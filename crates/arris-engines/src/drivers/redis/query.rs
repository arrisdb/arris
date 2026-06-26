use redis::aio::MultiplexedConnection;
use redis::AsyncCommands;

use crate::{ColumnSpec, DriverError, QueryValue};
use crate::drivers::errors::Result;

use super::format::{format_value, value_sort_key, RedisResult};
use super::parser::{parse_commands, RedisSqlQuery};

pub(super) async fn run_native_commands(conn: &mut MultiplexedConnection, text: &str) -> Result<RedisResult> {
    let commands = parse_commands(text);
    if commands.is_empty() {
        return Ok(RedisResult::empty());
    }

    let mut last_result = RedisResult::empty();

    for args in &commands {
        if args.is_empty() {
            continue;
        }
        let mut cmd = redis::cmd(&args[0]);
        for a in &args[1..] {
            cmd.arg(a.as_str());
        }
        let val: redis::Value = cmd
            .query_async(conn)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        last_result = format_value(&val, &args[0]);
    }

    Ok(last_result)
}

pub(super) async fn run_redis_sql(
    conn: &mut MultiplexedConnection,
    query: RedisSqlQuery,
    home_db: i64,
) -> Result<RedisResult> {
    // A `dbN.` prefix targets a specific database for this read; hop to it,
    // run, then return the connection to its home database so later queries
    // are unaffected.
    let target_db = match &query {
        RedisSqlQuery::Keys { db, .. } => *db,
        RedisSqlQuery::Key { db, .. } => *db,
    };
    if let Some(db) = target_db {
        select_db(conn, db).await?;
    }

    let result = match query {
        RedisSqlQuery::Keys { pattern, limit, .. } => scan_key_rows(conn, &pattern, limit).await,
        RedisSqlQuery::Key { key, .. } => read_key(conn, &key).await,
    };

    if target_db.is_some() {
        let restored = select_db(conn, home_db).await;
        // Surface the read's own error first if it failed.
        if result.is_ok() {
            restored?;
        }
    }
    result
}

async fn select_db(conn: &mut MultiplexedConnection, db: i64) -> Result<()> {
    redis::cmd("SELECT")
        .arg(db)
        .query_async::<()>(conn)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))
}

async fn scan_key_rows(
    conn: &mut MultiplexedConnection,
    pattern: &str,
    limit: usize,
) -> Result<RedisResult> {
    let columns = vec![
        ColumnSpec {
            name: "key".into(),
            type_hint: "text".into(),
        },
        ColumnSpec {
            name: "type".into(),
            type_hint: "text".into(),
        },
    ];
    if limit == 0 {
        return Ok(RedisResult {
            columns,
            rows: vec![],
            rows_affected: None,
        });
    }

    let mut rows = Vec::new();
    let mut cursor: u64 = 0;
    loop {
        let (next_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(pattern)
            .arg("COUNT")
            .arg(100)
            .query_async(conn)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        for key in batch {
            let key_type: String = conn
                .key_type(&key)
                .await
                .unwrap_or_else(|_| "unknown".to_string());
            rows.push(vec![QueryValue::Text(key), QueryValue::Text(key_type)]);
            if rows.len() >= limit {
                rows.sort_by(|a, b| value_sort_key(&a[0]).cmp(&value_sort_key(&b[0])));
                return Ok(RedisResult { columns, rows, rows_affected: None });
            }
        }

        cursor = next_cursor;
        if cursor == 0 {
            break;
        }
    }

    rows.sort_by(|a, b| value_sort_key(&a[0]).cmp(&value_sort_key(&b[0])));
    Ok(RedisResult { columns, rows, rows_affected: None })
}

async fn read_key(conn: &mut MultiplexedConnection, key: &str) -> Result<RedisResult> {
    let key_type: String = conn
        .key_type(key)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    if key_type == "none" {
        return Ok(format_value(&redis::Value::Nil, "SELECT"));
    }

    let val: redis::Value = match key_type.as_str() {
        "string" => redis::cmd("GET").arg(key).query_async(conn).await,
        "hash" => redis::cmd("HGETALL").arg(key).query_async(conn).await,
        "list" => {
            redis::cmd("LRANGE")
                .arg(key)
                .arg(0)
                .arg(-1)
                .query_async(conn)
                .await
        }
        "set" => redis::cmd("SMEMBERS").arg(key).query_async(conn).await,
        "zset" => {
            redis::cmd("ZRANGE")
                .arg(key)
                .arg(0)
                .arg(-1)
                .arg("WITHSCORES")
                .query_async(conn)
                .await
        }
        "stream" => {
            redis::cmd("XRANGE")
                .arg(key)
                .arg("-")
                .arg("+")
                .query_async(conn)
                .await
        }
        _ => redis::cmd("TYPE").arg(key).query_async(conn).await,
    }
    .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    Ok(format_value(&val, "SELECT"))
}
