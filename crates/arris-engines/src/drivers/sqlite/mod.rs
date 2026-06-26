//! SQLite driver — wraps `rusqlite::Connection` (sync) inside a
//! `tokio::sync::Mutex` and runs each call on the blocking thread pool.
//!
//! Mirrors `Packages/DatabaseKit/Sources/SQLiteDriver/SQLiteDriver.swift`.
//! Behaviour:
//! - File-based: `config.file_path` required, `:memory:` accepted as a literal value.
//! - Schema: `sqlite_master` for tables/views/indexes, `PRAGMA table_info` per table for columns + PK.
//! - Explain: dry-run via `EXPLAIN QUERY PLAN` only. `analyze` mode rejected (matches Swift behaviour).
//! - CRUD: full UPDATE / INSERT / DELETE.

mod definition;
mod query;
mod schema;
mod values;

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use rusqlite::{Connection, OpenFlags};
use tokio::sync::Mutex;
use tokio::task;

use crate::{
    ConnectionConfig, DriverError, ExplainMode, MutationResult, PlanAttribute, PlanNode,
    PlanResult, QueryLanguage, QueryResult, QueryValue, RowDelete, RowInsert, SchemaNode,
    TableRef,
};
use crate::drivers::errors::Result;

use crate::drivers::DatabaseDriver;
use crate::drivers::sql_builder::SqlBuilder;

use query::{run_exec, run_select};
use schema::{build_schema_nodes, primary_key_columns};

#[derive(Default)]
pub struct SqliteDriver {
    inner: Arc<Mutex<Option<Connection>>>,
    file_path: Mutex<Option<PathBuf>>,
    /// Whether a manual transaction is currently open on this connection.
    in_tx: Mutex<bool>,
}

impl SqliteDriver {
    pub fn new() -> Self {
        Self::default()
    }

    async fn with_conn<F, T>(&self, op: F) -> Result<T>
    where
        F: FnOnce(&mut Connection) -> Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let inner = self.inner.clone();
        task::spawn_blocking(move || {
            let mut guard = inner.blocking_lock();
            let conn = guard.as_mut().ok_or(DriverError::NotConnected)?;
            op(conn)
        })
        .await
        .map_err(|e| DriverError::other(format!("blocking pool join failed: {e}")))?
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let path = config
            .file_path
            .clone()
            .filter(|p| !p.is_empty())
            .ok_or_else(|| {
                DriverError::InvalidArgument(
                    "SQLite connection requires a file path (or ':memory:').".into(),
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
                        "SQLite path points to a directory — include a file name (e.g. /dir/mydb.db).".into(),
                    ));
                }
                if let Some(parent) = resolved.parent() {
                    if !parent.as_os_str().is_empty() && !parent.exists() {
                        std::fs::create_dir_all(parent)
                            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
                    }
                }
                Connection::open_with_flags(
                    &resolved,
                    OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
                )
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
            .unwrap_or_else(|| "main".into());
        self.with_conn(move |c| build_schema_nodes(c, &db_name)).await
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

