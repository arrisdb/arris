use std::sync::Arc;
use dashmap::DashMap;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::connection::ConnectionEngine;
use crate::persistence::ProjectState;
use crate::{DatabaseDriver, PaginationStrategy};
use crate::{
    DatabaseKind, DriverError, ExplainMode, MutationResult, ObjectRef, PlanResult, QueryLanguage,
    QueryResult, QueryStream, QueryValue, SchemaNode, StatementType, TableMutationBatch, TableRef,
};

use crate::Engine;
use super::*;

pub struct QueryEngine {
    running_queries: DashMap<String, RunningQuery>,
}

impl QueryEngine {
    pub fn new() -> Self {
        Self {
            running_queries: DashMap::new(),
        }
    }

    pub async fn list_schemas(
        &self,
        connection_id: Uuid,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
    ) -> Result<Vec<SchemaNode>, QueryError> {
        let driver = connection.driver_for(connection_id, project).await?;
        Ok(driver.list_schemas().await?)
    }

    pub async fn list_schema(
        &self,
        connection_id: Uuid,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
        schema: &str,
    ) -> Result<Vec<SchemaNode>, QueryError> {
        let driver = connection.driver_for(connection_id, project).await?;
        Ok(driver.list_schema(schema).await?)
    }

    pub async fn run_query(
        &self,
        connection_id: Uuid,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
        sql: String,
        params: Vec<QueryValue>,
        language: Option<QueryLanguage>,
        page_size: Option<u32>,
        page: Option<u32>,
        query_id: Option<String>,
    ) -> Result<QueryResult, QueryError> {
        let driver = connection.driver_for(connection_id, project).await?;
        let lang = language.unwrap_or_default();
        let sql = Self::trim_trailing_sql_semicolon(&sql);

        // In manual mode, lazily open a transaction on the first statement so
        // subsequent statements join it until an explicit commit/rollback.
        let txcfg = connection.transaction_config(connection_id).await;
        if matches!(txcfg.mode, crate::TransactionMode::Manual)
            && driver.supports_transactions()
            && !driver.in_transaction().await
        {
            driver.begin_transaction(txcfg.isolation).await?;
        }

        let cancel_token = query_id.as_ref().map(|qid| {
            let token = CancellationToken::new();
            self.running_queries.insert(
                qid.clone(),
                RunningQuery {
                    cancel_token: token.clone(),
                    driver: Some(driver.clone()),
                },
            );
            token
        });

        let result =
            Self::run_query_inner(&driver, sql, &params, lang, page_size, page, cancel_token.as_ref())
                .await;

        if let Some(qid) = &query_id {
            self.running_queries.remove(qid);
        }

        result
    }

    /// Open a streamed query for canvas ingestion. Handles the same manual-tx
    /// bootstrap as `run_query` and registers `query_id` (token + driver kill)
    /// for `cancel_query`; the CALLER must `unregister_query` once the stream
    /// is fully consumed, since the query outlives this call.
    pub async fn run_query_stream(
        &self,
        connection_id: Uuid,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
        sql: String,
        limit: Option<u64>,
        language: Option<QueryLanguage>,
        query_id: Option<String>,
    ) -> Result<(QueryStream, Option<CancellationToken>, Option<u64>), QueryError> {
        let driver = connection.driver_for(connection_id, project).await?;
        let lang = language.unwrap_or_default();
        let trimmed = Self::trim_trailing_sql_semicolon(&sql);
        // Apply the per-cell LIMIT: wrap the SQL for dialects that support it,
        // otherwise fall back to an ingest row cap the caller enforces.
        let (sql, row_cap) = Self::apply_cell_limit(trimmed, &driver.pagination_strategy(), limit);

        let txcfg = connection.transaction_config(connection_id).await;
        if matches!(txcfg.mode, crate::TransactionMode::Manual)
            && driver.supports_transactions()
            && !driver.in_transaction().await
        {
            driver.begin_transaction(txcfg.isolation).await?;
        }

        let cancel_token = query_id.as_ref().map(|qid| {
            let token = CancellationToken::new();
            self.running_queries.insert(
                qid.clone(),
                RunningQuery {
                    cancel_token: token.clone(),
                    driver: Some(driver.clone()),
                },
            );
            token
        });

        let opened = match cancel_token.as_ref() {
            Some(token) => {
                tokio::select! {
                    r = driver.run_query_stream(&sql, &[], lang) => r,
                    _ = token.cancelled() => {
                        let _ = driver.cancel_running_query().await;
                        Err(DriverError::Cancelled)
                    }
                }
            }
            None => driver.run_query_stream(&sql, &[], lang).await,
        };
        match opened {
            Ok(stream) => Ok((stream, cancel_token, row_cap)),
            Err(e) => {
                if let Some(qid) = &query_id {
                    self.running_queries.remove(qid);
                }
                Err(e.into())
            }
        }
    }

