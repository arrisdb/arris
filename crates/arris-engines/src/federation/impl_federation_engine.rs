use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use datafusion::arrow::array::{
    Array, BinaryArray, BooleanArray, Float32Array, Float64Array, Int16Array, Int32Array,
    Int64Array, Int8Array, StringArray, UInt16Array, UInt32Array, UInt64Array, UInt8Array,
};
use datafusion::arrow::datatypes::DataType;
use datafusion::arrow::record_batch::RecordBatch;
use datafusion::execution::disk_manager::DiskManagerBuilder;
use datafusion::execution::memory_pool::FairSpillPool;
use datafusion::execution::runtime_env::RuntimeEnvBuilder;
use datafusion::prelude::*;
use futures::StreamExt;
use tokio_util::sync::CancellationToken;

use datafusion::arrow::datatypes::SchemaRef;
use datafusion::catalog::TableProvider;
use datafusion::execution::session_state::SessionStateBuilder;
use datafusion::sql::TableReference;
use datafusion_federation::sql::{RemoteTableRef, SQLFederationProvider, SQLTableSource};
use datafusion_federation::{FederatedQueryPlanner, FederatedTableProviderAdaptor};

use super::constants::NO_REFERENCES_FOUND;
use super::errors::*;
use super::impl_driver_sql_executor::DriverSqlExecutor;
use super::impl_federation_ref_rewriter::FederationRefRewriter;
use super::impl_federated_table_provider::{FederatedExec, FederatedTableProvider, NodeIdMap};
use super::impl_metrics_stream::{ProgressCallback, ProgressEvent};
use super::impl_plan_dag::{DagNode, DagNodeStatus, DagNodeType, PlanDag};
use super::impl_scan_adapter::{DriverScanAdapter, ScanAdapter, ScanOptions, ScanSql};
use super::types::*;
use crate::connection::{ConnectionEngine, ScopedConnection};
use crate::query::QueryEngine;
use crate::Engine;
use crate::{ColumnSpec, DatabaseKind, DriverError, QueryResult, QueryValue};

const MEMORY_POOL_SIZE: usize = 512 * 1024 * 1024;

pub struct FederationEngine {
    adapters: HashMap<String, Arc<dyn ScanAdapter>>,
}

impl FederationEngine {
    pub fn new(adapters: HashMap<String, Arc<dyn ScanAdapter>>) -> Self {
        Self { adapters }
    }

    pub async fn execute(&self, sql: &str) -> Result<QueryResult, FederationError> {
        self.execute_with_cancel(sql, None).await
    }

    pub async fn execute_with_cancel(
        &self,
        sql: &str,
        cancel_token: Option<&CancellationToken>,
    ) -> Result<QueryResult, FederationError> {
        let start = Instant::now();
        let (rewritten, refs) = Self::rewrite(sql)?;

        let ctx = Self::create_session_context()?;

        let unique_refs = {
            let mut seen = std::collections::HashSet::new();
            refs.iter()
                .filter(|r| seen.insert((r.connection.clone(), r.schema.clone(), r.table.clone())))
                .cloned()
                .collect::<Vec<_>>()
        };

        for fref in &unique_refs {
            let conn_lower = fref.connection.to_lowercase();
            let adapter = self
                .adapters
                .iter()
                .find(|(k, _)| k.to_lowercase() == conn_lower)
                .map(|(_, v)| v)
                .ok_or_else(|| {
                    FederationError::InvalidReference(format!(
                        "unknown connection '{}'; available: {}",
                        fref.connection,
                        self.adapters.keys().cloned().collect::<Vec<_>>().join(", ")
                    ))
                })?;

            let kind = adapter.database_kind();
            let schema_sql = ScanSql::federation_scan_sql_with_options(
                kind,
                fref,
                &ScanOptions {
                    projections: None,
                    where_clause: None,
                    limit: Some(1),
                },
            )
            .map_err(|e| FederationError::Engine(e.to_string()))?;

            let probe = adapter.scan_with_sql(&schema_sql).await.map_err(|e| {
                FederationError::ScanFailed {
                    connection: fref.connection.clone(),
                    source: e,
                }
            })?;

            let schema = FederatedExec::infer_schema_from_result(&probe);

            let provider =
                FederatedTableProvider::new(schema.clone(), adapter.clone(), fref.clone());
            let provider = Self::table_provider_for(adapter, fref, schema, provider, None);

            ctx.register_table(TableReference::bare(fref.dotted_name()), provider)
                .map_err(|e| FederationError::Engine(e.to_string()))?;
        }

        let df = ctx
            .sql(&rewritten)
            .await
            .map_err(|e| FederationError::Engine(e.to_string()))?;

        let mut stream = df
            .execute_stream()
            .await
            .map_err(|e| FederationError::Engine(e.to_string()))?;

        let mut columns: Option<Vec<ColumnSpec>> = None;
        let mut rows = Vec::new();

        loop {
            let next_batch = match cancel_token {
                Some(token) => {
                    tokio::select! {
                        // Poll cancellation first so an already-cancelled token wins
                        // deterministically even when the next batch is immediately ready.
                        biased;
                        _ = token.cancelled() => {
                            for adapter in self.adapters.values() {
                                let _ = adapter.cancel_running_query().await;
                            }
                            return Err(FederationError::Engine(
                                DriverError::Cancelled.to_string(),
                            ));
                        }
                        batch = stream.next() => batch,
                    }
                }
                None => stream.next().await,
            };

            match next_batch {
                Some(Ok(batch)) => {
                    if columns.is_none() {
                        columns = Some(Self::schema_to_column_specs(&batch));
                    }
                    Self::append_batch_rows(&batch, &mut rows);
                }
                Some(Err(e)) => return Err(FederationError::Engine(e.to_string())),
                None => break,
            }
        }

        Ok(QueryResult {
            columns: columns.unwrap_or_default(),
            rows,
            rows_affected: None,
            elapsed: start.elapsed().as_secs_f64(),
            ..Default::default()
        })
    }

