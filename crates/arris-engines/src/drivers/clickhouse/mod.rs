//! ClickHouse driver — uses the official `clickhouse` crate over HTTP (port 8123
//! by default, HTTPS when `ssl_mode` is not `Disabled`).
//!
//! - `run_query` distinguishes SELECT-shape from DDL/DML by leading keyword.
//!   SELECT-shape statements are fetched in `JSONCompact`, whose `meta` carries
//!   the ClickHouse type per column (parsed in `query.rs`); everything else is
//!   executed with no row payload.
//! - `list_schemas` reads only `system.databases` and returns the database
//!   containers (empty children); ClickHouse databases act as the schema level.
//!   `list_schema` lazily loads one database's `system.tables` / `system.columns`
//!   when the user selects it, returning that database node with its
//!   tables/views/dictionaries (and their columns) beneath.
//! - `explain_query` runs `EXPLAIN json = 1, indexes = 1` and walks the JSON tree
//!   into `PlanNode`s (`explain.rs`).
//! - Staged edits map to ClickHouse mutations: `INSERT`, and `ALTER TABLE …
//!   UPDATE/DELETE … SETTINGS mutations_sync = 2` so they complete synchronously.

mod constants;
mod explain;
mod query;
mod values;

use async_trait::async_trait;
use clickhouse::Client;
use indexmap::IndexMap;
use tokio::sync::Mutex;

use crate::drivers::errors::Result;
use crate::drivers::sql_builder::SqlBuilder;
use crate::drivers::DatabaseDriver;
use crate::{
    ConnectionConfig, DriverError, ExplainMode, MutationResult, PlanResult, QueryLanguage,
    QueryResult, QueryStream, QueryValue, RowDelete, RowInsert, SchemaNode, SchemaNodeKind,
    TableRef, ValueMap,
};

use explain::walk_explain;
use query::parse_jsoncompact;
use values::format_literal;

/// System databases never surfaced in the schema browser.
const SYSTEM_DATABASES: &[&str] = &["system", "information_schema", "INFORMATION_SCHEMA"];

struct ConnState {
    client: Client,
    dbname: String,
}

pub struct ClickhouseDriver {
    inner: Mutex<Option<ConnState>>,
}

impl Default for ClickhouseDriver {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

impl ClickhouseDriver {
    pub fn new() -> Self {
        Self::default()
    }

    fn build_url(config: &ConnectionConfig) -> String {
        let scheme = if config.ssl_mode.forces_tls() { "https" } else { "http" };
        let host = if config.host.is_empty() {
            "localhost"
        } else {
            config.host.as_str()
        };
        let port = if config.port == 0 { 8123 } else { config.port };
        format!("{scheme}://{host}:{port}")
    }

    async fn client(&self) -> Result<Client> {
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
            .unwrap_or_else(|| "default".into())
    }

    /// Fetches a statement in `format`, accumulating the streamed body.
    async fn fetch_bytes(client: &Client, sql: &str, format: &str) -> Result<Vec<u8>> {
        let mut cursor = client
            .query(sql)
            .fetch_bytes(format)
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let mut buf = Vec::new();
        while let Some(chunk) = cursor
            .next()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
        {
            buf.extend_from_slice(&chunk);
        }
        Ok(buf)
    }

    /// Runs a `SELECT`-shape statement and returns its decoded rows.
    async fn select(client: &Client, sql: &str, elapsed: f64) -> Result<QueryResult> {
        let body = Self::fetch_bytes(client, sql, "JSONCompact").await?;
        parse_jsoncompact(&body, elapsed)
    }

    /// Renders `db`.`table` using ClickHouse backtick quoting, falling back to the
    /// connection's current database when the ref carries no schema.
    fn qualified_table(table: &TableRef, default_db: &str) -> String {
        let db = table
            .schema
            .as_deref()
            .or(table.database.as_deref())
            .unwrap_or(default_db);
        format!(
            "{}.{}",
            SqlBuilder::quote_backtick(db),
            SqlBuilder::quote_backtick(&table.name)
        )
    }
}

#[async_trait]
impl DatabaseDriver for ClickhouseDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let url = Self::build_url(config);
        let dbname = if config.database.is_empty() {
            "default".to_owned()
        } else {
            config.database.clone()
        };