    /// Whether `sql` is a SELECT-shaped statement the canvas can ingest as a
    /// stream; everything else goes through `run_query`.
    pub fn is_streamable_select(sql: &str) -> bool {
        Self::is_select_query(sql)
    }

    pub async fn cancel_query(&self, query_id: String) -> Result<(), QueryError> {
        if let Some((_, rq)) = self.running_queries.remove(&query_id) {
            rq.cancel_token.cancel();
            if let Some(driver) = &rq.driver {
                let _ = driver.cancel_running_query().await;
            }
        }
        Ok(())
    }

    pub fn register_cancel_token(&self, query_id: String) -> CancellationToken {
        let token = CancellationToken::new();
        self.running_queries.insert(
            query_id,
            RunningQuery {
                cancel_token: token.clone(),
                driver: None,
            },
        );
        token
    }

    pub fn unregister_query(&self, query_id: &str) {
        self.running_queries.remove(query_id);
    }

    pub async fn explain_query(
        &self,
        connection_id: Uuid,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
        sql: String,
        params: Vec<QueryValue>,
        language: Option<QueryLanguage>,
        mode: ExplainMode,
    ) -> Result<PlanResult, QueryError> {
        let driver = connection.driver_for(connection_id, project).await?;
        let lang = language.unwrap_or_default();
        let sql = Self::trim_trailing_sql_semicolon(&sql);
        Ok(driver.explain_query(sql, &params, lang, mode).await?)
    }

    pub async fn primary_key(
        &self,
        connection_id: Uuid,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
        table: TableRef,
    ) -> Result<Option<Vec<String>>, QueryError> {
        let driver = connection.driver_for(connection_id, project).await?;
        Ok(driver.primary_key(&table).await?)
    }

    pub async fn object_definition(
        &self,
        connection_id: Uuid,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
        object: ObjectRef,
    ) -> Result<String, QueryError> {
        let driver = connection.driver_for(connection_id, project).await?;
        Ok(driver.object_definition(&object).await?)
    }

    pub async fn table_browse_query(
        connection_id: Uuid,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
        table: &TableRef,
        limit: u32,
    ) -> Result<String, QueryError> {
        let cfg = connection
            .find_connection(connection_id, project)
            .await
            .ok_or_else(|| {
                crate::connection::ConnectionError::ConnectionNotFound(connection_id)
            })?;
        Self::build_browse_sql(cfg.kind, table, limit).ok_or_else(|| {
            QueryError::Driver(DriverError::InvalidArgument(format!(
                "Table browsing is not supported for {:?}",
                cfg.kind
            )))
        })
    }

    pub async fn apply_mutations(
        &self,
        connection_id: Uuid,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
        table: TableRef,
        batch: TableMutationBatch,
    ) -> Result<MutationResult, QueryError> {
        let driver = connection.driver_for(connection_id, project).await?;
        Ok(driver.apply_batch(&table, &batch).await?)
    }

    /// Commit the open manual transaction on a connection.
    pub async fn commit_transaction(
        &self,
        connection_id: Uuid,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
    ) -> Result<(), QueryError> {
        let driver = connection.driver_for(connection_id, project).await?;
        driver.commit_transaction().await?;
        Ok(())
    }

    /// Roll back the open manual transaction on a connection.
    pub async fn rollback_transaction(
        &self,
        connection_id: Uuid,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
    ) -> Result<(), QueryError> {
        let driver = connection.driver_for(connection_id, project).await?;
        driver.rollback_transaction().await?;
        Ok(())
    }
}

impl QueryEngine {
    pub fn trim_trailing_sql_semicolon(sql: &str) -> &str {
        sql.trim().trim_end_matches(';').trim_end()
    }

