mod definition;
mod query;
mod schema;
mod values;

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use duckdb::Connection;
use futures::StreamExt;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task;

use crate::{
    ConnectionConfig, DriverError, ExplainMode, MutationResult, PlanAttribute, PlanNode,
    PlanResult, QueryLanguage, QueryResult, QueryStream, QueryValue, RowChunkStream, RowDelete,
    RowInsert, SchemaNode, TableRef,
};
use crate::drivers::constants::STREAM_CHUNK_CHANNEL_CAPACITY;
use crate::drivers::errors::Result;

use crate::drivers::DatabaseDriver;
use crate::drivers::sql_builder::SqlBuilder;

use query::{run_exec, run_select, stream_select};
use schema::{build_schema_nodes, primary_key_columns};

#[derive(Default)]
pub struct DuckdbDriver {
    inner: Arc<Mutex<Option<Connection>>>,
    file_path: Mutex<Option<PathBuf>>,
    /// Whether a manual transaction is currently open on this connection.
    in_tx: Mutex<bool>,
}

impl DuckdbDriver {
    pub fn new() -> Self {
        Self::default()
    }

    async fn with_conn<F, T>(&self, op: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let inner = self.inner.clone();
        task::spawn_blocking(move || {
            let guard = inner.blocking_lock();
            let conn = guard.as_ref().ok_or(DriverError::NotConnected)?;
            op(conn)
        })
        .await
        .map_err(|e| DriverError::other(format!("blocking pool join failed: {e}")))?
    }
}

