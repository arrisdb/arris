use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use indexmap::IndexMap;
use mysql_async::prelude::Queryable;
use mysql_async::{
    ClientIdentity, Column, Conn, Opts, OptsBuilder, Params, Pool, Row, SslOpts, Value as MyValue,
    consts::ColumnType,
};
use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};
use tokio::sync::Mutex;

use crate::drivers::DatabaseDriver;
use crate::drivers::PaginationStrategy;
use crate::drivers::common::MysqlWireStream;
use crate::drivers::errors::Result;
use crate::drivers::sql_builder::SqlBuilder;
use crate::{
    ColumnSpec, ConnectionConfig, DriverError, ExplainMode, MutationResult, ObjectRef,
    PlanAttribute, PlanNode, PlanResult, QueryLanguage, QueryResult, QueryStream, QueryValue,
    RowDelete, RowInsert, SchemaNode, SchemaNodeKind, SslMode, TableRef, ValueMap,
};

use super::convert::Convert;
use super::types::{StarrocksColumnRow, StarrocksTableRow, StarrocksViewRow};

/// Characters percent-encoded inside the URI userinfo (user:password) segment.
const USERINFO_ENCODE: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b':')
    .add(b'@')
    .add(b'/')
    .add(b'?')
    .add(b'#')
    .add(b'%');

/// StarRocks driver over the MySQL wire protocol. StarRocks has no interactive
/// transactions, so (unlike the MySQL driver) there is no pinned-connection
/// machinery — every statement runs on a fresh pooled connection.
pub struct StarrocksDriver {
    inner: Mutex<Option<Arc<Pool>>>,
}

impl Default for StarrocksDriver {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

// ── Construction, connection helpers, option building ────────────────────────
impl StarrocksDriver {
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

    /// Builds the `mysql://` URL StarRocks accepts (port defaults to 9030, the
    /// FE MySQL-protocol port).
    fn build_url(config: &ConnectionConfig) -> String {
        use std::fmt::Write as _;
        let mut url = String::from("mysql://");
        if !config.user.is_empty() {
            let _ = write!(url, "{}", utf8_percent_encode(&config.user, USERINFO_ENCODE));
            if !config.password.is_empty() {
                url.push(':');
                let _ = write!(
                    url,
                    "{}",
                    utf8_percent_encode(&config.password, USERINFO_ENCODE)
                );
            }
            url.push('@');
        }
        let host = if config.host.is_empty() {
            "localhost"
        } else {
            config.host.as_str()
        };
        url.push_str(host);
        let port = if config.port == 0 { 9030 } else { config.port };
        let _ = write!(url, ":{port}");
        if !config.database.is_empty() {
            url.push('/');
            url.push_str(&config.database);
        }
        if !config.options.is_empty() {
            let opts = config
                .options
                .trim_start_matches('?')
                .trim_start_matches('&');
            url.push('?');
            url.push_str(opts);
        }
        url
    }