        // TLS: the `clickhouse` crate negotiates HTTPS (see build_url) using its
        // bundled rustls-tls with the system trust store. It exposes no hook for
        // a custom CA or client certificate, so ca/client cert/key paths are not
        // applied for ClickHouse.
        let mut client = Client::default().with_url(&url).with_database(&dbname);
        if !config.user.is_empty() {
            client = client.with_user(&config.user);
        }
        if !config.password.is_empty() {
            client = client.with_password(&config.password);
        }

        // Validate connectivity before storing the client.
        client
            .query("SELECT 1")
            .execute()
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        *self.inner.lock().await = Some(ConnState { client, dbname });
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    fn select_like_keywords(&self) -> &'static [&'static str] {
        &["DESCRIBE", "DESC", "EXISTS"]
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let client = self.client().await?;

        let db_filter = SYSTEM_DATABASES
            .iter()
            .map(|d| format!("'{d}'"))
            .collect::<Vec<_>>()
            .join(", ");

        // Lazy: database containers only. Each database's tables, views, and
        // their columns load on demand via `list_schema` when the user selects
        // the database in the schema dropdown.
        let db_rows = Self::select(
            &client,
            &format!(
                "SELECT name FROM system.databases WHERE name NOT IN ({db_filter}) ORDER BY name"
            ),
            0.0,
        )
        .await?;

        let mut db_nodes: Vec<SchemaNode> = db_rows
            .rows
            .iter()
            .map(|row| {
                let db = cell_text(&row[0]);
                SchemaNode::new(db.clone(), SchemaNodeKind::Database, db)
            })
            .collect();
        db_nodes.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(db_nodes)
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let client = self.client().await?;
        // ClickHouse over HTTP does not bind params in catalog queries, so the
        // database name is interpolated as a single-quoted literal with quotes
        // escaped the same way `primary_key` escapes its filters.
        let db_lit = schema.replace('\'', "\\'");

        let table_rows = Self::select(
            &client,
            &format!(
                "SELECT name, engine FROM system.tables \
                 WHERE database = '{db_lit}' ORDER BY name"
            ),
            0.0,
        )
        .await?;

        let col_rows = Self::select(
            &client,
            &format!(
                "SELECT table, name, type FROM system.columns \
                 WHERE database = '{db_lit}' ORDER BY table, position"
            ),
            0.0,
        )
        .await?;

        // table_key -> node
        let mut tables: IndexMap<String, SchemaNode> = IndexMap::new();
        for row in &table_rows.rows {
            let name = cell_text(&row[0]);
            let engine = cell_text(&row[1]);
            let kind = engine_to_kind(&engine);
            let path = format!("{schema}.{name}");
            let mut node = SchemaNode::new(name.clone(), kind, path);
            if kind == SchemaNodeKind::Table && engine == "Dictionary" {
                node = node.with_detail("Dictionary");
            }
            tables.insert(name, node);
        }
        for row in &col_rows.rows {
            let table = cell_text(&row[0]);
            let col = cell_text(&row[1]);
            let ty = cell_text(&row[2]);
            if let Some(node) = tables.get_mut(&table) {
                let col_path = format!("{}.{}", node.path, col);
                node.children.push(
                    SchemaNode::new(col, SchemaNodeKind::Column, col_path).with_detail(ty),
                );
            }
        }

        Ok(vec![
            SchemaNode::new(schema, SchemaNodeKind::Database, schema)
                .with_children(tables.into_values().collect()),
        ])
    }

    async fn run_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        let client = self.client().await?;
        let started = std::time::Instant::now();
        if self.looks_like_select(text) {
            Self::select(&client, text, started.elapsed().as_secs_f64()).await
        } else {
            client
                .query(text)
                .execute()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            Ok(QueryResult {
                elapsed: started.elapsed().as_secs_f64(),
                ..Default::default()
            })
        }
    }

    async fn run_query_stream(
        &self,
        text: &str,
        params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryStream> {
        // HTTP is stateless (no manual transaction to fence), so only SELECT-shape
        // statements stream; everything else has no rows and materializes.
        if !self.looks_like_select(text) {
            return Ok(QueryStream::from_materialized(
                self.run_query(text, params, language).await?,
            ));
        }
        let client = self.client().await?;
        Ok(QueryStream::Rows(query::stream_select(&client, text).await?))
    }

    async fn explain_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
        mode: ExplainMode,
    ) -> Result<PlanResult> {
        let client = self.client().await?;
        let trimmed = text.trim().trim_end_matches(';');
        let sql = format!("EXPLAIN json = 1, indexes = 1 {trimmed}");
        // `EXPLAIN json = 1` yields a single String column; TabSeparatedRaw hands
        // back the JSON document verbatim.
        let body = Self::fetch_bytes(&client, &sql, "TabSeparatedRaw").await?;
        let raw = String::from_utf8_lossy(&body).into_owned();
        let parsed: serde_json::Value =
            serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
        let root = walk_explain(&parsed);
        Ok(PlanResult::new(root, mode, raw))
    }

    async fn primary_key(&self, table: &TableRef) -> Result<Option<Vec<String>>> {
        let client = self.client().await?;
        let default_db = self.dbname().await;
        let db = table
            .schema
            .as_deref()
            .or(table.database.as_deref())
            .unwrap_or(&default_db);
        let sql = format!(
            "SELECT name FROM system.columns \
             WHERE database = '{}' AND table = '{}' AND is_in_primary_key = 1 \
             ORDER BY position",
            db.replace('\'', "\\'"),
            table.name.replace('\'', "\\'"),
        );
        let r = Self::select(&client, &sql, 0.0).await?;
        let cols: Vec<String> = r.rows.iter().map(|row| cell_text(&row[0])).collect();
        Ok(if cols.is_empty() { None } else { Some(cols) })
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &ValueMap,
        changes: &ValueMap,
    ) -> Result<MutationResult> {
        if primary_key.is_empty() {
            return Err(DriverError::InvalidArgument("primary key cannot be empty".into()));
        }
        if changes.is_empty() {
            return Err(DriverError::InvalidArgument("changes cannot be empty".into()));
        }
        let client = self.client().await?;
        let default_db = self.dbname().await;
        let target = Self::qualified_table(table, &default_db);

        let set_clause = changes
            .iter()
            .map(|(col, val)| {
                format!("{} = {}", SqlBuilder::quote_backtick(col), format_literal(val))
            })
            .collect::<Vec<_>>()
            .join(", ");
        let where_clause = where_from_pk(primary_key);
        let sql = format!(
            "ALTER TABLE {target} UPDATE {set_clause} WHERE {where_clause} SETTINGS mutations_sync = 2"
        );
        client
            .query(&sql)
            .execute()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        Ok(MutationResult {
            rows_affected: 1,
            statements: vec![sql],
        })
    }

    async fn insert_rows(&self, table: &TableRef, inserts: &[RowInsert]) -> Result<MutationResult> {
        let client = self.client().await?;
        let default_db = self.dbname().await;
        let target = Self::qualified_table(table, &default_db);
        let mut result = MutationResult::default();
        for ins in inserts {
            if ins.values.is_empty() {
                return Err(DriverError::InvalidArgument(
                    "insert must have at least one column".into(),
                ));
            }
            let cols = ins
                .values
                .keys()
                .map(|c| SqlBuilder::quote_backtick(c))
                .collect::<Vec<_>>()
                .join(", ");
            let vals = ins
                .values
                .values()
                .map(format_literal)
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!("INSERT INTO {target} ({cols}) VALUES ({vals})");
            client
                .query(&sql)
                .execute()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            result.rows_affected += 1;
            result.statements.push(sql);
        }
        Ok(result)
    }

    async fn delete_rows(&self, table: &TableRef, deletes: &[RowDelete]) -> Result<MutationResult> {
        let client = self.client().await?;
        let default_db = self.dbname().await;
        let target = Self::qualified_table(table, &default_db);
        let mut result = MutationResult::default();
        for del in deletes {
            if del.primary_key.is_empty() {
                return Err(DriverError::InvalidArgument("primary key cannot be empty".into()));
            }
            let where_clause = where_from_pk(&del.primary_key);
            let sql = format!(
                "ALTER TABLE {target} DELETE WHERE {where_clause} SETTINGS mutations_sync = 2"
            );
            client
                .query(&sql)
                .execute()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            result.rows_affected += 1;
            result.statements.push(sql);
        }
        Ok(result)
    }

    async fn close(&self) {
        *self.inner.lock().await = None;
    }
}

