use std::any::Any;
use std::fmt;
use std::sync::Arc;

use datafusion::arrow::array::{
    ArrayRef, BinaryArray, BooleanArray, Float64Array, Int64Array, StringArray,
};
use datafusion::arrow::datatypes::{DataType, Field, Schema, SchemaRef};
use datafusion::arrow::record_batch::{RecordBatch, RecordBatchOptions};
use datafusion::catalog::Session;
use datafusion::common::project_schema;
use datafusion::datasource::{TableProvider, TableType};
use datafusion::execution::{SendableRecordBatchStream, TaskContext};
use datafusion::logical_expr::{Expr, TableProviderFilterPushDown};
use datafusion::physical_expr::EquivalenceProperties;
use datafusion::physical_plan::execution_plan::{Boundedness, EmissionType};
use datafusion::physical_plan::stream::RecordBatchStreamAdapter;
use datafusion::physical_plan::{DisplayAs, DisplayFormatType, ExecutionPlan, PlanProperties};

use futures::TryStreamExt;

use super::impl_filter_translator::FilterTranslator;
use super::impl_metrics_stream::{MetricsStream, ProgressCallback};
use super::impl_scan_adapter::{ScanOptions, ScanSql};
use super::{FederationRef, ScanAdapter};
use crate::{ColumnSpec, QueryResult, QueryValue};

pub type NodeIdMap = Arc<std::sync::Mutex<std::collections::HashMap<String, usize>>>;

pub struct FederatedTableProvider {
    schema: SchemaRef,
    adapter: Arc<dyn ScanAdapter>,
    source: FederationRef,
    progress: Option<ProgressCallback>,
    node_id_map: Option<NodeIdMap>,
}

impl fmt::Debug for FederatedTableProvider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FederatedTableProvider")
            .field("source", &self.source.dotted_name())
            .finish()
    }
}

impl FederatedTableProvider {
    pub fn new(
        schema: SchemaRef,
        adapter: Arc<dyn ScanAdapter>,
        source: FederationRef,
    ) -> Self {
        Self {
            schema,
            adapter,
            source,
            progress: None,
            node_id_map: None,
        }
    }

    pub fn with_progress(mut self, callback: ProgressCallback, node_id_map: NodeIdMap) -> Self {
        self.progress = Some(callback);
        self.node_id_map = Some(node_id_map);
        self
    }
}

#[async_trait::async_trait]
impl TableProvider for FederatedTableProvider {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }

    fn table_type(&self) -> TableType {
        TableType::Base
    }

    async fn scan(
        &self,
        _state: &dyn Session,
        projection: Option<&Vec<usize>>,
        filters: &[Expr],
        limit: Option<usize>,
    ) -> datafusion::error::Result<Arc<dyn ExecutionPlan>> {
        let projected_schema = project_schema(&self.schema, projection)?;

        let select_columns: Option<Vec<String>> = projection.map(|indices| {
            indices
                .iter()
                .map(|&i| self.schema.field(i).name().clone())
                .collect()
        });

        Ok(Arc::new(FederatedExec::new(
            projected_schema,
            self.adapter.clone(),
            self.source.clone(),
            select_columns,
            filters.to_vec(),
            limit,
            self.progress.clone(),
            self.node_id_map.clone(),
        )))
    }

    fn supports_filters_pushdown(
        &self,
        filters: &[&Expr],
    ) -> datafusion::error::Result<Vec<TableProviderFilterPushDown>> {
        let kind = self.adapter.database_kind();
        Ok(filters
            .iter()
            .map(|f| {
                if FilterTranslator::expr_to_sql(f, kind).is_some() {
                    TableProviderFilterPushDown::Exact
                } else {
                    TableProviderFilterPushDown::Unsupported
                }
            })
            .collect())
    }
}

pub(crate) struct FederatedExec {
    projected_schema: SchemaRef,
    adapter: Arc<dyn ScanAdapter>,
    source: FederationRef,
    select_columns: Option<Vec<String>>,
    filters: Vec<Expr>,
    limit: Option<usize>,
    properties: PlanProperties,
    progress: Option<ProgressCallback>,
    node_id_map: Option<NodeIdMap>,
}

impl FederatedExec {
    pub(crate) fn source(&self) -> &FederationRef {
        &self.source
    }

    fn new(
        projected_schema: SchemaRef,
        adapter: Arc<dyn ScanAdapter>,
        source: FederationRef,
        select_columns: Option<Vec<String>>,
        filters: Vec<Expr>,
        limit: Option<usize>,
        progress: Option<ProgressCallback>,
        node_id_map: Option<NodeIdMap>,
    ) -> Self {
        let properties = PlanProperties::new(
            EquivalenceProperties::new(projected_schema.clone()),
            datafusion::physical_plan::Partitioning::UnknownPartitioning(1),
            EmissionType::Final,
            Boundedness::Bounded,
        );
        Self {
            projected_schema,
            adapter,
            source,
            select_columns,
            filters,
            limit,
            properties,
            progress,
            node_id_map,
        }
    }
}

