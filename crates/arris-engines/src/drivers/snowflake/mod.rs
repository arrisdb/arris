mod api;
mod definition;
mod schema;
mod values;

use std::time::Instant;

use async_trait::async_trait;
use tokio::sync::Mutex;

use crate::drivers::errors::Result;
use crate::drivers::sql_builder::SqlBuilder;
use crate::drivers::DatabaseDriver;
use crate::{
    ConnectionConfig, DriverError, ExplainMode, MutationResult, PlanAttribute, PlanNode,
    PlanResult, QueryLanguage, QueryResult, QueryValue, RowDelete, RowInsert, SchemaNode,
    SchemaNodeKind, TableRef,
};

use api::SnowflakeApi;
use schema::{assemble_database_node, database_names_from_show, SfColumn, SfObject};
use values::response_to_query_result;

pub struct SnowflakeDriver {
    api: Mutex<Option<SnowflakeApi>>,
    /// Whether a manual transaction is currently open. Snowflake binds a
    /// transaction to the session token, and a single `SnowflakeApi` (one token)
    /// is reused for every query on this connection, so begin/commit/rollback all
    /// share that session.
    in_tx: Mutex<bool>,
}

impl Default for SnowflakeDriver {
    fn default() -> Self {
        Self {
            api: Mutex::new(None),
            in_tx: Mutex::new(false),
        }
    }
}

impl SnowflakeDriver {
    pub fn new() -> Self {
        Self::default()
    }

    fn parse_options(options: &str) -> std::collections::HashMap<String, String> {
        options
            .split('&')
            .filter(|s| !s.is_empty())
            .filter_map(|kv| {
                let mut parts = kv.splitn(2, '=');
                let key = parts.next()?.to_lowercase();
                let value = parts.next()?.to_owned();
                Some((key, value))
            })
            .collect()
    }

    /// Map a Snowflake `TABLE_TYPE` to the schema browser node kind. Anything
    /// unrecognized is treated as a plain table.
    fn sf_kind(table_type: &str) -> SchemaNodeKind {
        match table_type {
            "BASE TABLE" => SchemaNodeKind::Table,
            "VIEW" => SchemaNodeKind::View,
            "MATERIALIZED VIEW" => SchemaNodeKind::MaterializedView,
            "EXTERNAL TABLE" => SchemaNodeKind::ForeignTable,
            _ => SchemaNodeKind::Table,
        }
    }

    /// Determine which databases to introspect. When the session has a current
    /// database, browse just that one; otherwise enumerate every accessible
    /// database so the browser is never empty. The bool is `true` when we
    /// enumerated — callers treat per-database failures as skippable then.
    async fn resolve_databases(api: &SnowflakeApi) -> Result<(Vec<String>, bool)> {
        let db_resp = api.query("SELECT CURRENT_DATABASE() AS DB").await?;
        let current_db = db_resp
            .rows
            .first()
            .and_then(|r| r.first().and_then(|c| c.clone()))
            .unwrap_or_default();

        if !current_db.is_empty() {
            return Ok((vec![current_db], false));
        }

        let resp = api.query("SHOW DATABASES").await?;
        Ok((database_names_from_show(&resp.columns, &resp.rows), true))
    }

    /// Cheap per-database container query: just the schema names. No table or
    /// column metadata — those load lazily via `list_schema`.
    async fn database_container(api: &SnowflakeApi, database: &str) -> Result<SchemaNode> {
        let db_esc = database.replace('"', "\"\"");
        let schema_resp = api
            .query(&format!(
                "SELECT SCHEMA_NAME \
                 FROM \"{db_esc}\".INFORMATION_SCHEMA.SCHEMATA \
                 WHERE SCHEMA_NAME NOT IN ('INFORMATION_SCHEMA') \
                 ORDER BY SCHEMA_NAME"
            ))
            .await?;

        let schema_nodes: Vec<SchemaNode> = schema_resp
            .rows
            .iter()
            .filter_map(|r| r.first().and_then(|c| c.clone()))
            .map(|name| {
                let path = format!("{database}.{name}");
                SchemaNode::new(name, SchemaNodeKind::Schema, path)
            })
            .collect();

        Ok(SchemaNode::new(database, SchemaNodeKind::Database, database)
            .with_children(schema_nodes))
    }
}

