//! PostgreSQL driver — uses `tokio-postgres` over TCP. TLS is driven by
//! `ssl_mode` (the single source of truth): `Disabled` connects via `NoTls`,
//! any other mode connects via `tokio-postgres-rustls` with a `rustls`
//! `ClientConfig` built by `drivers::tls` (accept-any / verify-ca /
//! verify-identity, plus optional mTLS client identity).
//!
//! Mirrors `Packages/DatabaseKit/Sources/PostgresDriver/PostgresDriver.swift`:
//! - Schema browser fetches namespaces, relations + columns and primary keys.
//! - `run_query` distinguishes SELECT-shape from DML by leading keyword.
//! - `explain_query` runs `EXPLAIN (FORMAT JSON [, ANALYZE])` then walks the
//!   JSON tree into `PlanNode`s (parity with `PostgresExplain.swift`).
//! - CRUD helpers route through `sql_builder::build_*` with PostgreSQL-style
//!   double-quoted identifiers and `$N` placeholders.

mod definition;
mod explain;
mod query;
mod values;

use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use indexmap::IndexMap;
use tokio::sync::Mutex;
use tokio_postgres::config::SslMode as PgSslMode;
use tokio_postgres::{Client, Config as PgConfig, NoTls};
use tokio_postgres_rustls::MakeRustlsConnect;

use crate::{
    ColumnSpec, ConnectionConfig, DriverError, ExplainMode, MutationResult, ObjectRef, PlanResult,
    QueryLanguage, QueryResult, QueryStream, QueryValue, RowDelete, RowInsert, SchemaNode,
    SchemaNodeKind, TableRef,
};
use crate::drivers::errors::Result;

use crate::drivers::common::RowChunkPump;
use crate::drivers::DatabaseDriver;
use crate::drivers::sql_builder::SqlBuilder;
use crate::drivers::tls::TlsParams;

use futures::StreamExt;

use explain::walk_explain;
use query::{pg_err_msg, pg_to_sql_refs, row_values, rows_to_query_result};
use values::PgValue;

pub struct PostgresDriver {
    inner: Mutex<Option<ConnState>>,
    cancel_token: Mutex<Option<tokio_postgres::CancelToken>>,
    /// rustls config for the active connection, if TLS is in use. Postgres
    /// sends a cancel request on a *fresh* connection, so it must negotiate
    /// TLS the same way the original connection did when the server requires
    /// it; `None` means the connection is plaintext.
    tls_config: Mutex<Option<rustls::ClientConfig>>,
    /// Whether a manual transaction is currently open. The driver holds a
    /// single `Client`, so an open `BEGIN` naturally spans every later
    /// `run_query` on this connection until commit/rollback.
    in_tx: Mutex<bool>,
    /// Set at connect time when the configured kind is `Redshift`. Redshift
    /// shares this driver but speaks a Postgres-8 dialect lacking `pg_get_*def`
    /// and the modern catalog columns, so DDL retrieval uses `SHOW TABLE` /
    /// `SHOW VIEW` instead of the catalog reconstruction.
    is_redshift: Mutex<bool>,
}

impl Default for PostgresDriver {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            cancel_token: Mutex::new(None),
            tls_config: Mutex::new(None),
            in_tx: Mutex::new(false),
            is_redshift: Mutex::new(false),
        }
    }
}

struct ConnState {
    client: Arc<Client>,
    dbname: String,
}

impl PostgresDriver {
    pub fn new() -> Self {
        Self::default()
    }

    async fn client(&self) -> Result<Arc<Client>> {
        let guard = self.inner.lock().await;
        guard
            .as_ref()
            .map(|s| s.client.clone())
            .ok_or(DriverError::NotConnected)
    }

    async fn dbname(&self) -> String {
        self.inner
            .lock()
            .await
            .as_ref()
            .map(|s| s.dbname.clone())
            .unwrap_or_else(|| "postgres".into())
    }

