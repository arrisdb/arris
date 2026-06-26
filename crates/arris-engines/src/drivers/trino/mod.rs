mod api;
mod schema;
mod values;

use std::collections::HashMap;
use std::time::Instant;

use async_trait::async_trait;
use tokio::sync::Mutex;

use crate::drivers::errors::Result;
use crate::drivers::sql_builder::SqlBuilder;
use crate::drivers::{DatabaseDriver, PaginationStrategy};
use crate::{
    ConnectionConfig, DriverError, ExplainMode, MutationResult, PlanAttribute, PlanNode,
    PlanResult, QueryLanguage, QueryResult, QueryValue, RowDelete, RowInsert, SchemaNode,
    TableRef,
};

use api::TrinoApi;
use schema::{build_trino_schema, build_trino_schema_tree};
use values::response_to_query_result;

pub struct TrinoDriver {
    api: Mutex<Option<TrinoApi>>,
}

impl Default for TrinoDriver {
    fn default() -> Self {
        Self {
            api: Mutex::new(None),
        }
    }
}

impl TrinoDriver {
    pub fn new() -> Self {
        Self::default()
    }

    fn parse_options(options: &str) -> HashMap<String, String> {
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

    fn base_url(config: &ConnectionConfig) -> String {
        let scheme = if config.ssl_mode.forces_tls() { "https" } else { "http" };
        let port = if config.port == 0 { 8080 } else { config.port };
        format!("{scheme}://{}:{port}", config.host)
    }
}

#[async_trait]
impl DatabaseDriver for TrinoDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let opts = Self::parse_options(&config.options);
        let catalog = if config.database.is_empty() {
            None
        } else {
            Some(config.database.clone())
        };
        let schema = opts.get("schema").cloned();
        let password = if config.password.is_empty() {
            None
        } else {
            Some(config.password.clone())
        };

        let api = TrinoApi::new(
            Self::base_url(config),
            config.user.clone(),
            password,
            catalog,
            schema,
            config.ssl_mode,
            config.ca_cert_path.as_deref(),
        )?;

        // Trino has no login endpoint — verify reachability with a trivial query.
        api.query("SELECT 1").await?;

