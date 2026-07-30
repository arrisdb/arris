use std::sync::Arc;

use async_trait::async_trait;
use datafusion::arrow::array::{ArrayRef, RecordBatch, RecordBatchOptions};
use datafusion::arrow::datatypes::SchemaRef;
use datafusion::error::{DataFusionError, Result as DfResult};
use datafusion::physical_plan::stream::RecordBatchStreamAdapter;
use datafusion::physical_plan::{PhysicalExpr, SendableRecordBatchStream};
use datafusion::sql::unparser::dialect::{
    BigQueryDialect, Dialect, DuckDBDialect, MySqlDialect, PostgreSqlDialect, SqliteDialect,
};
use datafusion_federation::sql::SQLExecutor;

use crate::drivers::common::ArrowChunkBuilder;
use crate::{DatabaseKind, QueryResult};

use super::ScanAdapter;
use super::constants::EXECUTOR_CATALOG_UNSUPPORTED;
use super::impl_federated_table_provider::NodeIdMap;
use super::impl_metrics_stream::{MetricsStream, ProgressCallback};

/// Runs a subplan that `datafusion-federation` unparsed into this dialect.
pub(super) struct DriverSqlExecutor {
    adapter: Arc<dyn ScanAdapter>,
    connection: String,
    kind: DatabaseKind,
    progress: Option<(ProgressCallback, NodeIdMap)>,
}

impl DriverSqlExecutor {
    pub(super) fn new(
        adapter: Arc<dyn ScanAdapter>,
        connection: String,
        kind: DatabaseKind,
    ) -> Self {
        Self { adapter, connection, kind, progress: None }
    }

    pub(super) fn with_progress(
        mut self,
        callback: ProgressCallback,
        node_id_map: NodeIdMap,
    ) -> Self {
        self.progress = Some((callback, node_id_map));
        self
    }

    /// Without a real unparser dialect a kind keeps the plain scan path.
    pub(super) fn supports_subplan_pushdown(kind: DatabaseKind) -> bool {
        matches!(
            kind,
            DatabaseKind::Postgres
                | DatabaseKind::Redshift
                | DatabaseKind::Mysql
                | DatabaseKind::Mariadb
                | DatabaseKind::Sqlite
                | DatabaseKind::Duckdb
                | DatabaseKind::Bigquery
        )
    }

    fn dialect_for(kind: DatabaseKind) -> Arc<dyn Dialect> {
        match kind {
            DatabaseKind::Postgres | DatabaseKind::Redshift => Arc::new(PostgreSqlDialect {}),
            DatabaseKind::Mysql | DatabaseKind::Mariadb => Arc::new(MySqlDialect {}),
            DatabaseKind::Sqlite => Arc::new(SqliteDialect {}),
            DatabaseKind::Duckdb => Arc::new(DuckDBDialect::new()),
            _ => Arc::new(BigQueryDialect {}),
        }
    }

    /// By position, not name: the source names an aggregate itself (`f0_`).
    fn to_record_batch(result: &QueryResult, schema: &SchemaRef) -> Result<RecordBatch, String> {
        if schema.fields().is_empty() {
            let options = RecordBatchOptions::new().with_row_count(Some(result.rows.len()));
            return RecordBatch::try_new_with_options(schema.clone(), vec![], &options)
                .map_err(|e| e.to_string());
        }
        if result.columns.len() != schema.fields().len() {
            return Err(format!(
                "pushed-down query returned {} columns, plan expected {}",
                result.columns.len(),
                schema.fields().len()
            ));
        }
        let arrays: Vec<ArrayRef> = schema
            .fields()
            .iter()
            .enumerate()
            .map(|(i, field)| ArrowChunkBuilder::build_array(field.data_type(), Some(i), &result.rows))
            .collect();
        RecordBatch::try_new(schema.clone(), arrays).map_err(|e| e.to_string())
    }
}

#[async_trait]
impl SQLExecutor for DriverSqlExecutor {
    fn name(&self) -> &str {
        &self.connection
    }

    /// Keyed by connection: only same-connection tables may federate together.
    fn compute_context(&self) -> Option<String> {
        Some(self.connection.clone())
    }

    fn dialect(&self) -> Arc<dyn Dialect> {
        Self::dialect_for(self.kind)
    }