    fn is_select_query(sql: &str) -> bool {
        use sqlparser::ast::Statement;
        use sqlparser::dialect::GenericDialect;
        use sqlparser::parser::Parser;

        match Parser::parse_sql(&GenericDialect {}, sql)
            .ok()
            .and_then(|stmts| stmts.into_iter().next())
        {
            Some(stmt) => matches!(
                stmt,
                Statement::Query(_)
                    | Statement::Explain { .. }
                    | Statement::ExplainTable { .. }
                    | Statement::ShowFunctions { .. }
                    | Statement::ShowVariable { .. }
                    | Statement::ShowStatus { .. }
                    | Statement::ShowVariables { .. }
                    | Statement::ShowCreate { .. }
                    | Statement::ShowColumns { .. }
                    | Statement::ShowDatabases { .. }
                    | Statement::ShowSchemas { .. }
                    | Statement::ShowCharset(..)
                    | Statement::ShowObjects(..)
                    | Statement::ShowTables { .. }
                    | Statement::ShowViews { .. }
                    | Statement::ShowCollation { .. }
            ),
            None => {
                let upper = sql.trim_start().get(..16).unwrap_or("").to_uppercase();
                ["SELECT ", "WITH ", "SHOW ", "EXPLAIN ", "DESCRIBE ", "DESC ", "VALUES ", "TABLE "]
                    .iter()
                    .any(|kw| upper.starts_with(kw))
            }
        }
    }

    fn is_paginatable_query(sql: &str) -> bool {
        use sqlparser::ast::Statement;
        use sqlparser::dialect::GenericDialect;
        use sqlparser::parser::Parser;

        Parser::parse_sql(&GenericDialect {}, sql)
            .ok()
            .and_then(|stmts| stmts.into_iter().next())
            .is_some_and(|stmt| matches!(stmt, Statement::Query(_)))
    }

    /// Classify a statement that `is_select_query` rejected. Real SQL (which the
    /// parser understands) is a write — `INSERT` / `UPDATE` / `DELETE` / DDL. But
    /// non-SQL shell syntax the parser can't parse (mongosh `db.coll.find()`,
    /// redis `GET`, …) must be judged by the driver's result: a reported
    /// `rows_affected` means a write, otherwise it's a read that renders as a grid.
    fn non_select_statement_type(sql: &str, rows_affected: Option<i64>) -> StatementType {
        use sqlparser::dialect::GenericDialect;
        use sqlparser::parser::Parser;

        let parses_as_sql = Parser::parse_sql(&GenericDialect {}, sql)
            .ok()
            .is_some_and(|stmts| !stmts.is_empty());
        if parses_as_sql || rows_affected.is_some() {
            StatementType::Mutation
        } else {
            StatementType::Query
        }
    }

    fn build_browse_sql(kind: DatabaseKind, table: &TableRef, limit: u32) -> Option<String> {
        let name = match kind {
            DatabaseKind::Mongodb => {
                let namespace = table.database.as_ref().or(table.schema.as_ref());
                Self::qualified_name(namespace.map(String::as_str), &table.name)
            }
            // Trino requires fully-qualified catalog.schema.table when no default
            // catalog is set on the session. Snowflake has the same need: when the
            // connection sets no default database, the session has no current
            // database, so a bare schema.table cannot resolve and browsing returns
            // nothing.
            DatabaseKind::Trino | DatabaseKind::Snowflake => table.dotted(),
            // DynamoDB tables are flat; PartiQL identifiers are double-quoted and
            // table names are case-sensitive, so quote the exact name.
            DatabaseKind::Dynamodb => format!("\"{}\"", table.name.replace('"', "\"\"")),
            _ => Self::qualified_name(table.schema.as_deref(), &table.name),
        };
        Some(match kind {
            DatabaseKind::Mssql => format!("SELECT TOP {limit} * FROM {name}"),
            DatabaseKind::Oracle => format!("SELECT * FROM {name} FETCH FIRST {limit} ROWS ONLY"),
            // PartiQL has no LIMIT clause; the result is page-capped by the driver.
            DatabaseKind::Dynamodb => format!("SELECT * FROM {name}"),
            _ => format!("SELECT * FROM {name} LIMIT {limit}"),
        })
    }

    fn qualified_name(namespace: Option<&str>, name: &str) -> String {
        match namespace.filter(|s| !s.is_empty()) {
            Some(ns) => format!("{ns}.{name}"),
            None => name.to_string(),
        }
    }

