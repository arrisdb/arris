mod config;
mod definition;
mod query;
mod schema;
mod values;

use std::time::Instant;

use async_trait::async_trait;
use tiberius::{Client, Column, Config, Row};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::Compat;

use crate::{
    ConnectionConfig, DriverError, ExplainMode, MutationResult, ObjectRef, PlanAttribute, PlanNode,
    PlanResult, QueryLanguage, QueryResult, QueryValue, RowDelete, RowInsert, SchemaNode,
    TableRef,
};
use crate::drivers::errors::Result;

use crate::drivers::DatabaseDriver;
use crate::drivers::sql_builder::SqlBuilder;

use config::{build_config, connect_tcp};
use query::rows_to_query_result;
use schema::{MssqlColumn, MssqlObject, MssqlSchema, build_mssql_schema_tree, mssql_kind_from_catalog};
use values::{SqlParam, ToSql};

type MssqlClient = Client<Compat<TcpStream>>;

pub struct MssqlDriver {
    inner: Mutex<Option<MssqlClient>>,
    /// SPID of the main connection, stored separately for cancel.
    spid: Mutex<Option<u16>>,
    /// Config clone for opening an ephemeral cancel connection.
    cancel_config: Mutex<Option<Config>>,
    /// Whether a manual transaction is currently open on the pinned client.
    in_tx: Mutex<bool>,
}

impl Default for MssqlDriver {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            spid: Mutex::new(None),
            cancel_config: Mutex::new(None),
            in_tx: Mutex::new(false),
        }
    }
}

impl MssqlDriver {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl DatabaseDriver for MssqlDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let cfg = build_config(config);
        let mut client = connect_tcp(&cfg).await?;

        // Retrieve SPID for cancel support.
        let spid: Option<u16> = {
            let stream = client.simple_query("SELECT @@SPID").await.ok();
            if let Some(stream) = stream {
                let results = stream.into_results().await.ok();
                results
                    .and_then(|r| r.into_iter().flatten().next())
                    .and_then(|row| row.get::<i16, _>(0))
                    .map(|v| v as u16)
            } else {
                None
            }
        };