    pub async fn execute_with_progress(
        &self,
        sql: &str,
        cancel_token: Option<&CancellationToken>,
        on_plan: impl FnOnce(&[DagNode]),
        progress: ProgressCallback,
    ) -> Result<QueryResult, FederationError> {
        let start = Instant::now();
        let (rewritten, refs) = Self::rewrite(sql)?;

        let ctx = Self::create_session_context()?;
        let node_id_map: NodeIdMap = Arc::new(Mutex::new(HashMap::new()));

        let unique_refs = {
            let mut seen = std::collections::HashSet::new();
            refs.iter()
                .filter(|r| seen.insert((r.connection.clone(), r.schema.clone(), r.table.clone())))
                .cloned()
                .collect::<Vec<_>>()
        };

        for fref in &unique_refs {
            let conn_lower = fref.connection.to_lowercase();
            let adapter = self
                .adapters
                .iter()
                .find(|(k, _)| k.to_lowercase() == conn_lower)
                .map(|(_, v)| v)
                .ok_or_else(|| {
                    FederationError::InvalidReference(format!(
                        "unknown connection '{}'; available: {}",
                        fref.connection,
                        self.adapters.keys().cloned().collect::<Vec<_>>().join(", ")
                    ))
                })?;

            let kind = adapter.database_kind();
            let schema_sql = ScanSql::federation_scan_sql_with_options(
                kind,
                fref,
                &ScanOptions {
                    projections: None,
                    where_clause: None,
                    limit: Some(1),
                },
            )
            .map_err(|e| FederationError::Engine(e.to_string()))?;

            let probe = adapter.scan_with_sql(&schema_sql).await.map_err(|e| {
                FederationError::ScanFailed {
                    connection: fref.connection.clone(),
                    source: e,
                }
            })?;

            let schema = FederatedExec::infer_schema_from_result(&probe);
            let provider =
                FederatedTableProvider::new(schema.clone(), adapter.clone(), fref.clone())
                    .with_progress(progress.clone(), node_id_map.clone());
            let provider = Self::table_provider_for(
                adapter,
                fref,
                schema,
                provider,
                Some((progress.clone(), node_id_map.clone())),
            );

            ctx.register_table(TableReference::bare(fref.dotted_name()), provider)
                .map_err(|e| FederationError::Engine(e.to_string()))?;
        }

        let df = ctx
            .sql(&rewritten)
            .await
            .map_err(|e| FederationError::Engine(e.to_string()))?;

        let plan = df
            .create_physical_plan()
            .await
            .map_err(|e| FederationError::Engine(e.to_string()))?;

        let connection_names: Vec<String> = self.adapters.keys().cloned().collect();
        let (dag, plan_refs) = PlanDag::build_dag(&plan, &connection_names);

        {
            let mut map = node_id_map.lock().unwrap();
            for (id, source) in PlanDag::scan_node_sources(&dag) {
                map.insert(source, id);
            }
        }

        on_plan(&dag);

        let non_scan_ids: Vec<usize> = dag
            .iter()
            .filter(|n| n.node_type != DagNodeType::Scan)
            .map(|n| n.id)
            .collect();

        let progress_poll = progress.clone();
        let plan_refs_poll = plan_refs.clone();
        let non_scan_ids_poll = non_scan_ids.clone();
        let poll_handle = tokio::spawn(async move {
            let mut seen = std::collections::HashSet::new();
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                for &id in &non_scan_ids_poll {
                    if seen.contains(&id) {
                        continue;
                    }
                    if let Some(p) = plan_refs_poll.get(&id) {
                        if let Some(ms) = p.metrics() {
                            if ms.output_rows().unwrap_or(0) > 0 {
                                seen.insert(id);
                                progress_poll(ProgressEvent {
                                    node_id: id,
                                    status: DagNodeStatus::Running,
                                    metrics: None,
                                });
                            }
                        }
                    }
                }
                if seen.len() == non_scan_ids_poll.len() {
                    break;
                }
            }
        });

        let mut stream = datafusion::physical_plan::execute_stream(plan, ctx.task_ctx())
            .map_err(|e| FederationError::Engine(e.to_string()))?;

        let mut columns: Option<Vec<ColumnSpec>> = None;
        let mut rows = Vec::new();

        loop {
            let next_batch = match cancel_token {
                Some(token) => {
                    tokio::select! {
                        // Poll cancellation first so an already-cancelled token wins
                        // deterministically even when the next batch is immediately ready.
                        biased;
                        _ = token.cancelled() => {
                            for adapter in self.adapters.values() {
                                let _ = adapter.cancel_running_query().await;
                            }
                            poll_handle.abort();
                            return Err(FederationError::Engine(
                                DriverError::Cancelled.to_string(),
                            ));
                        }
                        batch = stream.next() => batch,
                    }
                }
                None => stream.next().await,
            };

            match next_batch {
                Some(Ok(batch)) => {
                    if columns.is_none() {
                        columns = Some(Self::schema_to_column_specs(&batch));
                    }
                    Self::append_batch_rows(&batch, &mut rows);
                }
                Some(Err(e)) => {
                    poll_handle.abort();
                    return Err(FederationError::Engine(e.to_string()));
                }
                None => break,
            }
        }

        poll_handle.abort();

        for &id in &non_scan_ids {
            let metrics = plan_refs
                .get(&id)
                .and_then(|p| PlanDag::extract_plan_metrics(p.as_ref()));
            progress(ProgressEvent {
                node_id: id,
                status: DagNodeStatus::Done,
                metrics,
            });
        }