    async fn run_query_inner(
        driver: &Arc<dyn DatabaseDriver>,
        sql: &str,
        params: &[QueryValue],
        lang: QueryLanguage,
        page_size: Option<u32>,
        page: Option<u32>,
        cancel_token: Option<&CancellationToken>,
    ) -> Result<QueryResult, QueryError> {
        if !Self::is_select_query(sql) {
            let mut result =
                Self::cancellable_query(driver, sql, params, lang, cancel_token).await?;
            result.statement_type = Self::non_select_statement_type(sql, result.rows_affected);
            return Ok(result);
        }

        if !Self::is_paginatable_query(sql) {
            return Self::cancellable_query(driver, sql, params, lang, cancel_token).await;
        }

        let (ps, pg) = match (page_size, page) {
            (Some(ps), Some(pg)) => (ps, pg),
            _ => {
                return Self::cancellable_query(driver, sql, params, lang, cancel_token).await;
            }
        };

        let fetch_limit = ps + 1;
        let offset = (ps as u64) * (pg as u64);

        match driver.pagination_strategy() {
            PaginationStrategy::SubqueryOffset => {
                let sql = Self::paginated_subquery_sql(sql);
                let paginated =
                    format!("SELECT * FROM ({sql}) AS _p LIMIT {fetch_limit} OFFSET {offset}");
                let mut result =
                    Self::cancellable_query(driver, &paginated, params, lang, cancel_token).await?;
                Self::trim_paginated_result(&mut result, ps);
                Ok(result)
            }
            PaginationStrategy::TrinoOffset => {
                let sql = Self::paginated_subquery_sql(sql);
                let paginated =
                    format!("SELECT * FROM ({sql}) AS _p OFFSET {offset} LIMIT {fetch_limit}");
                let mut result =
                    Self::cancellable_query(driver, &paginated, params, lang, cancel_token).await?;
                Self::trim_paginated_result(&mut result, ps);
                Ok(result)
            }
            PaginationStrategy::SqlServerOffset => {
                let paginated = Self::sql_server_paginated_query(sql, fetch_limit, offset);
                let mut result =
                    Self::cancellable_query(driver, &paginated, params, lang, cancel_token).await?;
                Self::trim_paginated_result(&mut result, ps);
                Ok(result)
            }
            PaginationStrategy::OracleOffset => {
                let paginated = Self::oracle_paginated_query(sql, fetch_limit, offset);
                let mut result =
                    Self::cancellable_query(driver, &paginated, params, lang, cancel_token).await?;
                Self::trim_paginated_result(&mut result, ps);
                Ok(result)
            }
            PaginationStrategy::InMemory | PaginationStrategy::None => {
                let mut result =
                    Self::cancellable_query(driver, sql, params, lang, cancel_token).await?;
                let offset = (ps as usize) * (pg as usize);
                let end = (offset + fetch_limit as usize).min(result.rows.len());
                if offset < result.rows.len() {
                    result.rows = result.rows[offset..end].to_vec();
                } else {
                    result.rows.clear();
                }
                Self::trim_paginated_result(&mut result, ps);
                Ok(result)
            }
        }
    }

    fn trim_paginated_result(result: &mut QueryResult, page_size: u32) {
        let has_more = result.rows.len() > page_size as usize;
        result.rows.truncate(page_size as usize);
        result.has_more = Some(has_more);
    }

    async fn cancellable_query(
        driver: &Arc<dyn DatabaseDriver>,
        sql: &str,
        params: &[QueryValue],
        lang: QueryLanguage,
        cancel_token: Option<&CancellationToken>,
    ) -> Result<QueryResult, QueryError> {
        match cancel_token {
            Some(token) => {
                tokio::select! {
                    result = driver.run_query(sql, params, lang) => {
                        Ok(result?)
                    }
                    _ = token.cancelled() => {
                        let _ = driver.cancel_running_query().await;
                        Err(QueryError::Driver(DriverError::Cancelled))
                    }
                }
            }
            None => Ok(driver.run_query(sql, params, lang).await?),
        }
    }

    fn paginated_subquery_sql(sql: &str) -> &str {
        Self::trim_trailing_sql_semicolon(sql)
    }

    pub(crate) fn sql_server_paginated_query(sql: &str, fetch_limit: u32, offset: u64) -> String {
        let sql = Self::paginated_subquery_sql(sql);
        format!(
            "SELECT * FROM ({sql}) AS _p ORDER BY (SELECT NULL) \
             OFFSET {offset} ROWS FETCH NEXT {fetch_limit} ROWS ONLY"
        )
    }

