use async_trait::async_trait;

pub mod errors;
pub mod types;
pub mod uri;

pub mod common;
pub mod sql_builder;
pub mod unimplemented;

// Shared TLS foundation. Postgres is the only consumer in this slice, so the
// rustls-backed helper is gated behind that feature; later slices broaden it.
#[cfg(feature = "postgres")]
pub mod tls;

pub use errors::*;
pub use types::*;
pub use uri::{PostgresUriComponents, parse_postgres_uri};

use crate::connection::types::ConnectionConfig;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PaginationStrategy {
    SubqueryOffset,
    TrinoOffset,
    SqlServerOffset,
    OracleOffset,
    InMemory,
    None,
}

#[cfg(feature = "postgres")]
pub mod postgres;

#[cfg(feature = "sqlite")]
pub mod sqlite;

#[cfg(feature = "mongodb")]
pub mod mongodb;

#[cfg(feature = "mysql")]
pub mod mysql;

#[cfg(feature = "kafka")]
pub mod kafka;

#[cfg(feature = "mixpanel")]
pub mod mixpanel;

#[cfg(feature = "redis")]
pub mod redis;

#[cfg(feature = "mssql")]
pub mod mssql;

#[cfg(feature = "duckdb")]
pub mod duckdb;

#[cfg(feature = "oracle")]
pub mod oracle;

#[cfg(feature = "elasticsearch")]
pub mod elasticsearch;

#[cfg(feature = "bigquery")]
pub mod bigquery;

#[cfg(feature = "snowflake")]
pub mod snowflake;

#[cfg(feature = "trino")]
pub mod trino;

#[cfg(feature = "clickhouse")]
pub mod clickhouse;

#[cfg(feature = "dynamodb")]
pub mod dynamodb;