        Ok(QueryResult {
            columns: columns.unwrap_or_default(),
            rows,
            rows_affected: None,
            elapsed: start.elapsed().as_secs_f64(),
            ..Default::default()
        })
    }

    pub fn parse_refs(sql: &str) -> Vec<FederationRef> {
        FederationRefRewriter::parse(sql).unwrap_or_default()
    }

    /// Aliases every federated reference and reports the refs, so the caller knows
    /// which tables to register before handing the query to DataFusion.
    fn rewrite(sql: &str) -> Result<(String, Vec<FederationRef>), FederationError> {
        let (rewritten, refs) = FederationRefRewriter::apply(sql)
            .map_err(|e| FederationError::Engine(e.to_string()))?;
        if refs.is_empty() {
            return Err(FederationError::InvalidReference(
                NO_REFERENCES_FOUND.into(),
            ));
        }
        Ok((rewritten, refs))
    }

    pub fn scan_sql(
        kind: DatabaseKind,
        source: &FederationRef,
    ) -> crate::drivers::errors::Result<String> {
        ScanSql::federation_scan_sql(kind, source)
    }

    pub async fn run_query(
        sql: &str,
        connections: &[ScopedConnection],
        connection_engine: &ConnectionEngine,
        query_engine: &QueryEngine,
        query_id: Option<String>,
        on_plan: impl FnOnce(&[DagNode]) + Send,
        progress: ProgressCallback,
    ) -> Result<QueryResult, FederationError> {
        let refs = Self::parse_refs(sql);

        let mut seen = std::collections::HashSet::new();
        let mut conn_infos: Vec<(String, crate::ConnectionConfig, DatabaseKind)> = Vec::new();
        for fref in &refs {
            let conn_lower = fref.connection.to_lowercase();
            if !seen.insert(conn_lower.clone()) {
                continue;
            }
            let sc = connections
                .iter()
                .find(|c| c.config.name.to_lowercase() == conn_lower)
                .ok_or_else(|| {
                    FederationError::InvalidReference(format!(
                        "unknown connection '{}'; available: {}",
                        fref.connection,
                        connections
                            .iter()
                            .map(|c| c.config.name.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ))
                })?;
            Self::scan_sql(sc.config.kind, fref).map_err(|e| {
                FederationError::InvalidReference(format!(
                    "connection '{}' ({:?}) does not support SQL federation scans: {e}",
                    sc.config.name, sc.config.kind
                ))
            })?;
            conn_infos.push((
                sc.config.name.clone(),
                sc.config.clone(),
                sc.config.kind,
            ));
        }

        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        for (name, cfg, kind) in conn_infos {
            let driver = connection_engine
                .open_connection(&cfg)
                .await
                .map_err(|e| FederationError::Connection(e.to_string()))?;
            adapters.insert(name, Arc::new(DriverScanAdapter::new(driver, kind)));
        }

        let cancel_token = query_id
            .as_ref()
            .map(|qid| query_engine.register_cancel_token(qid.clone()));

        let engine = Self::new(adapters);
        let result = engine
            .execute_with_progress(sql, cancel_token.as_ref(), on_plan, progress)
            .await;

        if let Some(qid) = &query_id {
            query_engine.unregister_query(qid);
        }

        result
    }
}

impl FederationEngine {
    fn create_session_context() -> Result<SessionContext, FederationError> {
        let runtime = RuntimeEnvBuilder::new()
            .with_memory_pool(Arc::new(FairSpillPool::new(MEMORY_POOL_SIZE)))
            .with_disk_manager_builder(DiskManagerBuilder::default())
            .build_arc()
            .map_err(|e| FederationError::Engine(e.to_string()))?;
        let mut config = SessionConfig::new();
        config.options_mut().optimizer.prefer_hash_join = false;
        // These two are what push a single-source subplan into the source.
        let state = SessionStateBuilder::new()
            .with_config(config)
            .with_runtime_env(runtime)
            .with_optimizer_rules(datafusion_federation::default_optimizer_rules())
            .with_query_planner(Arc::new(FederatedQueryPlanner::new()))
            .with_default_features()
            .build();
        Ok(SessionContext::new_with_state(state))
    }

    /// The adaptor pushes whole single-source subplans down, falling back to
    /// `provider` when the optimizer declines to federate.
    fn table_provider_for(
        adapter: &Arc<dyn ScanAdapter>,
        source: &FederationRef,
        schema: SchemaRef,
        provider: FederatedTableProvider,
        progress: Option<(ProgressCallback, NodeIdMap)>,
    ) -> Arc<dyn TableProvider> {
        let kind = adapter.database_kind();
        if !DriverSqlExecutor::supports_subplan_pushdown(kind) {
            return Arc::new(provider);
        }
        let executor = DriverSqlExecutor::new(adapter.clone(), source.connection.clone(), kind);
        let executor = Arc::new(match progress {
            Some((callback, map)) => executor.with_progress(callback, map),
            None => executor,
        });
        let remote = match source.schema.as_deref().filter(|s| !s.is_empty()) {
            Some(schema_name) => TableReference::partial(schema_name, source.table.as_str()),
            None => TableReference::bare(source.table.as_str()),
        };
        let table_source = Arc::new(SQLTableSource::new_with_schema(
            Arc::new(SQLFederationProvider::new(executor)),
            RemoteTableRef::from(remote),
            schema,
        ));
        Arc::new(FederatedTableProviderAdaptor::new_with_provider(
            table_source,
            Arc::new(provider),
        ))
    }

    fn schema_to_column_specs(batch: &RecordBatch) -> Vec<ColumnSpec> {
        batch
            .schema()
            .fields()
            .iter()
            .map(|f| ColumnSpec {
                name: f.name().clone(),
                type_hint: format!("{}", f.data_type()),
            })
            .collect()
    }