#[async_trait]
impl DatabaseDriver for SnowflakeDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let opts = Self::parse_options(&config.options);
        let warehouse = opts.get("warehouse").map(|s| s.as_str());
        let role = opts.get("role").map(|s| s.as_str());
        let schema = opts.get("schema").map(|s| s.as_str());
        let database = if config.database.is_empty() {
            None
        } else {
            Some(config.database.as_str())
        };

        let api = SnowflakeApi::login(
            &config.host,
            &config.user,
            &config.password,
            warehouse,
            database,
            schema,
            role,
        )
        .await?;

        *self.api.lock().await = Some(api);
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.api.lock().await.is_some()
    }

    fn select_like_keywords(&self) -> &'static [&'static str] {
        &["DESCRIBE", "DESC", "LIST", "CALL"]
    }

    fn supports_transactions(&self) -> bool {
        true
    }

    async fn in_transaction(&self) -> bool {
        *self.in_tx.lock().await
    }

    async fn begin_transaction(&self, _isolation: crate::IsolationLevel) -> Result<()> {
        // Snowflake supports only READ COMMITTED isolation (its default), so the
        // requested `IsolationLevel` is ignored.
        {
            let guard = self.api.lock().await;
            let api = guard.as_ref().ok_or(DriverError::NotConnected)?;
            api.query("BEGIN").await?;
        }
        *self.in_tx.lock().await = true;
        Ok(())
    }

    async fn commit_transaction(&self) -> Result<()> {
        {
            let guard = self.api.lock().await;
            let api = guard.as_ref().ok_or(DriverError::NotConnected)?;
            api.query("COMMIT").await?;
        }
        *self.in_tx.lock().await = false;
        Ok(())
    }

    async fn rollback_transaction(&self) -> Result<()> {
        {
            let guard = self.api.lock().await;
            let api = guard.as_ref().ok_or(DriverError::NotConnected)?;
            api.query("ROLLBACK").await?;
        }
        *self.in_tx.lock().await = false;
        Ok(())
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let guard = self.api.lock().await;
        let api = guard.as_ref().ok_or(DriverError::NotConnected)?;

        // Lazy: containers only. Each database node holds its schema container
        // nodes with EMPTY children — one cheap `SCHEMATA` query per database,
        // no per-table or per-column metadata. A schema's tables, views, and
        // columns load on demand via `list_schema` when the user selects it.
        let (databases, best_effort) = Self::resolve_databases(api).await?;

        let mut nodes = Vec::with_capacity(databases.len());
        for db in &databases {
            match Self::database_container(api, db).await {
                Ok(node) => nodes.push(node),
                // A database we can't introspect shouldn't blank out the whole
                // browser when we enumerated everything ourselves.
                Err(_) if best_effort => continue,
                Err(e) => return Err(e),
            }
        }
        Ok(nodes)
    }

    /// Fetches a single schema's objects and columns, returning the populated
    /// schema container node so the frontend can merge it into the cached tree
    /// by matching `path`. `schema` is the bare schema name as surfaced by the
    /// frontend's `extractSchemaNames`; the database is taken from the current
    /// session (Snowflake's `CURRENT_DATABASE()`), matching the `{db}.{schema}`
    /// path `list_schemas` produced for the container.
    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let guard = self.api.lock().await;
        let api = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let db_resp = api.query("SELECT CURRENT_DATABASE() AS DB").await?;
        let database = db_resp
            .rows
            .first()
            .and_then(|r| r.first().and_then(|c| c.clone()))
            .unwrap_or_default();

        let db_esc = database.replace('"', "\"\"");
        let schema_lit = schema.replace('\'', "''");

        let obj_resp = api
            .query(&format!(
                "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE \
                 FROM \"{db_esc}\".INFORMATION_SCHEMA.TABLES \
                 WHERE TABLE_SCHEMA = '{schema_lit}' \
                 ORDER BY TABLE_NAME"
            ))
            .await?;

        let objects: Vec<SfObject> = obj_resp
            .rows
            .iter()
            .filter_map(|r| {
                let cell = |i: usize| r.get(i).and_then(|c| c.clone());
                Some(SfObject {
                    schema: cell(0)?,
                    name: cell(1)?,
                    kind: Self::sf_kind(&cell(2)?),
                })
            })
            .collect();

        let col_resp = api
            .query(&format!(
                "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE \
                 FROM \"{db_esc}\".INFORMATION_SCHEMA.COLUMNS \
                 WHERE TABLE_SCHEMA = '{schema_lit}' \
                 ORDER BY TABLE_NAME, ORDINAL_POSITION"
            ))
            .await?;

        let columns: Vec<SfColumn> = col_resp
            .rows
            .iter()
            .filter_map(|r| {
                let cell = |i: usize| r.get(i).and_then(|c| c.clone());
                Some(SfColumn {
                    schema: cell(0)?,
                    table: cell(1)?,
                    name: cell(2)?,
                    data_type: cell(3)?,
                    nullable: cell(4).map(|v| v == "YES").unwrap_or(true),
                })
            })
            .collect();

        // Build the full database node, then pluck out the one schema container
        // so the returned node carries the identical `name`, `kind`, and
        // `{database}.{schema}` path the cheap `list_schemas` produced.
        let db_node =
            assemble_database_node(&database, &[schema.to_owned()], &objects, &columns);
        Ok(db_node
            .children
            .into_iter()
            .find(|c| c.name == schema)
            .into_iter()
            .collect())
    }

    async fn run_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        let guard = self.api.lock().await;
        let api = guard.as_ref().ok_or(DriverError::NotConnected)?;
        let started = Instant::now();

        let resp = api.query(text).await?;

        if self.looks_like_select(text) {
            Ok(response_to_query_result(resp, started.elapsed().as_secs_f64()))
        } else {
            let affected = resp.rows.len() as i64;
            Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: Some(affected),
                elapsed: started.elapsed().as_secs_f64(),
                ..Default::default()
            })
        }
    }

    async fn explain_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
        mode: ExplainMode,
    ) -> Result<PlanResult> {
        let guard = self.api.lock().await;
        let api = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let resp = api
            .query(&format!("EXPLAIN USING JSON {text}"))
            .await?;

        let raw_lines: Vec<String> = resp
            .rows
            .iter()
            .filter_map(|r| r.first().and_then(|c| c.clone()))
            .collect();
        let raw = raw_lines.join("\n");

        let mut root = PlanNode::new("Query Plan", "query_plan");
        for (i, line) in raw_lines.iter().enumerate() {
            root.attributes
                .push(PlanAttribute::new(format!("L{i}"), line));
        }
        Ok(PlanResult::new(root, mode, raw))
    }

    async fn object_definition(&self, object: &crate::ObjectRef) -> Result<String> {
        let guard = self.api.lock().await;
        let api = guard.as_ref().ok_or(DriverError::NotConnected)?;
        definition::object_definition(api, object).await
    }

    async fn primary_key(&self, table: &TableRef) -> Result<Option<Vec<String>>> {
        let guard = self.api.lock().await;
        let api = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let schema = table.schema.as_deref().unwrap_or("PUBLIC");
        let escaped_schema = schema.replace('\'', "''");
        let escaped_table = table.name.replace('\'', "''");

        let db_prefix = match &table.database {
            Some(db) => format!("\"{}\".", db.replace('"', "\"\"")),
            None => String::new(),
        };

        let sql = format!(
            "SELECT kcu.COLUMN_NAME \
             FROM {db_prefix}INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
             JOIN {db_prefix}INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
               ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME \
               AND tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA \
             WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' \
               AND tc.TABLE_SCHEMA = '{escaped_schema}' \
               AND tc.TABLE_NAME = '{escaped_table}' \
             ORDER BY kcu.ORDINAL_POSITION"
        );

        let resp = api.query(&sql).await?;

        let cols: Vec<String> = resp
            .rows
            .iter()
            .filter_map(|r| r.first().and_then(|c| c.clone()))
            .collect();
        Ok(if cols.is_empty() { None } else { Some(cols) })
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &crate::ValueMap,
        changes: &crate::ValueMap,
    ) -> Result<MutationResult> {
        let (sql, params) = SqlBuilder::build_update(
            table,
            primary_key,
            changes,
            SqlBuilder::quote_double,
            SqlBuilder::placeholder_dollar,
        )
        .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
        let interpolated = SqlBuilder::interpolate_params(&sql, &params);
        let r = self
            .run_query(&interpolated, &[], QueryLanguage::Native)
            .await?;
        Ok(MutationResult {
            rows_affected: r.rows_affected.unwrap_or(0) as usize,
            statements: vec![interpolated],
        })
    }

    async fn insert_rows(
        &self,
        table: &TableRef,
        inserts: &[RowInsert],
    ) -> Result<MutationResult> {
        let mut result = MutationResult::default();
        for ins in inserts {
            let (sql, params) = SqlBuilder::build_insert(
                table,
                &ins.values,
                SqlBuilder::quote_double,
                SqlBuilder::placeholder_dollar,
            )
            .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let interpolated = SqlBuilder::interpolate_params(&sql, &params);
            let r = self
                .run_query(&interpolated, &[], QueryLanguage::Native)
                .await?;
            result.rows_affected += r.rows_affected.unwrap_or(0) as usize;
            result.statements.push(interpolated);
        }
        Ok(result)
    }

    async fn delete_rows(
        &self,
        table: &TableRef,
        deletes: &[RowDelete],
    ) -> Result<MutationResult> {
        let mut result = MutationResult::default();
        for del in deletes {
            let (sql, params) = SqlBuilder::build_delete(
                table,
                &del.primary_key,
                SqlBuilder::quote_double,
                SqlBuilder::placeholder_dollar,
            )
            .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let interpolated = SqlBuilder::interpolate_params(&sql, &params);
            let r = self
                .run_query(&interpolated, &[], QueryLanguage::Native)
                .await?;
            result.rows_affected += r.rows_affected.unwrap_or(0) as usize;
            result.statements.push(interpolated);
        }
        Ok(result)
    }

    async fn close(&self) {
        let _ = self.api.lock().await.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_options_extracts_key_value_pairs() {
        let opts = SnowflakeDriver::parse_options("warehouse=COMPUTE_WH&role=SYSADMIN&schema=PUBLIC");
        assert_eq!(opts.get("warehouse").unwrap(), "COMPUTE_WH");
        assert_eq!(opts.get("role").unwrap(), "SYSADMIN");
        assert_eq!(opts.get("schema").unwrap(), "PUBLIC");
    }

    #[test]
    fn parse_options_empty_string_returns_empty_map() {
        let opts = SnowflakeDriver::parse_options("");
        assert!(opts.is_empty());
    }

    #[test]
    fn parse_options_lowercases_keys() {
        let opts = SnowflakeDriver::parse_options("Warehouse=WH&ROLE=ADMIN");
        assert_eq!(opts.get("warehouse").unwrap(), "WH");
        assert_eq!(opts.get("role").unwrap(), "ADMIN");
    }

    #[tokio::test]
    async fn driver_starts_disconnected() {
        let d = SnowflakeDriver::new();
        assert!(!d.is_connected().await);
    }

    #[test]
    fn sf_kind_maps_table_types() {
        assert_eq!(SnowflakeDriver::sf_kind("BASE TABLE"), SchemaNodeKind::Table);
        assert_eq!(SnowflakeDriver::sf_kind("VIEW"), SchemaNodeKind::View);
        assert_eq!(
            SnowflakeDriver::sf_kind("MATERIALIZED VIEW"),
            SchemaNodeKind::MaterializedView
        );
        assert_eq!(
            SnowflakeDriver::sf_kind("EXTERNAL TABLE"),
            SchemaNodeKind::ForeignTable
        );
        // Unknown types fall back to a plain table.
        assert_eq!(SnowflakeDriver::sf_kind("SOMETHING_ELSE"), SchemaNodeKind::Table);
    }

    #[tokio::test]
    async fn list_schemas_and_list_schema_require_connection() {
        // Both schema calls go through the live HTTP API, so without a session
        // they must surface `NotConnected` rather than panicking. End-to-end
        // lazy-load behavior is covered against a real account.
        let d = SnowflakeDriver::new();
        assert!(matches!(
            d.list_schemas().await,
            Err(DriverError::NotConnected)
        ));
        assert!(matches!(
            d.list_schema("PUBLIC").await,
            Err(DriverError::NotConnected)
        ));
    }

    #[test]
    fn list_schema_assembles_bare_schema_container_with_merge_path() {
        // `list_schema` returns the bare schema container (not the database
        // wrapper) so the frontend merges it by matching the same
        // `{database}.{schema}` path `list_schemas` produced. This asserts the
        // assembly `list_schema` relies on yields that path and the nested
        // object/column paths.
        let db = assemble_database_node(
            "MYDB",
            &["PUBLIC".into()],
            &[SfObject {
                schema: "PUBLIC".into(),
                name: "users".into(),
                kind: SchemaNodeKind::Table,
            }],
            &[SfColumn {
                schema: "PUBLIC".into(),
                table: "users".into(),
                name: "id".into(),
                data_type: "NUMBER".into(),
                nullable: false,
            }],
        );
        let schema = db
            .children
            .into_iter()
            .find(|c| c.name == "PUBLIC")
            .expect("schema container present");

        assert_eq!(schema.kind, SchemaNodeKind::Schema);
        assert_eq!(schema.path, "MYDB.PUBLIC");
        assert_eq!(schema.children.len(), 1);
        assert_eq!(schema.children[0].name, "users");
        assert_eq!(schema.children[0].path, "MYDB.PUBLIC.users");
        assert_eq!(schema.children[0].children[0].path, "MYDB.PUBLIC.users.id");
    }

    #[tokio::test]
    async fn supports_transactions_and_starts_outside_one() {
        // Snowflake transactions (BEGIN/COMMIT/ROLLBACK) ride the session token,
        // which only exists after login, so begin/commit/rollback are exercised
        // against a live account rather than here. The static contract is asserted.
        let d = SnowflakeDriver::new();
        assert!(d.supports_transactions());
        assert!(!d.in_transaction().await);
    }

    #[test]
    fn looks_like_select_handles_common_keywords() {
        let d = SnowflakeDriver::new();
        assert!(d.looks_like_select("SELECT 1"));
        assert!(d.looks_like_select("  WITH x AS (SELECT 1) SELECT * FROM x"));
        assert!(d.looks_like_select("SHOW TABLES"));
        assert!(d.looks_like_select("DESCRIBE TABLE users"));
        assert!(d.looks_like_select("DESC TABLE users"));
        assert!(d.looks_like_select("EXPLAIN SELECT 1"));
        assert!(d.looks_like_select("LIST @my_stage"));
        assert!(d.looks_like_select("CALL my_procedure()"));
        assert!(!d.looks_like_select("INSERT INTO t VALUES (1)"));
        assert!(!d.looks_like_select("UPDATE t SET x=1"));
        assert!(!d.looks_like_select("DELETE FROM t WHERE id=1"));
        assert!(!d.looks_like_select("CREATE TABLE t(x int)"));
    }

    #[test]
    fn assemble_tree_wraps_schemas_in_database_node() {
        let db = assemble_database_node(
            "MYDB",
            &["PUBLIC".into(), "ANALYTICS".into()],
            &[
                SfObject {
                    schema: "PUBLIC".into(),
                    name: "users".into(),
                    kind: crate::SchemaNodeKind::Table,
                },
                SfObject {
                    schema: "ANALYTICS".into(),
                    name: "events".into(),
                    kind: crate::SchemaNodeKind::Table,
                },
            ],
            &[SfColumn {
                schema: "PUBLIC".into(),
                table: "users".into(),
                name: "id".into(),
                data_type: "NUMBER".into(),
                nullable: false,
            }],
        );

        assert_eq!(db.name, "MYDB");
        assert_eq!(db.kind, crate::SchemaNodeKind::Database);
        assert_eq!(db.children.len(), 2);

        let public = db.children.iter().find(|s| s.name == "PUBLIC").unwrap();
        assert_eq!(public.path, "MYDB.PUBLIC");
        let users = &public.children[0];
        assert_eq!(users.name, "users");
        assert_eq!(users.kind, crate::SchemaNodeKind::Table);
        assert_eq!(users.path, "MYDB.PUBLIC.users");
        assert_eq!(users.children[0].name, "id");
        assert_eq!(users.children[0].detail.as_deref(), Some("NUMBER NOT NULL"));

        let analytics = db.children.iter().find(|s| s.name == "ANALYTICS").unwrap();
        assert_eq!(analytics.children[0].name, "events");
    }

    #[test]
    fn assemble_tree_includes_views_and_external_tables() {
        let db = assemble_database_node(
            "DB",
            &["PUBLIC".into()],
            &[
                SfObject { schema: "PUBLIC".into(), name: "t1".into(), kind: crate::SchemaNodeKind::Table },
                SfObject { schema: "PUBLIC".into(), name: "v1".into(), kind: crate::SchemaNodeKind::View },
                SfObject { schema: "PUBLIC".into(), name: "mv1".into(), kind: crate::SchemaNodeKind::MaterializedView },
                SfObject { schema: "PUBLIC".into(), name: "ext1".into(), kind: crate::SchemaNodeKind::ForeignTable },
            ],
            &[],
        );

        let kinds: Vec<_> = db.children[0].children.iter().map(|n| n.kind).collect();
        assert!(kinds.contains(&crate::SchemaNodeKind::Table));
        assert!(kinds.contains(&crate::SchemaNodeKind::View));
        assert!(kinds.contains(&crate::SchemaNodeKind::MaterializedView));
        assert!(kinds.contains(&crate::SchemaNodeKind::ForeignTable));
    }

    #[test]
    fn assemble_tree_empty_schemas_produces_empty_children() {
        let db = assemble_database_node("DB", &["PUBLIC".into()], &[], &[]);
        assert_eq!(db.children[0].children.len(), 0);
    }

    #[cfg(feature = "snowflake")]
    #[test]
    fn factory_returns_snowflake_driver() {
        let d = crate::driver_for_kind(crate::DatabaseKind::Snowflake);
        assert!(d.is_ok());
    }
}