#[cfg(feature = "starrocks")]
pub mod starrocks;

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()>;

    async fn is_connected(&self) -> bool;

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>>;

    /// Lists the subtree for a single named schema: the schema/database
    /// container node named `schema`, populated with its tables and columns.
    ///
    /// Required so every driver declares how it loads one schema. Drivers where
    /// listing the whole tree is cheap delegate to
    /// `common::schema::find_schema_node(&self.list_schemas().await?, schema)`.
    /// Drivers where eager loading is expensive (large warehouses) keep
    /// `list_schemas` to containers-only and implement this with a targeted
    /// per-schema query, so a schema's tables load lazily when selected.
    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>>;

    async fn run_query(
        &self,
        text: &str,
        params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryResult>;

    async fn supports_explain(&self, _mode: ExplainMode) -> bool {
        true
    }

    fn pagination_strategy(&self) -> PaginationStrategy {
        PaginationStrategy::SubqueryOffset
    }

    async fn explain_query(
        &self,
        text: &str,
        params: &[QueryValue],
        language: QueryLanguage,
        mode: ExplainMode,
    ) -> Result<PlanResult>;

    async fn primary_key(&self, table: &TableRef) -> Result<Option<Vec<String>>>;

    /// Returns the DDL / definition text (a `CREATE …` statement) for a schema
    /// object — either as the database itself reports it (`SHOW CREATE`,
    /// `pg_get_*def`, `DBMS_METADATA.GET_DDL`) or reconstructed from the
    /// catalog when the engine has no native equivalent. The default impl
    /// reports the operation as unsupported so non-SQL drivers compile
    /// untouched.
    async fn object_definition(&self, _object: &ObjectRef) -> Result<String> {
        Err(DriverError::Unsupported(
            "object definition is not supported for this driver".into(),
        ))
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &ValueMap,
        changes: &ValueMap,
    ) -> Result<MutationResult>;

    async fn update_rows(&self, table: &TableRef, edits: &[RowEdit]) -> Result<MutationResult> {
        let mut result = MutationResult::default();
        for edit in edits {
            result.merge(self.update_row(table, &edit.primary_key, &edit.changes).await?);
        }
        Ok(result)
    }

    fn select_like_keywords(&self) -> &'static [&'static str] {
        &[]
    }

    fn looks_like_select(&self, sql: &str) -> bool {
        const BASE_SELECT_KEYWORDS: &[&str] =
            &["SELECT", "WITH", "VALUES", "TABLE", "SHOW", "EXPLAIN"];
        let trimmed = sql.trim_start();
        let head = trimmed.chars().take(16).collect::<String>().to_uppercase();
        let extra = self.select_like_keywords();
        BASE_SELECT_KEYWORDS
            .iter()
            .chain(extra.iter())
            .any(|keyword| {
                let kw = keyword.to_uppercase();
                head.starts_with(&kw)
                    && matches!(
                        head.as_bytes().get(kw.len()).copied(),
                        None | Some(b' ' | b'\t' | b'\n' | b'\r' | b'(')
                    )
            })
    }

    async fn insert_rows(&self, table: &TableRef, inserts: &[RowInsert]) -> Result<MutationResult>;
    async fn delete_rows(&self, table: &TableRef, deletes: &[RowDelete]) -> Result<MutationResult>;

    async fn apply_batch(
        &self,
        table: &TableRef,
        batch: &TableMutationBatch,
    ) -> Result<MutationResult> {
        let mut result = MutationResult::default();
        result.merge(self.update_rows(table, &batch.updates).await?);
        result.merge(self.delete_rows(table, &batch.deletes).await?);
        result.merge(self.insert_rows(table, &batch.inserts).await?);
        Ok(result)
    }

    async fn cancel_running_query(&self) -> Result<()> {
        Ok(())
    }

    // ── Manual transaction control ──────────────────────────────────────────
    // Drivers that can pin a single physical connection across statements
    // override these. The default impls report "unsupported" so non-
    // transactional drivers compile untouched.

    /// Whether this driver supports manual (multi-statement) transactions.
    fn supports_transactions(&self) -> bool {
        false
    }

    /// Whether a manual transaction is currently open on this connection.
    async fn in_transaction(&self) -> bool {
        false
    }

    /// Open a manual transaction with the given isolation level. Subsequent
    /// `run_query` calls run inside it until `commit_transaction` /
    /// `rollback_transaction`.
    async fn begin_transaction(&self, _isolation: IsolationLevel) -> Result<()> {
        Err(DriverError::TransactionUnsupported)
    }

    /// Commit the open manual transaction.
    async fn commit_transaction(&self) -> Result<()> {
        Err(DriverError::TransactionUnsupported)
    }

    /// Roll back the open manual transaction.
    async fn rollback_transaction(&self) -> Result<()> {
        Err(DriverError::TransactionUnsupported)
    }

    async fn close(&self);
}

