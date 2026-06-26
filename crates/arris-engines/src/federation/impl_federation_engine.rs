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

use super::errors::*;
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
        let refs = Self::parse_federated_refs(sql);
        if refs.is_empty() {
            return Err(FederationError::InvalidReference(
                "no connection.table references found in SQL".into(),
            ));
        }

        let ctx = Self::create_session_context()?;

        let unique_refs = {
            let mut seen = std::collections::HashSet::new();
            refs.iter()
                .filter(|r| seen.insert((r.connection.clone(), r.schema.clone(), r.table.clone())))
                .cloned()
                .collect::<Vec<_>>()
        };

        let mut rewritten = sql.to_string();

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

            let alias = fref.local_alias();
            let provider = FederatedTableProvider::new(schema, adapter.clone(), fref.clone());

            ctx.register_table(&alias, Arc::new(provider))
                .map_err(|e| FederationError::Engine(e.to_string()))?;

            let dotted = fref.dotted_name();
            rewritten = rewritten.replace(&dotted, &alias);
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
        let refs = Self::parse_federated_refs(sql);
        if refs.is_empty() {
            return Err(FederationError::InvalidReference(
                "no connection.table references found in SQL".into(),
            ));
        }

        let ctx = Self::create_session_context()?;
        let node_id_map: NodeIdMap = Arc::new(Mutex::new(HashMap::new()));

        let unique_refs = {
            let mut seen = std::collections::HashSet::new();
            refs.iter()
                .filter(|r| seen.insert((r.connection.clone(), r.schema.clone(), r.table.clone())))
                .cloned()
                .collect::<Vec<_>>()
        };

        let mut rewritten = sql.to_string();

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
            let alias = fref.local_alias();
            let provider = FederatedTableProvider::new(schema, adapter.clone(), fref.clone())
                .with_progress(progress.clone(), node_id_map.clone());

            ctx.register_table(&alias, Arc::new(provider))
                .map_err(|e| FederationError::Engine(e.to_string()))?;

            let dotted = fref.dotted_name();
            rewritten = rewritten.replace(&dotted, &alias);
        }

        let df = ctx
            .sql(&rewritten)
            .await
            .map_err(|e| FederationError::Engine(e.to_string()))?;

        let plan = df
            .create_physical_plan()
            .await
            .map_err(|e| FederationError::Engine(e.to_string()))?;

        let (dag, plan_refs) = PlanDag::build_dag(&plan);

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
        Self::parse_federated_refs(sql)
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
        Ok(SessionContext::new_with_config_rt(config, runtime))
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

    fn parse_federated_refs(sql: &str) -> Vec<FederationRef> {
        let chars: Vec<char> = sql.chars().collect();
        let mut out = Vec::new();
        let mut i = 0usize;

        while i < chars.len() {
            // Skip whitespace and commas.
            while i < chars.len() && (chars[i].is_whitespace() || chars[i] == ',') {
                i += 1;
            }
            if i >= chars.len() {
                break;
            }
            // Read a token.
            let start = i;
            while i < chars.len() && !chars[i].is_whitespace() && chars[i] != ',' {
                i += 1;
            }
            let token: String = chars[start..i].iter().collect();
            let upper = token.to_ascii_uppercase();
            if upper == "FROM" || upper == "JOIN" {
                // Skip whitespace.
                while i < chars.len() && chars[i].is_whitespace() {
                    i += 1;
                }
                // Read dotted identifier.
                let id_start = i;
                while i < chars.len()
                    && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '.')
                {
                    i += 1;
                }
                let dotted: String = chars[id_start..i].iter().collect();
                if let Some(parsed) = Self::parse_dotted(&dotted) {
                    out.push(parsed);
                }
            }
        }

        out
    }

    fn parse_dotted(s: &str) -> Option<FederationRef> {
        let parts: Vec<&str> = s.split('.').collect();
        match parts.len() {
            2 => Some(FederationRef {
                connection: parts[0].to_owned(),
                schema: None,
                table: parts[1].to_owned(),
            }),
            3 => Some(FederationRef {
                connection: parts[0].to_owned(),
                schema: Some(parts[1].to_owned()),
                table: parts[2].to_owned(),
            }),
            _ => None,
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

    struct MockAdapter {
        result: QueryResult,
        kind: DatabaseKind,
    }

    impl MockAdapter {
        fn new(result: QueryResult) -> Self {
            Self {
                result,
                kind: DatabaseKind::Postgres,
            }
        }
    }

    #[async_trait]
    impl ScanAdapter for MockAdapter {
        async fn scan(&self, _source: &FederationRef) -> crate::drivers::errors::Result<QueryResult> {
            Ok(self.result.clone())
        }

        async fn scan_with_sql(&self, _sql: &str) -> crate::drivers::errors::Result<QueryResult> {
            Ok(self.result.clone())
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

    // ---- Parser tests (from parser.rs) ----

    #[test]
    fn parses_two_part_reference() {
        let r = FederationEngine::parse_federated_refs("SELECT * FROM pg.users");
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].connection, "pg");
        assert_eq!(r[0].schema, None);
        assert_eq!(r[0].table, "users");
    }

    #[test]
    fn parses_three_part_reference() {
        let r = FederationEngine::parse_federated_refs("SELECT * FROM pg.public.users");
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].connection, "pg");
        assert_eq!(r[0].schema.as_deref(), Some("public"));
        assert_eq!(r[0].table, "users");
    }

    #[test]
    fn parses_join_clause() {
        let r = FederationEngine::parse_federated_refs(
            "SELECT * FROM pg.public.users JOIN mongo.test.events ON pg.public.users.id = mongo.test.events.user_id",
        );
        let conns: Vec<&str> = r.iter().map(|x| x.connection.as_str()).collect();
        assert!(conns.contains(&"pg"));
        assert!(conns.contains(&"mongo"));
    }

    #[test]
    fn ignores_single_part_table_names() {
        let r = FederationEngine::parse_federated_refs("SELECT * FROM users");
        assert!(r.is_empty());
    }

    #[test]
    fn local_alias_double_underscore_separator() {
        let r = FederationRef {
            connection: "pg".into(),
            schema: Some("public".into()),
            table: "users".into(),
        };
        assert_eq!(r.local_alias(), "pg__public__users");
        let r2 = FederationRef {
            connection: "mongo".into(),
            schema: None,
            table: "events".into(),
        };
        assert_eq!(r2.local_alias(), "mongo__events");
    }

    #[test]
    fn case_insensitive_keywords() {
        let r = FederationEngine::parse_federated_refs("select * from pg.users join ms.orders on 1=1");
        assert_eq!(r.len(), 2);
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
