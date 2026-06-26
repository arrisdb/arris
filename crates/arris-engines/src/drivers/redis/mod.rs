mod format;
mod parser;
mod query;
mod schema;

use async_trait::async_trait;
use crate::{
    ConnectionConfig, DriverError, ExplainMode, MutationResult, PlanResult, QueryLanguage,
    QueryResult, QueryValue, RowDelete, RowInsert, SchemaNode, SchemaNodeKind, TableRef,
};
use crate::drivers::errors::Result;
use redis::Client;
use redis::aio::MultiplexedConnection;
use tokio::sync::Mutex;

use crate::drivers::DatabaseDriver;

use parser::parse_redis_sql;
use query::{run_native_commands, run_redis_sql};
use schema::scan_keys;

pub struct RedisDriver {
    inner: Mutex<Option<RedisState>>,
}

struct RedisState {
    conn: MultiplexedConnection,
    #[allow(dead_code)]
    client: Client,
    /// The database the connection was opened on; schema browsing hops across
    /// databases via SELECT and returns here when done.
    home_db: i64,
}

impl RedisDriver {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    fn build_url(config: &ConnectionConfig) -> String {
        let scheme = if config.ssl_mode.forces_tls() { "rediss" } else { "redis" };
        let host = if config.host.is_empty() {
            "127.0.0.1"
        } else {
            &config.host
        };
        let port = if config.port > 0 { config.port } else { 6379 };
        let db = if config.database.is_empty() {
            "0".to_string()
        } else {
            config.database.clone()
        };

        if !config.user.is_empty() || !config.password.is_empty() {
            let user = &config.user;
            let pass = &config.password;
            format!("{scheme}://{user}:{pass}@{host}:{port}/{db}")
        } else {
            format!("{scheme}://{host}:{port}/{db}")
        }
    }
}

