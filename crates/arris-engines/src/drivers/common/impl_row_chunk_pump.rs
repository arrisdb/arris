use std::future::Future;

use futures::stream::{Stream, StreamExt};
use tokio::sync::mpsc;

use crate::drivers::constants::{STREAM_CHUNK_CHANNEL_CAPACITY, STREAM_CHUNK_ROWS};
use crate::drivers::errors::DriverError;
use crate::drivers::types::{ColumnSpec, QueryValue, RowChunkStream};

/// The reusable core every row-based streaming driver shares: spawns a background
/// task that opens a driver's row stream, drains it into `STREAM_CHUNK_ROWS`-sized
/// chunks over a bounded channel (keeping backpressure on the wire), and exposes
/// the receiver as a `RowChunkStream`. A driver supplies only two things: `open`,
/// how to start its native row stream (moved into the task so its client/statement
/// outlive the stream, and its initial error is surfaced as the first item), and
/// `map`, how to turn one native row into a `Vec<QueryValue>`. Dropping the
/// returned stream's receiver ends the task and its server cursor (drop-to-cancel).
pub struct RowChunkPump;

impl RowChunkPump {
    pub fn spawn<Row, St, Fut, Open, Map>(
        columns: Vec<ColumnSpec>,
        open: Open,
        map: Map,
    ) -> RowChunkStream
    where
        Open: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<St, DriverError>> + Send + 'static,
        St: Stream<Item = Result<Row, DriverError>> + Send + 'static,
        Map: Fn(&Row) -> Vec<QueryValue> + Send + 'static,
        Row: Send + 'static,
    {
        let (tx, rx) = mpsc::channel(STREAM_CHUNK_CHANNEL_CAPACITY);
        tokio::spawn(async move {
            let rows = match open().await {
                Ok(rows) => rows,
                Err(e) => {
                    let _ = tx.send(Err(e)).await;
                    return;
                }
            };
            futures::pin_mut!(rows);
            let mut chunk: Vec<Vec<QueryValue>> = Vec::with_capacity(STREAM_CHUNK_ROWS);
            while let Some(item) = rows.next().await {
                match item {
                    Ok(row) => {
                        chunk.push(map(&row));
                        if chunk.len() >= STREAM_CHUNK_ROWS {
                            let full = std::mem::replace(
                                &mut chunk,
                                Vec::with_capacity(STREAM_CHUNK_ROWS),
                            );
                            if tx.send(Ok(full)).await.is_err() {
                                return;
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(e)).await;
                        return;
                    }
                }
            }
            if !chunk.is_empty() {
                let _ = tx.send(Ok(chunk)).await;
            }
        });
        let chunks = futures::stream::unfold(rx, |mut rx| async move {
            rx.recv().await.map(|item| (item, rx))
        })
        .boxed();
        RowChunkStream { columns, chunks }
    }
}

#[cfg(test)]
mod tests {
    use futures::stream::{self, BoxStream};

    use super::*;

    fn cols() -> Vec<ColumnSpec> {
        vec![ColumnSpec::new("n", "int8")]
    }

    async fn drain(rs: RowChunkStream) -> Vec<Result<Vec<Vec<QueryValue>>, DriverError>> {
        let mut chunks = rs.chunks;
        let mut out = Vec::new();
        while let Some(item) = chunks.next().await {
            out.push(item);
        }
        out
    }

    fn int_rows(values: Vec<i64>) -> BoxStream<'static, Result<i64, DriverError>> {
        stream::iter(values.into_iter().map(Ok)).boxed()
    }

    #[tokio::test]
    async fn forwards_every_row_and_carries_columns() {
        let rs = RowChunkPump::spawn(
            cols(),
            || async { Ok(int_rows(vec![1, 2, 3])) },
            |n: &i64| vec![QueryValue::Int(*n)],
        );
        assert_eq!(rs.columns, cols());
        let flat: Vec<QueryValue> = drain(rs)
            .await
            .into_iter()
            .flat_map(|c| c.unwrap())
            .flatten()
            .collect();
        assert_eq!(
            flat,
            vec![QueryValue::Int(1), QueryValue::Int(2), QueryValue::Int(3)]
        );
    }

    #[tokio::test]
    async fn splits_into_chunks_at_the_configured_size() {
        let total = STREAM_CHUNK_ROWS + 1;
        let rs = RowChunkPump::spawn(
            cols(),
            move || async move { Ok(int_rows((0..total as i64).collect())) },
            |n: &i64| vec![QueryValue::Int(*n)],
        );
        let chunks = drain(rs).await;
        assert_eq!(chunks.len(), 2, "one full chunk plus a one-row tail");
        assert_eq!(chunks[0].as_ref().unwrap().len(), STREAM_CHUNK_ROWS);
        assert_eq!(chunks[1].as_ref().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn surfaces_an_error_opening_the_stream() {
        let rs = RowChunkPump::spawn(
            cols(),
            || async {
                Err::<BoxStream<'static, Result<i64, DriverError>>, _>(DriverError::QueryFailed(
                    "boom".into(),
                ))
            },
            |n: &i64| vec![QueryValue::Int(*n)],
        );
        let chunks = drain(rs).await;
        assert_eq!(chunks.len(), 1);
        assert!(matches!(chunks[0], Err(DriverError::QueryFailed(_))));
    }

    #[tokio::test]
    async fn stops_at_a_mid_stream_error() {
        let stream = stream::iter(vec![
            Ok(1i64),
            Err(DriverError::QueryFailed("wire dropped".into())),
            Ok(2),
        ])
        .boxed();
        let rs = RowChunkPump::spawn(cols(), move || async move { Ok(stream) }, |n: &i64| {
            vec![QueryValue::Int(*n)]
        });
        let chunks = drain(rs).await;
        // The pre-error rows were still in the open chunk (never flushed), so the
        // only item delivered is the error; nothing after it.
        assert!(matches!(chunks.last(), Some(Err(DriverError::QueryFailed(_)))));
        assert!(!chunks.iter().any(|c| c.as_ref().is_ok_and(|rows| {
            rows.iter().any(|r| r == &vec![QueryValue::Int(2)])
        })));
    }
}
