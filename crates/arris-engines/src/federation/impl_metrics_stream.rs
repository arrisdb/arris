use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Instant;

use datafusion::arrow::datatypes::SchemaRef;
use datafusion::arrow::record_batch::RecordBatch;
use datafusion::execution::SendableRecordBatchStream;
use datafusion::physical_plan::RecordBatchStream;
use futures::Stream;

use super::impl_plan_dag::{DagNodeStatus, NodeMetrics};

pub type ProgressCallback = Arc<dyn Fn(ProgressEvent) + Send + Sync>;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub node_id: usize,
    pub status: DagNodeStatus,
    pub metrics: Option<NodeMetrics>,
}

pub struct MetricsStream {
    inner: SendableRecordBatchStream,
    node_id: usize,
    callback: ProgressCallback,
    started: bool,
    start_time: Instant,
    rows_produced: u64,
}

impl MetricsStream {
    pub fn wrap(
        inner: SendableRecordBatchStream,
        node_id: usize,
        callback: ProgressCallback,
    ) -> SendableRecordBatchStream {
        Box::pin(Self {
            inner,
            node_id,
            callback,
            started: false,
            start_time: Instant::now(),
            rows_produced: 0,
        })
    }
}

impl Stream for MetricsStream {
    type Item = datafusion::error::Result<RecordBatch>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        if !self.started {
            self.started = true;
            self.start_time = Instant::now();
            (self.callback)(ProgressEvent {
                node_id: self.node_id,
                status: DagNodeStatus::Running,
                metrics: None,
            });
        }

        match Pin::new(&mut self.inner).poll_next(cx) {
            Poll::Ready(Some(Ok(batch))) => {
                self.rows_produced += batch.num_rows() as u64;
                Poll::Ready(Some(Ok(batch)))
            }
            Poll::Ready(Some(Err(e))) => {
                (self.callback)(ProgressEvent {
                    node_id: self.node_id,
                    status: DagNodeStatus::Error,
                    metrics: Some(NodeMetrics {
                        rows_produced: self.rows_produced,
                        elapsed_ms: self.start_time.elapsed().as_millis() as u64,
                    }),
                });
                Poll::Ready(Some(Err(e)))
            }
            Poll::Ready(None) => {
                (self.callback)(ProgressEvent {
                    node_id: self.node_id,
                    status: DagNodeStatus::Done,
                    metrics: Some(NodeMetrics {
                        rows_produced: self.rows_produced,
                        elapsed_ms: self.start_time.elapsed().as_millis() as u64,
                    }),
                });
                Poll::Ready(None)
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

impl RecordBatchStream for MetricsStream {
    fn schema(&self) -> SchemaRef {
        self.inner.schema()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use datafusion::arrow::array::Int64Array;
    use datafusion::arrow::datatypes::{DataType, Field, Schema};
    use datafusion::physical_plan::stream::RecordBatchStreamAdapter;
    use futures::StreamExt;
    use std::sync::Mutex;

    fn test_schema() -> SchemaRef {
        Arc::new(Schema::new(vec![Field::new("id", DataType::Int64, false)]))
    }

    fn test_batch(schema: &SchemaRef, rows: usize) -> RecordBatch {
        let ids: Vec<i64> = (0..rows as i64).collect();
        RecordBatch::try_new(schema.clone(), vec![Arc::new(Int64Array::from(ids))]).unwrap()
    }

    #[tokio::test]
    async fn emits_running_on_first_poll() {
        let schema = test_schema();
        let batch = test_batch(&schema, 5);
        let stream_schema = schema.clone();
        let inner: SendableRecordBatchStream = Box::pin(RecordBatchStreamAdapter::new(
            stream_schema,
            futures::stream::iter(vec![Ok(batch)]),
        ));

        let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let callback: ProgressCallback = Arc::new(move |e| {
            events_clone.lock().unwrap().push(e);
        });

        let mut wrapped = MetricsStream::wrap(inner, 42, callback);
        let _ = wrapped.next().await;
        let _ = wrapped.next().await;

        let captured = events.lock().unwrap();
        assert_eq!(captured.len(), 2);
        assert_eq!(captured[0].status, DagNodeStatus::Running);
        assert_eq!(captured[0].node_id, 42);
        assert_eq!(captured[1].status, DagNodeStatus::Done);
        assert_eq!(captured[1].metrics.as_ref().unwrap().rows_produced, 5);
    }

    #[tokio::test]
    async fn emits_done_with_total_row_count() {
        let schema = test_schema();
        let b1 = test_batch(&schema, 3);
        let b2 = test_batch(&schema, 7);
        let stream_schema = schema.clone();
        let inner: SendableRecordBatchStream = Box::pin(RecordBatchStreamAdapter::new(
            stream_schema,
            futures::stream::iter(vec![Ok(b1), Ok(b2)]),
        ));

        let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let callback: ProgressCallback = Arc::new(move |e| {
            events_clone.lock().unwrap().push(e);
        });

        let mut wrapped = MetricsStream::wrap(inner, 0, callback);
        while wrapped.next().await.is_some() {}

        let captured = events.lock().unwrap();
        let done = captured.iter().find(|e| e.status == DagNodeStatus::Done).unwrap();
        assert_eq!(done.metrics.as_ref().unwrap().rows_produced, 10);
    }

    #[tokio::test]
    async fn emits_error_on_stream_error() {
        let schema = test_schema();
        let stream_schema = schema.clone();
        let inner: SendableRecordBatchStream = Box::pin(RecordBatchStreamAdapter::new(
            stream_schema,
            futures::stream::iter(vec![Err(datafusion::error::DataFusionError::Plan(
                "test error".into(),
            ))]),
        ));

        let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let callback: ProgressCallback = Arc::new(move |e| {
            events_clone.lock().unwrap().push(e);
        });

        let mut wrapped = MetricsStream::wrap(inner, 1, callback);
        let _ = wrapped.next().await;

        let captured = events.lock().unwrap();
        assert!(captured.iter().any(|e| e.status == DagNodeStatus::Error));
    }

    #[tokio::test]
    async fn empty_stream_emits_running_then_done() {
        let schema = test_schema();
        let stream_schema = schema.clone();
        let inner: SendableRecordBatchStream = Box::pin(RecordBatchStreamAdapter::new(
            stream_schema,
            futures::stream::empty(),
        ));

        let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let callback: ProgressCallback = Arc::new(move |e| {
            events_clone.lock().unwrap().push(e);
        });

        let mut wrapped = MetricsStream::wrap(inner, 0, callback);
        while wrapped.next().await.is_some() {}

        let captured = events.lock().unwrap();
        assert_eq!(captured.len(), 2);
        assert_eq!(captured[0].status, DagNodeStatus::Running);
        assert_eq!(captured[1].status, DagNodeStatus::Done);
        assert_eq!(captured[1].metrics.as_ref().unwrap().rows_produced, 0);
    }
}