    fn oracle_paginated_query(sql: &str, fetch_limit: u32, offset: u64) -> String {
        let sql = Self::paginated_subquery_sql(sql);
        format!(
            "SELECT * FROM ({sql}) \
             OFFSET {offset} ROWS FETCH NEXT {fetch_limit} ROWS ONLY"
        )
    }

    /// The dialect-native way to cap `sql` to `fetch_count` rows at `offset`.
    /// `None` means the dialect cannot be subquery-wrapped without breaking
    /// ORDER BY (StarRocks and non-LIMIT sources); the caller caps in memory or
    /// at ingest instead.
    pub fn limit_wrapped_sql(
        sql: &str,
        strategy: &PaginationStrategy,
        fetch_count: u32,
        offset: u64,
    ) -> Option<String> {
        let trimmed = Self::paginated_subquery_sql(sql);
        match strategy {
            PaginationStrategy::SubqueryOffset => Some(format!(
                "SELECT * FROM ({trimmed}) AS _p LIMIT {fetch_count} OFFSET {offset}"
            )),
            PaginationStrategy::TrinoOffset => Some(format!(
                "SELECT * FROM ({trimmed}) AS _p OFFSET {offset} LIMIT {fetch_count}"
            )),
            PaginationStrategy::SqlServerOffset => {
                Some(Self::sql_server_paginated_query(sql, fetch_count, offset))
            }
            PaginationStrategy::OracleOffset => {
                Some(Self::oracle_paginated_query(sql, fetch_count, offset))
            }
            PaginationStrategy::InMemory | PaginationStrategy::None => None,
        }
    }

    /// Resolve a per-cell `limit` into the SQL to send and any ingest row cap.
    /// Wrappable dialects rewrite the SQL (the DB does top-N); order-sensitive
    /// ones keep the SQL and cap at ingest. `None` limit means select-all.
    pub fn apply_cell_limit(
        sql: &str,
        strategy: &PaginationStrategy,
        limit: Option<u64>,
    ) -> (String, Option<u64>) {
        match limit {
            None => (sql.to_string(), None),
            Some(n) => match Self::limit_wrapped_sql(sql, strategy, n as u32, 0) {
                Some(wrapped) => (wrapped, None),
                None => (sql.to_string(), Some(n)),
            },
        }
    }
}

impl Engine for QueryEngine {
    fn name(&self) -> &str {
        "query"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ConnectionConfig, DatabaseKind, IpcError};

    async fn sqlite_connection() -> (ConnectionEngine, Uuid) {
        let tmp = tempfile::tempdir().unwrap();
        let conn = ConnectionEngine::new(tmp.path().into()).await;
        let mut cfg = ConnectionConfig::new("mem", DatabaseKind::Sqlite);
        cfg.file_path = Some(":memory:".into());
        let id = cfg.id;
        conn.open_connection(&cfg).await.unwrap();
        (conn, id)
    }

    #[test]
    fn query_engine_name() {
        let engine = QueryEngine::new();
        assert_eq!(engine.name(), "query");
    }