/// Builds a `col = literal AND …` predicate from a primary-key map.
fn where_from_pk(primary_key: &ValueMap) -> String {
    primary_key
        .iter()
        .map(|(col, val)| format!("{} = {}", SqlBuilder::quote_backtick(col), format_literal(val)))
        .collect::<Vec<_>>()
        .join(" AND ")
}

/// Extracts a display string from a system-table cell (always text/int here).
fn cell_text(v: &QueryValue) -> String {
    match v {
        QueryValue::Text(s) => s.clone(),
        QueryValue::Int(i) => i.to_string(),
        QueryValue::Null => String::new(),
        other => format!("{other:?}"),
    }
}

/// Maps a ClickHouse table engine to a schema-tree node kind.
fn engine_to_kind(engine: &str) -> SchemaNodeKind {
    if engine == "MaterializedView" {
        SchemaNodeKind::MaterializedView
    } else if engine == "View" || engine == "LiveView" {
        SchemaNodeKind::View
    } else {
        // MergeTree family, Log, Memory, Dictionary, etc. all browse as tables.
        SchemaNodeKind::Table
    }
}

#[cfg(test)]
mod tests {
    //! Unit tests run without a live ClickHouse. End-to-end tests against a real
    //! `clickhouse-server` container live in `tests/clickhouse_integration.rs`
    //! (Docker required).
    use super::*;