    fn append_batch_rows(batch: &RecordBatch, rows: &mut Vec<Vec<QueryValue>>) {
        for row_idx in 0..batch.num_rows() {
            let row: Vec<QueryValue> = (0..batch.num_columns())
                .map(|col_idx| {
                    Self::arrow_value_to_query_value(batch.column(col_idx).as_ref(), row_idx)
                })
                .collect();
            rows.push(row);
        }
    }

    fn arrow_value_to_query_value(array: &dyn Array, row: usize) -> QueryValue {
        if array.is_null(row) {
            return QueryValue::Null;
        }
        match array.data_type() {
            DataType::Boolean => QueryValue::Bool(
                array
                    .as_any()
                    .downcast_ref::<BooleanArray>()
                    .unwrap()
                    .value(row),
            ),
            DataType::Int8 => QueryValue::Int(
                array
                    .as_any()
                    .downcast_ref::<Int8Array>()
                    .unwrap()
                    .value(row) as i64,
            ),
            DataType::Int16 => QueryValue::Int(
                array
                    .as_any()
                    .downcast_ref::<Int16Array>()
                    .unwrap()
                    .value(row) as i64,
            ),
            DataType::Int32 => QueryValue::Int(
                array
                    .as_any()
                    .downcast_ref::<Int32Array>()
                    .unwrap()
                    .value(row) as i64,
            ),
            DataType::Int64 => QueryValue::Int(
                array
                    .as_any()
                    .downcast_ref::<Int64Array>()
                    .unwrap()
                    .value(row),
            ),
            DataType::UInt8 => QueryValue::Int(
                array
                    .as_any()
                    .downcast_ref::<UInt8Array>()
                    .unwrap()
                    .value(row) as i64,
            ),
            DataType::UInt16 => QueryValue::Int(
                array
                    .as_any()
                    .downcast_ref::<UInt16Array>()
                    .unwrap()
                    .value(row) as i64,
            ),
            DataType::UInt32 => QueryValue::Int(
                array
                    .as_any()
                    .downcast_ref::<UInt32Array>()
                    .unwrap()
                    .value(row) as i64,
            ),
            DataType::UInt64 => QueryValue::Int(
                array
                    .as_any()
                    .downcast_ref::<UInt64Array>()
                    .unwrap()
                    .value(row) as i64,
            ),
            DataType::Float32 => QueryValue::Double(
                array
                    .as_any()
                    .downcast_ref::<Float32Array>()
                    .unwrap()
                    .value(row) as f64,
            ),
            DataType::Float64 => QueryValue::Double(
                array
                    .as_any()
                    .downcast_ref::<Float64Array>()
                    .unwrap()
                    .value(row),
            ),
            DataType::Utf8 => QueryValue::Text(
                array
                    .as_any()
                    .downcast_ref::<StringArray>()
                    .unwrap()
                    .value(row)
                    .to_string(),
            ),
            DataType::Binary => QueryValue::Data(
                array
                    .as_any()
                    .downcast_ref::<BinaryArray>()
                    .unwrap()
                    .value(row)
                    .to_vec(),
            ),
            _ => QueryValue::Text(format!("{array:?}")),
        }
    }

    /// Convert a `QueryResult` into a single Arrow `RecordBatch` plus its schema,
    /// reusing the same type inference the federation scan path uses. Shared with
    /// the canvas cell cache, which stores a prior cell's result as Arrow so a
    /// later cell can read it back through a `MemTable`.
    pub(crate) fn query_result_to_batch(
        result: &QueryResult,
    ) -> Result<(datafusion::arrow::datatypes::SchemaRef, RecordBatch), String> {
        let schema = FederatedExec::infer_schema_from_result(result);
        let batch = FederatedExec::query_result_to_record_batch(result, &schema)?;
        Ok((schema, batch))
    }

    /// Flatten Arrow `RecordBatch`es back into a `QueryResult` (column specs from
    /// the batch schema, rows from each batch). The inverse of
    /// `query_result_to_batch`; shared with the canvas engine so a chained cell
    /// returns the same shape as any other query.
    pub(crate) fn batches_to_query_result(batches: &[RecordBatch], elapsed: f64) -> QueryResult {
        let columns = batches
            .first()
            .map(Self::schema_to_column_specs)
            .unwrap_or_default();
        let mut rows = Vec::new();
        for batch in batches {
            Self::append_batch_rows(batch, &mut rows);
        }
        QueryResult {
            columns,
            rows,
            elapsed,
            ..Default::default()
        }
    }

}