#[async_trait]
impl DatabaseDriver for RedisDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let url = Self::build_url(config);
        let client =
            Client::open(url.as_str()).map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
        let conn = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        let home_db = config.database.parse::<i64>().unwrap_or(0);

        let mut guard = self.inner.lock().await;
        *guard = Some(RedisState { conn, client, home_db });
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        let mut guard = self.inner.lock().await;
        if let Some(state) = guard.as_mut() {
            redis::cmd("PING")
                .query_async::<String>(&mut state.conn)
                .await
                .is_ok()
        } else {
            false
        }
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let mut guard = self.inner.lock().await;
        let state = guard.as_mut().ok_or(DriverError::NotConnected)?;

        let info: String = redis::cmd("INFO")
            .arg("keyspace")
            .query_async(&mut state.conn)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let mut databases = Vec::new();
        for line in info.lines() {
            let line = line.trim();
            if !line.starts_with("db") {
                continue;
            }
            let Some((db_name, detail)) = line.split_once(':') else {
                continue;
            };

            let db_index: i64 = db_name.trim_start_matches("db").parse().unwrap_or(state.home_db);
            let keys = scan_keys(&mut state.conn, db_index).await?;

            databases.push(SchemaNode {
                name: db_name.to_string(),
                kind: SchemaNodeKind::Database,
                path: db_name.to_string(),
                detail: Some(detail.to_string()),
                children: keys,
            });
        }

        if databases.is_empty() {
            let keys = scan_keys(&mut state.conn, state.home_db).await?;
            databases.push(SchemaNode {
                name: format!("db{}", state.home_db),
                kind: SchemaNodeKind::Database,
                path: format!("db{}", state.home_db),
                detail: Some("keys=0".to_string()),
                children: keys,
            });
        }

        // scan_keys left the connection on whichever database it scanned last;
        // return it to the one the user is querying against.
        redis::cmd("SELECT")
            .arg(state.home_db)
            .query_async::<()>(&mut state.conn)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        Ok(databases)
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let all = self.list_schemas().await?;
        Ok(crate::drivers::common::schema::find_schema_node(&all, schema))
    }

    async fn run_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryResult> {
        let start = std::time::Instant::now();
        let mut guard = self.inner.lock().await;
        let state = guard.as_mut().ok_or(DriverError::NotConnected)?;

        let home_db = state.home_db;
        let last_result = match language {
            QueryLanguage::Sql => match parse_redis_sql(text)? {
                Some(query) => run_redis_sql(&mut state.conn, query, home_db).await?,
                None => run_native_commands(&mut state.conn, text).await?,
            },
            QueryLanguage::Native => run_native_commands(&mut state.conn, text).await?,
        };

        Ok(QueryResult {
            columns: last_result.columns,
            rows: last_result.rows,
            rows_affected: last_result.rows_affected,
            has_more: None,
            elapsed: start.elapsed().as_secs_f64(),
            ..Default::default()
        })
    }

    async fn supports_explain(&self, _mode: ExplainMode) -> bool {
        false
    }

    async fn explain_query(
        &self,
        _text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
        _mode: ExplainMode,
    ) -> Result<PlanResult> {
        Err(DriverError::ExplainUnsupported)
    }

    async fn primary_key(&self, _table: &TableRef) -> Result<Option<Vec<String>>> {
        Ok(None)
    }

    async fn update_row(
        &self,
        _table: &TableRef,
        _primary_key: &crate::ValueMap,
        _changes: &crate::ValueMap,
    ) -> Result<MutationResult> {
        Err(DriverError::Other(
            "Redis keys are read-only via query editor".into(),
        ))
    }

    async fn insert_rows(
        &self,
        _table: &TableRef,
        _inserts: &[RowInsert],
    ) -> Result<MutationResult> {
        Err(DriverError::Other(
            "Redis keys are read-only via query editor".into(),
        ))
    }

    async fn delete_rows(
        &self,
        _table: &TableRef,
        _deletes: &[RowDelete],
    ) -> Result<MutationResult> {
        Err(DriverError::Other(
            "Redis keys are read-only via query editor".into(),
        ))
    }

    fn pagination_strategy(&self) -> crate::PaginationStrategy {
        crate::PaginationStrategy::None
    }

    async fn close(&self) {
        let mut guard = self.inner.lock().await;
        *guard = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use format::{format_value, is_write_command, value_to_json, value_to_query_value};
    use parser::parse_commands;
    use schema::redis_key_kind;

    #[test]
    fn driver_starts_disconnected() {
        let driver = RedisDriver::new();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        assert!(!rt.block_on(driver.is_connected()));
    }

    fn test_config() -> ConnectionConfig {
        ConnectionConfig::new("test", crate::DatabaseKind::Redis)
    }

    #[test]
    fn build_url_defaults() {
        let config = test_config();
        assert_eq!(RedisDriver::build_url(&config), "redis://127.0.0.1:6379/0");
    }

    #[test]
    fn build_url_with_auth() {
        let mut config = test_config();
        config.host = "myhost".into();
        config.port = 6380;
        config.database = "2".into();
        config.user = "admin".into();
        config.password = "secret".into();
        assert_eq!(
            RedisDriver::build_url(&config),
            "redis://admin:secret@myhost:6380/2"
        );
    }

    #[test]
    fn build_url_tls() {
        let mut config = test_config();
        config.host = "secure.redis.io".into();
        config.port = 6379;
        config.ssl_mode = crate::SslMode::Required;
        assert_eq!(
            RedisDriver::build_url(&config),
            "rediss://secure.redis.io:6379/0"
        );
    }

    #[test]
    fn parse_simple_commands() {
        let cmds = parse_commands("SET mykey myvalue\nGET mykey");
        assert_eq!(cmds.len(), 2);
        assert_eq!(cmds[0], vec!["SET", "mykey", "myvalue"]);
        assert_eq!(cmds[1], vec!["GET", "mykey"]);
    }

    #[test]
    fn parse_quoted_strings() {
        let cmds = parse_commands(r#"SET mykey "hello world""#);
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0], vec!["SET", "mykey", "hello world"]);
    }

    #[test]
    fn parse_single_quoted_strings() {
        let cmds = parse_commands("SET mykey 'hello world'");
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0], vec!["SET", "mykey", "hello world"]);
    }

    #[test]
    fn parse_escaped_quotes() {
        let cmds = parse_commands(r#"SET mykey "hello \"world\"""#);
        assert_eq!(cmds[0], vec!["SET", "mykey", r#"hello "world""#]);
    }

    #[test]
    fn parse_skips_comments_and_blanks() {
        let cmds = parse_commands("# comment\n\nSET a b\n// another comment\nGET a");
        assert_eq!(cmds.len(), 2);
        assert_eq!(cmds[0][0], "SET");
        assert_eq!(cmds[1][0], "GET");
    }

    #[test]
    fn parse_strips_trailing_semicolons() {
        let cmds = parse_commands("GET mykey;\nHGETALL user:1;");
        assert_eq!(cmds[0], vec!["GET", "mykey"]);
        assert_eq!(cmds[1], vec!["HGETALL", "user:1"]);
    }

    #[test]
    fn parse_command_uppercases_command_only() {
        let cmds = parse_commands("set mykey myvalue");
        assert_eq!(cmds[0], vec!["SET", "mykey", "myvalue"]);
    }

    #[test]
    fn parse_preserves_quoted_case() {
        let cmds = parse_commands(r#"set "MyKey" "MyValue""#);
        assert_eq!(cmds[0], vec!["SET", "MyKey", "MyValue"]);
    }

    #[test]
    fn parse_sql_lists_keys() {
        let query = parse_redis_sql("select * from keys").unwrap();
        assert_eq!(
            query,
            Some(parser::RedisSqlQuery::Keys {
                db: None,
                pattern: "*".into(),
                limit: 1000,
            })
        );
    }

    #[test]
    fn parse_sql_key_pattern_and_limit() {
        let query = parse_redis_sql("SELECT * FROM keys WHERE key LIKE 'user:*' LIMIT 25").unwrap();
        assert_eq!(
            query,
            Some(parser::RedisSqlQuery::Keys {
                db: None,
                pattern: "user:*".into(),
                limit: 25,
            })
        );
    }

    #[test]
    fn parse_sql_quoted_key_with_trailing_limit() {
        // A quoted bare key (no db prefix) reads from the connection's home db.
        let query = parse_redis_sql(r#"SELECT * FROM "customers:1" LIMIT 500"#).unwrap();
        assert_eq!(
            query,
            Some(parser::RedisSqlQuery::Key {
                db: None,
                key: "customers:1".into()
            })
        );
    }

    #[test]
    fn parse_sql_db_qualified_key() {
        // The exact string the table-browse builder emits: `dbN.<key>` selects
        // the database before reading the key.
        let query = parse_redis_sql("SELECT * FROM db1.cache:stats LIMIT 500").unwrap();
        assert_eq!(
            query,
            Some(parser::RedisSqlQuery::Key {
                db: Some(1),
                key: "cache:stats".into()
            })
        );
    }

    #[test]
    fn parse_sql_db_qualified_keys_listing() {
        let query = parse_redis_sql("SELECT * FROM db2.keys WHERE key LIKE 'cache:*'").unwrap();
        assert_eq!(
            query,
            Some(parser::RedisSqlQuery::Keys {
                db: Some(2),
                pattern: "cache:*".into(),
                limit: 1000,
            })
        );
    }

    #[test]
    fn parse_sql_quoted_key_source() {
        let query = parse_redis_sql(r#"SELECT * FROM "user:1""#).unwrap();
        assert_eq!(
            query,
            Some(parser::RedisSqlQuery::Key {
                db: None,
                key: "user:1".into()
            })
        );
    }

    #[test]
    fn parse_sql_falls_back_for_native_commands() {
        assert_eq!(parse_redis_sql("GET user:1").unwrap(), None);
    }

    #[test]
    fn parse_sql_rejects_missing_from() {
        assert!(parse_redis_sql("SELECT *").is_err());
    }

    #[test]
    fn format_nil_value() {
        let result = format_value(&redis::Value::Nil, "GET");
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0][0], QueryValue::Null);
    }

    #[test]
    fn format_int_value() {
        let result = format_value(&redis::Value::Int(42), "INCR");
        assert_eq!(result.rows[0][0], QueryValue::Int(42));
    }

    #[test]
    fn format_bulk_string() {
        let result = format_value(&redis::Value::BulkString(b"hello".to_vec()), "GET");
        assert_eq!(result.rows[0][0], QueryValue::Text("hello".into()));
    }

    #[test]
    fn format_array_value() {
        let arr = redis::Value::Array(vec![
            redis::Value::BulkString(b"a".to_vec()),
            redis::Value::BulkString(b"b".to_vec()),
        ]);
        let result = format_value(&arr, "KEYS");
        assert_eq!(result.columns.len(), 2);
        assert_eq!(result.columns[0].name, "index");
        assert_eq!(result.columns[1].name, "value");
        assert_eq!(result.rows.len(), 2);
    }

    #[test]
    fn format_ok_value() {
        let result = format_value(&redis::Value::Okay, "SET");
        assert_eq!(result.rows[0][0], QueryValue::Text("OK".into()));
    }

    #[test]
    fn read_only_rejects_mutations() {
        let driver = RedisDriver::new();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let table = TableRef {
            database: None,
            schema: None,
            name: "t".into(),
        };
        assert!(rt.block_on(driver.insert_rows(&table, &[])).is_err());
        assert!(rt.block_on(driver.delete_rows(&table, &[])).is_err());
        assert!(
            rt.block_on(driver.update_row(&table, &crate::ValueMap::new(), &crate::ValueMap::new()))
                .is_err()
        );
    }

    #[test]
    fn nested_array_serializes_as_json() {
        let nested = redis::Value::Array(vec![
            redis::Value::BulkString(b"a".to_vec()),
            redis::Value::Int(42),
        ]);
        let qv = value_to_query_value(&nested);
        match &qv {
            QueryValue::Json(s) => {
                let parsed: serde_json::Value = serde_json::from_str(s).unwrap();
                assert_eq!(parsed, serde_json::json!(["a", 42]));
            }
            other => panic!("expected QueryValue::Json, got {other:?}"),
        }
    }

    #[test]
    fn nested_map_serializes_as_json() {
        let map = redis::Value::Map(vec![(
            redis::Value::BulkString(b"key".to_vec()),
            redis::Value::Int(1),
        )]);
        let qv = value_to_query_value(&map);
        match &qv {
            QueryValue::Json(s) => {
                let parsed: serde_json::Value = serde_json::from_str(s).unwrap();
                assert_eq!(parsed, serde_json::json!({"key": 1}));
            }
            other => panic!("expected QueryValue::Json, got {other:?}"),
        }
    }

    #[test]
    fn write_command_sets_rows_affected() {
        let result = format_value(&redis::Value::Int(3), "DEL");
        assert_eq!(result.rows_affected, Some(3));
    }

    #[test]
    fn write_command_ok_sets_rows_affected_one() {
        let result = format_value(&redis::Value::Okay, "SET");
        assert_eq!(result.rows_affected, Some(1));
    }

    #[test]
    fn read_command_has_no_rows_affected() {
        let result = format_value(&redis::Value::Int(42), "GET");
        assert_eq!(result.rows_affected, None);
    }

    #[test]
    fn is_write_command_detects_writes() {
        assert!(is_write_command("SET"));
        assert!(is_write_command("DEL"));
        assert!(is_write_command("LPUSH"));
        assert!(is_write_command("set"));
        assert!(!is_write_command("GET"));
        assert!(!is_write_command("KEYS"));
        assert!(!is_write_command("SCAN"));
    }

    #[test]
    fn pagination_strategy_is_none() {
        let driver = RedisDriver::new();
        assert_eq!(driver.pagination_strategy(), crate::PaginationStrategy::None);
    }

    #[test]
    fn redis_key_kind_maps_supported_types() {
        assert_eq!(redis_key_kind("string"), SchemaNodeKind::RedisStringKey);
        assert_eq!(redis_key_kind("list"), SchemaNodeKind::RedisListKey);
        assert_eq!(redis_key_kind("set"), SchemaNodeKind::RedisSetKey);
        assert_eq!(redis_key_kind("hash"), SchemaNodeKind::RedisHashKey);
        assert_eq!(redis_key_kind("zset"), SchemaNodeKind::RedisZsetKey);
        assert_eq!(redis_key_kind("stream"), SchemaNodeKind::RedisStreamKey);
        assert_eq!(redis_key_kind("module"), SchemaNodeKind::Key);
    }

    #[test]
    fn value_to_json_converts_types() {
        assert_eq!(value_to_json(&redis::Value::Nil), serde_json::Value::Null);
        assert_eq!(value_to_json(&redis::Value::Int(7)), serde_json::json!(7));
        assert_eq!(
            value_to_json(&redis::Value::BulkString(b"hello".to_vec())),
            serde_json::json!("hello")
        );
        assert_eq!(
            value_to_json(&redis::Value::Boolean(true)),
            serde_json::json!(true)
        );
    }
}