        *self.spid.lock().await = spid;
        *self.cancel_config.lock().await = Some(cfg);
        *self.inner.lock().await = Some(client);
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    fn select_like_keywords(&self) -> &'static [&'static str] {
        &["EXEC", "EXECUTE", "SP_HELP", "DBCC"]
    }

    fn pagination_strategy(&self) -> crate::PaginationStrategy {
        crate::PaginationStrategy::SqlServerOffset
    }

    fn supports_transactions(&self) -> bool {
        true
    }

    async fn in_transaction(&self) -> bool {
        *self.in_tx.lock().await
    }

    async fn begin_transaction(&self, isolation: crate::IsolationLevel) -> Result<()> {
        let mut guard = self.inner.lock().await;
        let client = guard.as_mut().ok_or(DriverError::NotConnected)?;
        // `SET TRANSACTION ISOLATION LEVEL` applies to the connection from here
        // on; pair it with `BEGIN TRAN` in one batch. SNAPSHOT is out of scope.
        let sql = match isolation.sql_name() {
            Some(level) => format!("SET TRANSACTION ISOLATION LEVEL {level}; BEGIN TRAN"),
            None => "BEGIN TRAN".to_owned(),
        };
        client
            .simple_query(sql)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .into_results()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        drop(guard);
        *self.in_tx.lock().await = true;
        Ok(())
    }

    async fn commit_transaction(&self) -> Result<()> {
        let mut guard = self.inner.lock().await;
        let client = guard.as_mut().ok_or(DriverError::NotConnected)?;
        client
            .simple_query("COMMIT TRAN")
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .into_results()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        drop(guard);
        *self.in_tx.lock().await = false;
        Ok(())
    }

    async fn rollback_transaction(&self) -> Result<()> {
        let mut guard = self.inner.lock().await;
        let client = guard.as_mut().ok_or(DriverError::NotConnected)?;
        client
            .simple_query("ROLLBACK TRAN")
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .into_results()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        drop(guard);
        *self.in_tx.lock().await = false;
        Ok(())
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let mut guard = self.inner.lock().await;
        let client = guard.as_mut().ok_or(DriverError::NotConnected)?;

        let current_database_rows = client
            .simple_query("SELECT DB_NAME()")
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .into_results()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let current_database = current_database_rows
            .into_iter()
            .flatten()
            .find_map(|r| r.get::<&str, _>(0).map(|s| s.to_owned()))
            .unwrap_or_else(|| "database".to_owned());

        let database_rows = client
            .simple_query(
                "SELECT name \
                 FROM sys.databases \
                 WHERE state_desc = 'ONLINE' \
                   AND HAS_DBACCESS(name) = 1 \
                   AND name NOT IN ('master','model','msdb','tempdb') \
                 ORDER BY name",
            )
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .into_results()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let mut databases: Vec<String> = database_rows
            .into_iter()
            .flatten()
            .filter_map(|r| r.get::<&str, _>(0).map(|s| s.to_owned()))
            .collect();
        if databases.is_empty() {
            databases.push(current_database);
        }

        // Lazy: containers only. Each schema's tables, views, routines,
        // sequences, types, triggers, and indexes (with columns) load on demand
        // via `list_schema` when the user selects the schema in the dropdown.
        let mut schemas = Vec::new();
        for database in &databases {
            let db = SqlBuilder::quote_bracket(database);
            let schema_rows = client
                .simple_query(&format!(
                    "SELECT s.name \
                     FROM {db}.sys.schemas s \
                     WHERE s.name NOT IN ('sys','INFORMATION_SCHEMA','guest','db_owner',\
                       'db_accessadmin','db_securityadmin','db_ddladmin','db_backupoperator',\
                       'db_datareader','db_datawriter','db_denydatareader','db_denydatawriter') \
                     ORDER BY s.name"
                ))
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?
                .into_results()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            schemas.extend(schema_rows.into_iter().flatten().filter_map(|r| {
                Some(MssqlSchema {
                    database: database.clone(),
                    name: r.get::<&str, _>(0)?.to_owned(),
                })
            }));
        }

        Ok(build_mssql_schema_tree(
            databases,
            schemas,
            Vec::new(),
            Vec::new(),
        ))
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let mut guard = self.inner.lock().await;
        let client = guard.as_mut().ok_or(DriverError::NotConnected)?;

        // The dropdown selection is a bare schema name (e.g. `dbo`). The same
        // name can exist in more than one database, so resolve the databases
        // and emit a populated Schema node per `{database}.{schema}` match —
        // each carries the same path `list_schemas` produced, so the frontend
        // grafts it in by path.
        let database_rows = client
            .simple_query(
                "SELECT name \
                 FROM sys.databases \
                 WHERE state_desc = 'ONLINE' \
                   AND HAS_DBACCESS(name) = 1 \
                   AND name NOT IN ('master','model','msdb','tempdb') \
                 ORDER BY name",
            )
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .into_results()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let mut databases: Vec<String> = database_rows
            .into_iter()
            .flatten()
            .filter_map(|r| r.get::<&str, _>(0).map(|s| s.to_owned()))
            .collect();
        if databases.is_empty() {
            let current_database_rows = client
                .simple_query("SELECT DB_NAME()")
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?
                .into_results()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            if let Some(name) = current_database_rows
                .into_iter()
                .flatten()
                .find_map(|r| r.get::<&str, _>(0).map(|s| s.to_owned()))
            {
                databases.push(name);
            }
        }

        let mut nodes = Vec::new();
        for database in &databases {
            let db = SqlBuilder::quote_bracket(database);
            let params: [&dyn ToSql; 1] = [&schema];

            // Confirm the schema exists in this database before fetching its
            // contents, so non-matching databases don't yield an empty node.
            let schema_rows = client
                .query(
                    &format!("SELECT s.name FROM {db}.sys.schemas s WHERE s.name = @P1"),
                    &params,
                )
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?
                .into_results()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            if schema_rows.into_iter().flatten().next().is_none() {
                continue;
            }

            let object_rows = client
                .query(
                    &format!(
                        "SELECT s.name AS schema_name, t.name AS object_name, 'table' AS kind \
                         FROM {db}.sys.tables t \
                         JOIN {db}.sys.schemas s ON t.schema_id = s.schema_id \
                         WHERE t.is_ms_shipped = 0 AND s.name = @P1 \
                         UNION ALL \
                         SELECT s.name, v.name, 'view' \
                         FROM {db}.sys.views v \
                         JOIN {db}.sys.schemas s ON v.schema_id = s.schema_id \
                         WHERE v.is_ms_shipped = 0 AND s.name = @P1 \
                         UNION ALL \
                         SELECT s.name, p.name, 'procedure' \
                         FROM {db}.sys.procedures p \
                         JOIN {db}.sys.schemas s ON p.schema_id = s.schema_id \
                         WHERE p.is_ms_shipped = 0 AND s.name = @P1 \
                         UNION ALL \
                         SELECT s.name, o.name, 'function' \
                         FROM {db}.sys.objects o \
                         JOIN {db}.sys.schemas s ON o.schema_id = s.schema_id \
                         WHERE o.type IN ('FN','IF','TF','FS','FT') \
                           AND o.is_ms_shipped = 0 AND s.name = @P1 \
                         UNION ALL \
                         SELECT s.name, seq.name, 'sequence' \
                         FROM {db}.sys.sequences seq \
                         JOIN {db}.sys.schemas s ON seq.schema_id = s.schema_id \
                         WHERE s.name = @P1 \
                         UNION ALL \
                         SELECT s.name, ty.name, 'type' \
                         FROM {db}.sys.types ty \
                         JOIN {db}.sys.schemas s ON ty.schema_id = s.schema_id \
                         WHERE (ty.is_user_defined = 1 OR ty.is_table_type = 1) \
                           AND ty.is_assembly_type = 0 AND s.name = @P1 \
                         UNION ALL \
                         SELECT COALESCE(s.name, 'dbo'), tr.name, 'trigger' \
                         FROM {db}.sys.triggers tr \
                         LEFT JOIN {db}.sys.objects o ON tr.parent_id = o.object_id \
                         LEFT JOIN {db}.sys.schemas s ON o.schema_id = s.schema_id \
                         WHERE tr.is_ms_shipped = 0 AND COALESCE(s.name, 'dbo') = @P1 \
                         UNION ALL \
                         SELECT s.name, CONCAT(o.name, '.', i.name), 'index' \
                         FROM {db}.sys.indexes i \
                         JOIN {db}.sys.objects o ON i.object_id = o.object_id \
                         JOIN {db}.sys.schemas s ON o.schema_id = s.schema_id \
                         WHERE i.index_id > 0 \
                           AND i.name IS NOT NULL \
                           AND i.is_hypothetical = 0 \
                           AND o.is_ms_shipped = 0 \
                           AND o.type IN ('U','V') AND s.name = @P1 \
                         ORDER BY schema_name, kind, object_name"
                    ),
                    &params,
                )
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?
                .into_results()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            let objects: Vec<MssqlObject> = object_rows
                .into_iter()
                .flatten()
                .filter_map(|row| {
                    let object_schema = row.get::<&str, _>(0)?.to_owned();
                    let name = row.get::<&str, _>(1)?.to_owned();
                    let kind = mssql_kind_from_catalog(row.get::<&str, _>(2)?)?;
                    Some(MssqlObject {
                        database: database.clone(),
                        schema: object_schema,
                        name,
                        kind,
                    })
                })
                .collect();

            let col_rows = client
                .query(
                    &format!(
                        "SELECT s.name, o.name, c.name, ty.name, c.is_nullable, c.column_id \
                         FROM {db}.sys.columns c \
                         JOIN {db}.sys.objects o ON c.object_id = o.object_id \
                         JOIN {db}.sys.schemas s ON o.schema_id = s.schema_id \
                         JOIN {db}.sys.types ty ON c.user_type_id = ty.user_type_id \
                         WHERE o.type IN ('U','V') \
                           AND o.is_ms_shipped = 0 AND s.name = @P1 \
                         ORDER BY s.name, o.name, c.column_id"
                    ),
                    &params,
                )
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?
                .into_results()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            let columns: Vec<MssqlColumn> = col_rows
                .into_iter()
                .flatten()
                .filter_map(|row| {
                    Some(MssqlColumn {
                        database: database.clone(),
                        schema: row.get::<&str, _>(0)?.to_owned(),
                        object: row.get::<&str, _>(1)?.to_owned(),
                        name: row.get::<&str, _>(2)?.to_owned(),
                        data_type: row.get::<&str, _>(3)?.to_owned(),
                        nullable: row.get::<bool, _>(4).unwrap_or(true),
                    })
                })
                .collect();

            // Build the full tree for this single database/schema, then unwrap
            // the bare Schema node so the returned path is `{database}.{schema}`
            // — identical to what `list_schemas` produced for the container.
            let tree = build_mssql_schema_tree(
                vec![database.clone()],
                vec![MssqlSchema {
                    database: database.clone(),
                    name: schema.to_owned(),
                }],
                objects,
                columns,
            );
            for database_node in tree {
                nodes.extend(database_node.children);
            }
        }

        Ok(nodes)
    }

    async fn run_query(
        &self,
        text: &str,
        params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        let mut guard = self.inner.lock().await;
        let client = guard.as_mut().ok_or(DriverError::NotConnected)?;
        let started = Instant::now();

        if params.is_empty() {
            let mut stream = client
                .simple_query(text)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            if self.looks_like_select(text) {
                let columns: Vec<Column> = stream
                    .columns()
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?
                    .map(|c| c.to_vec())
                    .unwrap_or_default();
                let rows: Vec<Row> = stream
                    .into_results()
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?
                    .into_iter()
                    .flatten()
                    .collect();
                Ok(rows_to_query_result(
                    &columns,
                    rows,
                    started.elapsed().as_secs_f64(),
                ))
            } else {
                let results = stream
                    .into_results()
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
                let total_rows: usize = results.iter().map(|r| r.len()).sum();
                Ok(QueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    rows_affected: Some(total_rows as i64),
                    elapsed: started.elapsed().as_secs_f64(),
                    ..Default::default()
                })
            }
        } else {
            let sql_params: Vec<SqlParam> = params.iter().map(|v| SqlParam(v.clone())).collect();
            let refs: Vec<&dyn ToSql> = sql_params.iter().map(|p| p as &dyn ToSql).collect();
            let mut stream = client
                .query(text, &refs)
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            if self.looks_like_select(text) {
                let columns: Vec<Column> = stream
                    .columns()
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?
                    .map(|c| c.to_vec())
                    .unwrap_or_default();
                let rows: Vec<Row> = stream
                    .into_results()
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?
                    .into_iter()
                    .flatten()
                    .collect();
                Ok(rows_to_query_result(
                    &columns,
                    rows,
                    started.elapsed().as_secs_f64(),
                ))
            } else {
                let results = stream
                    .into_results()
                    .await
                    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
                let total_rows: usize = results.iter().map(|r| r.len()).sum();
                Ok(QueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    rows_affected: Some(total_rows as i64),
                    elapsed: started.elapsed().as_secs_f64(),
                    ..Default::default()
                })
            }
        }
    }

    async fn explain_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
        mode: ExplainMode,
    ) -> Result<PlanResult> {
        let mut guard = self.inner.lock().await;
        let client = guard.as_mut().ok_or(DriverError::NotConnected)?;

        let (on_cmd, off_cmd) = match mode {
            ExplainMode::DryRun => ("SET SHOWPLAN_TEXT ON", "SET SHOWPLAN_TEXT OFF"),
            ExplainMode::Analyze => ("SET STATISTICS PROFILE ON", "SET STATISTICS PROFILE OFF"),
        };

        client
            .simple_query(on_cmd)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .into_results()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let plan_result = client
            .simple_query(text)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .into_results()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let _ = client
            .simple_query(off_cmd)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .into_results()
            .await;

        let mut raw_lines: Vec<String> = Vec::new();
        for result_set in &plan_result {
            for row in result_set {
                if let Some(s) = row.get::<&str, _>(0) {
                    raw_lines.push(s.to_owned());
                }
            }
        }
        let raw = raw_lines.join("\n");

        let mut root = PlanNode::new("Query Plan", "query_plan");
        for (i, line) in raw_lines.iter().enumerate() {
            root.attributes
                .push(PlanAttribute::new(format!("L{i}"), line));
        }
        Ok(PlanResult::new(root, mode, raw))
    }

    async fn primary_key(&self, table: &TableRef) -> Result<Option<Vec<String>>> {
        let mut guard = self.inner.lock().await;
        let client = guard.as_mut().ok_or(DriverError::NotConnected)?;

        let schema = table
            .schema
            .as_deref()
            .or(table.database.as_deref())
            .unwrap_or("dbo");
        let escaped_schema = schema.replace('\'', "''");
        let escaped_table = table.name.replace('\'', "''");
        let sql = format!(
            "SELECT kcu.COLUMN_NAME \
             FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
             JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
               ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME \
               AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA \
             WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' \
               AND tc.TABLE_SCHEMA = '{escaped_schema}' \
               AND tc.TABLE_NAME = '{escaped_table}' \
             ORDER BY kcu.ORDINAL_POSITION"
        );
        let results = client
            .simple_query(&sql)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
            .into_results()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let cols: Vec<String> = results
            .into_iter()
            .flatten()
            .filter_map(|r| r.get::<&str, _>(0).map(|s| s.to_owned()))
            .collect();
        Ok(if cols.is_empty() { None } else { Some(cols) })
    }

    async fn object_definition(&self, object: &ObjectRef) -> Result<String> {
        self.build_object_definition(object).await
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &crate::ValueMap,
        changes: &crate::ValueMap,
    ) -> Result<MutationResult> {
        let (sql, params) = SqlBuilder::build_update(table, primary_key, changes, SqlBuilder::quote_bracket, SqlBuilder::placeholder_at_p)
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
            let (sql, params) = SqlBuilder::build_insert(table, &ins.values, SqlBuilder::quote_bracket, SqlBuilder::placeholder_at_p)
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
                SqlBuilder::build_delete(table, &del.primary_key, SqlBuilder::quote_bracket, SqlBuilder::placeholder_at_p)
                    .map_err(|m| DriverError::InvalidArgument(m.to_owned()))?;
            let r = self.run_query(&sql, &params, QueryLanguage::Native).await?;
            result.rows_affected += r.rows_affected.unwrap_or(0) as usize;
            result.statements.push(SqlBuilder::interpolate_params(&sql, &params));
        }
        Ok(result)
    }

    async fn cancel_running_query(&self) -> Result<()> {
        let spid = *self.spid.lock().await;
        let cfg = self.cancel_config.lock().await.clone();
        if let (Some(spid), Some(cfg)) = (spid, cfg) {
            if let Ok(mut kill_client) = connect_tcp(&cfg).await {
                let _ = kill_client
                    .simple_query(&format!("KILL {spid}"))
                    .await
                    .ok()
                    .map(|s| async { s.into_results().await });
            }
        }
        Ok(())
    }

    async fn close(&self) {
        *self.spid.lock().await = None;
        *self.cancel_config.lock().await = None;
        let _ = self.inner.lock().await.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use config::{build_config, encryption_plan};
    use schema::{MssqlColumn, MssqlObject, MssqlSchema, build_mssql_schema_tree};

    use crate::{SchemaNodeKind, SslMode};
    use tiberius::{ColumnType, EncryptionLevel};

    #[test]
    fn looks_like_select_handles_common_keywords() {
        let d = MssqlDriver::new();
        assert!(d.looks_like_select("SELECT 1"));
        assert!(d.looks_like_select("  WITH x AS (SELECT 1) SELECT * FROM x"));
        assert!(d.looks_like_select("SHOW TABLES"));
        assert!(d.looks_like_select("EXEC sp_help 'users'"));
        assert!(d.looks_like_select("EXECUTE sp_helpdb"));
        assert!(d.looks_like_select("EXPLAIN SELECT 1"));
        assert!(!d.looks_like_select("INSERT INTO t VALUES (1)"));
        assert!(!d.looks_like_select("UPDATE t SET x=1"));
        assert!(!d.looks_like_select("DELETE FROM t WHERE id=1"));
        assert!(!d.looks_like_select("CREATE TABLE t(x int)"));
    }

    #[tokio::test]
    async fn driver_starts_disconnected() {
        let d = MssqlDriver::new();
        assert!(!d.is_connected().await);
    }

    #[test]
    fn mssql_column_type_names_come_from_metadata() {
        let columns = vec![
            Column::new("id".into(), ColumnType::Int4),
            Column::new("name".into(), ColumnType::NVarchar),
            Column::new("price".into(), ColumnType::Numericn),
            Column::new("ordered_at".into(), ColumnType::Datetime2),
        ];
        let result = rows_to_query_result(&columns, vec![], 0.0);

        assert_eq!(result.columns[0].type_hint, "int");
        assert_eq!(result.columns[1].type_hint, "nvarchar");
        assert_eq!(result.columns[2].type_hint, "numeric");
        assert_eq!(result.columns[3].type_hint, "datetime2");
    }

    #[test]
    fn build_config_with_all_fields_does_not_panic() {
        let mut cfg = ConnectionConfig::new("local", crate::DatabaseKind::Mssql);
        cfg.host = "db.example.com".into();
        cfg.port = 1434;
        cfg.user = "sa".into();
        cfg.password = "secret".into();
        cfg.database = "mydb".into();
        let _tc = build_config(&cfg);
    }

    #[test]
    fn build_config_defaults_do_not_panic() {
        let cfg = ConnectionConfig::new("local", crate::DatabaseKind::Mssql);
        let _tc = build_config(&cfg);
    }

    #[test]
    fn build_config_with_tls_does_not_panic() {
        let mut cfg = ConnectionConfig::new("local", crate::DatabaseKind::Mssql);
        cfg.ssl_mode = SslMode::Required;
        let _tc = build_config(&cfg);
    }

    #[test]
    fn build_config_disabled_ssl_does_not_panic() {
        let mut cfg = ConnectionConfig::new("local", crate::DatabaseKind::Mssql);
        cfg.ssl_mode = SslMode::Disabled;
        let _tc = build_config(&cfg);
    }

    #[test]
    fn encryption_plan_preferred_negotiates_tls_and_trusts_self_signed() {
        let (level, trust) = encryption_plan(SslMode::Preferred);
        assert!(matches!(level, EncryptionLevel::Required));
        assert!(trust);
    }

    #[test]
    fn encryption_plan_required_encrypts_and_trusts_self_signed() {
        let (level, trust) = encryption_plan(SslMode::Required);
        assert!(matches!(level, EncryptionLevel::Required));
        assert!(trust);
    }

    #[test]
    fn encryption_plan_disabled_opts_out_of_encryption() {
        let (level, trust) = encryption_plan(SslMode::Disabled);
        assert!(matches!(level, EncryptionLevel::NotSupported));
        assert!(!trust);
    }

    #[test]
    fn encryption_plan_verifying_modes_require_valid_cert() {
        for mode in [SslMode::VerifyCa, SslMode::VerifyIdentity] {
            let (level, trust) = encryption_plan(mode);
            assert!(matches!(level, EncryptionLevel::Required));
            assert!(!trust, "{mode:?} must not trust a self-signed cert");
        }
    }

    #[test]
    fn build_mssql_schema_tree_wraps_schemas_in_database_node() {
        let schemas = build_mssql_schema_tree(
            vec!["warehouse".into()],
            vec![
                MssqlSchema {
                    database: "warehouse".into(),
                    name: "dbo".into(),
                },
                MssqlSchema {
                    database: "warehouse".into(),
                    name: "audit".into(),
                },
            ],
            vec![
                MssqlObject {
                    database: "warehouse".into(),
                    schema: "dbo".into(),
                    name: "users".into(),
                    kind: SchemaNodeKind::Table,
                },
                MssqlObject {
                    database: "warehouse".into(),
                    schema: "audit".into(),
                    name: "audit_log".into(),
                    kind: SchemaNodeKind::Table,
                },
            ],
            vec![MssqlColumn {
                database: "warehouse".into(),
                schema: "dbo".into(),
                object: "users".into(),
                name: "id".into(),
                data_type: "int".into(),
                nullable: false,
            }],
        );

        assert_eq!(schemas.len(), 1);
        let db = &schemas[0];
        assert_eq!(db.name, "warehouse");
        assert_eq!(db.kind, SchemaNodeKind::Database);
        assert_eq!(
            db.children
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>(),
            vec!["audit", "dbo"]
        );

        let dbo = db.children.iter().find(|s| s.name == "dbo").unwrap();
        assert_eq!(dbo.path, "warehouse.dbo");
        let users = dbo.children.iter().find(|n| n.name == "users").unwrap();
        assert_eq!(users.kind, SchemaNodeKind::Table);
        assert_eq!(users.path, "warehouse.dbo.users");
        assert_eq!(users.children[0].name, "id");
        assert_eq!(users.children[0].detail.as_deref(), Some("int NOT NULL"));
    }

    #[test]
    fn build_mssql_schema_tree_includes_all_metadata_kinds() {
        let objects = vec![
            ("users", SchemaNodeKind::Table),
            ("active_users", SchemaNodeKind::View),
            ("normalize_email", SchemaNodeKind::Function),
            ("refresh_rollups", SchemaNodeKind::Procedure),
            ("order_seq", SchemaNodeKind::Sequence),
            ("email_address", SchemaNodeKind::Type),
            ("users_ai", SchemaNodeKind::Trigger),
            ("users_name_idx", SchemaNodeKind::Index),
        ]
        .into_iter()
        .map(|(name, kind)| MssqlObject {
            database: "warehouse".into(),
            schema: "dbo".into(),
            name: name.into(),
            kind,
        })
        .collect();

        let schemas = build_mssql_schema_tree(
            vec!["warehouse".into()],
            vec![MssqlSchema {
                database: "warehouse".into(),
                name: "dbo".into(),
            }],
            objects,
            vec![],
        );
        let dbo = &schemas[0].children[0];
        let kinds = dbo.children.iter().map(|n| n.kind).collect::<Vec<_>>();

        assert!(kinds.contains(&SchemaNodeKind::Table));
        assert!(kinds.contains(&SchemaNodeKind::View));
        assert!(kinds.contains(&SchemaNodeKind::Function));
        assert!(kinds.contains(&SchemaNodeKind::Procedure));
        assert!(kinds.contains(&SchemaNodeKind::Sequence));
        assert!(kinds.contains(&SchemaNodeKind::Type));
        assert!(kinds.contains(&SchemaNodeKind::Trigger));
        assert!(kinds.contains(&SchemaNodeKind::Index));
    }

    #[test]
    fn build_mssql_schema_tree_keeps_multiple_databases() {
        let schemas = build_mssql_schema_tree(
            vec!["appdb".into(), "warehouse".into()],
            vec![
                MssqlSchema {
                    database: "appdb".into(),
                    name: "dbo".into(),
                },
                MssqlSchema {
                    database: "warehouse".into(),
                    name: "dbo".into(),
                },
            ],
            vec![MssqlObject {
                database: "appdb".into(),
                schema: "dbo".into(),
                name: "users".into(),
                kind: SchemaNodeKind::Table,
            }],
            vec![],
        );

        assert_eq!(
            schemas
                .iter()
                .map(|db| db.name.as_str())
                .collect::<Vec<_>>(),
            vec!["appdb", "warehouse"]
        );
        assert_eq!(schemas[0].children[0].children[0].path, "appdb.dbo.users");
        assert!(schemas[1].children[0].children.is_empty());
    }

    #[test]
    fn pagination_strategy_uses_sql_server_offset() {
        let d = MssqlDriver::new();
        assert_eq!(
            d.pagination_strategy(),
            crate::PaginationStrategy::SqlServerOffset
        );
    }

    #[cfg(feature = "mssql")]
    #[test]
    fn factory_returns_mssql_driver() {
        let d = crate::driver_for_kind(crate::DatabaseKind::Mssql);
        assert!(d.is_ok());
    }
}
