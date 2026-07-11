//! MySQL / MariaDB driver — uses the pure-Rust `mysql_async` crate over
//! tokio. Single binary serves both kinds (MariaDB shares MySQL's wire
//! protocol).
//!
//! Mirrors `Packages/DatabaseKit/Sources/MySQLDriver/MySQLDriver.swift`:
//! - Schema browser walks `information_schema` (databases → tables → columns).
//! - `run_query` distinguishes SELECT-shape from DML by leading keyword.
//! - `explain_query` wraps the statement in `EXPLAIN FORMAT=JSON …` (dry-run)
//!   or `EXPLAIN ANALYZE …` (analyze) and walks the JSON tree into
//!   `PlanNode`s.
//! - CRUD helpers route through `sql_builder::build_*` with backtick-quoted
//!   identifiers and `?` placeholders.

mod config;
mod definition;
mod explain;
mod query;
mod schema;
mod values;

use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use mysql_async::prelude::Queryable;
use mysql_async::{Conn, Opts, Params, Pool, Row, TxOpts};
use tokio::sync::Mutex;

use crate::{
    ConnectionConfig, DriverError, ExplainMode, MutationResult, PlanAttribute, PlanNode,
    PlanResult, QueryLanguage, QueryResult, QueryStream, QueryValue, RowDelete, RowInsert,
    SchemaNode, SchemaNodeKind, TableRef,
};
use crate::drivers::errors::Result;

use crate::drivers::DatabaseDriver;
use crate::drivers::common::MysqlWireStream;
use crate::drivers::sql_builder::SqlBuilder;


use config::build_opts;
use definition::{DefinitionQuery, definition_from_row};
use explain::walk_mysql_plan;
use query::{
    params_to_mysql, row_to_query_values, rows_first_column_to_string, rows_to_query_result,
    stmt_columns_to_specs,
};
use schema::{
    MysqlColumnRow, MysqlNamedObjectRow, MysqlRoutineRow, MysqlTableRow, build_mysql_schema_tree,
};

pub struct MysqlDriver {
    inner: Mutex<Option<Arc<Pool>>>,
    /// Stored separately so `cancel_running_query` can open an ephemeral
    /// connection without acquiring `inner`.
    cancel_opts: Mutex<Option<Opts>>,
    /// A connection pinned out of the pool while a manual transaction is open.
    /// The pool hands a fresh connection per `get_conn`, so a multi-statement
    /// transaction must keep using this same one; `run_query` routes through it
    /// while present. Dropped (returned to the pool) on commit/rollback/close.
    tx_conn: Mutex<Option<Conn>>,
}

impl Default for MysqlDriver {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            cancel_opts: Mutex::new(None),
            tx_conn: Mutex::new(None),
        }
    }
}

impl MysqlDriver {
    pub fn new() -> Self {
        Self::default()
    }

    async fn pool(&self) -> Result<Arc<Pool>> {
        self.inner
            .lock()
            .await
            .as_ref()
            .cloned()
            .ok_or(DriverError::NotConnected)
    }

    async fn conn(&self) -> Result<Conn> {
        let pool = self.pool().await?;
        pool.get_conn()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))
    }

    /// Run one statement on a specific connection. Shared by the pooled path
    /// (one connection per query) and the pinned-connection path (a manual
    /// transaction reusing one connection across statements).
    async fn run_on_conn(
        conn: &mut Conn,
        text: &str,
        params: &[QueryValue],
        is_select: bool,
    ) -> Result<QueryResult> {
        let started = Instant::now();
        let p = params_to_mysql(params);

        if is_select {
            let (cols, rows) = if matches!(p, Params::Empty) {
                let q = conn
                    .query_iter(text)
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
                let cols = q.columns();
                let rows: Vec<Row> = q
                    .collect_and_drop::<Row>()
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
                (cols, rows)
            } else {
                let q = conn
                    .exec_iter(text, p)
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
                let cols = q.columns();
                let rows: Vec<Row> = q
                    .collect_and_drop::<Row>()
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
                (cols, rows)
            };
            Ok(rows_to_query_result(rows, cols, started.elapsed().as_secs_f64()))
        } else {
            if matches!(p, Params::Empty) {
                conn.query_drop(text)
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            } else {
                conn.exec_drop(text, p)
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            }
            Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: Some(conn.affected_rows() as i64),
                elapsed: started.elapsed().as_secs_f64(),
                ..Default::default()
            })
        }
    }
}