        *self.api.lock().await = Some(api);
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.api.lock().await.is_some()
    }

    fn select_like_keywords(&self) -> &'static [&'static str] {
        &["DESCRIBE", "DESC"]
    }

    fn pagination_strategy(&self) -> PaginationStrategy {
        // Trino requires OFFSET before LIMIT, unlike the default LIMIT/OFFSET form.
        PaginationStrategy::TrinoOffset
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        // Cheap: catalog (Database) nodes whose Schema children have empty
        // children. A schema's tables/views and their columns load on demand
        // via `list_schema` when the user selects it in the schema dropdown.
        let guard = self.api.lock().await;
        let api = guard.as_ref().ok_or(DriverError::NotConnected)?;
        build_trino_schema_tree(api).await
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        // The frontend passes a bare schema name (Trino's `extractSchemaNames`
        // returns each Schema node's name, not catalog-qualified). The same
        // name may exist under multiple catalogs, so this returns one populated
        // Schema node per matching catalog, each carrying the `{catalog}.{schema}`
        // path `list_schemas` produced so the frontend merges them by path.
        let guard = self.api.lock().await;
        let api = guard.as_ref().ok_or(DriverError::NotConnected)?;
        build_trino_schema(api, schema).await
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
            Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: Some(resp.update_count.unwrap_or(0)),
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

        let resp = api.query(&format!("EXPLAIN (FORMAT TEXT) {text}")).await?;

        let raw_lines: Vec<String> = resp
            .rows
            .iter()
            .filter_map(|r| r.first())
            .map(|c| match c {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .flat_map(|cell| cell.lines().map(str::to_owned).collect::<Vec<_>>())
            .collect();
        let raw = raw_lines.join("\n");

        let mut root = PlanNode::new("Query Plan", "query_plan");
        for (i, line) in raw_lines.iter().enumerate() {
            root.attributes.push(PlanAttribute::new(format!("L{i}"), line));
        }
        Ok(PlanResult::new(root, mode, raw))
    }

    async fn primary_key(&self, _table: &TableRef) -> Result<Option<Vec<String>>> {
        // Trino connectors do not expose enforced primary keys.
        Ok(None)
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
        let r = self.run_query(&interpolated, &[], QueryLanguage::Native).await?;
        Ok(MutationResult {
            rows_affected: r.rows_affected.unwrap_or(0) as usize,
            statements: vec![interpolated],
        })
    }

    async fn insert_rows(&self, table: &TableRef, inserts: &[RowInsert]) -> Result<MutationResult> {
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
            let r = self.run_query(&interpolated, &[], QueryLanguage::Native).await?;
            result.rows_affected += r.rows_affected.unwrap_or(0) as usize;
            result.statements.push(interpolated);
        }
        Ok(result)
    }

    async fn delete_rows(&self, table: &TableRef, deletes: &[RowDelete]) -> Result<MutationResult> {
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
            let r = self.run_query(&interpolated, &[], QueryLanguage::Native).await?;
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

    fn cfg(host: &str, port: u16, tls: bool) -> ConnectionConfig {
        let mut c = ConnectionConfig::new("trino", crate::DatabaseKind::Trino);
        c.host = host.into();
        c.port = port;
        c.ssl_mode = if tls { crate::SslMode::Required } else { crate::SslMode::Disabled };
        c
    }

    #[test]
    fn parse_options_extracts_schema() {
        let opts = TrinoDriver::parse_options("schema=default&foo=bar");
        assert_eq!(opts.get("schema").unwrap(), "default");
        assert_eq!(opts.get("foo").unwrap(), "bar");
    }

    #[test]
    fn parse_options_empty_is_empty() {
        assert!(TrinoDriver::parse_options("").is_empty());
    }

    #[test]
    fn base_url_uses_http_by_default() {
        assert_eq!(TrinoDriver::base_url(&cfg("trino.local", 8080, false)), "http://trino.local:8080");
    }

    #[test]
    fn base_url_uses_https_with_tls() {
        assert_eq!(TrinoDriver::base_url(&cfg("trino.local", 8443, true)), "https://trino.local:8443");
    }

    #[test]
    fn base_url_falls_back_to_8080_when_port_zero() {
        assert_eq!(TrinoDriver::base_url(&cfg("h", 0, false)), "http://h:8080");
    }

    #[tokio::test]
    async fn driver_starts_disconnected() {
        let d = TrinoDriver::new();
        assert!(!d.is_connected().await);
    }

    #[test]
    fn pagination_strategy_is_trino_offset() {
        assert_eq!(TrinoDriver::new().pagination_strategy(), PaginationStrategy::TrinoOffset);
    }

    #[test]
    fn looks_like_select_handles_trino_keywords() {
        let d = TrinoDriver::new();
        assert!(d.looks_like_select("SELECT 1"));
        assert!(d.looks_like_select("SHOW CATALOGS"));
        assert!(d.looks_like_select("DESCRIBE memory.default.users"));
        assert!(d.looks_like_select("DESC memory.default.users"));
        assert!(d.looks_like_select("EXPLAIN SELECT 1"));
        assert!(d.looks_like_select("WITH x AS (SELECT 1) SELECT * FROM x"));
        assert!(!d.looks_like_select("INSERT INTO t VALUES (1)"));
        assert!(!d.looks_like_select("DELETE FROM t WHERE id = 1"));
        assert!(!d.looks_like_select("CREATE TABLE t(x int)"));
    }

    #[cfg(feature = "trino")]
    #[test]
    fn factory_returns_trino_driver() {
        let d = crate::driver_for_kind(crate::DatabaseKind::Trino);
        assert!(d.is_ok());
    }
}