impl Engine for FederationEngine {
    fn name(&self) -> &str {
        "federation"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use crate::{DatabaseKind, DriverError};

    // ---- Test helpers ----

    /// Executes the SQL it is handed: pushdown means the double can no longer
    /// replay one canned result.
    struct MockAdapter {
        result: QueryResult,
        kind: DatabaseKind,
        seen: Option<Arc<Mutex<Vec<String>>>>,
    }

    impl MockAdapter {
        fn new(result: QueryResult) -> Self {
            Self {
                result,
                kind: DatabaseKind::Postgres,
                seen: None,
            }
        }

        fn recording(
            result: QueryResult,
            kind: DatabaseKind,
            seen: Arc<Mutex<Vec<String>>>,
        ) -> Self {
            Self { result, kind, seen: Some(seen) }
        }

        /// Returns the SQL stripped of quoting and schema, plus the bare table.
        fn localize(sql: &str) -> (String, String) {
            let unquoted = sql.replace(['"', '`'], "");
            let qualified = regex_lite::Regex::new(r"(?i)\bFROM\s+([\w.]+)")
                .expect("valid FROM regex")
                .captures(&unquoted)
                .map(|c| c[1].to_string())
                .unwrap_or_default();
            let bare = qualified.rsplit('.').next().unwrap_or_default().to_string();
            (unquoted.replace(&qualified, &bare), bare)
        }
    }

    #[async_trait]
    impl ScanAdapter for MockAdapter {
        async fn scan(&self, _source: &FederationRef) -> crate::drivers::errors::Result<QueryResult> {
            Ok(self.result.clone())
        }

        async fn scan_with_sql(&self, sql: &str) -> crate::drivers::errors::Result<QueryResult> {
            if let Some(seen) = &self.seen {
                seen.lock().unwrap().push(sql.to_string());
            }
            let (local_sql, table) = Self::localize(sql);
            let schema = FederatedExec::infer_schema_from_result(&self.result);
            let batch = FederatedExec::query_result_to_record_batch(&self.result, &schema)
                .map_err(DriverError::QueryFailed)?;
            let ctx = SessionContext::new();
            ctx.register_batch(&table, batch)
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            let batches = ctx
                .sql(&local_sql)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?
                .collect()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            let mut columns = Vec::new();
            let mut rows = Vec::new();
            for b in &batches {
                if columns.is_empty() {
                    columns = FederationEngine::schema_to_column_specs(b);
                }
                FederationEngine::append_batch_rows(b, &mut rows);
            }
            Ok(QueryResult::new(columns, rows))
        }

        fn database_kind(&self) -> DatabaseKind {
            self.kind
        }
    }

    struct FailingAdapter;

    #[async_trait]
    impl ScanAdapter for FailingAdapter {
        async fn scan(&self, _source: &FederationRef) -> crate::drivers::errors::Result<QueryResult> {
            Err(DriverError::ConnectionFailed("mock failure".into()))
        }

        async fn scan_with_sql(&self, _sql: &str) -> crate::drivers::errors::Result<QueryResult> {
            Err(DriverError::ConnectionFailed("mock failure".into()))
        }

        fn database_kind(&self) -> DatabaseKind {
            DatabaseKind::Postgres
        }
    }

    struct RecordingAdapter {
        result: QueryResult,
        queries: std::sync::Mutex<Vec<String>>,
    }

    #[async_trait]
    impl ScanAdapter for RecordingAdapter {
        async fn scan(&self, _source: &FederationRef) -> crate::drivers::errors::Result<QueryResult> {
            Ok(self.result.clone())
        }

        async fn scan_with_sql(&self, sql: &str) -> crate::drivers::errors::Result<QueryResult> {
            self.queries.lock().unwrap().push(sql.to_string());
            Ok(self.result.clone())
        }

        fn database_kind(&self) -> DatabaseKind {
            DatabaseKind::Postgres
        }
    }

    fn users_result() -> QueryResult {
        QueryResult {
            columns: vec![
                ColumnSpec {
                    name: "id".into(),
                    type_hint: "int4".into(),
                },
                ColumnSpec {
                    name: "name".into(),
                    type_hint: "text".into(),
                },
            ],
            rows: vec![
                vec![QueryValue::Int(1), QueryValue::Text("Alice".into())],
                vec![QueryValue::Int(2), QueryValue::Text("Bob".into())],
            ],
            rows_affected: None,
            elapsed: 0.01,
            ..Default::default()
        }
    }

    fn orders_result() -> QueryResult {
        QueryResult {
            columns: vec![
                ColumnSpec {
                    name: "order_id".into(),
                    type_hint: "int4".into(),
                },
                ColumnSpec {
                    name: "user_id".into(),
                    type_hint: "int4".into(),
                },
                ColumnSpec {
                    name: "total".into(),
                    type_hint: "float8".into(),
                },
            ],
            rows: vec![
                vec![
                    QueryValue::Int(100),
                    QueryValue::Int(1),
                    QueryValue::Double(29.99),
                ],
                vec![
                    QueryValue::Int(101),
                    QueryValue::Int(2),
                    QueryValue::Double(49.99),
                ],
                vec![
                    QueryValue::Int(102),
                    QueryValue::Int(1),
                    QueryValue::Double(9.99),
                ],
            ],
            rows_affected: None,
            elapsed: 0.02,
            ..Default::default()
        }
    }

    // ---- Engine trait tests (from old mod.rs) ----

    #[test]
    fn federation_engine_name() {
        let engine = FederationEngine::new(HashMap::new());
        assert_eq!(engine.name(), "federation");
    }

    #[test]
    fn federation_engine_is_object_safe_as_engine() {
        fn _assert(_: &dyn Engine) {}
        let engine = FederationEngine::new(HashMap::new());
        _assert(&engine);
    }

    #[test]
    fn dotted_name_joins_the_segments_verbatim() {
        let r = FederationRef {
            connection: "my prod-db".into(),
            schema: Some("public".into()),
            table: "order items".into(),
        };
        assert_eq!(r.dotted_name(), "my prod-db.public.order items");
        let r2 = FederationRef {
            connection: "mongo".into(),
            schema: None,
            table: "events".into(),
        };
        assert_eq!(r2.dotted_name(), "mongo.events");
    }

    // ---- Engine execution tests (from engine.rs) ----

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn simple_select_from_single_source() {
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("pg".into(), Arc::new(MockAdapter::new(users_result())));

        let engine = FederationEngine::new(adapters);
        let result = engine
            .execute("SELECT * FROM pg.public.users")
            .await
            .unwrap();

        assert_eq!(result.columns.len(), 2);
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.columns[0].name, "id");
        assert_eq!(result.columns[1].name, "name");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn select_from_a_backtick_quoted_connection_name() {
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("my prod-db".into(), Arc::new(MockAdapter::new(users_result())));

        let engine = FederationEngine::new(adapters);
        let result = engine
            .execute("SELECT * FROM `my prod-db`.public.users")
            .await
            .unwrap();

        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.columns[0].name, "id");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn joins_two_connections_whose_names_slug_alike() {
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("my db".into(), Arc::new(MockAdapter::new(users_result())));
        adapters.insert("my-db".into(), Arc::new(MockAdapter::new(orders_result())));

        let engine = FederationEngine::new(adapters);
        let result = engine
            .execute(
                "SELECT u.name, o.total FROM `my db`.public.users u \
                 JOIN `my-db`.mydb.orders o ON u.id = o.user_id ORDER BY o.total DESC",
            )
            .await
            .unwrap();

        assert_eq!(result.columns.len(), 2);
        assert!(!result.rows.is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cross_source_join() {
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("pg".into(), Arc::new(MockAdapter::new(users_result())));
        adapters.insert("mysql".into(), Arc::new(MockAdapter::new(orders_result())));

        let engine = FederationEngine::new(adapters);
        let result = engine
            .execute(
                "SELECT u.name, o.total FROM pg.public.users u JOIN mysql.mydb.orders o ON u.id = o.user_id ORDER BY o.total DESC",
            )
            .await
            .unwrap();

        assert_eq!(result.columns.len(), 2);
        assert_eq!(result.rows.len(), 3);
        assert_eq!(result.columns[0].name, "name");
        assert_eq!(result.columns[1].name, "total");
        if let QueryValue::Double(v) = &result.rows[0][1] {
            assert!(*v > 40.0);
        } else {
            panic!("expected Double");
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unknown_connection_returns_error() {
        let adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        let engine = FederationEngine::new(adapters);
        let err = engine
            .execute("SELECT * FROM unknown.public.tbl")
            .await
            .unwrap_err();
        assert!(matches!(err, FederationError::InvalidReference(_)));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn no_refs_returns_error() {
        let adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        let engine = FederationEngine::new(adapters);
        let err = engine.execute("SELECT 1").await.unwrap_err();
        assert!(matches!(err, FederationError::InvalidReference(_)));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn scan_failure_propagates() {
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("bad".into(), Arc::new(FailingAdapter));

        let engine = FederationEngine::new(adapters);
        let err = engine
            .execute("SELECT * FROM bad.public.tbl")
            .await
            .unwrap_err();
        assert!(matches!(err, FederationError::ScanFailed { .. }));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn case_insensitive_connection_match() {
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("MyPG".into(), Arc::new(MockAdapter::new(users_result())));

        let engine = FederationEngine::new(adapters);
        let result = engine
            .execute("SELECT * FROM mypg.public.users")
            .await
            .unwrap();
        assert_eq!(result.rows.len(), 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn two_part_ref_defaults_to_public_schema() {
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("pg".into(), Arc::new(MockAdapter::new(users_result())));

        let engine = FederationEngine::new(adapters);
        let result = engine.execute("SELECT * FROM pg.users").await.unwrap();
        assert_eq!(result.rows.len(), 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn empty_result_handled() {
        let empty = QueryResult {
            columns: vec![ColumnSpec {
                name: "id".into(),
                type_hint: "int4".into(),
            }],
            rows: vec![],
            rows_affected: None,
            elapsed: 0.0,
            ..Default::default()
        };
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("pg".into(), Arc::new(MockAdapter::new(empty)));

        let engine = FederationEngine::new(adapters);
        let result = engine
            .execute("SELECT * FROM pg.public.empty_tbl")
            .await
            .unwrap();
        assert_eq!(result.rows.len(), 0);
        assert_eq!(result.columns.len(), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn null_values_round_trip() {
        let with_nulls = QueryResult {
            columns: vec![
                ColumnSpec {
                    name: "id".into(),
                    type_hint: "int4".into(),
                },
                ColumnSpec {
                    name: "note".into(),
                    type_hint: "text".into(),
                },
            ],
            rows: vec![
                vec![QueryValue::Int(1), QueryValue::Null],
                vec![QueryValue::Int(2), QueryValue::Text("hello".into())],
            ],
            rows_affected: None,
            elapsed: 0.0,
            ..Default::default()
        };
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("pg".into(), Arc::new(MockAdapter::new(with_nulls)));

        let engine = FederationEngine::new(adapters);
        let result = engine
            .execute("SELECT * FROM pg.public.notes")
            .await
            .unwrap();
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0][1], QueryValue::Null);
        assert_eq!(result.rows[1][1], QueryValue::Text("hello".into()));
    }






    /// Pushed SQL, minus the schema probe the engine issues per table.
    async fn pushed_sql_for(query: &str) -> Vec<String> {
        let pk_rows = QueryResult::new(
            vec![ColumnSpec::new("pk", "int4")],
            vec![vec![QueryValue::Int(1)], vec![QueryValue::Int(2)]],
        );
        let seen = Arc::new(Mutex::new(Vec::new()));
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("test_postgres".into(), Arc::new(MockAdapter::new(pk_rows.clone())));
        adapters.insert(
            "prod_bigquery".into(),
            Arc::new(MockAdapter::recording(pk_rows, DatabaseKind::Bigquery, seen.clone())),
        );
        FederationEngine::new(adapters).execute(query).await.unwrap();
        let pushed = seen.lock().unwrap().clone();
        pushed.into_iter().filter(|s| !s.contains("LIMIT 1")).collect()
    }

    /// Every derived table in `sql` carries an alias, so its inner qualifiers
    /// stay in scope. Unaliased ones drew `Unrecognized name` from BigQuery.
    fn assert_every_derived_table_is_aliased(sql: &str) {
        use std::ops::ControlFlow;

        use datafusion::sql::sqlparser::ast::{TableFactor, Visit, Visitor};
        use datafusion::sql::sqlparser::dialect::GenericDialect;
        use datafusion::sql::sqlparser::parser::Parser;

        struct FindUnaliased;
        impl Visitor for FindUnaliased {
            type Break = ();
            fn pre_visit_table_factor(&mut self, factor: &TableFactor) -> ControlFlow<()> {
                match factor {
                    TableFactor::Derived { alias: None, .. } => ControlFlow::Break(()),
                    _ => ControlFlow::Continue(()),
                }
            }
        }

        for statement in Parser::parse_sql(&GenericDialect {}, sql).unwrap() {
            assert!(
                statement.visit(&mut FindUnaliased).is_continue(),
                "derived table without an alias in: {sql}"
            );
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pushed_down_subquery_binds_its_own_alias() {
        let pushed = pushed_sql_for(
            "SELECT COUNT(DISTINCT a.pk) FROM test_postgres.public.table_a AS a \
             WHERE a.pk NOT IN (SELECT DISTINCT b.pk FROM prod_bigquery.test_dataset.table_b AS b)",
        )
        .await;

        assert_eq!(pushed.len(), 1, "{pushed:?}");
        assert!(pushed[0].contains("`table_b`"), "{}", pushed[0]);
        assert_every_derived_table_is_aliased(&pushed[0]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn aggregates_push_down_without_a_derived_table() {
        for query in [
            "SELECT COUNT(*) FROM prod_bigquery.test_dataset.table_b",
            "SELECT COUNT(*) FROM prod_bigquery.test_dataset.table_b AS b",
            "SELECT COUNT(*) FROM prod_bigquery.test_dataset.table_b WHERE pk > 1",
            "SELECT pk, COUNT(*) FROM prod_bigquery.test_dataset.table_b GROUP BY pk",
        ] {
            let pushed = pushed_sql_for(query).await;
            assert_eq!(pushed.len(), 1, "{query}: {pushed:?}");
            assert!(pushed[0].contains("count("), "{query}: {}", pushed[0]);
            assert_every_derived_table_is_aliased(&pushed[0]);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn aggregation_query() {
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("mysql".into(), Arc::new(MockAdapter::new(orders_result())));

        let engine = FederationEngine::new(adapters);
        let result = engine
            .execute("SELECT COUNT(*) as cnt, SUM(total) as sum_total FROM mysql.mydb.orders")
            .await
            .unwrap();
        assert_eq!(result.rows.len(), 1);
        if let QueryValue::Int(cnt) = &result.rows[0][0] {
            assert_eq!(*cnt, 3);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn aggregation_on_numeric_text_columns() {
        let orders = QueryResult {
            columns: vec![
                ColumnSpec {
                    name: "id".into(),
                    type_hint: "int4".into(),
                },
                ColumnSpec {
                    name: "customer_id".into(),
                    type_hint: "int4".into(),
                },
                ColumnSpec {
                    name: "total".into(),
                    type_hint: "numeric".into(),
                },
            ],
            rows: vec![
                vec![
                    QueryValue::Int(1),
                    QueryValue::Int(1),
                    QueryValue::Text("179.98".into()),
                ],
                vec![
                    QueryValue::Int(2),
                    QueryValue::Int(1),
                    QueryValue::Text("599.00".into()),
                ],
                vec![
                    QueryValue::Int(3),
                    QueryValue::Int(2),
                    QueryValue::Text("129.99".into()),
                ],
            ],
            rows_affected: None,
            elapsed: 0.0,
            ..Default::default()
        };
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("pg".into(), Arc::new(MockAdapter::new(orders)));

        let engine = FederationEngine::new(adapters);
        let result = engine
            .execute("SELECT customer_id, SUM(total) as total_spent FROM pg.public.orders GROUP BY customer_id ORDER BY total_spent DESC")
            .await
            .unwrap();
        assert_eq!(result.rows.len(), 2);
        if let QueryValue::Double(v) = &result.rows[0][1] {
            assert!((*v - 778.98).abs() < 0.01);
        } else {
            panic!(
                "expected Double for SUM of numeric, got {:?}",
                result.rows[0][1]
            );
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn scan_with_sql_receives_pushdown_sql() {
        let adapter = Arc::new(RecordingAdapter {
            result: users_result(),
            queries: std::sync::Mutex::new(Vec::new()),
        });
        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("pg".into(), adapter.clone());

        let engine = FederationEngine::new(adapters);
        let _result = engine
            .execute("SELECT * FROM pg.public.users")
            .await
            .unwrap();

        let queries = adapter.queries.lock().unwrap();
        assert!(queries.len() >= 1, "expected at least 1 scan_with_sql call");
        assert!(
            queries.iter().any(|q| q.contains("LIMIT 1")),
            "expected schema probe with LIMIT 1, got: {:?}",
            *queries
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn execute_with_progress_emits_dag_and_events() {
        use super::ProgressEvent;
        use super::{DagNode, DagNodeStatus};

        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("pg".into(), Arc::new(MockAdapter::new(users_result())));

        let engine = FederationEngine::new(adapters);

        let dag_capture: Arc<std::sync::Mutex<Vec<DagNode>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let events: Arc<std::sync::Mutex<Vec<ProgressEvent>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));

        let dag_clone = dag_capture.clone();
        let events_clone = events.clone();
        let callback: ProgressCallback = Arc::new(move |e| {
            events_clone.lock().unwrap().push(e);
        });

        let result = engine
            .execute_with_progress(
                "SELECT * FROM pg.public.users",
                None,
                |dag| {
                    dag_clone.lock().unwrap().extend_from_slice(dag);
                },
                callback,
            )
            .await
            .unwrap();

        assert_eq!(result.rows.len(), 2);

        let dag = dag_capture.lock().unwrap();
        assert!(!dag.is_empty());
        assert!(dag
            .iter()
            .any(|n| n.node_type == DagNodeType::Scan));

        let evts = events.lock().unwrap();
        assert!(
            evts.iter().any(|e| e.status == DagNodeStatus::Running),
            "expected Running event"
        );
        assert!(
            evts.iter().any(|e| e.status == DagNodeStatus::Done),
            "expected Done event"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn execute_with_progress_cross_source() {
        use super::ProgressEvent;
        use super::{DagNode, DagNodeStatus, DagNodeType};

        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("pg".into(), Arc::new(MockAdapter::new(users_result())));
        adapters.insert("mysql".into(), Arc::new(MockAdapter::new(orders_result())));

        let engine = FederationEngine::new(adapters);

        let dag_capture: Arc<std::sync::Mutex<Vec<DagNode>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let events: Arc<std::sync::Mutex<Vec<ProgressEvent>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));

        let dag_clone = dag_capture.clone();
        let events_clone = events.clone();
        let callback: ProgressCallback = Arc::new(move |e| {
            events_clone.lock().unwrap().push(e);
        });

        let result = engine
            .execute_with_progress(
                "SELECT u.name, o.total FROM pg.public.users u JOIN mysql.mydb.orders o ON u.id = o.user_id",
                None,
                |dag| {
                    dag_clone.lock().unwrap().extend_from_slice(dag);
                },
                callback,
            )
            .await
            .unwrap();

        assert_eq!(result.rows.len(), 3);

        let dag = dag_capture.lock().unwrap();
        let scan_count = dag
            .iter()
            .filter(|n| n.node_type == DagNodeType::Scan)
            .count();
        assert_eq!(scan_count, 2, "expected 2 scan nodes for cross-source join");

        let evts = events.lock().unwrap();
        let running_count = evts
            .iter()
            .filter(|e| e.status == DagNodeStatus::Running)
            .count();
        assert!(
            running_count >= 2,
            "expected at least 2 Running events (one per scan)"
        );
    }

    /// A scan node's id is keyed off its label, which is read out of the federation
    /// exec's display. A spaced name used to truncate, so both scans collided on the
    /// same key and one of them never received an event.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn progress_reaches_a_scan_whose_connection_name_holds_a_space() {
        use super::ProgressEvent;
        use super::{DagNode, DagNodeStatus, DagNodeType};

        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert(
            "prod bigquery".into(),
            Arc::new(MockAdapter::new(orders_result())),
        );
        adapters.insert("prod".into(), Arc::new(MockAdapter::new(users_result())));

        let engine = FederationEngine::new(adapters);
        let dag_capture: Arc<std::sync::Mutex<Vec<DagNode>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let events: Arc<std::sync::Mutex<Vec<ProgressEvent>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));

        let dag_clone = dag_capture.clone();
        let events_clone = events.clone();
        let callback: ProgressCallback = Arc::new(move |e| {
            events_clone.lock().unwrap().push(e);
        });

        engine
            .execute_with_progress(
                "SELECT u.name, o.total FROM prod.public.users u \
                 JOIN `prod bigquery`.mydb.orders o ON u.id = o.user_id",
                None,
                |dag| {
                    dag_clone.lock().unwrap().extend_from_slice(dag);
                },
                callback,
            )
            .await
            .unwrap();

        let dag = dag_capture.lock().unwrap();
        let scans: Vec<&DagNode> = dag
            .iter()
            .filter(|n| n.node_type == DagNodeType::Scan)
            .collect();
        assert_eq!(scans.len(), 2);
        assert!(
            scans.iter().any(|n| n.label.contains("prod bigquery")),
            "no scan kept the spaced name: {:?}",
            scans.iter().map(|n| &n.label).collect::<Vec<_>>()
        );

        // Truncating the spaced name collapsed both scans onto one key, so the
        // distinct-id count is what catches it.
        let evts = events.lock().unwrap();
        let running: std::collections::HashSet<usize> = evts
            .iter()
            .filter(|e| e.status == DagNodeStatus::Running)
            .map(|e| e.node_id)
            .collect();
        for scan in &scans {
            assert!(
                running.contains(&scan.id),
                "no Running event for scan {} ({})",
                scan.id,
                scan.label
            );
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn memory_pool_configured() {
        let ctx = FederationEngine::create_session_context().unwrap();
        let pool = &ctx.runtime_env().memory_pool;
        assert!(
            pool.reserved() == 0,
            "fresh pool should have zero reservations"
        );
        let consumer = datafusion::execution::memory_pool::MemoryConsumer::new("test");
        let reservation = consumer.register(&pool);
        assert_eq!(reservation.size(), 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn run_query_unknown_connection_returns_error() {
        use crate::connection::{ConnectionEngine, ScopedConnection};
        use crate::query::QueryEngine;

        let tmp = tempfile::tempdir().unwrap();
        let conn_engine = ConnectionEngine::new(tmp.path().to_path_buf()).await;
        let query_engine = QueryEngine::new();

        let connections: Vec<ScopedConnection> = vec![];
        let progress: ProgressCallback = Arc::new(|_| {});

        let err = FederationEngine::run_query(
            "SELECT * FROM unknown.public.tbl",
            &connections,
            &conn_engine,
            &query_engine,
            None,
            |_| {},
            progress,
        )
        .await
        .unwrap_err();

        assert!(matches!(err, FederationError::InvalidReference(_)));
        assert!(err.to_string().contains("unknown connection"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn execute_with_progress_respects_cancel_token() {
        use super::ProgressEvent;

        let mut adapters: HashMap<String, Arc<dyn ScanAdapter>> = HashMap::new();
        adapters.insert("pg".into(), Arc::new(MockAdapter::new(users_result())));

        let engine = FederationEngine::new(adapters);

        let token = CancellationToken::new();
        token.cancel();

        let events: Arc<std::sync::Mutex<Vec<ProgressEvent>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let callback: ProgressCallback = Arc::new(move |e| {
            events_clone.lock().unwrap().push(e);
        });

        let err = engine
            .execute_with_progress(
                "SELECT * FROM pg.public.users",
                Some(&token),
                |_| {},
                callback,
            )
            .await
            .unwrap_err();

        assert!(
            err.to_string().contains("cancelled"),
            "expected cancellation error, got: {err}"
        );
    }
}