// ── QueryResult → Arrow conversion ────────────────────────────────────────────

impl FederatedExec {
    pub(crate) fn infer_schema_from_result(result: &QueryResult) -> SchemaRef {
        let fields: Vec<Field> = result
            .columns
            .iter()
            .enumerate()
            .map(|(i, col)| {
                let dt = Self::infer_arrow_type(col, i, &result.rows);
                Field::new(&col.name, dt, true)
            })
            .collect();
        Arc::new(Schema::new(fields))
    }

    fn is_numeric_type_hint(hint: &str) -> bool {
        matches!(
            hint.to_lowercase().as_str(),
            "numeric"
                | "decimal"
                | "newdecimal"
                | "money"
                | "real"
                | "double precision"
                | "float"
                | "float4"
                | "float8"
                | "double"
                | "dec"
        )
    }

    fn infer_arrow_type(col: &ColumnSpec, col_idx: usize, rows: &[Vec<QueryValue>]) -> DataType {
        if Self::is_numeric_type_hint(&col.type_hint) {
            return DataType::Float64;
        }
        for row in rows {
            if let Some(val) = row.get(col_idx) {
                match val {
                    QueryValue::Null => continue,
                    QueryValue::Bool(_) => return DataType::Boolean,
                    QueryValue::Int(_) => return DataType::Int64,
                    QueryValue::Double(_) => return DataType::Float64,
                    QueryValue::Decimal(_) => return DataType::Float64,
                    QueryValue::Text(_) | QueryValue::Json(_) => return DataType::Utf8,
                    QueryValue::Data(_) => return DataType::Binary,
                }
            }
        }
        DataType::Utf8
    }

    pub(crate) fn query_result_to_record_batch(
        result: &QueryResult,
        schema: &SchemaRef,
    ) -> Result<RecordBatch, String> {
        if schema.fields().is_empty() {
            // Zero-column projection (e.g. `SELECT COUNT(*)`, where DataFusion needs
            // only the row count): a column-less batch must carry an explicit row
            // count rather than be inferred from its (absent) columns.
            let options = RecordBatchOptions::new().with_row_count(Some(result.rows.len()));
            return RecordBatch::try_new_with_options(schema.clone(), vec![], &options)
                .map_err(|e| e.to_string());
        }
        if result.columns.is_empty() {
            return RecordBatch::try_new(schema.clone(), vec![]).map_err(|e| e.to_string());
        }

        let col_map: std::collections::HashMap<&str, usize> = result
            .columns
            .iter()
            .enumerate()
            .map(|(i, c)| (c.name.as_str(), i))
            .collect();

        let arrays: Vec<ArrayRef> = schema
            .fields()
            .iter()
            .map(|field| {
                let src_idx = col_map.get(field.name().as_str()).copied();
                Self::build_array(field.data_type(), src_idx, &result.rows)
            })
            .collect();

        RecordBatch::try_new(schema.clone(), arrays).map_err(|e| e.to_string())
    }

    fn build_array(dt: &DataType, src_idx: Option<usize>, rows: &[Vec<QueryValue>]) -> ArrayRef {
        match dt {
            DataType::Boolean => {
                let arr: BooleanArray = rows
                    .iter()
                    .map(|row| {
                        src_idx.and_then(|i| row.get(i)).and_then(|v| match v {
                            QueryValue::Bool(b) => Some(*b),
                            _ => None,
                        })
                    })
                    .collect();
                Arc::new(arr) as ArrayRef
            }
            DataType::Int64 => {
                let arr: Int64Array = rows
                    .iter()
                    .map(|row| {
                        src_idx.and_then(|i| row.get(i)).and_then(|v| match v {
                            QueryValue::Int(n) => Some(*n),
                            _ => None,
                        })
                    })
                    .collect();
                Arc::new(arr) as ArrayRef
            }
            DataType::Float64 => {
                let arr: Float64Array = rows
                    .iter()
                    .map(|row| {
                        src_idx.and_then(|i| row.get(i)).and_then(|v| match v {
                            QueryValue::Double(n) => Some(*n),
                            QueryValue::Int(n) => Some(*n as f64),
                            QueryValue::Text(s) | QueryValue::Decimal(s) => s.parse::<f64>().ok(),
                            _ => None,
                        })
                    })
                    .collect();
                Arc::new(arr) as ArrayRef
            }
            DataType::Binary => {
                let arr: BinaryArray = rows
                    .iter()
                    .map(|row| {
                        src_idx.and_then(|i| row.get(i)).and_then(|v| match v {
                            QueryValue::Data(d) => Some(d.as_slice()),
                            _ => None,
                        })
                    })
                    .collect();
                Arc::new(arr) as ArrayRef
            }
            _ => {
                let strings: Vec<Option<String>> = rows
                    .iter()
                    .map(|row| {
                        src_idx.and_then(|i| row.get(i)).and_then(|v| match v {
                            QueryValue::Text(s) => Some(s.clone()),
                            QueryValue::Json(s) => Some(s.clone()),
                            QueryValue::Decimal(s) => Some(s.clone()),
                            QueryValue::Int(n) => Some(n.to_string()),
                            QueryValue::Double(n) => Some(n.to_string()),
                            QueryValue::Bool(b) => Some(b.to_string()),
                            _ => None,
                        })
                    })
                    .collect();
                let arr: StringArray = strings.iter().map(|s| s.as_deref()).collect();
                Arc::new(arr) as ArrayRef
            }
        }
    }
}