#[async_trait]
impl DatabaseDriver for DuckdbDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let path = config
            .file_path
            .clone()
            .filter(|p| !p.is_empty())
            .ok_or_else(|| {
                DriverError::InvalidArgument(
                    "DuckDB connection requires a file path (or ':memory:').".into(),
                )
            })?;

        let resolved = PathBuf::from(&path);
        let inner = self.inner.clone();
        let path_for_log = resolved.clone();
        task::spawn_blocking(move || -> Result<()> {
            let conn = if path == ":memory:" {
                Connection::open_in_memory()
            } else {
                // A bare directory has no file name — the driver can't create a DB from it.
                if resolved.is_dir() || path.ends_with(std::path::MAIN_SEPARATOR) {
                    return Err(DriverError::InvalidArgument(
                        "DuckDB path points to a directory — include a file name (e.g. /dir/mydb.duckdb).".into(),
                    ));
                }
                if let Some(parent) = resolved.parent() {
                    if !parent.as_os_str().is_empty() && !parent.exists() {
                        std::fs::create_dir_all(parent)
                            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
                    }
                }
                Connection::open(&resolved)
            }
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
            *inner.blocking_lock() = Some(conn);
            Ok(())
        })
        .await
        .map_err(|e| DriverError::other(format!("blocking pool join failed: {e}")))??;

        *self.file_path.lock().await = Some(path_for_log);
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let db_name = self
            .file_path
            .lock()
            .await
            .as_ref()
            .and_then(|p| p.file_stem().map(|s| s.to_string_lossy().into_owned()))
            .unwrap_or_else(|| "memory".into());
        self.with_conn(move |c| build_schema_nodes(c, &db_name))
            .await
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let all = self.list_schemas().await?;
        Ok(crate::drivers::common::schema::find_schema_node(&all, schema))
    }

    async fn run_query(
        &self,
        text: &str,
        params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        let sql = text.to_owned();
        let p = params.to_vec();
        if self.looks_like_select(&sql) {
            self.with_conn(move |c| run_select(c, &sql, &p)).await
        } else {
            self.with_conn(move |c| run_exec(c, &sql, &p)).await
        }
    }

    async fn run_query_stream(
        &self,
        text: &str,
        params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryStream> {
        // A background drain must not hold the single connection's lock inside
        // a manual transaction, and non-SELECTs have no rows: both materialize.
        if !self.looks_like_select(text) || self.in_transaction().await {
            return Ok(QueryStream::from_materialized(
                self.run_query(text, params, language).await?,
            ));
        }
        let sql = text.to_owned();
        let p = params.to_vec();
        let inner = self.inner.clone();
        let (col_tx, col_rx) = oneshot::channel();
        let (chunk_tx, chunk_rx) = mpsc::channel(STREAM_CHUNK_CHANNEL_CAPACITY);
        task::spawn_blocking(move || {
            let guard = inner.blocking_lock();
            match guard.as_ref() {
                Some(conn) => stream_select(conn, &sql, &p, col_tx, chunk_tx),
                None => {
                    let _ = col_tx.send(Err(DriverError::NotConnected));
                }
            }
        });
        let columns = col_rx
            .await
            .map_err(|_| DriverError::other("streaming task exited before returning columns"))??;
        let chunks = futures::stream::unfold(chunk_rx, |mut rx| async move {
            rx.recv().await.map(|item| (item, rx))
        })
        .boxed();
        Ok(QueryStream::Rows(RowChunkStream { columns, chunks }))
    }

    fn select_like_keywords(&self) -> &'static [&'static str] {
        &["DESCRIBE", "SHOW", "PRAGMA", "FROM"]
    }

    fn supports_transactions(&self) -> bool {
        true
    }

    async fn in_transaction(&self) -> bool {
        *self.in_tx.lock().await
    }

    async fn begin_transaction(&self, _isolation: crate::IsolationLevel) -> Result<()> {
        // DuckDB exposes no selectable isolation level (snapshot isolation only),
        // so `IsolationLevel` other than `Default` is a no-op.
        self.with_conn(|c| {
            c.execute_batch("BEGIN TRANSACTION")
                .map_err(|e| DriverError::QueryFailed(e.to_string()))
        })
        .await?;
        *self.in_tx.lock().await = true;
        Ok(())
    }

    async fn commit_transaction(&self) -> Result<()> {
        self.with_conn(|c| {
            c.execute_batch("COMMIT")
                .map_err(|e| DriverError::QueryFailed(e.to_string()))
        })
        .await?;
        *self.in_tx.lock().await = false;
        Ok(())
    }

    async fn rollback_transaction(&self) -> Result<()> {
        self.with_conn(|c| {
            c.execute_batch("ROLLBACK")
                .map_err(|e| DriverError::QueryFailed(e.to_string()))
        })
        .await?;
        *self.in_tx.lock().await = false;
        Ok(())
    }

    async fn supports_explain(&self, _mode: ExplainMode) -> bool {
        true
    }

    async fn explain_query(
        &self,
        text: &str,
        params: &[QueryValue],
        _language: QueryLanguage,
        mode: ExplainMode,
    ) -> Result<PlanResult> {
        let prefix = match mode {
            ExplainMode::DryRun => "EXPLAIN",
            ExplainMode::Analyze => "EXPLAIN ANALYZE",
        };
        let sql = format!("{prefix} {text}");
        let p = params.to_vec();
        let result = self.with_conn(move |c| run_select(c, &sql, &p)).await?;

        // DuckDB EXPLAIN returns (explain_key, explain_value) rows; the rendered
        // plan tree is the value column, so take the last cell, not the first.
        let mut plan_text = String::new();
        for row in &result.rows {
            if let Some(QueryValue::Text(s)) = row.last() {
                if !plan_text.is_empty() {
                    plan_text.push('\n');
                }
                plan_text.push_str(s);
            }
        }

        let mut root = PlanNode::new(plan_text.clone(), "QueryPlan");
        root.attributes
            .push(PlanAttribute::new("plan", plan_text));

        Ok(PlanResult::new(root, mode, format!("{prefix} {text}")))
    }

    async fn object_definition(&self, object: &crate::ObjectRef) -> Result<String> {
        let obj = object.clone();
        self.with_conn(move |c| definition::object_definition(c, &obj)).await
    }

    async fn primary_key(&self, table: &TableRef) -> Result<Option<Vec<String>>> {
        let t = table.clone();
        let cols = self.with_conn(move |c| primary_key_columns(c, &t)).await?;
        Ok(if cols.is_empty() { None } else { Some(cols) })
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &crate::ValueMap,
        changes: &crate::ValueMap,
    ) -> Result<MutationResult> {
        let (sql, params) =
            SqlBuilder::build_update(table, primary_key, changes, SqlBuilder::quote_double, SqlBuilder::placeholder_dollar)
                .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
        let r = self.run_query(&sql, &params, QueryLanguage::Native).await?;
        Ok(MutationResult {
            rows_affected: r.rows_affected.unwrap_or(0) as usize,
            statements: vec![SqlBuilder::interpolate_params(&sql, &params)],
        })
    }

    async fn insert_rows(&self, table: &TableRef, inserts: &[RowInsert]) -> Result<MutationResult> {
        let mut result = MutationResult::default();
        for ins in inserts {
            let (sql, params) =
                SqlBuilder::build_insert(table, &ins.values, SqlBuilder::quote_double, SqlBuilder::placeholder_dollar)
                    .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let r = self.run_query(&sql, &params, QueryLanguage::Native).await?;
            result.rows_affected += r.rows_affected.unwrap_or(0) as usize;
            result.statements.push(SqlBuilder::interpolate_params(&sql, &params));
        }
        Ok(result)
    }

    async fn delete_rows(&self, table: &TableRef, deletes: &[RowDelete]) -> Result<MutationResult> {
        let mut result = MutationResult::default();
        for del in deletes {
            let (sql, params) =
                SqlBuilder::build_delete(table, &del.primary_key, SqlBuilder::quote_double, SqlBuilder::placeholder_dollar)
                    .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let r = self.run_query(&sql, &params, QueryLanguage::Native).await?;
            result.rows_affected += r.rows_affected.unwrap_or(0) as usize;
            result.statements.push(SqlBuilder::interpolate_params(&sql, &params));
        }
        Ok(result)
    }

    async fn cancel_running_query(&self) -> crate::drivers::errors::Result<()> {
        let inner = self.inner.clone();
        let _ = task::spawn_blocking(move || {
            let guard = inner.blocking_lock();
            if let Some(conn) = guard.as_ref() {
                conn.interrupt_handle().interrupt();
            }
        })
        .await;
        Ok(())
    }

    async fn close(&self) {
        let inner = self.inner.clone();
        let _ = task::spawn_blocking(move || {
            inner.blocking_lock().take();
        })
        .await;
        *self.file_path.lock().await = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use crate::{DatabaseKind, SchemaNodeKind};
    use indexmap::IndexMap;

    use schema::build_schema_tree;

    fn cfg(path: &str) -> ConnectionConfig {
        let mut c = ConnectionConfig::new("test", DatabaseKind::Duckdb);
        c.file_path = Some(path.into());
        c
    }

    #[tokio::test]
    async fn connect_then_disconnect_roundtrip() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        assert!(d.is_connected().await);
        d.close().await;
        assert!(!d.is_connected().await);
    }

    #[tokio::test]
    async fn rejects_missing_file_path() {
        let d = DuckdbDriver::new();
        let mut c = ConnectionConfig::new("x", DatabaseKind::Duckdb);
        c.file_path = None;
        let err = d.connect(&c).await.unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)));
    }

    #[tokio::test]
    async fn create_select_update_delete_round_trip() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();

        d.run_query(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, age INTEGER)",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();

        let ins = d
            .run_query(
                "INSERT INTO users (id, name, age) VALUES ($1, $2, $3)",
                &[
                    QueryValue::Int(1),
                    QueryValue::Text("Alice".into()),
                    QueryValue::Int(30),
                ],
                QueryLanguage::Native,
            )
            .await
            .unwrap();
        assert_eq!(ins.rows_affected, Some(1));

        let sel = d
            .run_query("SELECT id, name, age FROM users", &[], QueryLanguage::Native)
            .await
            .unwrap();
        assert_eq!(sel.columns.len(), 3);
        assert_eq!(sel.rows.len(), 1);
        assert_eq!(sel.rows[0][0], QueryValue::Int(1));
        assert_eq!(sel.rows[0][1], QueryValue::Text("Alice".into()));

        let mut pk = IndexMap::new();
        pk.insert("id".into(), QueryValue::Int(1));
        let mut chg = IndexMap::new();
        chg.insert("age".into(), QueryValue::Int(31));
        let n = d
            .update_row(&TableRef::new("users"), &pk, &chg)
            .await
            .unwrap();
        assert_eq!(n.rows_affected, 1);

        let after = d
            .run_query(
                "SELECT age FROM users WHERE id = 1",
                &[],
                QueryLanguage::Native,
            )
            .await
            .unwrap();
        assert_eq!(after.rows[0][0], QueryValue::Int(31));

        let del = d
            .delete_rows(
                &TableRef::new("users"),
                &[RowDelete::new({
                    let mut m = IndexMap::new();
                    m.insert("id".into(), QueryValue::Int(1));
                    m
                })],
            )
            .await
            .unwrap();
        assert_eq!(del.rows_affected, 1);

        d.close().await;
    }

    #[tokio::test]
    async fn list_schemas_returns_all_object_types() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        for sql in [
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL)",
            "CREATE VIEW active_users AS SELECT * FROM users WHERE id > 0",
            "CREATE SEQUENCE user_id_seq START 1",
            "CREATE INDEX idx_users_name ON users(name)",
            "CREATE MACRO add_one(x) AS x + 1",
        ] {
            d.run_query(sql, &[], QueryLanguage::Native).await.unwrap();
        }

        let schemas = d.list_schemas().await.unwrap();
        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].kind, SchemaNodeKind::Database);

        let main_schema = &schemas[0].children[0];
        assert_eq!(main_schema.kind, SchemaNodeKind::Schema);
        assert_eq!(main_schema.name, "main");

        let kinds: HashMap<_, _> = main_schema
            .children
            .iter()
            .map(|n| (n.name.as_str(), n.kind))
            .collect();
        assert_eq!(kinds.get("users"), Some(&SchemaNodeKind::Table));
        assert_eq!(kinds.get("active_users"), Some(&SchemaNodeKind::View));
        assert_eq!(kinds.get("user_id_seq"), Some(&SchemaNodeKind::Sequence));
        assert_eq!(kinds.get("idx_users_name"), Some(&SchemaNodeKind::Index));
        assert_eq!(kinds.get("add_one"), Some(&SchemaNodeKind::Function));

        let users = main_schema
            .children
            .iter()
            .find(|n| n.name == "users")
            .unwrap();
        assert_eq!(users.children.len(), 2);
        assert_eq!(users.children[0].name, "id");
        assert_eq!(
            users.children[0].detail.as_deref(),
            Some("INTEGER NOT NULL")
        );
        assert_eq!(users.children[1].name, "name");
        assert_eq!(
            users.children[1].detail.as_deref(),
            Some("VARCHAR NOT NULL")
        );

        d.close().await;
    }

    #[tokio::test]
    async fn list_schema_returns_only_the_named_container_node() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query(
            "CREATE TABLE users (id INTEGER)",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();

        let all = d.list_schemas().await.unwrap();
        let database = all[0].clone();
        let main_schema = database.children[0].clone();
        assert_eq!(main_schema.kind, SchemaNodeKind::Schema);
        assert_eq!(main_schema.name, "main");

        // The top-level database container is found by name.
        let db = d.list_schema(&database.name).await.unwrap();
        assert_eq!(db, vec![database]);

        // The nested "main" schema is found even though it is not top-level.
        let schema = d.list_schema("main").await.unwrap();
        assert_eq!(schema, vec![main_schema]);

        // An unknown schema yields nothing rather than the whole tree.
        let none = d.list_schema("does_not_exist").await.unwrap();
        assert!(none.is_empty());

        d.close().await;
    }

    #[test]
    fn build_schema_tree_includes_full_metadata() {
        let schemas = build_schema_tree(
            "testdb",
            vec![
                ("main".into(), "users".into(), "BASE TABLE".into()),
                ("main".into(), "active_users".into(), "VIEW".into()),
            ],
            vec![
                (
                    "main".into(),
                    "users".into(),
                    "id".into(),
                    "INTEGER".into(),
                    "NO".into(),
                ),
            ],
            vec![("main".into(), "user_id_seq".into())],
            vec![("main".into(), "idx_users_name".into())],
            vec![("main".into(), "add_one".into(), "macro".into())],
        )
        .unwrap();

        assert_eq!(schemas.len(), 1);
        let db = &schemas[0];
        assert_eq!(db.kind, SchemaNodeKind::Database);
        assert_eq!(db.name, "testdb");

        let main_schema = &db.children[0];
        assert_eq!(main_schema.kind, SchemaNodeKind::Schema);

        let kinds: HashMap<_, _> = main_schema
            .children
            .iter()
            .map(|n| (n.name.as_str(), n.kind))
            .collect();
        assert_eq!(kinds.get("users"), Some(&SchemaNodeKind::Table));
        assert_eq!(kinds.get("active_users"), Some(&SchemaNodeKind::View));
        assert_eq!(kinds.get("user_id_seq"), Some(&SchemaNodeKind::Sequence));
        assert_eq!(kinds.get("idx_users_name"), Some(&SchemaNodeKind::Index));
        assert_eq!(kinds.get("add_one"), Some(&SchemaNodeKind::Function));

        let users = main_schema
            .children
            .iter()
            .find(|n| n.name == "users")
            .unwrap();
        assert_eq!(users.children[0].name, "id");
        assert_eq!(
            users.children[0].detail.as_deref(),
            Some("INTEGER NOT NULL")
        );
    }

    #[test]
    fn build_schema_tree_no_name_collisions() {
        let schemas = build_schema_tree(
            "testdb",
            vec![("main".into(), "sync".into(), "BASE TABLE".into())],
            Vec::new(),
            Vec::new(),
            Vec::new(),
            vec![("main".into(), "sync".into(), "macro".into())],
        )
        .unwrap();

        let main_schema = &schemas[0].children[0];
        assert_eq!(main_schema.children.len(), 2);
        assert!(main_schema
            .children
            .iter()
            .any(|n| n.name == "sync" && n.kind == SchemaNodeKind::Table));
        assert!(main_schema
            .children
            .iter()
            .any(|n| n.name == "sync" && n.kind == SchemaNodeKind::Function));
    }

    #[tokio::test]
    async fn primary_key_lookup() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query(
            "CREATE TABLE k (a INTEGER, b INTEGER, c VARCHAR, PRIMARY KEY (a, b))",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
        let pk = d
            .primary_key(&TableRef::new("k"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(pk, vec!["a".to_string(), "b".to_string()]);
    }

    #[tokio::test]
    async fn primary_key_returns_none_when_absent() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query(
            "CREATE TABLE p (x VARCHAR)",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
        assert_eq!(d.primary_key(&TableRef::new("p")).await.unwrap(), None);
    }

    #[tokio::test]
    async fn explain_dry_run_returns_plan() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR)",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
        let plan = d
            .explain_query(
                "SELECT * FROM users WHERE id = 1",
                &[],
                QueryLanguage::Native,
                ExplainMode::DryRun,
            )
            .await
            .unwrap();
        assert_eq!(plan.mode, ExplainMode::DryRun);
        assert!(plan.raw.starts_with("EXPLAIN"));
    }

    #[tokio::test]
    async fn explain_analyze_returns_plan() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR)",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
        let plan = d
            .explain_query(
                "SELECT * FROM users WHERE id = 1",
                &[],
                QueryLanguage::Native,
                ExplainMode::Analyze,
            )
            .await
            .unwrap();
        assert_eq!(plan.mode, ExplainMode::Analyze);
        assert!(plan.raw.starts_with("EXPLAIN ANALYZE"));
    }

    #[tokio::test]
    async fn rejects_query_when_not_connected() {
        let d = DuckdbDriver::new();
        let err = d
            .run_query("SELECT 1", &[], QueryLanguage::Native)
            .await
            .unwrap_err();
        assert!(matches!(err, DriverError::NotConnected));
    }

    #[tokio::test]
    async fn insert_then_select_blob() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query(
            "CREATE TABLE bin (id INTEGER PRIMARY KEY, b BLOB)",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
        d.run_query(
            "INSERT INTO bin VALUES (1, $1)",
            &[QueryValue::Data(vec![0xde, 0xad])],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
        let r = d
            .run_query("SELECT b FROM bin WHERE id=1", &[], QueryLanguage::Native)
            .await
            .unwrap();
        assert_eq!(r.rows[0][0], QueryValue::Data(vec![0xde, 0xad]));
    }

    // ── run_query_stream ─────────────────────────────────────────────────────

    use crate::ColumnSpec;
    use crate::drivers::constants::STREAM_CHUNK_ROWS;

    async fn drain(
        stream: QueryStream,
    ) -> (
        Vec<ColumnSpec>,
        Vec<std::result::Result<Vec<Vec<QueryValue>>, DriverError>>,
    ) {
        match stream {
            QueryStream::Rows(rs) => (rs.columns, rs.chunks.collect().await),
            QueryStream::Arrow(_) => panic!("expected a row stream"),
        }
    }

    async fn seed_range(d: &DuckdbDriver, total: usize) {
        d.run_query(
            &format!("CREATE TABLE t AS SELECT range AS n FROM range({total})"),
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn run_query_stream_chunks_a_large_select_in_order() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        let total = STREAM_CHUNK_ROWS + 5;
        seed_range(&d, total).await;

        let stream = d
            .run_query_stream("SELECT n FROM t ORDER BY n", &[], QueryLanguage::Native)
            .await
            .unwrap();
        let (columns, chunks) = drain(stream).await;

        assert_eq!(columns.len(), 1);
        assert_eq!(columns[0].name, "n");
        assert_eq!(columns[0].type_hint, "BIGINT");
        assert_eq!(chunks.len(), 2);
        let first = chunks[0].as_ref().unwrap();
        assert_eq!(first.len(), STREAM_CHUNK_ROWS);
        assert_eq!(first[0][0], QueryValue::Int(0));
        let last = chunks[1].as_ref().unwrap();
        assert_eq!(last.len(), 5);
        assert_eq!(last[4][0], QueryValue::Int(total as i64 - 1));
    }

    #[tokio::test]
    async fn run_query_stream_materializes_non_select() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query("CREATE TABLE m (n INTEGER)", &[], QueryLanguage::Native)
            .await
            .unwrap();

        let stream = d
            .run_query_stream("INSERT INTO m VALUES (7)", &[], QueryLanguage::Native)
            .await
            .unwrap();
        let (_, chunks) = drain(stream).await;
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].as_ref().unwrap().is_empty());

        let r = d
            .run_query("SELECT COUNT(*) FROM m", &[], QueryLanguage::Native)
            .await
            .unwrap();
        assert_eq!(r.rows[0][0], QueryValue::Int(1));
    }

    #[tokio::test]
    async fn run_query_stream_materializes_inside_a_manual_transaction() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        let total = STREAM_CHUNK_ROWS + 5;
        seed_range(&d, total).await;

        d.begin_transaction(crate::IsolationLevel::Default)
            .await
            .unwrap();
        let stream = d
            .run_query_stream("SELECT n FROM t", &[], QueryLanguage::Native)
            .await
            .unwrap();
        let (_, chunks) = drain(stream).await;
        // Materialized results arrive as one chunk regardless of size.
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].as_ref().unwrap().len(), total);
        d.rollback_transaction().await.unwrap();
    }

    #[tokio::test]
    async fn dropping_the_stream_frees_the_connection() {
        let d = DuckdbDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        seed_range(&d, 100_000).await;

        let stream = d
            .run_query_stream("SELECT n FROM t", &[], QueryLanguage::Native)
            .await
            .unwrap();
        let QueryStream::Rows(mut rs) = stream else {
            panic!("expected a row stream")
        };
        rs.chunks.next().await.unwrap().unwrap();
        drop(rs);

        // Hangs here (and times out) if the abandoned stream kept the lock.
        let r = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            d.run_query("SELECT 1", &[], QueryLanguage::Native),
        )
        .await
        .expect("connection stayed locked after the stream was dropped")
        .unwrap();
        assert_eq!(r.rows[0][0], QueryValue::Int(1));
    }
}