    fn execute(
        &self,
        query: &str,
        schema: SchemaRef,
        _filters: &[Arc<dyn PhysicalExpr>],
    ) -> DfResult<SendableRecordBatchStream> {
        let adapter = self.adapter.clone();
        let sql = query.to_owned();
        let batch_schema = schema.clone();
        let stream = futures::stream::once(async move {
            let result = adapter
                .scan_with_sql(&sql)
                .await
                .map_err(|e| DataFusionError::External(Box::new(e)))?;
            Self::to_record_batch(&result, &batch_schema)
                .map_err(|e| DataFusionError::External(e.into()))
        });
        let raw: SendableRecordBatchStream = Box::pin(RecordBatchStreamAdapter::new(schema, stream));
        let Some((callback, node_id_map)) = &self.progress else {
            return Ok(raw);
        };
        let node_id = node_id_map
            .lock()
            .unwrap()
            .get(&self.connection)
            .copied()
            .unwrap_or(0);
        Ok(MetricsStream::wrap(raw, node_id, callback.clone()))
    }

    // Tables are registered with an already-probed schema, so these never run.
    async fn table_names(&self) -> DfResult<Vec<String>> {
        Err(DataFusionError::NotImplemented(
            EXECUTOR_CATALOG_UNSUPPORTED.to_owned(),
        ))
    }

    async fn get_table_schema(&self, _table_name: &str) -> DfResult<SchemaRef> {
        Err(DataFusionError::NotImplemented(
            EXECUTOR_CATALOG_UNSUPPORTED.to_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use datafusion::arrow::datatypes::{DataType, Field, Schema};

    use super::*;
    use crate::{ColumnSpec, QueryValue};

    fn schema(fields: Vec<(&str, DataType)>) -> SchemaRef {
        Arc::new(Schema::new(
            fields
                .into_iter()
                .map(|(n, t)| Field::new(n, t, true))
                .collect::<Vec<_>>(),
        ))
    }

    fn result(columns: Vec<&str>, rows: Vec<Vec<QueryValue>>) -> QueryResult {
        QueryResult::new(
            columns.into_iter().map(|c| ColumnSpec::new(c, "int8")).collect(),
            rows,
        )
    }

    #[test]
    fn maps_columns_by_position_not_name() {
        let out = schema(vec![("count(*)", DataType::Int64)]);
        let batch =
            DriverSqlExecutor::to_record_batch(&result(vec!["f0_"], vec![vec![QueryValue::Int(700000)]]), &out)
                .unwrap();
        assert_eq!(batch.num_rows(), 1);
        assert_eq!(batch.num_columns(), 1);
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<datafusion::arrow::array::Int64Array>()
            .unwrap();
        assert_eq!(col.value(0), 700000);
    }

    #[test]
    fn column_count_mismatch_is_an_error_not_silent_nulls() {
        let out = schema(vec![("a", DataType::Int64), ("b", DataType::Int64)]);
        let err = DriverSqlExecutor::to_record_batch(&result(vec!["a"], vec![vec![QueryValue::Int(1)]]), &out)
            .unwrap_err();
        assert!(err.contains("returned 1 columns"), "{err}");
    }

    #[test]
    fn zero_column_plan_keeps_the_row_count() {
        let empty: SchemaRef = Arc::new(Schema::empty());
        let rows = vec![vec![QueryValue::Int(1)], vec![QueryValue::Int(2)]];
        let batch = DriverSqlExecutor::to_record_batch(&result(vec!["x"], rows), &empty).unwrap();
        assert_eq!(batch.num_columns(), 0);
        assert_eq!(batch.num_rows(), 2);
    }

    #[test]
    fn pushdown_is_limited_to_kinds_with_an_unparser_dialect() {
        assert!(DriverSqlExecutor::supports_subplan_pushdown(DatabaseKind::Bigquery));
        assert!(DriverSqlExecutor::supports_subplan_pushdown(DatabaseKind::Postgres));
        assert!(!DriverSqlExecutor::supports_subplan_pushdown(DatabaseKind::Mongodb));
        assert!(!DriverSqlExecutor::supports_subplan_pushdown(DatabaseKind::Dynamodb));
        assert!(!DriverSqlExecutor::supports_subplan_pushdown(DatabaseKind::Trino));
    }
}