pub fn driver_for_kind(kind: crate::connection::types::DatabaseKind) -> Result<Box<dyn DatabaseDriver>> {
    use crate::connection::types::DatabaseKind;
    match kind {
        #[cfg(feature = "postgres")]
        DatabaseKind::Postgres | DatabaseKind::Redshift => {
            Ok(Box::new(postgres::PostgresDriver::new()))
        }
        #[cfg(feature = "sqlite")]
        DatabaseKind::Sqlite => Ok(Box::new(sqlite::SqliteDriver::new())),
        #[cfg(feature = "mongodb")]
        DatabaseKind::Mongodb => Ok(Box::new(mongodb::MongoDriver::new())),
        #[cfg(feature = "mysql")]
        DatabaseKind::Mysql | DatabaseKind::Mariadb => Ok(Box::new(mysql::MysqlDriver::new())),
        #[cfg(feature = "kafka")]
        DatabaseKind::Kafka => Ok(Box::new(kafka::KafkaDriver::new())),
        #[cfg(feature = "mixpanel")]
        DatabaseKind::Mixpanel => Ok(Box::new(mixpanel::MixpanelDriver::new())),
        #[cfg(feature = "redis")]
        DatabaseKind::Redis => Ok(Box::new(redis::RedisDriver::new())),
        #[cfg(feature = "mssql")]
        DatabaseKind::Mssql => Ok(Box::new(mssql::MssqlDriver::new())),
        #[cfg(feature = "duckdb")]
        DatabaseKind::Duckdb => Ok(Box::new(duckdb::DuckdbDriver::new())),
        #[cfg(feature = "oracle")]
        DatabaseKind::Oracle => Ok(Box::new(oracle::OracleDriver::new())),
        #[cfg(feature = "elasticsearch")]
        DatabaseKind::Elasticsearch => {
            Ok(Box::new(elasticsearch::ElasticsearchDriver::new()))
        }
        #[cfg(feature = "bigquery")]
        DatabaseKind::Bigquery => Ok(Box::new(bigquery::BigqueryDriver::new())),
        #[cfg(feature = "snowflake")]
        DatabaseKind::Snowflake => Ok(Box::new(snowflake::SnowflakeDriver::new())),
        #[cfg(feature = "trino")]
        DatabaseKind::Trino => Ok(Box::new(trino::TrinoDriver::new())),
        #[cfg(feature = "clickhouse")]
        DatabaseKind::Clickhouse => Ok(Box::new(clickhouse::ClickhouseDriver::new())),
        #[cfg(feature = "dynamodb")]
        DatabaseKind::Dynamodb => Ok(Box::new(dynamodb::DynamoDbDriver::new())),
        #[cfg(feature = "starrocks")]
        DatabaseKind::Starrocks => Ok(Box::new(starrocks::StarrocksDriver::new())),
        // Reachable only when one or more driver features are disabled.
        #[allow(unreachable_patterns)]
        other => Ok(Box::new(unimplemented::UnimplementedDriver::new(other))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::types::DatabaseKind;

    #[cfg(feature = "postgres")]
    #[test]
    fn factory_returns_postgres_driver() {
        let d = driver_for_kind(DatabaseKind::Postgres);
        assert!(d.is_ok());
    }

    #[cfg(feature = "postgres")]
    #[test]
    fn factory_returns_postgres_driver_for_redshift() {
        let d = driver_for_kind(DatabaseKind::Redshift);
        assert!(d.is_ok());
    }

    #[cfg(feature = "sqlite")]
    #[test]
    fn factory_returns_sqlite_driver() {
        let d = driver_for_kind(DatabaseKind::Sqlite);
        assert!(d.is_ok());
    }

    #[cfg(feature = "kafka")]
    #[test]
    fn factory_returns_kafka_driver() {
        let d = driver_for_kind(DatabaseKind::Kafka);
        assert!(d.is_ok());
    }

    #[cfg(feature = "redis")]
    #[test]
    fn factory_returns_redis_driver() {
        let d = driver_for_kind(DatabaseKind::Redis);
        assert!(d.is_ok());
    }

    #[cfg(feature = "duckdb")]
    #[test]
    fn factory_returns_duckdb_driver() {
        let d = driver_for_kind(DatabaseKind::Duckdb);
        assert!(d.is_ok());
    }

    #[cfg(feature = "bigquery")]
    #[test]
    fn factory_returns_bigquery_driver() {
        let d = driver_for_kind(DatabaseKind::Bigquery);
        assert!(d.is_ok());
    }

    #[test]
    fn factory_falls_back_to_unimplemented_for_pending_kinds() {
        for kind in [
            DatabaseKind::Mongodb,
            DatabaseKind::Mysql,
            DatabaseKind::Mariadb,
            DatabaseKind::Oracle,
            DatabaseKind::Clickhouse,
        ] {
            assert!(driver_for_kind(kind).is_ok(), "kind {kind:?}");
        }
    }

    #[test]
    fn pagination_strategy_variants_are_distinct() {
        assert_ne!(PaginationStrategy::SubqueryOffset, PaginationStrategy::InMemory);
        assert_ne!(PaginationStrategy::SubqueryOffset, PaginationStrategy::SqlServerOffset);
        assert_ne!(PaginationStrategy::SqlServerOffset, PaginationStrategy::InMemory);
        assert_ne!(PaginationStrategy::SqlServerOffset, PaginationStrategy::None);
        assert_ne!(PaginationStrategy::InMemory, PaginationStrategy::None);
        assert_ne!(PaginationStrategy::SubqueryOffset, PaginationStrategy::None);
    }

    #[cfg(feature = "postgres")]
    #[test]
    fn sql_driver_defaults_to_subquery_offset() {
        let d = driver_for_kind(DatabaseKind::Postgres).unwrap();
        assert_eq!(d.pagination_strategy(), PaginationStrategy::SubqueryOffset);
    }
}
