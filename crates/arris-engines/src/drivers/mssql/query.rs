use futures::StreamExt;
use tiberius::{Column, Row};
use tokio::sync::{mpsc, oneshot};

use crate::drivers::constants::{STREAM_CHUNK_CHANNEL_CAPACITY, STREAM_CHUNK_ROWS};
use crate::drivers::errors::{DriverError, Result};
use crate::{ColumnSpec, QueryResult, QueryValue, RowChunkStream};

use super::MssqlClient;
use super::values::{SqlParam, ToSql, column_data_to_query, mssql_column_type_name};

pub(super) fn rows_to_query_result(columns: &[Column], rows: Vec<Row>, elapsed: f64) -> QueryResult {
    let column_specs: Vec<ColumnSpec> = columns
        .iter()
        .map(|c| ColumnSpec::new(c.name(), mssql_column_type_name(c.column_type())))
        .collect();

    let num_cols = columns.len();
    let mut out: Vec<Vec<QueryValue>> = Vec::with_capacity(rows.len());
    for row in rows {
        let mut vals: Vec<QueryValue> = row.into_iter().map(column_data_to_query).collect();
        vals.truncate(num_cols);
        out.push(vals);
    }

    QueryResult {
        columns: column_specs,
        rows: out,
        rows_affected: None,
        elapsed,
        ..Default::default()
    }
}

/// One streamed row to `QueryValue`s (cells moved out, not cloned).
pub(super) fn row_to_query_values(row: Row) -> Vec<QueryValue> {
    row.into_iter().map(column_data_to_query).collect()
}

/// Stream a SELECT over an owned ephemeral client: a spawned task runs the query,
/// reads the leading metadata into `ColumnSpec`s (sent up front over a oneshot,
/// since tiberius can only learn columns by executing), then chunks rows onto a
/// bounded channel. Dropping the receiver drops the task and its connection.
pub(super) async fn stream_query(
    mut client: MssqlClient,
    text: String,
    params: Vec<QueryValue>,
) -> Result<RowChunkStream> {
    let (col_tx, col_rx) = oneshot::channel::<Result<Vec<ColumnSpec>>>();
    let (chunk_tx, chunk_rx) = mpsc::channel(STREAM_CHUNK_CHANNEL_CAPACITY);

    tokio::spawn(async move {
        let sql_params: Vec<SqlParam> = params.into_iter().map(SqlParam).collect();
        let refs: Vec<&dyn ToSql> = sql_params.iter().map(|p| p as &dyn ToSql).collect();
        let mut stream = match client.query(&text, &refs).await {
            Ok(s) => s,
            Err(e) => {
                let _ = col_tx.send(Err(DriverError::QueryFailed(e.to_string())));
                return;
            }
        };
        let columns = match stream.columns().await {
            Ok(cols) => cols
                .unwrap_or_default()
                .iter()
                .map(|c| ColumnSpec::new(c.name(), mssql_column_type_name(c.column_type())))
                .collect(),
            Err(e) => {
                let _ = col_tx.send(Err(DriverError::QueryFailed(e.to_string())));
                return;
            }
        };
        if col_tx.send(Ok(columns)).is_err() {
            return;
        }

        let mut rows = stream.into_row_stream();
        let mut chunk: Vec<Vec<QueryValue>> = Vec::with_capacity(STREAM_CHUNK_ROWS);
        while let Some(item) = rows.next().await {
            match item {
                Ok(row) => {
                    chunk.push(row_to_query_values(row));
                    if chunk.len() >= STREAM_CHUNK_ROWS {
                        let full =
                            std::mem::replace(&mut chunk, Vec::with_capacity(STREAM_CHUNK_ROWS));
                        if chunk_tx.send(Ok(full)).await.is_err() {
                            return;
                        }
                    }
                }
                Err(e) => {
                    let _ = chunk_tx.send(Err(DriverError::QueryFailed(e.to_string()))).await;
                    return;
                }
            }
        }
        if !chunk.is_empty() {
            let _ = chunk_tx.send(Ok(chunk)).await;
        }
    });

    let columns = col_rx
        .await
        .map_err(|_| DriverError::QueryFailed("MSSQL stream task ended before sending columns".into()))??;
    let chunks = futures::stream::unfold(chunk_rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    })
    .boxed();
    Ok(RowChunkStream { columns, chunks })
}
