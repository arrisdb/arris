use redis::aio::MultiplexedConnection;
use redis::AsyncCommands;

use crate::{DriverError, SchemaNode, SchemaNodeKind};
use crate::drivers::errors::Result;

pub(super) fn redis_key_kind(key_type: &str) -> SchemaNodeKind {
    match key_type {
        "string" => SchemaNodeKind::RedisStringKey,
        "list" => SchemaNodeKind::RedisListKey,
        "set" => SchemaNodeKind::RedisSetKey,
        "hash" => SchemaNodeKind::RedisHashKey,
        "zset" => SchemaNodeKind::RedisZsetKey,
        "stream" => SchemaNodeKind::RedisStreamKey,
        _ => SchemaNodeKind::Key,
    }
}

pub(super) async fn scan_keys(conn: &mut MultiplexedConnection, db_index: i64) -> Result<Vec<SchemaNode>> {
    // SCAN only ever sees the connection's currently-selected database, so switch
    // to the requested one first. The caller restores the home database afterwards.
    redis::cmd("SELECT")
        .arg(db_index)
        .query_async::<()>(conn)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let db_name = format!("db{db_index}");
    let mut keys = Vec::new();
    let mut cursor: u64 = 0;
    let max_keys = 1000;

    loop {
        let (next_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("COUNT")
            .arg(100)
            .query_async(conn)
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        for key in &batch {
            let key_type: String = conn
                .key_type(key)
                .await
                .unwrap_or_else(|_| "unknown".to_string());

            keys.push(SchemaNode {
                name: key.clone(),
                kind: redis_key_kind(&key_type),
                path: format!("{db_name}.{key}"),
                detail: Some(key_type),
                children: vec![],
            });
        }

        cursor = next_cursor;
        if cursor == 0 || keys.len() >= max_keys {
            break;
        }
    }

    keys.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(keys)
}
