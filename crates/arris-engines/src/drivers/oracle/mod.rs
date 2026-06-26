mod config;
mod definition;
mod values;

use std::time::Instant;

use async_trait::async_trait;
use indexmap::IndexMap;
use oracle_rs::{Config, Connection};
use tokio::sync::Mutex;

use crate::{
    ColumnSpec, ConnectionConfig, DriverError, ExplainMode, MutationResult, ObjectRef,
    PaginationStrategy, PlanAttribute, PlanNode, PlanResult, QueryLanguage, QueryResult,
    QueryValue, RowDelete, RowInsert, SchemaNode, SchemaNodeKind, TableRef,
};
use crate::drivers::errors::Result;

use crate::drivers::sql_builder::SqlBuilder;

use crate::drivers::DatabaseDriver;

use config::build_config;
use values::{oracle_value_to_query, query_value_to_oracle};

const EXCLUDED_SCHEMAS: &str = "'SYS','SYSTEM','OUTLN','DIP','ORACLE_OCM','DBSNMP',\
    'APPQOSSYS','WMSYS','EXFSYS','CTXSYS','XDB','ANONYMOUS','ORDSYS','ORDDATA',\
    'ORDPLUGINS','SI_INFORMTN_SCHEMA','MDSYS','OLAPSYS','MDDATA',\
    'SPATIAL_WFS_ADMIN_USR','SPATIAL_CSW_ADMIN_USR','FLOWS_FILES','APEX_PUBLIC_USER',\
    'APEX_040000','OWBSYS','OWBSYS_AUDIT'";

pub struct OracleDriver {
    inner: Mutex<Option<Connection>>,
    cancel_config: Mutex<Option<Config>>,
    service_name: Mutex<String>,
    /// Whether a manual transaction is currently open. Oracle is always
    /// implicitly transactional; in Auto mode each DML statement is committed
    /// immediately, in Manual mode commits are deferred until an explicit
    /// `commit_transaction`/`rollback_transaction`.
    in_tx: Mutex<bool>,
}

impl Default for OracleDriver {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            cancel_config: Mutex::new(None),
            service_name: Mutex::new(String::new()),
            in_tx: Mutex::new(false),
        }
    }
}

impl OracleDriver {
    pub fn new() -> Self {
        Self::default()
    }

    async fn reconnect(&self) -> Result<()> {
        let cfg = self.cancel_config.lock().await.clone()
            .ok_or(DriverError::NotConnected)?;
        let conn = Connection::connect_with_config(cfg)
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
        *self.inner.lock().await = Some(conn);
        Ok(())
    }

    fn is_connection_error(msg: &str) -> bool {
        let m = msg.to_lowercase();
        m.contains("connection closed") || m.contains("closed the connection")
            || m.contains("broken pipe")
    }

    async fn run_query_inner(
        &self,
        text: &str,
        params: &[QueryValue],
    ) -> Result<QueryResult> {
        let guard = self.inner.lock().await;
        let conn = guard.as_ref().ok_or(DriverError::NotConnected)?;
        let started = Instant::now();

        let oracle_params: Vec<_> = params.iter().map(query_value_to_oracle).collect();

        if self.looks_like_select(text) {
            let result = conn
                .query(text, &oracle_params)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            let columns: Vec<ColumnSpec> = result
                .columns
                .iter()
                .map(|c| ColumnSpec::new(&c.name, &format!("{:?}", c.oracle_type)))
                .collect();

            let rows: Vec<Vec<QueryValue>> = result
                .rows
                .into_iter()
                .map(|row| row.into_values().into_iter().map(oracle_value_to_query).collect())
                .collect();

            Ok(QueryResult {
                columns,
                rows,
                rows_affected: None,
                elapsed: started.elapsed().as_secs_f64(),
                ..Default::default()
            })
        } else {
            // oracle-rs binds Value::String as CLOB which Oracle Free rejects
            // in DML. Inline params into the SQL to avoid LOB binding.
            let final_sql = if params.is_empty() {
                text.to_owned()
            } else {
                SqlBuilder::interpolate_params(text, params)
            };
            conn.execute(&final_sql, &[])
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            // oracle-rs does not auto-commit DML. Outside a manual transaction we
            // emulate autocommit so changes persist; inside one we defer to the
            // explicit commit/rollback.
            if !*self.in_tx.lock().await {
                conn.commit()
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            }

            Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: Some(1),
                elapsed: started.elapsed().as_secs_f64(),
                ..Default::default()
            })
        }
    }

    /// Run a `SELECT` with a single bound `:1` parameter, reconnecting once on a
    /// dropped connection. Used by `list_schema` to filter to one owner.
    async fn query_bound(
        &self,
        sql: &str,
        param: &QueryValue,
    ) -> Result<oracle_rs::QueryResult> {
        let result = {
            let guard = self.inner.lock().await;
            let conn = guard.as_ref().ok_or(DriverError::NotConnected)?;
            conn.query(sql, &[query_value_to_oracle(param)]).await
        };
        match result {
            Ok(r) => Ok(r),
            Err(e) => {
                let msg = e.to_string();
                if Self::is_connection_error(&msg) {
                    self.reconnect().await?;
                    let guard = self.inner.lock().await;
                    let conn = guard.as_ref().ok_or(DriverError::NotConnected)?;
                    conn.query(sql, &[query_value_to_oracle(param)])
                        .await
                        .map_err(|e| DriverError::QueryFailed(e.to_string()))
                } else {
                    Err(DriverError::QueryFailed(msg))
                }
            }
        }
    }

    async fn query_with_retry(
        &self,
        sql: &str,
    ) -> Result<oracle_rs::QueryResult> {
        let result = {
            let guard = self.inner.lock().await;
            let conn = guard.as_ref().ok_or(DriverError::NotConnected)?;
            conn.query(sql, &[]).await
        };
        match result {
            Ok(r) => Ok(r),
            Err(e) => {
                let msg = e.to_string();
                if Self::is_connection_error(&msg) {
                    self.reconnect().await?;
                    let guard = self.inner.lock().await;
                    let conn = guard.as_ref().ok_or(DriverError::NotConnected)?;
                    conn.query(sql, &[])
                        .await
                        .map_err(|e| DriverError::QueryFailed(e.to_string()))
                } else {
                    Err(DriverError::QueryFailed(msg))
                }
            }
        }
    }
}