impl fmt::Debug for FederatedExec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FederatedExec")
            .field("source", &self.source.dotted_name())
            .field("filters", &self.filters.len())
            .field("limit", &self.limit)
            .finish()
    }
}

impl DisplayAs for FederatedExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "FederatedExec: source={}, filters={}, limit={:?}",
            self.source.dotted_name(),
            self.filters.len(),
            self.limit,
        )
    }
}

impl fmt::Display for FederatedExec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.fmt_as(DisplayFormatType::Default, f)
    }
}

impl ExecutionPlan for FederatedExec {
    fn name(&self) -> &str {
        "FederatedExec"
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> SchemaRef {
        self.projected_schema.clone()
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![]
    }

    fn with_new_children(
        self: Arc<Self>,
        _children: Vec<Arc<dyn ExecutionPlan>>,
    ) -> datafusion::error::Result<Arc<dyn ExecutionPlan>> {
        Ok(self)
    }

    fn execute(
        &self,
        _partition: usize,
        _context: Arc<TaskContext>,
    ) -> datafusion::error::Result<SendableRecordBatchStream> {
        let adapter = self.adapter.clone();
        let source = self.source.clone();
        let filters = self.filters.clone();
        let limit = self.limit;
        let schema = self.projected_schema.clone();
        let stream_schema = schema.clone();
        let select_columns = self.select_columns.clone();

        let stream = futures::stream::once(async move {
            let kind = adapter.database_kind();
            let (where_clause, _) = FilterTranslator::exprs_to_where_clause(&filters, kind);

            let sql = ScanSql::federation_scan_sql_with_options(
                kind,
                &source,
                &ScanOptions {
                    projections: select_columns.as_deref(),
                    where_clause: if where_clause.is_empty() {
                        None
                    } else {
                        Some(&where_clause)
                    },
                    limit,
                },
            )
            .map_err(|e| datafusion::error::DataFusionError::External(Box::new(e)))?;

            let result = adapter
                .scan_with_sql(&sql)
                .await
                .map_err(|e| datafusion::error::DataFusionError::External(Box::new(e)))?;

            let batch = FederatedExec::query_result_to_record_batch(&result, &schema)
                .map_err(|e| datafusion::error::DataFusionError::External(e.into()))?;

            Ok::<_, datafusion::error::DataFusionError>(batch)
        })
        .map_ok(|batch| {
            const CHUNK_SIZE: usize = 8192;
            let total = batch.num_rows();
            let mut batches = Vec::with_capacity((total / CHUNK_SIZE) + 1);
            let mut offset = 0;
            while offset < total {
                let len = CHUNK_SIZE.min(total - offset);
                batches.push(Ok(batch.slice(offset, len)));
                offset += len;
            }
            if batches.is_empty() {
                batches.push(Ok(batch));
            }
            futures::stream::iter(batches)
        })
        .try_flatten();

        let raw: SendableRecordBatchStream =
            Box::pin(RecordBatchStreamAdapter::new(stream_schema, stream));

        if let (Some(cb), Some(map)) = (&self.progress, &self.node_id_map) {
            let source_key = self.source.dotted_name();
            let node_id = map.lock().unwrap().get(&source_key).copied().unwrap_or(0);
            Ok(MetricsStream::wrap(raw, node_id, cb.clone()))
        } else {
            Ok(raw)
        }
    }

    fn properties(&self) -> &PlanProperties {
        &self.properties
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_column_projection_preserves_row_count() {
        // `SELECT COUNT(*)` makes DataFusion request an empty projection; the
        // batch must still report the underlying row count.
        let result = QueryResult {
            columns: vec![ColumnSpec {
                name: "customer_id".into(),
                type_hint: "integer".into(),
            }],
            rows: vec![
                vec![QueryValue::Int(1)],
                vec![QueryValue::Int(2)],
                vec![QueryValue::Int(3)],
            ],
            rows_affected: None,
            elapsed: 0.0,
            ..Default::default()
        };
        let empty_schema: SchemaRef = Arc::new(Schema::empty());

        let batch = FederatedExec::query_result_to_record_batch(&result, &empty_schema).unwrap();
        assert_eq!(batch.num_columns(), 0);
        assert_eq!(batch.num_rows(), 3);
    }
}