    #[test]
    fn build_url_defaults_and_tls() {
        let mut cfg = ConnectionConfig::new("ch", crate::DatabaseKind::Clickhouse);
        assert_eq!(ClickhouseDriver::build_url(&cfg), "http://localhost:8123");
        cfg.host = "db.example.com".into();
        cfg.port = 9440;
        cfg.ssl_mode = crate::SslMode::Required;
        assert_eq!(ClickhouseDriver::build_url(&cfg), "https://db.example.com:9440");
    }

    #[test]
    fn looks_like_select_covers_clickhouse_keywords() {
        let d = ClickhouseDriver::new();
        assert!(d.looks_like_select("SELECT 1"));
        assert!(d.looks_like_select("WITH x AS (SELECT 1) SELECT * FROM x"));
        assert!(d.looks_like_select("DESCRIBE TABLE t"));
        assert!(d.looks_like_select("EXISTS TABLE t"));
        assert!(d.looks_like_select("SHOW TABLES"));
        assert!(!d.looks_like_select("INSERT INTO t VALUES (1)"));
        assert!(!d.looks_like_select("ALTER TABLE t UPDATE x = 1 WHERE id = 1"));
        assert!(!d.looks_like_select("CREATE TABLE t (x UInt8) ENGINE = Memory"));
    }

    #[test]
    fn engine_maps_to_node_kind() {
        assert_eq!(engine_to_kind("MergeTree"), SchemaNodeKind::Table);
        assert_eq!(engine_to_kind("View"), SchemaNodeKind::View);
        assert_eq!(
            engine_to_kind("MaterializedView"),
            SchemaNodeKind::MaterializedView
        );
        assert_eq!(engine_to_kind("Dictionary"), SchemaNodeKind::Table);
    }

    #[test]
    fn qualified_table_uses_backticks_and_default_db() {
        let t = TableRef::new("events");
        assert_eq!(
            ClickhouseDriver::qualified_table(&t, "analytics"),
            "`analytics`.`events`"
        );
        let t2 = TableRef::schema_qualified("metrics", "events");
        assert_eq!(
            ClickhouseDriver::qualified_table(&t2, "analytics"),
            "`metrics`.`events`"
        );
    }

    #[test]
    fn where_from_pk_joins_with_and() {
        let mut pk: ValueMap = IndexMap::new();
        pk.insert("id".into(), QueryValue::Int(5));
        pk.insert("region".into(), QueryValue::Text("east".into()));
        assert_eq!(where_from_pk(&pk), "`id` = 5 AND `region` = 'east'");
    }

    #[test]
    fn driver_starts_disconnected() {
        let d = ClickhouseDriver::new();
        let connected = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(d.is_connected());
        assert!(!connected);
    }
}