#[async_trait]
impl DatabaseDriver for OracleDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        // TLS: Oracle's TCPS transport authenticates with an Oracle wallet
        // (cwallet.sso / sqlnet.ora) rather than standalone PEM files, so the
        // ca/client cert/key paths are not applied for Oracle.
        let cfg = build_config(config);
        let conn = Connection::connect_with_config(cfg.clone())
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        let service = if config.database.is_empty() {
            "FREEPDB1".to_owned()
        } else {
            config.database.clone()
        };

        *self.cancel_config.lock().await = Some(cfg);
        *self.service_name.lock().await = service;
        *self.inner.lock().await = Some(conn);
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let service = self.service_name.lock().await.clone();

        // Cheap: list schema (owner) containers only. A schema's tables,
        // columns, views, routines, sequences, types, triggers, and indexes
        // load on demand via `list_schema` when the user selects it.
        let schema_result = self.query_with_retry(&format!(
            "SELECT USERNAME FROM ALL_USERS \
             WHERE USERNAME NOT IN ({EXCLUDED_SCHEMAS}) ORDER BY USERNAME"
        )).await?;

        let schema_nodes: Vec<SchemaNode> = schema_result
            .rows
            .iter()
            .filter_map(|row| row.get(0).and_then(|v| v.as_str()))
            .map(|owner| {
                let path = format!("{service}.{owner}");
                SchemaNode::new(owner, SchemaNodeKind::Schema, path)
            })
            .collect();

        Ok(vec![
            SchemaNode::new(service.clone(), SchemaNodeKind::Database, service)
                .with_children(schema_nodes),
        ])
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let service = self.service_name.lock().await.clone();
        // Oracle owner names are case-sensitive uppercase identifiers. The
        // schema arg is the owner exactly as `list_schemas` surfaced it; bind
        // it as `:1` without re-casing, matching the file's bind style.
        let owner = QueryValue::Text(schema.to_owned());

        let table_result = self.query_bound(
            "SELECT TABLE_NAME FROM ALL_TABLES \
             WHERE OWNER = :1 \
               AND (OWNER, TABLE_NAME) NOT IN (SELECT OWNER, MVIEW_NAME FROM ALL_MVIEWS) \
             ORDER BY TABLE_NAME",
            &owner,
        ).await.unwrap_or_else(|_| oracle_rs::QueryResult::empty());

        let view_result = self.query_bound(
            "SELECT VIEW_NAME FROM ALL_VIEWS \
             WHERE OWNER = :1 ORDER BY VIEW_NAME",
            &owner,
        ).await.unwrap_or_else(|_| oracle_rs::QueryResult::empty());

        let mview_result = self.query_bound(
            "SELECT MVIEW_NAME FROM ALL_MVIEWS \
             WHERE OWNER = :1 ORDER BY MVIEW_NAME",
            &owner,
        ).await.unwrap_or_else(|_| oracle_rs::QueryResult::empty());

        let routine_result = self.query_bound(
            "SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_PROCEDURES \
             WHERE OWNER = :1 \
               AND OBJECT_TYPE IN ('PROCEDURE','FUNCTION') \
               AND PROCEDURE_NAME IS NULL \
             ORDER BY OBJECT_NAME",
            &owner,
        ).await.unwrap_or_else(|_| oracle_rs::QueryResult::empty());

        let seq_result = self.query_bound(
            "SELECT SEQUENCE_NAME FROM ALL_SEQUENCES \
             WHERE SEQUENCE_OWNER = :1 ORDER BY SEQUENCE_NAME",
            &owner,
        ).await.unwrap_or_else(|_| oracle_rs::QueryResult::empty());

        let type_result = self.query_bound(
            "SELECT TYPE_NAME FROM ALL_TYPES \
             WHERE OWNER = :1 ORDER BY TYPE_NAME",
            &owner,
        ).await.unwrap_or_else(|_| oracle_rs::QueryResult::empty());

        let trigger_result = self.query_bound(
            "SELECT TRIGGER_NAME FROM ALL_TRIGGERS \
             WHERE OWNER = :1 ORDER BY TRIGGER_NAME",
            &owner,
        ).await.unwrap_or_else(|_| oracle_rs::QueryResult::empty());

        let index_result = self.query_bound(
            "SELECT INDEX_NAME FROM ALL_INDEXES \
             WHERE OWNER = :1 AND INDEX_TYPE != 'LOB' \
             ORDER BY INDEX_NAME",
            &owner,
        ).await.unwrap_or_else(|_| oracle_rs::QueryResult::empty());

        let col_result = self.query_bound(
            "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, NULLABLE \
             FROM ALL_TAB_COLUMNS \
             WHERE OWNER = :1 \
             ORDER BY TABLE_NAME, COLUMN_ID",
            &owner,
        ).await.unwrap_or_else(|_| oracle_rs::QueryResult::empty());

        let mut objs: IndexMap<String, SchemaNode> = IndexMap::new();
        let mut insert_node =
            |name: &str, kind: SchemaNodeKind, key: String| {
                let path = format!("{service}.{schema}.{name}");
                objs.entry(key)
                    .or_insert_with(|| SchemaNode::new(name, kind, path));
            };

        for row in &table_result.rows {
            let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default();
            insert_node(name, SchemaNodeKind::Table, name.to_owned());
        }
        for row in &view_result.rows {
            let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default();
            insert_node(name, SchemaNodeKind::View, name.to_owned());
        }
        for row in &mview_result.rows {
            let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default();
            insert_node(name, SchemaNodeKind::MaterializedView, name.to_owned());
        }
        for row in &routine_result.rows {
            let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default();
            let kind_str = row.get(1).and_then(|v| v.as_str()).unwrap_or_default();
            let node_kind = if kind_str == "PROCEDURE" {
                SchemaNodeKind::Procedure
            } else {
                SchemaNodeKind::Function
            };
            insert_node(name, node_kind, format!("fn:{name}"));
        }
        for row in &seq_result.rows {
            let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default();
            insert_node(name, SchemaNodeKind::Sequence, format!("seq:{name}"));
        }
        for row in &type_result.rows {
            let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default();
            insert_node(name, SchemaNodeKind::Type, format!("type:{name}"));
        }
        for row in &trigger_result.rows {
            let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default();
            insert_node(name, SchemaNodeKind::Trigger, format!("trg:{name}"));
        }
        for row in &index_result.rows {
            let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default();
            insert_node(name, SchemaNodeKind::Index, format!("idx:{name}"));
        }

        for row in &col_result.rows {
            let table = row.get(0).and_then(|v| v.as_str()).unwrap_or_default().to_owned();
            let col = row.get(1).and_then(|v| v.as_str()).unwrap_or_default().to_owned();
            let data_type = row.get(2).and_then(|v| v.as_str()).unwrap_or_default().to_owned();
            let nullable = row.get(3).and_then(|v| v.as_str()).unwrap_or_default().to_owned();
            let detail = if nullable == "N" {
                format!("{data_type} NOT NULL")
            } else {
                data_type
            };
            if let Some(node) = objs.get_mut(&table) {
                let col_path = format!("{}.{}", node.path, col);
                node.children.push(
                    SchemaNode::new(&col, SchemaNodeKind::Column, col_path)
                        .with_detail(detail),
                );
            }
        }

        let path = format!("{service}.{schema}");
        Ok(vec![
            SchemaNode::new(schema, SchemaNodeKind::Schema, path)
                .with_children(objs.into_values().collect()),
        ])
    }

    fn select_like_keywords(&self) -> &'static [&'static str] {
        &["DESCRIBE", "DESC"]
    }

    fn supports_transactions(&self) -> bool {
        true
    }

    async fn in_transaction(&self) -> bool {
        *self.in_tx.lock().await
    }

    async fn begin_transaction(&self, isolation: crate::IsolationLevel) -> Result<()> {
        // Oracle has no `BEGIN`: it is always implicitly in a transaction. Entering
        // manual mode just closes any prior implicit transaction cleanly and pins
        // the isolation level for the next one. Oracle has no Repeatable Read, so
        // it maps to the stricter Serializable.
        let oracle_level = match isolation {
            crate::IsolationLevel::Default => None,
            crate::IsolationLevel::ReadCommitted => Some("READ COMMITTED"),
            crate::IsolationLevel::RepeatableRead | crate::IsolationLevel::Serializable => {
                Some("SERIALIZABLE")
            }
        };
        {
            let guard = self.inner.lock().await;
            let conn = guard.as_ref().ok_or(DriverError::NotConnected)?;
            conn.commit()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            if let Some(level) = oracle_level {
                conn.execute(&format!("SET TRANSACTION ISOLATION LEVEL {level}"), &[])
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            }
        }
        *self.in_tx.lock().await = true;
        Ok(())
    }

    async fn commit_transaction(&self) -> Result<()> {
        {
            let guard = self.inner.lock().await;
            let conn = guard.as_ref().ok_or(DriverError::NotConnected)?;
            conn.commit()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        }
        *self.in_tx.lock().await = false;
        Ok(())
    }

    async fn rollback_transaction(&self) -> Result<()> {
        {
            let guard = self.inner.lock().await;
            let conn = guard.as_ref().ok_or(DriverError::NotConnected)?;
            conn.rollback()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        }
        *self.in_tx.lock().await = false;
        Ok(())
    }

    async fn run_query(
        &self,
        text: &str,
        params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        let result = self.run_query_inner(text, params).await;
        match &result {
            Err(DriverError::QueryFailed(msg)) if Self::is_connection_error(msg) => {
                self.reconnect().await?;
                self.run_query_inner(text, params).await
            }
            _ => result,
        }
    }

    async fn explain_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
        mode: ExplainMode,
    ) -> Result<PlanResult> {
        // `PLAN_TABLE.STATEMENT_ID` is `VARCHAR2(30)`; keep the id well under that
        // (a 32-char uuid would overflow and reset the connection).
        let plan_id = format!("p{}", &uuid::Uuid::new_v4().simple().to_string()[..24]);
        // The thin driver resets the connection on a bare `EXPLAIN PLAN`
        // statement, so issue it through an anonymous PL/SQL block instead. The
        // inner statement's single quotes are doubled for the string literal.
        let inner = format!("EXPLAIN PLAN SET STATEMENT_ID = '{plan_id}' FOR {text}");
        let explain_sql = format!("BEGIN EXECUTE IMMEDIATE '{}'; END;", inner.replace('\'', "''"));

        self.run_query(&explain_sql, &[], QueryLanguage::Native).await?;

        let fetch_sql = format!(
            "SELECT LPAD(' ', 2 * (LEVEL - 1)) || OPERATION || ' ' || OPTIONS || \
             DECODE(OBJECT_NAME, NULL, '', ' ON ' || OBJECT_NAME) AS PLAN_LINE \
             FROM PLAN_TABLE WHERE STATEMENT_ID = '{plan_id}' \
             START WITH ID = 0 CONNECT BY PRIOR ID = PARENT_ID \
             ORDER SIBLINGS BY POSITION"
        );

        let result = self.run_query(&fetch_sql, &[], QueryLanguage::Native).await?;

        let raw_lines: Vec<String> = result
            .rows
            .iter()
            .filter_map(|row| {
                if let QueryValue::Text(s) = &row[0] {
                    Some(s.clone())
                } else {
                    None
                }
            })
            .collect();
        let raw = raw_lines.join("\n");

        let mut root = PlanNode::new("Query Plan", "query_plan");
        for (i, line) in raw_lines.iter().enumerate() {
            root.attributes
                .push(PlanAttribute::new(format!("L{i}"), line));
        }

        let _ = self
            .run_query(
                &format!("DELETE FROM PLAN_TABLE WHERE STATEMENT_ID = '{plan_id}'"),
                &[],
                QueryLanguage::Native,
            )
            .await;

        Ok(PlanResult::new(root, mode, raw))
    }

    async fn primary_key(&self, table: &TableRef) -> Result<Option<Vec<String>>> {
        let guard = self.inner.lock().await;
        let conn = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let schema = table
            .schema
            .as_deref()
            .or(table.database.as_deref())
            .unwrap_or("SYSTEM");
        let escaped_schema = schema.replace('\'', "''").to_uppercase();
        let escaped_table = table.name.replace('\'', "''").to_uppercase();

        let sql = format!(
            "SELECT cols.COLUMN_NAME \
             FROM ALL_CONSTRAINTS cons \
             JOIN ALL_CONS_COLUMNS cols ON cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME \
               AND cons.OWNER = cols.OWNER \
             WHERE cons.CONSTRAINT_TYPE = 'P' \
               AND cons.OWNER = '{escaped_schema}' \
               AND cons.TABLE_NAME = '{escaped_table}' \
             ORDER BY cols.POSITION"
        );

        let result = conn
            .query(&sql, &[])
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let cols: Vec<String> = result
            .rows
            .iter()
            .filter_map(|row| row.get(0).and_then(|v| v.as_str()).map(|s| s.to_owned()))
            .collect();
        Ok(if cols.is_empty() { None } else { Some(cols) })
    }

    async fn object_definition(&self, object: &ObjectRef) -> Result<String> {
        self.object_definition_inner(object).await
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &crate::ValueMap,
        changes: &crate::ValueMap,
    ) -> Result<MutationResult> {
        let (sql, params) = SqlBuilder::build_update(table, primary_key, changes, SqlBuilder::quote_none, SqlBuilder::placeholder_colon_n)
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
                SqlBuilder::build_insert(table, &ins.values, SqlBuilder::quote_none, SqlBuilder::placeholder_colon_n)
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
                SqlBuilder::build_delete(table, &del.primary_key, SqlBuilder::quote_none, SqlBuilder::placeholder_colon_n)
                    .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let r = self.run_query(&sql, &params, QueryLanguage::Native).await?;
            result.rows_affected += r.rows_affected.unwrap_or(0) as usize;
            result.statements.push(SqlBuilder::interpolate_params(&sql, &params));
        }
        Ok(result)
    }

    fn pagination_strategy(&self) -> PaginationStrategy {
        PaginationStrategy::OracleOffset
    }

    async fn cancel_running_query(&self) -> Result<()> {
        Ok(())
    }

    async fn close(&self) {
        *self.cancel_config.lock().await = None;
        *self.service_name.lock().await = String::new();
        let _ = self.inner.lock().await.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_like_select_handles_common_keywords() {
        let d = OracleDriver::new();
        assert!(d.looks_like_select("SELECT 1 FROM DUAL"));
        assert!(d.looks_like_select("  WITH x AS (SELECT 1 FROM DUAL) SELECT * FROM x"));
        assert!(d.looks_like_select("DESCRIBE users"));
        assert!(d.looks_like_select("DESC users"));
        assert!(!d.looks_like_select("INSERT INTO t VALUES (1)"));
        assert!(!d.looks_like_select("UPDATE t SET x=1"));
        assert!(!d.looks_like_select("DELETE FROM t WHERE id=1"));
        assert!(!d.looks_like_select("CREATE TABLE t(x NUMBER)"));
    }

    #[tokio::test]
    async fn driver_starts_disconnected() {
        let d = OracleDriver::new();
        assert!(!d.is_connected().await);
    }

    #[test]
    fn build_config_with_all_fields() {
        let mut cfg = ConnectionConfig::new("local", crate::DatabaseKind::Oracle);
        cfg.host = "db.example.com".into();
        cfg.port = 1522;
        cfg.database = "ORCLPDB1".into();
        cfg.user = "scott".into();
        cfg.password = "tiger".into();
        let _oc = build_config(&cfg);
    }

    #[test]
    fn build_config_defaults() {
        let cfg = ConnectionConfig::new("local", crate::DatabaseKind::Oracle);
        let _oc = build_config(&cfg);
    }

    #[test]
    fn excluded_schemas_contains_sys() {
        assert!(EXCLUDED_SCHEMAS.contains("'SYS'"));
        assert!(EXCLUDED_SCHEMAS.contains("'SYSTEM'"));
    }

    #[tokio::test]
    async fn default_driver_has_empty_service_name() {
        let d = OracleDriver::new();
        assert!(d.service_name.lock().await.is_empty());
    }

    #[cfg(feature = "oracle")]
    #[test]
    fn factory_returns_oracle_driver() {
        let d = crate::driver_for_kind(crate::DatabaseKind::Oracle);
        assert!(d.is_ok());
    }
}
