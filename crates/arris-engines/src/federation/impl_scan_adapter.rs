use std::sync::Arc;

use async_trait::async_trait;
use futures::StreamExt;

use crate::DatabaseDriver;
use crate::drivers::errors::Result;
use crate::drivers::types::{QueryStream, RowChunkStream};
use crate::{DatabaseKind, DriverError, QueryLanguage, QueryResult};

use super::FederationEngine;
use super::FederationRef;
use super::constants::ARROW_SCAN_UNSUPPORTED;

#[async_trait]
pub trait ScanAdapter: Send + Sync {
    async fn scan(&self, source: &FederationRef) -> Result<QueryResult>;

    async fn scan_with_sql(&self, sql: &str) -> Result<QueryResult>;

    fn database_kind(&self) -> DatabaseKind;

    async fn cancel_running_query(&self) -> Result<()> {
        Ok(())
    }
}

pub struct DriverScanAdapter {
    driver: Arc<dyn DatabaseDriver>,
    kind: DatabaseKind,
}

impl DriverScanAdapter {
    pub fn new(driver: Arc<dyn DatabaseDriver>, kind: DatabaseKind) -> Self {
        Self { driver, kind }
    }

    /// A driver's `run_query` may return only the source's first result page
    /// (BigQuery does), which silently truncates a scan, so scans drain the
    /// streamed variant instead and keep every chunk.
    pub(super) async fn collect_stream(stream: QueryStream) -> Result<QueryResult> {
        let QueryStream::Rows(RowChunkStream { columns, mut chunks }) = stream else {
            return Err(DriverError::QueryFailed(ARROW_SCAN_UNSUPPORTED.to_owned()));
        };
        let mut rows = Vec::new();
        while let Some(chunk) = chunks.next().await {
            rows.extend(chunk?);
        }
        Ok(QueryResult::new(columns, rows))
    }

    async fn scan_all_pages(&self, sql: &str) -> Result<QueryResult> {
        let stream = self.driver.run_query_stream(sql, &[], QueryLanguage::Sql).await?;
        Self::collect_stream(stream).await
    }
}

#[async_trait]
impl ScanAdapter for DriverScanAdapter {
    async fn scan(&self, source: &FederationRef) -> Result<QueryResult> {
        let sql = FederationEngine::scan_sql(self.kind, source)?;
        self.scan_all_pages(&sql).await
    }

    async fn scan_with_sql(&self, sql: &str) -> Result<QueryResult> {
        self.scan_all_pages(sql).await
    }

    fn database_kind(&self) -> DatabaseKind {
        self.kind
    }

    async fn cancel_running_query(&self) -> Result<()> {
        self.driver.cancel_running_query().await
    }
}

pub struct ScanOptions<'a> {
    pub projections: Option<&'a [String]>,
    pub where_clause: Option<&'a str>,
    pub limit: Option<usize>,
}

/// Builds the dialect-specific `SELECT` pushed down to a federated source, plus
/// the per-dialect identifier/literal quoting the rest of federation relies on.
pub(crate) struct ScanSql;

impl ScanSql {
    pub(crate) fn federation_scan_sql(kind: DatabaseKind, source: &FederationRef) -> Result<String> {
        Self::federation_scan_sql_with_options(kind, source, &ScanOptions {
            projections: None,
            where_clause: None,
            limit: None,
        })
    }

    pub(crate) fn federation_scan_sql_with_options(
        kind: DatabaseKind,
        source: &FederationRef,
        options: &ScanOptions<'_>,
    ) -> Result<String> {
        if !Self::supports_federation_scan_sql(kind) {
            return Err(DriverError::InvalidArgument(format!(
                "{kind:?} sources do not support SQL federation scans"
            )));
        }

        let table = Self::quote_ident(kind, &source.table);
        let table_name = match source.schema.as_deref().filter(|s| !s.is_empty()) {
            Some(schema) => format!("{}.{}", Self::quote_ident(kind, schema), table),
            None => table,
        };

        let columns = match options.projections {
            Some(cols) if !cols.is_empty() => {
                cols.iter()
                    .map(|c| Self::quote_ident(kind, c))
                    .collect::<Vec<_>>()
                    .join(", ")
            }
            _ => "*".to_string(),
        };

        // SQL Server has no LIMIT clause; the row cap goes in a TOP prefix instead.
        let top = match (kind, options.limit) {
            (DatabaseKind::Mssql, Some(limit)) => format!("TOP {limit} "),
            _ => String::new(),
        };

        let mut sql = format!("SELECT {top}{columns} FROM {table_name}");

        if let Some(wc) = options.where_clause {
            if !wc.is_empty() {
                sql.push_str(" WHERE ");
                sql.push_str(wc);
            }
        }

        if let Some(limit) = options.limit {
            match kind {
                // Handled by the TOP prefix above.
                DatabaseKind::Mssql => {}
                // Oracle uses the ANSI row-limiting clause rather than LIMIT.
                DatabaseKind::Oracle => sql.push_str(&format!(" FETCH FIRST {limit} ROWS ONLY")),
                // PartiQL (DynamoDB) has no LIMIT clause; the scan is page-capped by
                // the driver, so the row cap is dropped from the pushed-down SQL.
                DatabaseKind::Dynamodb => {}
                _ => sql.push_str(&format!(" LIMIT {limit}")),
            }
        }

        Ok(sql)
    }