#[async_trait]
impl DatabaseDriver for MysqlDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let opts = build_opts(config);
        let pool = Pool::new(opts.clone());
        // Verify connectivity synchronously so bad credentials surface here
        // rather than on the first query (mirrors the Mongo `ping_on_connect`
        // invariant).
        let mut conn = pool
            .get_conn()
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
        conn.ping()
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
        drop(conn);
        *self.inner.lock().await = Some(Arc::new(pool));
        *self.cancel_opts.lock().await = Some(opts);
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let mut conn = self.conn().await?;

        // Cheap: list the database containers only. Each database's tables,
        // columns, routines, events, and triggers load on demand via
        // `list_schema` when the user selects it in the schema dropdown.
        let dbs: Vec<String> = conn
            .query(
                "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA \
                 WHERE SCHEMA_NAME NOT IN ('mysql','information_schema','performance_schema','sys') \
                 ORDER BY SCHEMA_NAME",
            )
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        drop(conn);

        let mut nodes: Vec<SchemaNode> = dbs
            .into_iter()
            .map(|db| {
                let path = db.clone();
                SchemaNode::new(db, SchemaNodeKind::Database, path)
            })
            .collect();
        nodes.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(nodes)
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let mut conn = self.conn().await?;

        // All targeted to the one selected database; bind the name as a param.
        let tables: Vec<MysqlTableRow> = conn
            .exec(
                "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES \
                 WHERE TABLE_SCHEMA = ? \
                 ORDER BY TABLE_TYPE, TABLE_NAME",
                (schema,),
            )
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let cols: Vec<MysqlColumnRow> = conn
            .exec(
                "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, ORDINAL_POSITION \
                 FROM information_schema.COLUMNS \
                 WHERE TABLE_SCHEMA = ? \
                 ORDER BY TABLE_NAME, ORDINAL_POSITION",
                (schema,),
            )
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let routines: Vec<MysqlRoutineRow> = conn
            .exec(
                "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES \
                 WHERE ROUTINE_SCHEMA = ? \
                 ORDER BY ROUTINE_TYPE, ROUTINE_NAME",
                (schema,),
            )
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let events: Vec<MysqlNamedObjectRow> = conn
            .exec(
                "SELECT EVENT_SCHEMA, EVENT_NAME FROM information_schema.EVENTS \
                 WHERE EVENT_SCHEMA = ? \
                 ORDER BY EVENT_NAME",
                (schema,),
            )
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let triggers: Vec<MysqlNamedObjectRow> = conn
            .exec(
                "SELECT TRIGGER_SCHEMA, TRIGGER_NAME FROM information_schema.TRIGGERS \
                 WHERE TRIGGER_SCHEMA = ? \
                 ORDER BY TRIGGER_NAME",
                (schema,),
            )
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        drop(conn);

        // `build_mysql_schema_tree` seeds the database node from `dbs`, so it
        // returns exactly one Database node with the same `name`/`kind`/`path`
        // (the bare db name) that `list_schemas` produced — the path the
        // frontend merges the lazily-loaded subtree onto.
        Ok(build_mysql_schema_tree(
            vec![schema.to_owned()],
            tables,
            cols,
            routines,
            events,
            triggers,
        ))
    }

    fn select_like_keywords(&self) -> &'static [&'static str] {
        &["DESCRIBE", "DESC", "HELP"]
    }

    async fn run_query(
        &self,
        text: &str,
        params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        let is_select = self.looks_like_select(text);
        // When a manual transaction is open, run on the pinned connection so the
        // statement joins it; otherwise take a fresh connection from the pool.
        let mut guard = self.tx_conn.lock().await;
        if let Some(conn) = guard.as_mut() {
            Self::run_on_conn(conn, text, params, is_select).await
        } else {
            drop(guard);
            let mut conn = self.conn().await?;
            Self::run_on_conn(&mut conn, text, params, is_select).await
        }
    }

    async fn run_query_stream(
        &self,
        text: &str,
        params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryStream> {
        // Streaming needs its own pooled connection for the stream's life, so an
        // open manual transaction (pinned conn) and non-SELECTs stay materialized.
        if !self.looks_like_select(text) || self.in_transaction().await {
            return Ok(QueryStream::from_materialized(
                self.run_query(text, params, language).await?,
            ));
        }
        let mut conn = self.conn().await?;
        // Prepare learns the result columns up front. Some SELECT-shaped forms
        // (e.g. SHOW) are not preparable: fall back to materializing on this conn.
        let stmt = match conn.prep(text).await {
            Ok(stmt) => stmt,
            Err(_) => {
                let result = Self::run_on_conn(&mut conn, text, params, true).await?;
                return Ok(QueryStream::from_materialized(result));
            }
        };
        let columns = stmt_columns_to_specs(stmt.columns());
        let params = params_to_mysql(params);
        Ok(QueryStream::Rows(MysqlWireStream::open(
            conn,
            stmt,
            params,
            columns,
            row_to_query_values,
        )))
    }

    async fn explain_query(
        &self,
        text: &str,
        params: &[QueryValue],
        _language: QueryLanguage,
        mode: ExplainMode,
    ) -> Result<PlanResult> {
        let analyze = matches!(mode, ExplainMode::Analyze);
        let mut conn = self.conn().await?;
        let p = params_to_mysql(params);

        if analyze {
            // EXPLAIN ANALYZE returns text rows (one column).
            let sql = format!("EXPLAIN ANALYZE {text}");
            let rows: Vec<Row> = if matches!(p, Params::Empty) {
                conn.query(&sql)
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            } else {
                conn.exec(&sql, p)
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            };
            let raw = rows_first_column_to_string(rows);
            let mut root = PlanNode::new("EXPLAIN ANALYZE", "explain_analyze");
            for (i, line) in raw.lines().enumerate() {
                root.attributes
                    .push(PlanAttribute::new(format!("L{i}"), line));
            }
            Ok(PlanResult::new(root, mode, raw))
        } else {
            let sql = format!("EXPLAIN FORMAT=JSON {text}");
            let rows: Vec<Row> = if matches!(p, Params::Empty) {
                conn.query(&sql)
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            } else {
                conn.exec(&sql, p)
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            };
            let raw = rows_first_column_to_string(rows);
            let parsed: serde_json::Value =
                serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
            let root = walk_mysql_plan(&parsed);
            Ok(PlanResult::new(root, mode, raw))
        }
    }

    async fn primary_key(&self, table: &TableRef) -> Result<Option<Vec<String>>> {
        let mut conn = self.conn().await?;
        // MySQL flattens schema → database; prefer schema, fall back to current DB.
        let db_filter: String = match &table.schema {
            Some(s) => s.clone(),
            None => match &table.database {
                Some(d) => d.clone(),
                None => "DATABASE()".into(),
            },
        };
        // Inline-quoted because parameter binding for SCHEMA is awkward; escape single quotes.
        let escaped_db = db_filter.replace('\'', "''");
        let escaped_tbl = table.name.replace('\'', "''");
        let sql = format!(
            "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE \
             WHERE CONSTRAINT_NAME='PRIMARY' AND TABLE_SCHEMA='{escaped_db}' AND TABLE_NAME='{escaped_tbl}' \
             ORDER BY ORDINAL_POSITION"
        );
        let cols: Vec<String> = conn
            .query(&sql)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        Ok(if cols.is_empty() { None } else { Some(cols) })
    }

    async fn object_definition(&self, object: &crate::ObjectRef) -> Result<String> {
        let query = DefinitionQuery::for_object(object)?;
        let mut conn = self.conn().await?;
        let mut iter = conn
            .query_iter(query.sql)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let row: Row = iter
            .next()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .ok_or_else(|| {
                DriverError::QueryFailed(format!(
                    "MySQL: no definition returned for {:?} {:?}",
                    object.kind, object.name
                ))
            })?;
        let ddl = definition_from_row(&row, query.label)?;
        // Drain remaining rows so the connection returns to the pool cleanly.
        iter.drop_result()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        Ok(ddl)
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &crate::ValueMap,
        changes: &crate::ValueMap,
    ) -> Result<MutationResult> {
        let (sql, params) =
            SqlBuilder::build_update(table, primary_key, changes, SqlBuilder::quote_backtick, SqlBuilder::placeholder_qmark)
                .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
        let r = self.run_query(&sql, &params, QueryLanguage::Native).await?;
        Ok(MutationResult {
            rows_affected: r.rows_affected.unwrap_or(0) as usize,
            statements: vec![SqlBuilder::interpolate_params(&sql, &params)],
        })
    }

    async fn update_rows(
        &self,
        table: &TableRef,
        edits: &[crate::RowEdit],
    ) -> Result<MutationResult> {
        let mut conn = self.conn().await?;
        let mut tx = conn
            .start_transaction(TxOpts::default())
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let mut result = MutationResult::default();
        for edit in edits {
            let (sql, params) = SqlBuilder::build_update(
                table,
                &edit.primary_key,
                &edit.changes,
                SqlBuilder::quote_backtick,
                SqlBuilder::placeholder_qmark,
            )
            .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let p = params_to_mysql(&params);
            match tx.exec_drop(&sql, p).await {
                Ok(()) => result.rows_affected += tx.affected_rows() as usize,
                Err(e) => {
                    let _ = tx.rollback().await;
                    return Err(DriverError::QueryFailed(e.to_string()));
                }
            }
            result.statements.push(SqlBuilder::interpolate_params(&sql, &params));
        }
        tx.commit()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        Ok(result)
    }

    async fn insert_rows(&self, table: &TableRef, inserts: &[RowInsert]) -> Result<MutationResult> {
        let mut result = MutationResult::default();
        for ins in inserts {
            let (sql, params) =
                SqlBuilder::build_insert(table, &ins.values, SqlBuilder::quote_backtick, SqlBuilder::placeholder_qmark)
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
                SqlBuilder::build_delete(table, &del.primary_key, SqlBuilder::quote_backtick, SqlBuilder::placeholder_qmark)
                    .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let r = self.run_query(&sql, &params, QueryLanguage::Native).await?;
            result.rows_affected += r.rows_affected.unwrap_or(0) as usize;
            result.statements.push(SqlBuilder::interpolate_params(&sql, &params));
        }
        Ok(result)
    }

    async fn cancel_running_query(&self) -> crate::drivers::errors::Result<()> {
        // Open an ephemeral connection using the stored opts and KILL QUERY
        // all other connections from our pool.
        let opts = self.cancel_opts.lock().await.clone();
        let pool = self.pool().await.ok();
        if let (Some(opts), Some(pool)) = (opts, pool) {
            // Get a connection from the pool to find its connection_id
            if let Ok(mut conn) = pool.get_conn().await {
                let conn_id: Option<u64> = conn.query_first("SELECT CONNECTION_ID()").await.ok().flatten();
                drop(conn);
                if let Some(id) = conn_id {
                    // Open ephemeral connection to issue KILL QUERY
                    let kill_pool = Pool::new(opts);
                    if let Ok(mut kill_conn) = kill_pool.get_conn().await {
                        let _ = kill_conn.query_drop(format!("KILL QUERY {id}")).await;
                    }
                    let _ = kill_pool.disconnect().await;
                }
            }
        }
        Ok(())
    }

    fn supports_transactions(&self) -> bool {
        true
    }

    async fn in_transaction(&self) -> bool {
        self.tx_conn.lock().await.is_some()
    }

    async fn begin_transaction(&self, isolation: crate::IsolationLevel) -> Result<()> {
        let pool = self.pool().await?;
        let mut conn = pool
            .get_conn()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        // `SET TRANSACTION ISOLATION LEVEL` (no SESSION/GLOBAL) applies to the
        // next transaction only and must precede `START TRANSACTION`.
        if let Some(level) = isolation.sql_name() {
            conn.query_drop(format!("SET TRANSACTION ISOLATION LEVEL {level}"))
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        }
        conn.query_drop("START TRANSACTION")
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        *self.tx_conn.lock().await = Some(conn);
        Ok(())
    }

    async fn commit_transaction(&self) -> Result<()> {
        if let Some(mut conn) = self.tx_conn.lock().await.take() {
            conn.query_drop("COMMIT")
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        }
        Ok(())
    }

    async fn rollback_transaction(&self) -> Result<()> {
        if let Some(mut conn) = self.tx_conn.lock().await.take() {
            conn.query_drop("ROLLBACK")
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        }
        Ok(())
    }

    async fn close(&self) {
        *self.cancel_opts.lock().await = None;
        // Drop any pinned transaction connection; the pool resets it on return.
        let _ = self.tx_conn.lock().await.take();
        if let Some(pool) = self.inner.lock().await.take() {
            // Best-effort graceful shutdown.
            if let Ok(p) = Arc::try_unwrap(pool) {
                let _ = p.disconnect().await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    //! Unit tests run without a live MySQL.
    use super::*;
    use std::collections::HashMap;

    use config::{build_mysql_url, build_opts};
    use explain::walk_mysql_plan;
    use query::params_to_mysql;
    use schema::build_mysql_schema_tree;

    use crate::{SchemaNodeKind, SslMode};

    #[test]
    fn looks_like_select_handles_common_keywords() {
        let d = MysqlDriver::new();
        assert!(d.looks_like_select("SELECT 1"));
        assert!(d.looks_like_select("  with x as (select 1) select * from x"));
        assert!(d.looks_like_select("SHOW TABLES"));
        assert!(d.looks_like_select("DESCRIBE users"));
        assert!(d.looks_like_select("DESC users"));
        assert!(d.looks_like_select("EXPLAIN SELECT 1"));
        assert!(!d.looks_like_select("INSERT INTO t VALUES (1)"));
        assert!(!d.looks_like_select("UPDATE t SET x=1"));
        assert!(!d.looks_like_select("DELETE FROM t WHERE id=1"));
        assert!(!d.looks_like_select("CREATE TABLE t(x int)"));
    }

    #[tokio::test]
    async fn driver_starts_disconnected() {
        let d = MysqlDriver::new();
        assert!(!d.is_connected().await);
    }

    #[tokio::test]
    async fn mysql_supports_transactions_and_starts_outside_tx() {
        let d = MysqlDriver::new();
        assert!(d.supports_transactions());
        assert!(!d.in_transaction().await);
    }

    #[test]
    fn build_opts_sets_host_port_user() {
        let mut cfg = ConnectionConfig::new("local", crate::DatabaseKind::Mysql);
        cfg.host = "db.example.com".into();
        cfg.port = 3307;
        cfg.user = "rw".into();
        cfg.password = "s".into();
        cfg.database = "app".into();
        // Just make sure the builder doesn't panic and the resulting Opts can
        // be built. We don't peek inside fields because OptsBuilder is opaque.
        let _opts = build_opts(&cfg);
    }

    #[test]
    fn build_opts_default_port_when_zero() {
        let cfg = ConnectionConfig::new("local", crate::DatabaseKind::Mysql);
        let opts = build_opts(&cfg);
        assert_eq!(opts.tcp_port(), 3306);
    }

    #[test]
    fn build_opts_default_host_when_empty() {
        let cfg = ConnectionConfig::new("local", crate::DatabaseKind::Mysql);
        let opts = build_opts(&cfg);
        assert_eq!(opts.ip_or_hostname(), "localhost");
    }

    #[test]
    fn build_opts_attaches_ssl_when_mode_enabled() {
        let mut cfg = ConnectionConfig::new("local", crate::DatabaseKind::Mysql);
        cfg.ssl_mode = SslMode::Required;
        let opts = build_opts(&cfg);
        assert!(opts.ssl_opts().is_some());
    }

    #[test]
    fn build_opts_no_ssl_when_disabled() {
        let mut cfg = ConnectionConfig::new("local", crate::DatabaseKind::Mysql);
        cfg.ssl_mode = SslMode::Disabled;
        let opts = build_opts(&cfg);
        assert!(opts.ssl_opts().is_none());
    }

    #[test]
    fn mysql_container_node_matches_lazy_merge_path() {
        // `list_schemas` returns bare Database containers (empty children) and
        // `list_schema(db)` returns the populated Database node. Both must share
        // the same name/kind/path (the bare db name) so the frontend merges the
        // lazy subtree onto the cached container by path. The container shape is
        // identical to seeding `build_mysql_schema_tree` with empty metadata.
        let container = &build_mysql_schema_tree(
            vec!["appdb".into()],
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        )[0];
        assert_eq!(container.name, "appdb");
        assert_eq!(container.kind, SchemaNodeKind::Database);
        assert_eq!(container.path, "appdb");
        assert!(container.children.is_empty());

        let populated = &build_mysql_schema_tree(
            vec!["appdb".into()],
            vec![("appdb".into(), "users".into(), "BASE TABLE".into())],
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        )[0];
        // Same merge anchor as the empty container.
        assert_eq!(populated.name, container.name);
        assert_eq!(populated.kind, container.kind);
        assert_eq!(populated.path, container.path);
        assert!(!populated.children.is_empty());
    }

    #[test]
    fn mysql_schema_tree_includes_full_metadata_scan() {
        let schemas = build_mysql_schema_tree(
            vec!["appdb".into()],
            vec![
                ("appdb".into(), "users".into(), "BASE TABLE".into()),
                ("appdb".into(), "active_users".into(), "VIEW".into()),
                ("appdb".into(), "invoice_seq".into(), "SEQUENCE".into()),
            ],
            vec![(
                "appdb".into(),
                "users".into(),
                "id".into(),
                "int".into(),
                "NO".into(),
                1,
            )],
            vec![
                ("appdb".into(), "normalize_email".into(), "FUNCTION".into()),
                ("appdb".into(), "refresh_rollups".into(), "PROCEDURE".into()),
            ],
            vec![("appdb".into(), "nightly_rollup".into())],
            vec![("appdb".into(), "users_ai".into())],
        );

        assert_eq!(schemas.len(), 1);
        let db = &schemas[0];
        assert_eq!(db.kind, SchemaNodeKind::Database);
        let kinds: HashMap<_, _> = db
            .children
            .iter()
            .map(|n| (n.name.as_str(), n.kind))
            .collect();
        assert_eq!(kinds.get("users"), Some(&SchemaNodeKind::Table));
        assert_eq!(kinds.get("active_users"), Some(&SchemaNodeKind::View));
        assert_eq!(kinds.get("invoice_seq"), Some(&SchemaNodeKind::Sequence));
        assert_eq!(
            kinds.get("normalize_email"),
            Some(&SchemaNodeKind::Function)
        );
        assert_eq!(
            kinds.get("refresh_rollups"),
            Some(&SchemaNodeKind::Procedure)
        );
        assert_eq!(kinds.get("nightly_rollup"), Some(&SchemaNodeKind::Event));
        assert_eq!(kinds.get("users_ai"), Some(&SchemaNodeKind::Trigger));

        let users = db.children.iter().find(|n| n.name == "users").unwrap();
        assert_eq!(users.children[0].name, "id");
        assert_eq!(users.children[0].detail.as_deref(), Some("int NOT NULL"));
    }

    #[test]
    fn mysql_metadata_nodes_do_not_overwrite_tables_with_same_name() {
        let schemas = build_mysql_schema_tree(
            vec!["appdb".into()],
            vec![("appdb".into(), "sync".into(), "BASE TABLE".into())],
            Vec::new(),
            vec![("appdb".into(), "sync".into(), "FUNCTION".into())],
            Vec::new(),
            Vec::new(),
        );

        let db = &schemas[0];
        assert_eq!(db.children.len(), 2);
        assert!(
            db.children
                .iter()
                .any(|n| n.name == "sync" && n.kind == SchemaNodeKind::Table)
        );
        assert!(
            db.children
                .iter()
                .any(|n| n.name == "sync" && n.kind == SchemaNodeKind::Function)
        );
    }

    #[test]
    fn walk_mysql_plan_extracts_root_table_and_cost() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{
              "query_block": {
                "select_id": 1,
                "cost_info": { "query_cost": "1.10" },
                "table": {
                  "table_name": "users",
                  "access_type": "ALL",
                  "rows_examined_per_scan": 100,
                  "rows_produced_per_join": 99
                }
              }
            }"#,
        )
        .unwrap();
        let plan = walk_mysql_plan(&json);
        assert_eq!(plan.cost_total, Some(1.10));
        // child table node is appended
        assert_eq!(plan.children.len(), 1);
        assert!(plan.children[0].label.starts_with("Table: users"));
        let child = &plan.children[0];
        assert_eq!(child.rows_estimated, Some(100.0));
        assert_eq!(child.rows_actual, Some(99.0));
        assert!(child.attributes.iter().any(|a| a.key == "access_type"));
    }

    #[test]
    fn walk_mysql_plan_handles_nested_loop() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{
              "query_block": {
                "select_id": 1,
                "nested_loop": [
                  { "table": { "table_name": "a" } },
                  { "table": { "table_name": "b" } }
                ]
              }
            }"#,
        )
        .unwrap();
        let plan = walk_mysql_plan(&json);
        assert_eq!(plan.children.len(), 2);
        assert!(plan.children[0].label.contains("Table: a"));
        assert!(plan.children[1].label.contains("Table: b"));
    }

    #[test]
    fn params_to_mysql_empty_returns_empty_variant() {
        let p = params_to_mysql(&[]);
        assert!(matches!(p, Params::Empty));
    }

    #[test]
    fn params_to_mysql_positional_for_non_empty() {
        let p = params_to_mysql(&[QueryValue::Int(1), QueryValue::Text("a".into())]);
        match p {
            Params::Positional(v) => assert_eq!(v.len(), 2),
            _ => panic!("expected positional"),
        }
    }

    #[test]
    fn build_mysql_url_basic() {
        let mut cfg = ConnectionConfig::new("t", crate::DatabaseKind::Mysql);
        cfg.host = "db.local".into();
        cfg.port = 3307;
        cfg.user = "root".into();
        cfg.password = "secret".into();
        cfg.database = "mydb".into();
        let url = build_mysql_url(&cfg);
        assert_eq!(url, "mysql://root:secret@db.local:3307/mydb");
    }

    #[test]
    fn build_mysql_url_encodes_special_chars() {
        let mut cfg = ConnectionConfig::new("t", crate::DatabaseKind::Mysql);
        cfg.user = "user@org".into();
        cfg.password = "p@ss:word".into();
        cfg.host = "localhost".into();
        let url = build_mysql_url(&cfg);
        assert!(url.contains("user%40org"));
        assert!(url.contains("p%40ss%3Aword"));
    }

    #[test]
    fn build_mysql_url_appends_options() {
        let mut cfg = ConnectionConfig::new("t", crate::DatabaseKind::Mysql);
        cfg.host = "localhost".into();
        cfg.options = "prefer_socket=false&stmt_cache_size=100".into();
        let url = build_mysql_url(&cfg);
        assert!(url.ends_with("?prefer_socket=false&stmt_cache_size=100"));
    }

    #[test]
    fn build_mysql_url_strips_leading_question_mark() {
        let mut cfg = ConnectionConfig::new("t", crate::DatabaseKind::Mysql);
        cfg.host = "localhost".into();
        cfg.options = "?prefer_socket=false".into();
        let url = build_mysql_url(&cfg);
        assert!(url.contains("?prefer_socket=false"));
        assert!(!url.contains("??"));
    }

    #[test]
    fn build_opts_with_options_doesnt_panic() {
        let mut cfg = ConnectionConfig::new("t", crate::DatabaseKind::Mysql);
        cfg.host = "localhost".into();
        cfg.port = 3306;
        cfg.user = "root".into();
        cfg.password = "test".into();
        cfg.database = "mydb".into();
        cfg.options = "stmt_cache_size=50".into();
        let _opts = build_opts(&cfg);
    }

    #[test]
    fn build_opts_fallback_on_bad_options() {
        let mut cfg = ConnectionConfig::new("t", crate::DatabaseKind::Mysql);
        cfg.host = "localhost".into();
        cfg.port = 3306;
        cfg.options = "=====invalid&&&".into();
        let opts = build_opts(&cfg);
        assert_eq!(opts.ip_or_hostname(), "localhost");
    }

    #[test]
    fn build_mysql_url_defaults() {
        let cfg = ConnectionConfig::new("t", crate::DatabaseKind::Mysql);
        let url = build_mysql_url(&cfg);
        assert_eq!(url, "mysql://localhost:3306");
    }

    #[test]
    fn build_mysql_url_no_user() {
        let mut cfg = ConnectionConfig::new("t", crate::DatabaseKind::Mysql);
        cfg.host = "db.local".into();
        cfg.port = 3306;
        cfg.database = "mydb".into();
        let url = build_mysql_url(&cfg);
        assert_eq!(url, "mysql://db.local:3306/mydb");
    }
}