    #[tokio::test]
    async fn run_query_returns_result() {
        let engine = QueryEngine::new();
        let (conn, id) = sqlite_connection().await;
        let r = engine
            .run_query(
                id,
                &conn,
                None,
                "SELECT 7 AS n".into(),
                vec![],
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(r.rows[0][0], QueryValue::Int(7));
    }

    #[tokio::test]
    async fn run_query_with_pagination() {
        let engine = QueryEngine::new();
        let (conn, id) = sqlite_connection().await;
        let r = engine
            .run_query(
                id,
                &conn,
                None,
                "SELECT 7 AS n;".into(),
                vec![],
                None,
                Some(10),
                Some(0),
                None,
            )
            .await
            .unwrap();
        assert_eq!(r.rows[0][0], QueryValue::Int(7));
        assert_eq!(r.has_more, Some(false));
    }

    #[test]
    fn sql_server_paginated_query_uses_offset_fetch() {
        let sql =
            QueryEngine::sql_server_paginated_query("SELECT * FROM appdb.dbo.orders;", 101, 0);
        assert_eq!(
            sql,
            "SELECT * FROM (SELECT * FROM appdb.dbo.orders) AS _p ORDER BY (SELECT NULL) \
             OFFSET 0 ROWS FETCH NEXT 101 ROWS ONLY"
        );
    }

    #[test]
    fn limit_wrapped_sql_wraps_per_dialect_and_skips_in_memory() {
        use crate::PaginationStrategy as PS;
        let sql = "SELECT * FROM t";
        assert_eq!(
            QueryEngine::limit_wrapped_sql(sql, &PS::SubqueryOffset, 500, 0),
            Some("SELECT * FROM (SELECT * FROM t) AS _p LIMIT 500 OFFSET 0".to_string())
        );
        assert_eq!(
            QueryEngine::limit_wrapped_sql(sql, &PS::TrinoOffset, 500, 0),
            Some("SELECT * FROM (SELECT * FROM t) AS _p OFFSET 0 LIMIT 500".to_string())
        );
        assert!(
            QueryEngine::limit_wrapped_sql(sql, &PS::SqlServerOffset, 500, 0)
                .unwrap()
                .contains("FETCH NEXT 500 ROWS ONLY")
        );
        assert!(
            QueryEngine::limit_wrapped_sql(sql, &PS::OracleOffset, 500, 0)
                .unwrap()
                .contains("FETCH NEXT 500 ROWS ONLY")
        );
        // Order-sensitive dialects cannot be subquery-wrapped safely.
        assert_eq!(QueryEngine::limit_wrapped_sql(sql, &PS::InMemory, 500, 0), None);
        assert_eq!(QueryEngine::limit_wrapped_sql(sql, &PS::None, 500, 0), None);
    }

    #[test]
    fn apply_cell_limit_chooses_wrap_or_cap_by_strategy() {
        use crate::PaginationStrategy as PS;
        let (sql, cap) = QueryEngine::apply_cell_limit("SELECT * FROM t", &PS::SubqueryOffset, Some(500));
        assert_eq!(sql, "SELECT * FROM (SELECT * FROM t) AS _p LIMIT 500 OFFSET 0");
        assert_eq!(cap, None);
        let (sql, cap) = QueryEngine::apply_cell_limit("SELECT * FROM t", &PS::InMemory, Some(500));
        assert_eq!(sql, "SELECT * FROM t");
        assert_eq!(cap, Some(500));
        // Select-all: unchanged SQL, no cap.
        let (sql, cap) = QueryEngine::apply_cell_limit("SELECT * FROM t", &PS::SubqueryOffset, None);
        assert_eq!(sql, "SELECT * FROM t");
        assert_eq!(cap, None);
    }

    #[tokio::test]
    async fn run_query_trims_trailing_semicolon() {
        let engine = QueryEngine::new();
        let (conn, id) = sqlite_connection().await;
        let r = engine
            .run_query(
                id,
                &conn,
                None,
                "SELECT ';' AS semi;".into(),
                vec![],
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(r.rows[0][0], QueryValue::Text(";".into()));
    }

    #[tokio::test]
    async fn run_query_sets_mutation_for_dml() {
        let engine = QueryEngine::new();
        let (conn, id) = sqlite_connection().await;

        engine
            .run_query(
                id,
                &conn,
                None,
                "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)".into(),
                vec![],
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();

        let r = engine
            .run_query(
                id,
                &conn,
                None,
                "INSERT INTO t VALUES (1, 'alice')".into(),
                vec![],
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(r.statement_type, StatementType::Mutation);

        let r = engine
            .run_query(
                id,
                &conn,
                None,
                "UPDATE t SET name = 'bob' WHERE id = 1".into(),
                vec![],
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(r.statement_type, StatementType::Mutation);

        let r = engine
            .run_query(
                id,
                &conn,
                None,
                "DELETE FROM t WHERE id = 1".into(),
                vec![],
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(r.statement_type, StatementType::Mutation);
    }

    #[tokio::test]
    async fn run_query_sets_query_for_select() {
        let engine = QueryEngine::new();
        let (conn, id) = sqlite_connection().await;
        let r = engine
            .run_query(
                id,
                &conn,
                None,
                "SELECT 1 AS n".into(),
                vec![],
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(r.statement_type, StatementType::Query);
    }

    #[test]
    fn non_select_mongosh_reads_classified_as_query() {
        // mongosh read verbs don't parse as SQL and report no `rows_affected`, so
        // they must render as a grid (Query), not be force-marked Mutation.
        for sql in [
            "db.users.find()",
            "appdb.customers.find()",
            "db.orders.aggregate([{\"$match\":{\"x\":1}}])",
            "db.users.countDocuments()",
        ] {
            assert_eq!(
                QueryEngine::non_select_statement_type(sql, None),
                StatementType::Query,
                "{sql} should be a read"
            );
        }
    }

    #[test]
    fn non_select_mongosh_writes_classified_as_mutation() {
        // A non-SQL result reporting affected rows is a write.
        assert_eq!(
            QueryEngine::non_select_statement_type("db.users.insertOne({})", Some(1)),
            StatementType::Mutation
        );
        assert_eq!(
            QueryEngine::non_select_statement_type("db.users.deleteMany({})", Some(3)),
            StatementType::Mutation
        );
    }

    #[test]
    fn non_select_sql_dml_classified_as_mutation() {
        // Parseable SQL that isn't a SELECT is a write even without affected rows.
        for sql in [
            "INSERT INTO t VALUES (1)",
            "UPDATE t SET a = 1",
            "DELETE FROM t",
            "CREATE TABLE t (id INTEGER)",
        ] {
            assert_eq!(
                QueryEngine::non_select_statement_type(sql, None),
                StatementType::Mutation,
                "{sql} should be a mutation"
            );
        }
    }

    #[tokio::test]
    async fn cancel_query_on_unknown_id_returns_ok() {
        let engine = QueryEngine::new();
        let result = engine.cancel_query("nonexistent".into()).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn cancel_running_query_driver_noop() {
        let driver = crate::driver_for_kind(DatabaseKind::Sqlite).unwrap();
        let result = driver.cancel_running_query().await;
        assert!(result.is_ok());
    }

    /// Build a ConnectionEngine backed by an in-memory secret store so the test
    /// never touches the real macOS keychain (a real `Keychain` blocks on an
    /// authorization prompt in headless CI, hanging the whole suite).
    async fn engine_with_mock_secrets(dir: &std::path::Path) -> ConnectionEngine {
        ConnectionEngine::new_with_secrets(
            dir.to_path_buf(),
            std::sync::Arc::new(crate::persistence::MockSecretStore::new()),
        )
        .await
    }

    #[tokio::test]
    async fn table_browse_query_returns_sql() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = engine_with_mock_secrets(tmp.path()).await;
        let cfg = ConnectionConfig::new("mongo", DatabaseKind::Mongodb);
        let id = cfg.id;
        conn.save_connection(cfg, "global", None).await.unwrap();

        let sql = QueryEngine::table_browse_query(
            id,
            &conn,
            None,
            &TableRef {
                database: Some("sales".into()),
                schema: Some("ignored".into()),
                name: "orders".into(),
            },
            25,
        )
        .await
        .unwrap();
        assert_eq!(sql, "SELECT * FROM sales.orders LIMIT 25");
    }

    #[tokio::test]
    async fn table_browse_query_unknown_connection() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = ConnectionEngine::new(tmp.path().into()).await;
        let result = QueryEngine::table_browse_query(
            Uuid::new_v4(),
            &conn,
            None,
            &TableRef {
                database: None,
                schema: None,
                name: "t".into(),
            },
            100,
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn register_and_cancel_token() {
        let engine = QueryEngine::new();
        let token = engine.register_cancel_token("fed-1".into());
        assert!(!token.is_cancelled());
        engine.cancel_query("fed-1".into()).await.unwrap();
        assert!(token.is_cancelled());
    }

    #[tokio::test]
    async fn unregister_query_removes_entry() {
        let engine = QueryEngine::new();
        let _token = engine.register_cancel_token("fed-2".into());
        engine.unregister_query("fed-2");
        engine.cancel_query("fed-2".into()).await.unwrap();
    }

    #[tokio::test]
    async fn ipc_error_from_query_error_preserves_driver_code() {
        let err = QueryError::Driver(DriverError::NotConnected);
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, crate::ErrorCode::NotConnected);
    }

    #[tokio::test]
    async fn ipc_error_from_query_error_other() {
        let err = QueryError::Other("boom".into());
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, crate::ErrorCode::Other);
        assert!(ipc.message.contains("boom"));
    }

    #[tokio::test]
    async fn ipc_error_from_query_error_connection() {
        let err = QueryError::Connection(
            crate::connection::ConnectionError::ConnectionNotFound(Uuid::new_v4()),
        );
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, crate::ErrorCode::Other);
        assert!(ipc.message.contains("not found"));
    }

    #[test]
    fn trims_only_trailing_sql_semicolons() {
        assert_eq!(
            QueryEngine::trim_trailing_sql_semicolon(" SELECT 1; \n"),
            "SELECT 1"
        );
        assert_eq!(
            QueryEngine::trim_trailing_sql_semicolon("SELECT ';';"),
            "SELECT ';'"
        );
    }

    #[test]
    fn is_select_query_detects_statement_types() {
        assert!(QueryEngine::is_select_query("SELECT * FROM t"));
        assert!(QueryEngine::is_select_query("  select 1"));
        assert!(QueryEngine::is_select_query("SELECT a FROM t WHERE id = 1"));
        assert!(!QueryEngine::is_select_query("INSERT INTO t VALUES (1)"));
        assert!(!QueryEngine::is_select_query("UPDATE t SET x = 1"));
        assert!(!QueryEngine::is_select_query("DELETE FROM t WHERE id = 1"));
        assert!(!QueryEngine::is_select_query("CREATE TABLE t (id INT)"));
        assert!(!QueryEngine::is_select_query("DROP TABLE t"));
        assert!(!QueryEngine::is_select_query("ALTER TABLE t ADD col INT"));
        assert!(!QueryEngine::is_select_query("TRUNCATE TABLE t"));

        assert!(QueryEngine::is_select_query("SHOW DATABASES"));
        assert!(QueryEngine::is_select_query("SHOW TABLES"));
        assert!(QueryEngine::is_select_query("SHOW SCHEMAS"));
        assert!(QueryEngine::is_select_query("SHOW COLUMNS FROM t"));
        assert!(QueryEngine::is_select_query("SHOW CREATE TABLE t"));
        assert!(QueryEngine::is_select_query("EXPLAIN SELECT 1"));
        assert!(QueryEngine::is_select_query("DESCRIBE t"));
    }

    #[test]
    fn builds_browse_queries_per_driver_kind() {
        let table = TableRef {
            database: Some("sales".into()),
            schema: Some("public".into()),
            name: "orders".into(),
        };
        assert_eq!(
            QueryEngine::build_browse_sql(DatabaseKind::Postgres, &table, 500).unwrap(),
            "SELECT * FROM public.orders LIMIT 500"
        );
        assert_eq!(
            QueryEngine::build_browse_sql(DatabaseKind::Mongodb, &table, 500).unwrap(),
            "SELECT * FROM sales.orders LIMIT 500"
        );
        assert_eq!(
            QueryEngine::build_browse_sql(DatabaseKind::Oracle, &table, 500).unwrap(),
            "SELECT * FROM public.orders FETCH FIRST 500 ROWS ONLY"
        );
        assert_eq!(
            QueryEngine::build_browse_sql(DatabaseKind::Mssql, &table, 500).unwrap(),
            "SELECT TOP 500 * FROM public.orders"
        );
        assert_eq!(
            QueryEngine::build_browse_sql(DatabaseKind::Trino, &table, 500).unwrap(),
            "SELECT * FROM sales.public.orders LIMIT 500"
        );
        // DynamoDB is flat (no schema/db), PartiQL quotes identifiers and has no
        // LIMIT clause.
        assert_eq!(
            QueryEngine::build_browse_sql(DatabaseKind::Dynamodb, &table, 500).unwrap(),
            "SELECT * FROM \"orders\""
        );
        // Snowflake must fully-qualify db.schema.table: when the connection sets
        // no default database the session has no current database, so a bare
        // schema.table cannot resolve and browsing returns no rows.
        assert_eq!(
            QueryEngine::build_browse_sql(DatabaseKind::Snowflake, &table, 500).unwrap(),
            "SELECT * FROM sales.public.orders LIMIT 500"
        );

        // A Redis key node carries the db as `schema` (e.g. db0) and the key as
        // `name`. Browsing emits a `dbN.<key>` source the Redis SQL parser reads
        // as "select that database, then read the key".
        let key = TableRef {
            database: None,
            schema: Some("db0".into()),
            name: "customers:1".into(),
        };
        assert_eq!(
            QueryEngine::build_browse_sql(DatabaseKind::Redis, &key, 500).unwrap(),
            "SELECT * FROM db0.customers:1 LIMIT 500"
        );
    }
}