    fn supports_federation_scan_sql(kind: DatabaseKind) -> bool {
        matches!(
            kind,
            DatabaseKind::Postgres
                | DatabaseKind::Redshift
                | DatabaseKind::Snowflake
                | DatabaseKind::Bigquery
                | DatabaseKind::Mysql
                | DatabaseKind::Mariadb
                | DatabaseKind::Sqlite
                | DatabaseKind::Mssql
                | DatabaseKind::Oracle
                | DatabaseKind::Duckdb
                | DatabaseKind::Clickhouse
                | DatabaseKind::Trino
                | DatabaseKind::Mongodb
                | DatabaseKind::Redis
                | DatabaseKind::Kafka
                | DatabaseKind::Mixpanel
                | DatabaseKind::Elasticsearch
                | DatabaseKind::Dynamodb
                | DatabaseKind::Starrocks
        )
    }

    pub(crate) fn quote_ident(kind: DatabaseKind, ident: &str) -> String {
        match kind {
            DatabaseKind::Mysql
            | DatabaseKind::Mariadb
            | DatabaseKind::Bigquery
            | DatabaseKind::Starrocks => {
                format!("`{}`", ident.replace('`', "``"))
            }
            DatabaseKind::Mssql => format!("[{}]", ident.replace(']', "]]")),
            DatabaseKind::Postgres
            | DatabaseKind::Redshift
            | DatabaseKind::Sqlite
            | DatabaseKind::Elasticsearch
            | DatabaseKind::Dynamodb => {
                // Elasticsearch SQL follows ANSI double-quote identifier quoting, which
                // is required so index/field names containing `-` or `.` parse as a
                // single identifier rather than an arithmetic expression.
                format!("\"{}\"", ident.replace('"', "\"\""))
            }
            _ => ident.to_string(),
        }
    }