    /// The `BEGIN` statement for a manual transaction at the given isolation
    /// level (`BEGIN` alone for `Default`).
    fn begin_sql(isolation: crate::IsolationLevel) -> String {
        match isolation.sql_name() {
            Some(level) => format!("BEGIN ISOLATION LEVEL {level}"),
            None => "BEGIN".to_owned(),
        }
    }

    /// Run a single statement and shape the `QueryResult`. No transaction
    /// bookkeeping — callers wrap this when a manual transaction is open.
    async fn run_one(
        &self,
        client: &Client,
        text: &str,
        params: &[QueryValue],
    ) -> Result<QueryResult> {
        let wrapped: Vec<PgValue<'_>> = params.iter().map(PgValue).collect();
        let refs = pg_to_sql_refs(&wrapped);

        let started = Instant::now();
        if self.looks_like_select(text) {
            let rows = client
                .query(text, &refs)
                .await
                .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
            let mut r = rows_to_query_result(rows, started.elapsed().as_secs_f64());
            if r.columns.is_empty() {
                if let Ok(stmt) = client.prepare(text).await {
                    r.columns = stmt
                        .columns()
                        .iter()
                        .map(|c| ColumnSpec::new(c.name(), c.type_().name()))
                        .collect();
                }
            }
            Ok(r)
        } else {
            let affected = client
                .execute(text, &refs)
                .await
                .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
            Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: Some(affected as i64),
                elapsed: started.elapsed().as_secs_f64(),
                ..Default::default()
            })
        }
    }
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let mut cfg = PgConfig::new();
        if !config.host.is_empty() {
            cfg.host(&config.host);
        }
        let port = if config.port == 0 { 5432 } else { config.port };
        cfg.port(port);
        if !config.user.is_empty() {
            cfg.user(&config.user);
        }
        if !config.password.is_empty() {
            cfg.password(&config.password);
        }
        if !config.database.is_empty() {
            cfg.dbname(&config.database);
        }
        cfg.application_name("arris");

        // `ssl_mode` is the single source of truth: `Disabled` connects via
        // `NoTls`, every other mode builds a rustls `ClientConfig`. The two
        // connectors yield different stream types, so the connect + background
        // spawn is branched; both arms store the same `ConnState`.
        let tls_config = TlsParams::from_config(config).rustls_client_config()?;
        let (client, cancel_token) = match tls_config.clone() {
            Some(client_config) => {
                // Require a real TLS session for Required and the verify modes;
                // Preferred may fall back to plaintext if the server declines.
                cfg.ssl_mode(if matches!(config.ssl_mode, crate::SslMode::Preferred) {
                    PgSslMode::Prefer
                } else {
                    PgSslMode::Require
                });
                let tls = MakeRustlsConnect::new(client_config);
                let (client, connection) = cfg
                    .connect(tls)
                    .await
                    .map_err(|e| DriverError::ConnectionFailed(pg_err_msg(&e)))?;
                tokio::spawn(async move {
                    if let Err(e) = connection.await {
                        tracing::warn!("postgres connection task ended: {e}");
                    }
                });
                let cancel_token = client.cancel_token();
                (client, cancel_token)
            }
            None => {
                let (client, connection) = cfg
                    .connect(NoTls)
                    .await
                    .map_err(|e| DriverError::ConnectionFailed(pg_err_msg(&e)))?;
                tokio::spawn(async move {
                    if let Err(e) = connection.await {
                        tracing::warn!("postgres connection task ended: {e}");
                    }
                });
                let cancel_token = client.cancel_token();
                (client, cancel_token)
            }
        };

        let dbname = if config.database.is_empty() {
            "postgres".to_owned()
        } else {
            config.database.clone()
        };
        *self.inner.lock().await = Some(ConnState {
            client: Arc::new(client),
            dbname,
        });
        *self.cancel_token.lock().await = Some(cancel_token);
        *self.tls_config.lock().await = tls_config;
        *self.is_redshift.lock().await =
            matches!(config.kind, crate::DatabaseKind::Redshift);
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let client = self.client().await?;
        let dbname = self.dbname().await;

        // Namespaces (schemas).
        let ns_rows = client
            .query(
                "SELECT nspname FROM pg_namespace \
                 WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast') \
                   AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%' \
                 ORDER BY nspname",
                &[],
            )
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;

        // Lazy: containers only. A schema's relations, columns, routines,
        // triggers, and indexes load on demand via `list_schema` when the user
        // selects it in the schema dropdown.
        let ns_nodes: Vec<SchemaNode> = ns_rows
            .iter()
            .map(|ns| {
                let n: String = ns.get(0);
                let path = format!("{dbname}.{n}");
                SchemaNode::new(n, SchemaNodeKind::Schema, path)
            })
            .collect();

        Ok(vec![
            SchemaNode::new(dbname.clone(), SchemaNodeKind::Database, dbname)
                .with_children(ns_nodes),
        ])
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let client = self.client().await?;
        let dbname = self.dbname().await;

        // Relations within the namespace.
        let rel_rows = client
            .query(
                "SELECT c.relname, c.relkind \
                 FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid \
                 WHERE n.nspname = $1 \
                   AND c.relkind IN ('r','v','m','f','S') \
                 ORDER BY c.relkind, c.relname",
                &[&schema],
            )
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;

        // Columns.
        let col_rows = client
            .query(
                "SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull \
                 FROM pg_attribute a \
                 JOIN pg_class c ON a.attrelid = c.oid \
                 JOIN pg_namespace n ON c.relnamespace = n.oid \
                 WHERE a.attnum > 0 AND NOT a.attisdropped \
                   AND n.nspname = $1 \
                   AND c.relkind IN ('r','v','m','f') \
                 ORDER BY c.relname, a.attnum",
                &[&schema],
            )
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;

        // Routines (functions and procedures).
        let routine_rows = client
            .query(
                "SELECT p.proname, \
                        CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END AS kind \
                 FROM pg_proc p \
                 JOIN pg_namespace n ON p.pronamespace = n.oid \
                 WHERE n.nspname = $1 \
                 ORDER BY p.proname",
                &[&schema],
            )
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;

        // Triggers.
        let trigger_rows = client
            .query(
                "SELECT t.tgname \
                 FROM pg_trigger t \
                 JOIN pg_class c ON t.tgrelid = c.oid \
                 JOIN pg_namespace n ON c.relnamespace = n.oid \
                 WHERE NOT t.tgisinternal \
                   AND n.nspname = $1 \
                 ORDER BY t.tgname",
                &[&schema],
            )
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;

        // Indexes.
        let index_rows = client
            .query(
                "SELECT indexname FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname",
                &[&schema],
            )
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;

        let mut rels: IndexMap<String, SchemaNode> = IndexMap::new();
        for rel in &rel_rows {
            let name: String = rel.get(0);
            let kind: i8 = rel.get(1);
            let node_kind = match kind as u8 as char {
                'r' => SchemaNodeKind::Table,
                'v' => SchemaNodeKind::View,
                'm' => SchemaNodeKind::MaterializedView,
                'f' => SchemaNodeKind::ForeignTable,
                'S' => SchemaNodeKind::Sequence,
                _ => continue,
            };
            let path = format!("{dbname}.{schema}.{name}");
            rels.insert(name.clone(), SchemaNode::new(name, node_kind, path));
        }
        for col in &col_rows {
            let rel: String = col.get(0);
            let attname: String = col.get(1);
            let atttype: String = col.get(2);
            let notnull: bool = col.get(3);
            let detail = if notnull {
                format!("{atttype} NOT NULL")
            } else {
                atttype
            };
            if let Some(node) = rels.get_mut(&rel) {
                let col_path = format!("{}.{}", node.path, attname);
                node.children.push(
                    SchemaNode::new(attname, SchemaNodeKind::Column, col_path)
                        .with_detail(detail),
                );
            }
        }
        for row in &routine_rows {
            let name: String = row.get(0);
            let kind_str: String = row.get(1);
            let node_kind = if kind_str == "procedure" {
                SchemaNodeKind::Procedure
            } else {
                SchemaNodeKind::Function
            };
            let key = format!("fn:{name}");
            let path = format!("{dbname}.{schema}.{name}");
            rels.entry(key)
                .or_insert_with(|| SchemaNode::new(name, node_kind, path));
        }
        for row in &trigger_rows {
            let name: String = row.get(0);
            let key = format!("trg:{name}");
            let path = format!("{dbname}.{schema}.{name}");
            rels.entry(key)
                .or_insert_with(|| SchemaNode::new(name, SchemaNodeKind::Trigger, path));
        }
        for row in &index_rows {
            let name: String = row.get(0);
            let key = format!("idx:{name}");
            let path = format!("{dbname}.{schema}.{name}");
            rels.entry(key)
                .or_insert_with(|| SchemaNode::new(name, SchemaNodeKind::Index, path));
        }

        let path = format!("{dbname}.{schema}");
        Ok(vec![
            SchemaNode::new(schema, SchemaNodeKind::Schema, path)
                .with_children(rels.into_values().collect()),
        ])
    }

    async fn object_definition(&self, object: &ObjectRef) -> Result<String> {
        let client = self.client().await?;
        if *self.is_redshift.lock().await {
            definition::redshift_object_definition(&client, object).await
        } else {
            definition::object_definition(&client, object).await
        }
    }

    async fn run_query(
        &self,
        text: &str,
        params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        let client = self.client().await?;
        if !*self.in_tx.lock().await {
            return self.run_one(&client, text, params).await;
        }
        // Manual transaction open: fence each statement with a savepoint so a
        // failed statement rolls back to here instead of aborting the whole
        // transaction (Postgres "current transaction is aborted" state). The
        // user keeps an open, usable transaction after an error.
        client
            .batch_execute("SAVEPOINT arris_stmt")
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
        let result = self.run_one(&client, text, params).await;
        let cleanup = if result.is_ok() {
            "RELEASE SAVEPOINT arris_stmt"
        } else {
            "ROLLBACK TO SAVEPOINT arris_stmt"
        };
        let _ = client.batch_execute(cleanup).await;
        result
    }

    async fn run_query_stream(
        &self,
        text: &str,
        params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryStream> {
        // Streaming bypasses the savepoint fencing, so non-SELECTs and open
        // manual transactions keep the materialized path.
        if !self.looks_like_select(text) || *self.in_tx.lock().await {
            return Ok(QueryStream::from_materialized(
                self.run_query(text, params, language).await?,
            ));
        }
        let client = self.client().await?;
        let stmt = client
            .prepare(text)
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
        let columns: Vec<ColumnSpec> = stmt
            .columns()
            .iter()
            .map(|c| ColumnSpec::new(c.name(), c.type_().name()))
            .collect();

        // The shared pump owns the client + statement for the stream's life
        // (dropping its receiver cancels and drops the server cursor); this driver
        // supplies only how to open the row stream and how to map one row.
        let params = params.to_vec();
        let stream = RowChunkPump::spawn(
            columns,
            move || async move {
                let wrapped: Vec<PgValue<'_>> = params.iter().map(PgValue).collect();
                let refs = wrapped
                    .iter()
                    .map(|v| v as &dyn tokio_postgres::types::ToSql);
                let rows = client
                    .query_raw(&stmt, refs)
                    .await
                    .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
                Ok(rows
                    .map(|r| r.map_err(|e| DriverError::QueryFailed(pg_err_msg(&e))))
                    .boxed())
            },
            |row| row_values(row),
        );
        Ok(QueryStream::Rows(stream))
    }

    async fn explain_query(
        &self,
        text: &str,
        params: &[QueryValue],
        _language: QueryLanguage,
        mode: ExplainMode,
    ) -> Result<PlanResult> {
        let analyze = matches!(mode, ExplainMode::Analyze);
        let prefix = if analyze {
            "EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS)"
        } else {
            "EXPLAIN (FORMAT JSON)"
        };
        let sql = format!("{prefix} {text}");

        let client = self.client().await?;
        let wrapped: Vec<PgValue<'_>> = params.iter().map(PgValue).collect();
        let refs = pg_to_sql_refs(&wrapped);
        let rows = client
            .query(&sql, &refs)
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;

        let raw: String = rows
            .iter()
            .filter_map(|r| {
                r.try_get::<_, serde_json::Value>(0)
                    .ok()
                    .map(|v| v.to_string())
            })
            .collect::<Vec<_>>()
            .join("\n");

        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
        let root = walk_explain(&parsed);
        Ok(PlanResult::new(root, mode, raw))
    }

    async fn primary_key(&self, table: &TableRef) -> Result<Option<Vec<String>>> {
        let client = self.client().await?;
        let qualified = match (&table.schema, &table.name) {
            (Some(s), n) => format!("{s}.{n}"),
            (None, n) => n.clone(),
        };
        let sql = format!(
            "SELECT a.attname FROM pg_index i \
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) \
             WHERE i.indrelid = '{}'::regclass AND i.indisprimary \
             ORDER BY a.attnum",
            qualified.replace('\'', "''")
        );
        let rows = client
            .query(&sql, &[])
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
        let cols: Vec<String> = rows.iter().map(|r| r.get::<_, String>(0)).collect();
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

    async fn update_rows(
        &self,
        table: &TableRef,
        edits: &[crate::RowEdit],
    ) -> Result<MutationResult> {
        let client = self.client().await?;
        // When a manual transaction is already open we must not wrap the batch
        // in its own BEGIN/COMMIT: the COMMIT would close the user's manual
        // transaction early. Run inline so the edits simply join it.
        let own_tx = !*self.in_tx.lock().await;
        if own_tx {
            client
                .batch_execute("BEGIN")
                .await
                .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
        }
        let mut result = MutationResult::default();
        for edit in edits {
            let (sql, params) = SqlBuilder::build_update(
                table,
                &edit.primary_key,
                &edit.changes,
                SqlBuilder::quote_double,
                SqlBuilder::placeholder_dollar,
            )
            .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let wrapped: Vec<PgValue<'_>> = params.iter().map(PgValue).collect();
            let refs = pg_to_sql_refs(&wrapped);
            let n = match client.execute(&sql, &refs).await {
                Ok(n) => n as usize,
                Err(e) => {
                    if own_tx {
                        let _ = client.batch_execute("ROLLBACK").await;
                    }
                    return Err(DriverError::QueryFailed(pg_err_msg(&e)));
                }
            };
            result.rows_affected += n;
            result.statements.push(SqlBuilder::interpolate_params(&sql, &params));
        }
        if own_tx {
            client
                .batch_execute("COMMIT")
                .await
                .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
        }
        Ok(result)
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

    async fn cancel_running_query(&self) -> Result<()> {
        let token = self.cancel_token.lock().await.clone();
        let tls_config = self.tls_config.lock().await.clone();
        if let Some(token) = token {
            // The cancel request opens a fresh connection, so it must use the
            // same TLS posture the server expects.
            let res = match tls_config {
                Some(client_config) => {
                    token.cancel_query(MakeRustlsConnect::new(client_config)).await
                }
                None => token.cancel_query(NoTls).await,
            };
            res.map_err(|e| {
                DriverError::QueryFailed(format!("cancel failed: {}", pg_err_msg(&e)))
            })?;
        }
        Ok(())
    }

    fn supports_transactions(&self) -> bool {
        true
    }

    async fn in_transaction(&self) -> bool {
        *self.in_tx.lock().await
    }

    async fn begin_transaction(&self, isolation: crate::IsolationLevel) -> Result<()> {
        let client = self.client().await?;
        client
            .batch_execute(&Self::begin_sql(isolation))
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
        *self.in_tx.lock().await = true;
        Ok(())
    }

    async fn commit_transaction(&self) -> Result<()> {
        let client = self.client().await?;
        client
            .batch_execute("COMMIT")
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
        *self.in_tx.lock().await = false;
        Ok(())
    }

    async fn rollback_transaction(&self) -> Result<()> {
        let client = self.client().await?;
        client
            .batch_execute("ROLLBACK")
            .await
            .map_err(|e| DriverError::QueryFailed(pg_err_msg(&e)))?;
        *self.in_tx.lock().await = false;
        Ok(())
    }

    async fn close(&self) {
        *self.cancel_token.lock().await = None;
        *self.tls_config.lock().await = None;
        *self.in_tx.lock().await = false;
        // Drop the client; the background driver task exits next.
        *self.inner.lock().await = None;
    }
}

#[cfg(test)]
mod tests {
    //! Unit tests run without a live Postgres. End-to-end tests against a real
    //! `postgres:18` container live in `tests/postgres_integration.rs` (Docker
    //! required).
    use super::*;
    use query::pg_err_msg;
    use explain::walk_explain;

    #[test]
    fn looks_like_select_handles_common_dml_keywords() {
        let d = PostgresDriver::new();
        assert!(d.looks_like_select("SELECT 1"));
        assert!(d.looks_like_select("  with x as (select 1) select * from x"));
        assert!(d.looks_like_select("VALUES (1)"));
        assert!(d.looks_like_select("EXPLAIN SELECT 1"));
        assert!(d.looks_like_select("SHOW search_path"));
        assert!(!d.looks_like_select("INSERT INTO t VALUES (1)"));
        assert!(!d.looks_like_select("UPDATE t SET x=1"));
        assert!(!d.looks_like_select("DELETE FROM t WHERE id=1"));
        assert!(!d.looks_like_select("CREATE TABLE t(x int)"));
    }

    #[test]
    fn walk_explain_extracts_node_type_and_metrics() {
        let json: serde_json::Value = serde_json::from_str(
            r#"[{
                "Plan": {
                    "Node Type": "Seq Scan",
                    "Total Cost": 12.5,
                    "Plan Rows": 100,
                    "Actual Total Time": 3.2,
                    "Actual Rows": 99,
                    "Relation Name": "users",
                    "Plans": [
                        {"Node Type": "Index Scan", "Actual Total Time": 1.1, "Actual Rows": 50}
                    ]
                }
            }]"#,
        )
        .unwrap();
        let plan = walk_explain(&json);
        assert_eq!(plan.node_type, "Seq Scan");
        assert_eq!(plan.total_ms, Some(3.2));
        assert_eq!(plan.rows_actual, Some(99.0));
        assert_eq!(plan.rows_estimated, Some(100.0));
        assert_eq!(plan.cost_total, Some(12.5));
        assert_eq!(plan.children.len(), 1);
        assert_eq!(plan.children[0].node_type, "Index Scan");
        assert!(plan.attributes.iter().any(|a| a.key == "Relation Name"));
    }

    #[test]
    fn begin_sql_emits_isolation_clause_only_when_set() {
        use crate::IsolationLevel;
        assert_eq!(PostgresDriver::begin_sql(IsolationLevel::Default), "BEGIN");
        assert_eq!(
            PostgresDriver::begin_sql(IsolationLevel::ReadCommitted),
            "BEGIN ISOLATION LEVEL READ COMMITTED"
        );
        assert_eq!(
            PostgresDriver::begin_sql(IsolationLevel::Serializable),
            "BEGIN ISOLATION LEVEL SERIALIZABLE"
        );
    }

    #[test]
    fn postgres_supports_transactions() {
        assert!(PostgresDriver::new().supports_transactions());
    }

    #[test]
    fn driver_starts_disconnected() {
        let d = PostgresDriver::new();
        let connected = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(d.is_connected());
        assert!(!connected);
    }

    #[test]
    fn pg_err_msg_non_db_error_falls_through_to_display() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let err = rt.block_on(async {
            let mut cfg = PgConfig::new();
            cfg.host("127.0.0.1");
            cfg.port(1);
            cfg.connect_timeout(std::time::Duration::from_millis(100));
            match cfg.connect(NoTls).await {
                Err(e) => e,
                Ok(_) => panic!("expected connection to fail"),
            }
        });
        assert!(err.as_db_error().is_none());
        let msg = pg_err_msg(&err);
        assert!(!msg.is_empty());
        assert_ne!(msg, "db error");
    }
}