    /// Builds `mysql_async::Opts`, attaching TLS when the SSL mode forces it
    /// (same switch the MySQL driver uses; StarRocks shares the handshake).
    fn build_opts(config: &ConnectionConfig) -> Opts {
        let url = Self::build_url(config);
        let mut b = match Opts::from_url(&url) {
            Ok(opts) => OptsBuilder::from_opts(opts),
            Err(_) => {
                let mut b = OptsBuilder::default();
                let host = if config.host.is_empty() {
                    "localhost"
                } else {
                    config.host.as_str()
                };
                b = b.ip_or_hostname(host);
                let port = if config.port == 0 { 9030 } else { config.port };
                b = b.tcp_port(port);
                if !config.user.is_empty() {
                    b = b.user(Some(config.user.clone()));
                }
                if !config.password.is_empty() {
                    b = b.pass(Some(config.password.clone()));
                }
                if !config.database.is_empty() {
                    b = b.db_name(Some(config.database.clone()));
                }
                b
            }
        };
        // StarRocks exposes no `@@socket` system variable. mysql_async, with
        // `prefer_socket` on (its default), probes `@@socket` after the TCP
        // handshake to decide whether to reconnect over a unix socket, which
        // StarRocks rejects with `Unknown system variable 'socket'`. We always
        // talk to a remote FE over TCP, so disable the probe.
        b = b.prefer_socket(false);
        if config.ssl_mode.forces_tls() {
            // mysql_async drives rustls, whose process-wide crypto provider must
            // be installed before the handshake (ring, matching its feature).
            let _ = rustls::crypto::ring::default_provider().install_default();
            let strict = matches!(config.ssl_mode, SslMode::VerifyCa | SslMode::VerifyIdentity);
            let mut ssl = SslOpts::default();
            if !strict {
                ssl = ssl.with_danger_accept_invalid_certs(true);
            }
            if matches!(config.ssl_mode, SslMode::VerifyCa) {
                ssl = ssl.with_danger_skip_domain_validation(true);
            }
            if let Some(ca) = config.ca_cert_path.as_deref().filter(|s| !s.is_empty()) {
                ssl = ssl.with_root_certs(vec![PathBuf::from(ca).into()]);
            }
            if let (Some(cert), Some(key)) = (
                config.client_cert_path.as_deref().filter(|s| !s.is_empty()),
                config.client_key_path.as_deref().filter(|s| !s.is_empty()),
            ) {
                ssl = ssl.with_client_identity(Some(ClientIdentity::new(
                    PathBuf::from(cert).into(),
                    PathBuf::from(key).into(),
                )));
            }
            b = b.ssl_opts(Some(ssl));
        }
        b.into()
    }
}

// ── Query execution, value & plan helpers ────────────────────────────────────
impl StarrocksDriver {
    fn params_to_mysql(params: &[QueryValue]) -> Params {
        if params.is_empty() {
            Params::Empty
        } else {
            Params::Positional(params.iter().map(Convert::query_to_mysql).collect())
        }
    }

    /// Column specs for a prepared statement's result set, used to seed a
    /// streamed `RowChunkStream` before any row arrives.
    fn stmt_columns_to_specs(cols: &[Column]) -> Vec<ColumnSpec> {
        cols.iter()
            .map(|c| {
                ColumnSpec::new(
                    c.name_str().into_owned(),
                    Convert::column_type_str(c.column_type()),
                )
            })
            .collect()
    }

    /// One streamed row to `QueryValue`s (values moved out, not cloned).
    fn row_to_query_values(row: Row) -> Vec<QueryValue> {
        let types: Vec<_> = row.columns_ref().iter().map(|c| c.column_type()).collect();
        row.unwrap()
            .into_iter()
            .zip(types)
            .map(|(v, t)| Convert::mysql_to_query(v, t))
            .collect()
    }