    fn select_like_keywords(&self) -> &'static [&'static str] {
        &["PRAGMA"]
    }

    fn supports_transactions(&self) -> bool {
        true
    }

    async fn in_transaction(&self) -> bool {
        *self.in_tx.lock().await
    }

    async fn begin_transaction(&self, _isolation: crate::IsolationLevel) -> Result<()> {
        // SQLite has no selectable transaction isolation — writers are always
        // serializable — so `IsolationLevel` other than `Default` is a no-op.
        self.with_conn(|c| {
            c.execute_batch("BEGIN")
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

    async fn supports_explain(&self, mode: ExplainMode) -> bool {
        matches!(mode, ExplainMode::DryRun)
    }

    async fn explain_query(
        &self,
        text: &str,
        params: &[QueryValue],
        _language: QueryLanguage,
        mode: ExplainMode,
    ) -> Result<PlanResult> {
        if !matches!(mode, ExplainMode::DryRun) {
            return Err(DriverError::ExplainUnsupported);
        }
        let sql = format!("EXPLAIN QUERY PLAN {text}");
        let p = params.to_vec();
        let result = self.with_conn(move |c| run_select(c, &sql, &p)).await?;

        // Each row: (id, parent, _, detail). Build a nested tree by parent-id.
        let mut nodes: Vec<(i64, i64, PlanNode)> = Vec::new();
        for row in &result.rows {
            let id = match row.first() {
                Some(QueryValue::Int(i)) => *i,
                _ => 0,
            };
            let parent = match row.get(1) {
                Some(QueryValue::Int(i)) => *i,
                _ => 0,
            };
            let detail = match row.get(3) {
                Some(QueryValue::Text(s)) => s.clone(),
                _ => String::new(),
            };
            let mut n = PlanNode::new(detail.clone(), "QueryPlan");
            n.attributes
                .push(PlanAttribute::new("detail", detail));
            nodes.push((id, parent, n));
        }

        // Stitch children under parents (parent_id = 0 → root).
        let mut by_id: std::collections::HashMap<i64, PlanNode> = std::collections::HashMap::new();
        let mut order: Vec<i64> = Vec::new();
        for (id, _, n) in &nodes {
            by_id.insert(*id, n.clone());
            order.push(*id);
        }
        let mut roots: Vec<PlanNode> = Vec::new();
        for (id, parent, _) in nodes.iter().rev() {
            let node = by_id.remove(id).unwrap();
            if *parent == 0 {
                roots.push(node);
            } else if let Some(p) = by_id.get_mut(parent) {
                p.children.insert(0, node);
            } else {
                roots.push(node);
            }
        }
        roots.reverse();
        let _ = order;

        let root = if roots.len() == 1 {
            roots.remove(0)
        } else {
            let mut wrap = PlanNode::new("Plan", "Plan");
            wrap.children = roots;
            wrap
        };

        Ok(PlanResult::new(root, ExplainMode::DryRun, format!("EXPLAIN QUERY PLAN {text}")))
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
        let (sql, params) = SqlBuilder::build_update(table, primary_key, changes, SqlBuilder::quote_double, SqlBuilder::placeholder_qmark)
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
                SqlBuilder::build_insert(table, &ins.values, SqlBuilder::quote_double, SqlBuilder::placeholder_qmark)
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
                SqlBuilder::build_delete(table, &del.primary_key, SqlBuilder::quote_double, SqlBuilder::placeholder_qmark)
                    .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let r = self.run_query(&sql, &params, QueryLanguage::Native).await?;
            result.rows_affected += r.rows_affected.unwrap_or(0) as usize;
            result.statements.push(SqlBuilder::interpolate_params(&sql, &params));
        }
        Ok(result)
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

    fn cfg(path: &str) -> ConnectionConfig {
        let mut c = ConnectionConfig::new("test", DatabaseKind::Sqlite);
        c.file_path = Some(path.into());
        c
    }

    #[tokio::test]
    async fn connect_then_disconnect_roundtrip() {
        let d = SqliteDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        assert!(d.is_connected().await);
        d.close().await;
        assert!(!d.is_connected().await);
    }

    #[tokio::test]
    async fn rejects_missing_file_path() {
        let d = SqliteDriver::new();
        let mut c = ConnectionConfig::new("x", DatabaseKind::Sqlite);
        c.file_path = None;
        let err = d.connect(&c).await.unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)));
    }

    #[tokio::test]
    async fn create_select_update_delete_round_trip() {
        let d = SqliteDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();

        d.run_query(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();

        let ins = d
            .run_query(
                "INSERT INTO users (id, name, age) VALUES (?, ?, ?)",
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

        // update via trait helper
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
            .run_query("SELECT age FROM users WHERE id = 1", &[], QueryLanguage::Native)
            .await
            .unwrap();
        assert_eq!(after.rows[0][0], QueryValue::Int(31));

        // delete
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
    async fn list_schemas_returns_table_with_columns() {
        let d = SqliteDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
        let schemas = d.list_schemas().await.unwrap();
        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].kind, SchemaNodeKind::Database);
        let table = &schemas[0].children[0];
        assert_eq!(table.name, "users");
        assert_eq!(table.kind, SchemaNodeKind::Table);
        let col_names: Vec<&str> = table.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(col_names, vec!["id", "name"]);
    }

    #[tokio::test]
    async fn list_schemas_returns_sqlite_metadata_object_kinds() {
        let d = SqliteDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
        d.run_query(
            "CREATE VIEW active_users AS SELECT id, name FROM users WHERE name IS NOT NULL",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
        d.run_query(
            "CREATE INDEX users_name_idx ON users(name)",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
        d.run_query(
            "CREATE TRIGGER users_ai AFTER INSERT ON users BEGIN SELECT NEW.id; END",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();

        let schemas = d.list_schemas().await.unwrap();
        let db = schemas.first().unwrap();
        let kinds: HashMap<&str, SchemaNodeKind> = db
            .children
            .iter()
            .map(|node| (node.name.as_str(), node.kind))
            .collect();

        assert_eq!(kinds.get("users"), Some(&SchemaNodeKind::Table));
        assert_eq!(kinds.get("active_users"), Some(&SchemaNodeKind::View));
        assert_eq!(kinds.get("users_name_idx"), Some(&SchemaNodeKind::Index));
        assert_eq!(kinds.get("users_ai"), Some(&SchemaNodeKind::Trigger));
    }

    #[tokio::test]
    async fn primary_key_lookup() {
        let d = SqliteDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query(
            "CREATE TABLE k (a INTEGER, b INTEGER, c TEXT, PRIMARY KEY (a, b))",
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
        let d = SqliteDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query("CREATE TABLE p (x TEXT)", &[], QueryLanguage::Native)
            .await
            .unwrap();
        assert_eq!(d.primary_key(&TableRef::new("p")).await.unwrap(), None);
    }

    #[tokio::test]
    async fn explain_dry_run_returns_plan() {
        let d = SqliteDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
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
        assert!(plan.raw.starts_with("EXPLAIN QUERY PLAN"));
    }

    #[tokio::test]
    async fn explain_analyze_unsupported() {
        let d = SqliteDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        let err = d
            .explain_query("SELECT 1", &[], QueryLanguage::Native, ExplainMode::Analyze)
            .await
            .unwrap_err();
        assert!(matches!(err, DriverError::ExplainUnsupported));
        assert!(!d.supports_explain(ExplainMode::Analyze).await);
        assert!(d.supports_explain(ExplainMode::DryRun).await);
    }

    #[tokio::test]
    async fn rejects_query_when_not_connected() {
        let d = SqliteDriver::new();
        let err = d
            .run_query("SELECT 1", &[], QueryLanguage::Native)
            .await
            .unwrap_err();
        assert!(matches!(err, DriverError::NotConnected));
    }

    #[tokio::test]
    async fn insert_then_select_blob() {
        let d = SqliteDriver::new();
        d.connect(&cfg(":memory:")).await.unwrap();
        d.run_query(
            "CREATE TABLE bin (id INTEGER PRIMARY KEY, b BLOB)",
            &[],
            QueryLanguage::Native,
        )
        .await
        .unwrap();
        d.run_query(
            "INSERT INTO bin VALUES (1, ?)",
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
}