    pub(crate) fn quote_literal(kind: DatabaseKind, value: &str) -> String {
        let escaped = value.replace('\'', "''");
        match kind {
            DatabaseKind::Mysql | DatabaseKind::Mariadb | DatabaseKind::Starrocks => {
                let escaped = escaped.replace('\\', "\\\\");
                format!("'{escaped}'")
            }
            _ => format!("'{escaped}'"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::{ColumnSpec, QueryValue};
    use futures::stream;

    fn int_chunk(values: &[i64]) -> Vec<Vec<QueryValue>> {
        values.iter().map(|v| vec![QueryValue::Int(*v)]).collect()
    }

    fn row_stream(
        chunks: Vec<std::result::Result<Vec<Vec<QueryValue>>, DriverError>>,
    ) -> QueryStream {
        QueryStream::Rows(RowChunkStream {
            columns: vec![ColumnSpec::new("pk", "INT64")],
            chunks: stream::iter(chunks).boxed(),
        })
    }

    #[tokio::test]
    async fn collect_stream_keeps_every_chunk() {
        let stream = row_stream(vec![
            Ok(int_chunk(&[1, 2])),
            Ok(int_chunk(&[3])),
            Ok(int_chunk(&[4, 5])),
        ]);
        let result = DriverScanAdapter::collect_stream(stream).await.unwrap();
        assert_eq!(result.columns.len(), 1);
        assert_eq!(result.columns[0].name, "pk");
        assert_eq!(result.rows, int_chunk(&[1, 2, 3, 4, 5]));
    }

    #[tokio::test]
    async fn collect_stream_handles_empty_result() {
        let result = DriverScanAdapter::collect_stream(row_stream(vec![]))
            .await
            .unwrap();
        assert!(result.rows.is_empty());
        assert_eq!(result.columns.len(), 1);
    }

    #[tokio::test]
    async fn collect_stream_propagates_chunk_error() {
        let stream = row_stream(vec![
            Ok(int_chunk(&[1])),
            Err(DriverError::QueryFailed("page 2 failed".into())),
        ]);
        let err = DriverScanAdapter::collect_stream(stream).await.unwrap_err();
        assert!(err.to_string().contains("page 2 failed"));
    }

    #[tokio::test]
    async fn collect_stream_rejects_arrow_streams() {
        let stream = QueryStream::Arrow(stream::empty().boxed());
        let err = DriverScanAdapter::collect_stream(stream).await.unwrap_err();
        assert!(err.to_string().contains(ARROW_SCAN_UNSUPPORTED));
    }

    fn source(schema: Option<&str>, table: &str) -> FederationRef {
        FederationRef {
            connection: "src".into(),
            schema: schema.map(str::to_string),
            table: table.into(),
        }
    }

    #[test]
    fn scan_sql_omits_missing_schema() {
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Sqlite, &source(None, "users")).unwrap(),
            "SELECT * FROM \"users\""
        );
    }

    #[test]
    fn scan_sql_quotes_per_source_dialect() {
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Postgres, &source(Some("public"), "users")).unwrap(),
            "SELECT * FROM \"public\".\"users\""
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Mysql, &source(Some("appdb"), "orders")).unwrap(),
            "SELECT * FROM `appdb`.`orders`"
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Redshift, &source(Some("public"), "orders")).unwrap(),
            "SELECT * FROM \"public\".\"orders\""
        );
    }

    #[test]
    fn scan_sql_supports_snowflake() {
        // Snowflake folds unquoted identifiers to uppercase, so refs are left
        // unquoted to match its default uppercase object names.
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Snowflake, &source(Some("reporting"), "orders"))
                .unwrap(),
            "SELECT * FROM reporting.orders"
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Snowflake, &source(None, "orders")).unwrap(),
            "SELECT * FROM orders"
        );
        let cols = vec!["customer_id".to_string(), "amount".to_string()];
        let options = ScanOptions {
            projections: Some(&cols),
            where_clause: Some("amount > 0"),
            limit: Some(100),
        };
        assert_eq!(
            ScanSql::federation_scan_sql_with_options(
                DatabaseKind::Snowflake,
                &source(Some("reporting"), "orders"),
                &options
            )
            .unwrap(),
            "SELECT customer_id, amount FROM reporting.orders WHERE amount > 0 LIMIT 100"
        );
    }

    #[test]
    fn scan_sql_supports_sql_frontends_for_non_relational_sources() {
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Mongodb, &source(Some("appdb"), "customers"))
                .unwrap(),
            "SELECT * FROM appdb.customers"
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Redis, &source(None, "keys")).unwrap(),
            "SELECT * FROM keys"
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Kafka, &source(None, "orders")).unwrap(),
            "SELECT * FROM orders"
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Mixpanel, &source(None, "events")).unwrap(),
            "SELECT * FROM events"
        );
    }

    #[test]
    fn scan_sql_quotes_elasticsearch_indices() {
        // ES SQL needs ANSI double quotes so index names with `-` / `.` parse as a
        // single identifier. ES connections address indices as a 2-part ref.
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Elasticsearch, &source(None, "customers")).unwrap(),
            "SELECT * FROM \"customers\""
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Elasticsearch, &source(None, "metrics-prod"))
                .unwrap(),
            "SELECT * FROM \"metrics-prod\""
        );
    }

    #[test]
    fn scan_sql_elasticsearch_projects_and_filters() {
        let cols = vec!["customer_id".to_string(), "country_code".to_string()];
        let options = ScanOptions {
            projections: Some(&cols),
            where_clause: Some("\"country_code\" = 'US'"),
            limit: Some(50),
        };
        assert_eq!(
            ScanSql::federation_scan_sql_with_options(
                DatabaseKind::Elasticsearch,
                &source(None, "customers"),
                &options
            )
            .unwrap(),
            "SELECT \"customer_id\", \"country_code\" FROM \"customers\" WHERE \"country_code\" = 'US' LIMIT 50"
        );
    }

    #[test]
    fn scan_sql_supports_remaining_sql_sources() {
        // BigQuery and MSSQL carry their own identifier quoting; Oracle, DuckDB,
        // ClickHouse, and Trino fall through to the unquoted default.
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Bigquery, &source(Some("reporting"), "orders"))
                .unwrap(),
            "SELECT * FROM `reporting`.`orders`"
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Mssql, &source(Some("dbo"), "orders")).unwrap(),
            "SELECT * FROM [dbo].[orders]"
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Oracle, &source(Some("hr"), "employees")).unwrap(),
            "SELECT * FROM hr.employees"
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Duckdb, &source(Some("main"), "events")).unwrap(),
            "SELECT * FROM main.events"
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Clickhouse, &source(Some("default"), "hits"))
                .unwrap(),
            "SELECT * FROM default.hits"
        );
        assert_eq!(
            ScanSql::federation_scan_sql(DatabaseKind::Trino, &source(Some("tpch"), "nation")).unwrap(),
            "SELECT * FROM tpch.nation"
        );
    }

    #[test]
    fn scan_sql_limits_per_dialect() {
        let cols = vec!["customer_id".to_string()];
        let options = ScanOptions {
            projections: Some(&cols),
            where_clause: None,
            limit: Some(1),
        };
        // SQL Server: TOP prefix, no LIMIT clause.
        assert_eq!(
            ScanSql::federation_scan_sql_with_options(
                DatabaseKind::Mssql,
                &source(Some("dbo"), "orders"),
                &options
            )
            .unwrap(),
            "SELECT TOP 1 [customer_id] FROM [dbo].[orders]"
        );
        // Oracle: ANSI row-limiting clause, no LIMIT.
        assert_eq!(
            ScanSql::federation_scan_sql_with_options(
                DatabaseKind::Oracle,
                &source(Some("hr"), "employees"),
                &options
            )
            .unwrap(),
            "SELECT customer_id FROM hr.employees FETCH FIRST 1 ROWS ONLY"
        );
        // Others keep the LIMIT clause.
        assert_eq!(
            ScanSql::federation_scan_sql_with_options(
                DatabaseKind::Clickhouse,
                &source(Some("default"), "hits"),
                &options
            )
            .unwrap(),
            "SELECT customer_id FROM default.hits LIMIT 1"
        );
    }

    #[test]
    fn scan_sql_rejects_unsupported_kinds() {
        // Every current DatabaseKind is federatable; the allowlist exists so a
        // newly added kind is rejected until it is explicitly validated.
        for kind in DatabaseKind::ALL {
            assert!(
                ScanSql::federation_scan_sql(kind, &source(None, "t")).is_ok(),
                "{kind:?} should be federatable"
            );
        }
    }

    #[test]
    fn scan_sql_with_projections() {
        let cols = vec!["id".to_string(), "name".to_string()];
        let options = ScanOptions {
            projections: Some(&cols),
            where_clause: None,
            limit: None,
        };
        assert_eq!(
            ScanSql::federation_scan_sql_with_options(
                DatabaseKind::Postgres,
                &source(Some("public"), "users"),
                &options
            )
            .unwrap(),
            "SELECT \"id\", \"name\" FROM \"public\".\"users\""
        );
    }

    #[test]
    fn scan_sql_with_where_and_limit() {
        let options = ScanOptions {
            projections: None,
            where_clause: Some("\"age\" > 30"),
            limit: Some(100),
        };
        assert_eq!(
            ScanSql::federation_scan_sql_with_options(
                DatabaseKind::Postgres,
                &source(Some("public"), "users"),
                &options
            )
            .unwrap(),
            "SELECT * FROM \"public\".\"users\" WHERE \"age\" > 30 LIMIT 100"
        );
    }

    #[test]
    fn scan_sql_with_all_options() {
        let cols = vec!["name".to_string()];
        let options = ScanOptions {
            projections: Some(&cols),
            where_clause: Some("`status` = 'active'"),
            limit: Some(10),
        };
        assert_eq!(
            ScanSql::federation_scan_sql_with_options(
                DatabaseKind::Mysql,
                &source(Some("appdb"), "users"),
                &options
            )
            .unwrap(),
            "SELECT `name` FROM `appdb`.`users` WHERE `status` = 'active' LIMIT 10"
        );
    }

    #[test]
    fn quote_literal_escapes_single_quotes() {
        assert_eq!(ScanSql::quote_literal(DatabaseKind::Postgres, "it's"), "'it''s'");
    }

    #[test]
    fn quote_literal_mysql_escapes_backslashes() {
        assert_eq!(ScanSql::quote_literal(DatabaseKind::Mysql, "a\\b"), "'a\\\\b'");
    }
}