    fn rows_to_query_result(
        rows: Vec<Row>,
        cols: Option<Arc<[mysql_async::Column]>>,
        elapsed: f64,
    ) -> QueryResult {
        let column_specs: Vec<ColumnSpec> = cols
            .as_deref()
            .map(|c| {
                c.iter()
                    .map(|col| {
                        ColumnSpec::new(
                            col.name_str().into_owned(),
                            Convert::column_type_str(col.column_type()),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        let column_types: Vec<ColumnType> = cols
            .as_deref()
            .map(|c| c.iter().map(|col| col.column_type()).collect())
            .unwrap_or_default();
        let mut out: Vec<Vec<QueryValue>> = Vec::with_capacity(rows.len());
        for row in rows {
            let raw: Vec<MyValue> = row.unwrap();
            let mut values = Vec::with_capacity(raw.len());
            for (i, v) in raw.into_iter().enumerate() {
                let t = column_types
                    .get(i)
                    .copied()
                    .unwrap_or(ColumnType::MYSQL_TYPE_VAR_STRING);
                values.push(Convert::mysql_to_query(v, t));
            }
            out.push(values);
        }
        QueryResult {
            columns: column_specs,
            rows: out,
            rows_affected: None,
            elapsed,
            ..Default::default()
        }
    }

    /// Joins the first column of every row as newline-separated text — the shape
    /// StarRocks returns for `EXPLAIN` / `EXPLAIN ANALYZE` / `SHOW CREATE`.
    fn rows_first_column_to_string(rows: Vec<Row>) -> String {
        let mut parts: Vec<String> = Vec::with_capacity(rows.len());
        for r in rows {
            let raw_vals: Vec<MyValue> = r.unwrap();
            if let Some(v) = raw_vals.into_iter().next() {
                match v {
                    MyValue::Bytes(bs) => {
                        if let Ok(s) = String::from_utf8(bs) {
                            parts.push(s);
                        }
                    }
                    MyValue::NULL => {}
                    other => parts.push(format!("{other:?}")),
                }
            }
        }
        parts.join("\n")
    }

    /// Backtick-quote an identifier, doubling any embedded backticks.
    fn quote_ident(ident: &str) -> String {
        format!("`{}`", ident.replace('`', "``"))
    }

    /// Build the qualified `` `db`.`name` `` for `SHOW CREATE …`, resolving the
    /// database as `schema` then `database`.
    fn qualified_name(object: &ObjectRef) -> Result<String> {
        let db = object
            .schema
            .as_deref()
            .or(object.database.as_deref())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                DriverError::QueryFailed(format!(
                    "StarRocks: cannot resolve database for object {:?}",
                    object.name
                ))
            })?;
        Ok(format!(
            "{}.{}",
            Self::quote_ident(db),
            Self::quote_ident(&object.name)
        ))
    }

    /// Build the lazily-loaded subtree for one database: a `Database` node whose
    /// children are tables / views / materialized views, each carrying its
    /// `Column` children.
    fn build_schema_tree(
        db: &str,
        tables: Vec<StarrocksTableRow>,
        view_names: Vec<StarrocksViewRow>,
        cols: Vec<StarrocksColumnRow>,
    ) -> Vec<SchemaNode> {
        // Regular logical views are listed in `information_schema.views`; async
        // materialized views are NOT. Both surface in `information_schema.tables`
        // as `TABLE_TYPE = 'VIEW'`, so membership in this set is what tells a
        // plain view apart from a materialized view.
        let regular_views: std::collections::HashSet<String> = view_names.into_iter().collect();
        // Keyed by table name so columns attach to the matching node.
        let mut objects: IndexMap<String, SchemaNode> = IndexMap::new();
        for (name, ttype) in tables {
            let kind = match ttype.as_str() {
                "VIEW" if regular_views.contains(&name) => SchemaNodeKind::View,
                "VIEW" => SchemaNodeKind::MaterializedView,
                _ => SchemaNodeKind::Table,
            };
            let path = format!("{db}.{name}");
            objects.insert(name.clone(), SchemaNode::new(name, kind, path));
        }
        for (tbl, col, col_type, is_nullable) in cols {
            if let Some(node) = objects.get_mut(&tbl) {
                let detail = if is_nullable == "NO" {
                    format!("{col_type} NOT NULL")
                } else {
                    col_type
                };
                let col_path = format!("{}.{}", node.path, col);
                node.children.push(
                    SchemaNode::new(col, SchemaNodeKind::Column, col_path).with_detail(detail),
                );
            }
        }
        let path = db.to_owned();
        vec![
            SchemaNode::new(db.to_owned(), SchemaNodeKind::Database, path)
                .with_children(objects.into_values().collect()),
        ]
    }

    /// Extract the primary-key column names from a `SHOW CREATE TABLE` body by
    /// reading the `PRIMARY KEY (...)` clause. Returns `None` when absent.
    fn parse_primary_key(ddl: &str) -> Option<Vec<String>> {
        let upper = ddl.to_ascii_uppercase();
        let marker = "PRIMARY KEY";
        let mut search_from = 0;
        while let Some(rel) = upper[search_from..].find(marker) {
            let kw_start = search_from + rel;
            // Find the opening paren after the keyword (skip whitespace).
            let after_kw = kw_start + marker.len();
            let open = ddl[after_kw..].find('(').map(|i| after_kw + i);
            let Some(open) = open else {
                return None;
            };
            // Only whitespace may sit between the keyword and `(`; otherwise this
            // is a false match (e.g. inside a comment) — keep scanning.
            if ddl[after_kw..open].trim().is_empty() {
                let close = ddl[open + 1..].find(')').map(|i| open + 1 + i)?;
                let inner = &ddl[open + 1..close];
                let cols: Vec<String> = inner
                    .split(',')
                    .map(|c| c.trim().trim_matches('`').trim().to_owned())
                    .filter(|c| !c.is_empty())
                    .collect();
                return if cols.is_empty() { None } else { Some(cols) };
            }
            search_from = after_kw;
        }
        None
    }
}

#[async_trait]
impl DatabaseDriver for StarrocksDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let opts = Self::build_opts(config);
        let pool = Pool::new(opts);
        // Verify connectivity now so bad credentials surface here, not on the
        // first query.
        let mut conn = pool
            .get_conn()
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
        conn.ping()
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
        drop(conn);
        *self.inner.lock().await = Some(Arc::new(pool));
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let mut conn = self.conn().await?;
        let dbs: Vec<String> = conn
            .query(
                "SELECT SCHEMA_NAME FROM information_schema.schemata \
                 WHERE SCHEMA_NAME NOT IN \
                 ('information_schema','sys','_statistics_','starrocks_monitor') \
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

        let tables: Vec<StarrocksTableRow> = conn
            .exec(
                "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables \
                 WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
                (schema,),
            )
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        // Regular logical views; `build_schema_tree` uses this set to tell plain
        // views apart from async materialized views (both are `VIEW` in
        // `information_schema.tables`). The dedicated `materialized_views` IS
        // table is avoided on purpose: it triggers a BE status RPC that fails on
        // single-node clusters, whereas `information_schema.views` is metadata
        // only and always available.
        let view_names: Vec<StarrocksViewRow> = conn
            .exec(
                "SELECT TABLE_NAME FROM information_schema.views \
                 WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
                (schema,),
            )
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let cols: Vec<StarrocksColumnRow> = conn
            .exec(
                "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE \
                 FROM information_schema.columns \
                 WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION",
                (schema,),
            )
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        drop(conn);

        Ok(Self::build_schema_tree(schema, tables, view_names, cols))
    }

    fn select_like_keywords(&self) -> &'static [&'static str] {
        &["DESCRIBE", "DESC", "SHOW", "EXPLAIN"]
    }

    async fn run_query(
        &self,
        text: &str,
        params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        let is_select = self.looks_like_select(text);
        let started = Instant::now();
        let mut conn = self.conn().await?;
        let p = Self::params_to_mysql(params);

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
            Ok(Self::rows_to_query_result(
                rows,
                cols,
                started.elapsed().as_secs_f64(),
            ))
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

    async fn run_query_stream(
        &self,
        text: &str,
        params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryStream> {
        // StarRocks has no interactive transactions, so the only non-streaming
        // case is a non-SELECT (materialized fallback).
        if !self.looks_like_select(text) {
            return Ok(QueryStream::from_materialized(
                self.run_query(text, params, language).await?,
            ));
        }
        let mut conn = self.conn().await?;
        // Prepare learns the result columns up front. StarRocks prepared-statement
        // support varies by version: a failure materializes on a fresh conn.
        let stmt = match conn.prep(text).await {
            Ok(stmt) => stmt,
            Err(_) => {
                drop(conn);
                return Ok(QueryStream::from_materialized(
                    self.run_query(text, params, language).await?,
                ));
            }
        };
        let columns = Self::stmt_columns_to_specs(stmt.columns());
        let params = Self::params_to_mysql(params);
        Ok(QueryStream::Rows(MysqlWireStream::open(
            conn,
            stmt,
            params,
            columns,
            Self::row_to_query_values,
        )))
    }

    fn pagination_strategy(&self) -> PaginationStrategy {
        // The default `SubqueryOffset` wraps the query as
        // `SELECT * FROM (<query>) AS _p LIMIT n OFFSET m`. StarRocks is an MPP
        // engine: a derived table's `ORDER BY` is not preserved by the outer
        // SELECT, so wrapping silently scrambles row order. Page in memory
        // instead — the query runs verbatim (its `ORDER BY` honored) and the
        // engine slices the buffered rows.
        PaginationStrategy::InMemory
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
        let p = Self::params_to_mysql(params);

        // StarRocks has no `EXPLAIN FORMAT=JSON`; both modes return text rows.
        let (sql, label, node_type) = if analyze {
            (format!("EXPLAIN ANALYZE {text}"), "EXPLAIN ANALYZE", "explain_analyze")
        } else {
            (format!("EXPLAIN {text}"), "StarRocks plan", "explain")
        };

        let rows: Vec<Row> = if matches!(p, Params::Empty) {
            conn.query(&sql)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?
        } else {
            conn.exec(&sql, p)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?
        };
        let raw = Self::rows_first_column_to_string(rows);
        let mut root = PlanNode::new(label, node_type);
        for (i, line) in raw.lines().enumerate() {
            root.attributes.push(PlanAttribute::new(format!("L{i}"), line));
        }
        Ok(PlanResult::new(root, mode, raw))
    }

    async fn primary_key(&self, table: &TableRef) -> Result<Option<Vec<String>>> {
        // `information_schema.key_column_usage` is an empty placeholder in
        // StarRocks, so derive the PK from the `SHOW CREATE TABLE` DDL.
        let db = table
            .schema
            .as_deref()
            .or(table.database.as_deref())
            .filter(|s| !s.is_empty());
        let qualified = match db {
            Some(d) => format!(
                "{}.{}",
                Self::quote_ident(d),
                Self::quote_ident(&table.name)
            ),
            None => Self::quote_ident(&table.name),
        };
        let mut conn = self.conn().await?;
        let rows: Vec<Row> = conn
            .query(format!("SHOW CREATE TABLE {qualified}"))
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        drop(conn);
        // `SHOW CREATE TABLE` returns `(Table, Create Table)`; the DDL is the
        // second column.
        let ddl = rows
            .into_iter()
            .next()
            .and_then(|r| {
                let vals: Vec<MyValue> = r.unwrap();
                vals.into_iter().nth(1)
            })
            .and_then(|v| match v {
                MyValue::Bytes(bs) => String::from_utf8(bs).ok(),
                _ => None,
            });
        Ok(ddl.as_deref().and_then(Self::parse_primary_key))
    }

    async fn object_definition(&self, object: &ObjectRef) -> Result<String> {
        let keyword = match object.kind {
            SchemaNodeKind::Table => "TABLE",
            SchemaNodeKind::View => "VIEW",
            SchemaNodeKind::MaterializedView => "MATERIALIZED VIEW",
            other => {
                return Err(DriverError::Unsupported(format!(
                    "StarRocks: no definition for {other:?}"
                )));
            }
        };
        let qualified = Self::qualified_name(object)?;
        let mut conn = self.conn().await?;
        let rows: Vec<Row> = conn
            .query(format!("SHOW CREATE {keyword} {qualified}"))
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        drop(conn);
        // The DDL lives in the `Create ...` column. For a TABLE that is the last
        // of two columns (`Table`, `Create Table`), but `SHOW CREATE VIEW`
        // returns four (`View`, `Create View`, `character_set_client`,
        // `collation_connection`), so the DDL is NOT the last column. Pick the
        // column whose name starts with `Create`, falling back to the last.
        rows.into_iter()
            .next()
            .and_then(|r| {
                let cols = r.columns();
                let idx = cols
                    .iter()
                    .position(|c| c.name_str().to_ascii_lowercase().starts_with("create"))
                    .unwrap_or_else(|| cols.len().saturating_sub(1));
                let vals: Vec<MyValue> = r.unwrap();
                vals.into_iter().nth(idx)
            })
            .and_then(|v| match v {
                MyValue::Bytes(bs) => Some(String::from_utf8_lossy(&bs).into_owned()),
                _ => None,
            })
            .ok_or_else(|| {
                DriverError::QueryFailed(format!(
                    "StarRocks: no definition returned for {:?} {:?}",
                    object.kind, object.name
                ))
            })
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &ValueMap,
        changes: &ValueMap,
    ) -> Result<MutationResult> {
        let (sql, params) = SqlBuilder::build_update(
            table,
            primary_key,
            changes,
            SqlBuilder::quote_backtick,
            SqlBuilder::placeholder_qmark,
        )
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
            let (sql, params) = SqlBuilder::build_insert(
                table,
                &ins.values,
                SqlBuilder::quote_backtick,
                SqlBuilder::placeholder_qmark,
            )
            .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let r = self.run_query(&sql, &params, QueryLanguage::Native).await?;
            result.rows_affected += r.rows_affected.unwrap_or(0) as usize;
            result
                .statements
                .push(SqlBuilder::interpolate_params(&sql, &params));
        }
        Ok(result)
    }

    async fn delete_rows(&self, table: &TableRef, deletes: &[RowDelete]) -> Result<MutationResult> {
        let mut result = MutationResult::default();
        for del in deletes {
            let (sql, params) = SqlBuilder::build_delete(
                table,
                &del.primary_key,
                SqlBuilder::quote_backtick,
                SqlBuilder::placeholder_qmark,
            )
            .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let r = self.run_query(&sql, &params, QueryLanguage::Native).await?;
            result.rows_affected += r.rows_affected.unwrap_or(0) as usize;
            result
                .statements
                .push(SqlBuilder::interpolate_params(&sql, &params));
        }
        Ok(result)
    }

    fn supports_transactions(&self) -> bool {
        false
    }

    async fn in_transaction(&self) -> bool {
        false
    }

    async fn begin_transaction(&self, _isolation: crate::IsolationLevel) -> Result<()> {
        Err(DriverError::Unsupported(
            "StarRocks does not support interactive transactions".into(),
        ))
    }

    async fn commit_transaction(&self) -> Result<()> {
        Err(DriverError::Unsupported(
            "StarRocks does not support interactive transactions".into(),
        ))
    }

    async fn rollback_transaction(&self) -> Result<()> {
        Err(DriverError::Unsupported(
            "StarRocks does not support interactive transactions".into(),
        ))
    }

    async fn close(&self) {
        if let Some(pool) = self.inner.lock().await.take() {
            if let Ok(p) = Arc::try_unwrap(pool) {
                let _ = p.disconnect().await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    //! Pure-unit tests — no live StarRocks / network.
    use super::*;
    use crate::DatabaseKind;

    #[test]
    fn looks_like_select_classifies_statements() {
        let d = StarrocksDriver::new();
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
    async fn driver_starts_disconnected_and_non_transactional() {
        let d = StarrocksDriver::new();
        assert!(!d.is_connected().await);
        assert!(!d.supports_transactions());
        assert!(!d.in_transaction().await);
    }

    #[tokio::test]
    async fn transaction_methods_report_unsupported() {
        let d = StarrocksDriver::new();
        assert!(matches!(
            d.begin_transaction(crate::IsolationLevel::default()).await,
            Err(DriverError::Unsupported(_))
        ));
        assert!(matches!(
            d.commit_transaction().await,
            Err(DriverError::Unsupported(_))
        ));
        assert!(matches!(
            d.rollback_transaction().await,
            Err(DriverError::Unsupported(_))
        ));
    }

    #[test]
    fn build_opts_default_port_is_9030() {
        let cfg = ConnectionConfig::new("local", DatabaseKind::Starrocks);
        let opts = StarrocksDriver::build_opts(&cfg);
        assert_eq!(opts.tcp_port(), 9030);
    }

    #[test]
    fn build_opts_uses_configured_port() {
        let mut cfg = ConnectionConfig::new("local", DatabaseKind::Starrocks);
        cfg.port = 9031;
        let opts = StarrocksDriver::build_opts(&cfg);
        assert_eq!(opts.tcp_port(), 9031);
    }

    #[test]
    fn build_opts_default_host_when_empty() {
        let cfg = ConnectionConfig::new("local", DatabaseKind::Starrocks);
        let opts = StarrocksDriver::build_opts(&cfg);
        assert_eq!(opts.ip_or_hostname(), "localhost");
    }

    #[test]
    fn build_opts_attaches_ssl_when_mode_enabled() {
        let mut cfg = ConnectionConfig::new("local", DatabaseKind::Starrocks);
        cfg.ssl_mode = SslMode::Required;
        let opts = StarrocksDriver::build_opts(&cfg);
        assert!(opts.ssl_opts().is_some());
    }

    #[test]
    fn build_opts_no_ssl_when_disabled() {
        let mut cfg = ConnectionConfig::new("local", DatabaseKind::Starrocks);
        cfg.ssl_mode = SslMode::Disabled;
        let opts = StarrocksDriver::build_opts(&cfg);
        assert!(opts.ssl_opts().is_none());
    }

    #[test]
    fn build_url_basic_with_default_port() {
        let mut cfg = ConnectionConfig::new("t", DatabaseKind::Starrocks);
        cfg.host = "fe.local".into();
        cfg.user = "root".into();
        cfg.password = "secret".into();
        cfg.database = "warehouse".into();
        let url = StarrocksDriver::build_url(&cfg);
        assert_eq!(url, "mysql://root:secret@fe.local:9030/warehouse");
    }

    #[test]
    fn build_url_encodes_userinfo_special_chars() {
        let mut cfg = ConnectionConfig::new("t", DatabaseKind::Starrocks);
        cfg.host = "localhost".into();
        cfg.user = "user@org".into();
        cfg.password = "p@ss:word".into();
        let url = StarrocksDriver::build_url(&cfg);
        assert!(url.contains("user%40org"));
        assert!(url.contains("p%40ss%3Aword"));
    }

    #[test]
    fn quote_ident_doubles_backticks() {
        assert_eq!(StarrocksDriver::quote_ident("ta`ble"), "`ta``ble`");
        assert_eq!(StarrocksDriver::quote_ident("plain"), "`plain`");
    }

    #[test]
    fn pagination_is_in_memory_to_preserve_order_by() {
        // Subquery-wrapping (the default) drops `ORDER BY` on StarRocks' MPP
        // engine, so the driver must page in memory instead.
        assert_eq!(
            StarrocksDriver::new().pagination_strategy(),
            PaginationStrategy::InMemory
        );
    }

    #[test]
    fn parse_primary_key_extracts_single_column() {
        let ddl = "CREATE TABLE `orders` (\n  `id` BIGINT NOT NULL,\n  `total` DECIMAL(10,2)\n) \
                   PRIMARY KEY (`id`)\nDISTRIBUTED BY HASH(`id`);";
        assert_eq!(
            StarrocksDriver::parse_primary_key(ddl),
            Some(vec!["id".to_string()])
        );
    }

    #[test]
    fn parse_primary_key_extracts_composite_columns() {
        let ddl = "CREATE TABLE `order_items` (\n  `order_id` BIGINT,\n  `product_id` BIGINT\n) \
                   PRIMARY KEY (`order_id`, `product_id`)\nDISTRIBUTED BY HASH(`order_id`);";
        assert_eq!(
            StarrocksDriver::parse_primary_key(ddl),
            Some(vec!["order_id".to_string(), "product_id".to_string()])
        );
    }

    #[test]
    fn parse_primary_key_handles_unquoted_and_spaced_columns() {
        let ddl = "CREATE TABLE t (id INT) PRIMARY KEY ( a , b )";
        assert_eq!(
            StarrocksDriver::parse_primary_key(ddl),
            Some(vec!["a".to_string(), "b".to_string()])
        );
    }

    #[test]
    fn parse_primary_key_returns_none_without_clause() {
        let ddl = "CREATE TABLE `logs` (\n  `ts` DATETIME,\n  `msg` STRING\n) \
                   DUPLICATE KEY(`ts`)\nDISTRIBUTED BY HASH(`ts`);";
        assert_eq!(StarrocksDriver::parse_primary_key(ddl), None);
    }

    #[test]
    fn build_schema_tree_groups_objects_and_columns() {
        // Both a regular view and a materialized view show as `VIEW` in
        // `information_schema.tables`; only the regular view is in `view_names`
        // (from `information_schema.views`), which is how they are told apart.
        let tree = StarrocksDriver::build_schema_tree(
            "warehouse",
            vec![
                ("orders".into(), "BASE TABLE".into()),
                ("active_orders".into(), "VIEW".into()),
                ("daily_sales".into(), "VIEW".into()),
            ],
            vec!["active_orders".into()],
            vec![
                ("orders".into(), "id".into(), "bigint".into(), "NO".into()),
                ("orders".into(), "note".into(), "varchar(255)".into(), "YES".into()),
            ],
        );
        assert_eq!(tree.len(), 1);
        let db = &tree[0];
        assert_eq!(db.name, "warehouse");
        assert_eq!(db.kind, SchemaNodeKind::Database);
        assert_eq!(db.path, "warehouse");

        let kinds: std::collections::HashMap<_, _> = db
            .children
            .iter()
            .map(|n| (n.name.as_str(), n.kind))
            .collect();
        assert_eq!(kinds.get("orders"), Some(&SchemaNodeKind::Table));
        assert_eq!(kinds.get("active_orders"), Some(&SchemaNodeKind::View));
        assert_eq!(
            kinds.get("daily_sales"),
            Some(&SchemaNodeKind::MaterializedView)
        );

        let orders = db.children.iter().find(|n| n.name == "orders").unwrap();
        assert_eq!(orders.children.len(), 2);
        assert_eq!(orders.children[0].name, "id");
        assert_eq!(orders.children[0].detail.as_deref(), Some("bigint NOT NULL"));
        assert_eq!(orders.children[0].path, "warehouse.orders.id");
        assert_eq!(orders.children[1].detail.as_deref(), Some("varchar(255)"));
    }

    #[test]
    fn build_schema_tree_container_matches_lazy_merge_path() {
        // The empty subtree must share the same name/kind/path that
        // `list_schemas` produces, so the frontend merges onto it by path.
        let tree =
            StarrocksDriver::build_schema_tree("warehouse", Vec::new(), Vec::new(), Vec::new());
        let db = &tree[0];
        assert_eq!(db.name, "warehouse");
        assert_eq!(db.kind, SchemaNodeKind::Database);
        assert_eq!(db.path, "warehouse");
        assert!(db.children.is_empty());
    }

    #[test]
    fn params_to_mysql_maps_empty_and_positional() {
        assert!(matches!(
            StarrocksDriver::params_to_mysql(&[]),
            Params::Empty
        ));
        match StarrocksDriver::params_to_mysql(&[QueryValue::Int(1), QueryValue::Text("a".into())]) {
            Params::Positional(v) => assert_eq!(v.len(), 2),
            _ => panic!("expected positional"),
        }
    }
}
