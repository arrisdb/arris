use crate::{ColumnSpec, QueryValue};

const WRITE_COMMANDS: &[&str] = &[
    "SET", "SETNX", "SETEX", "PSETEX", "MSET", "MSETNX", "APPEND",
    "DEL", "UNLINK", "EXPIRE", "EXPIREAT", "PEXPIRE", "PEXPIREAT", "PERSIST",
    "LPUSH", "RPUSH", "LPOP", "RPOP", "LSET", "LREM", "LTRIM", "LINSERT",
    "SADD", "SREM", "SPOP", "SMOVE",
    "ZADD", "ZREM", "ZINCRBY", "ZRANGESTORE",
    "HSET", "HSETNX", "HMSET", "HDEL", "HINCRBY", "HINCRBYFLOAT",
    "INCR", "INCRBY", "INCRBYFLOAT", "DECR", "DECRBY",
    "RENAME", "RENAMENX", "COPY", "MOVE",
    "XADD", "XDEL", "XTRIM",
    "GEOADD", "GEOREMOVE",
    "PFADD", "PFMERGE",
];

pub(super) struct RedisResult {
    pub(super) columns: Vec<ColumnSpec>,
    pub(super) rows: Vec<Vec<QueryValue>>,
    pub(super) rows_affected: Option<i64>,
}

impl RedisResult {
    pub(super) fn empty() -> Self {
        Self {
            columns: vec![],
            rows: vec![],
            rows_affected: None,
        }
    }

    fn single(value: QueryValue) -> Self {
        Self {
            columns: vec![ColumnSpec {
                name: "result".into(),
                type_hint: "text".into(),
            }],
            rows: vec![vec![value]],
            rows_affected: None,
        }
    }
}

pub(super) fn is_write_command(cmd: &str) -> bool {
    WRITE_COMMANDS.iter().any(|c| c.eq_ignore_ascii_case(cmd))
}

pub(super) fn format_value(val: &redis::Value, cmd: &str) -> RedisResult {
    let mut result = match val {
        redis::Value::Nil => RedisResult::single(QueryValue::Null),
        redis::Value::Int(i) => RedisResult::single(QueryValue::Int(*i)),
        redis::Value::BulkString(bytes) => {
            let s = String::from_utf8_lossy(bytes).to_string();
            RedisResult::single(QueryValue::Text(s))
        }
        redis::Value::SimpleString(s) => RedisResult::single(QueryValue::Text(s.clone())),
        redis::Value::Okay => RedisResult::single(QueryValue::Text("OK".into())),
        redis::Value::Array(arr) => format_array(arr),
        redis::Value::Map(pairs) => format_map(pairs),
        redis::Value::Double(f) => RedisResult::single(QueryValue::Double(*f)),
        redis::Value::Boolean(b) => RedisResult::single(QueryValue::Bool(*b)),
        redis::Value::VerbatimString { format: _, text } => {
            RedisResult::single(QueryValue::Text(text.clone()))
        }
        redis::Value::BigNumber(n) => RedisResult::single(QueryValue::Text(n.to_string())),
        redis::Value::Set(arr) => format_array(arr),
        redis::Value::Attribute {
            data,
            attributes: _,
        } => format_value(data, cmd),
        redis::Value::Push { kind: _, data } => format_array(data),
        redis::Value::ServerError(e) => RedisResult::single(QueryValue::Text(format!("ERR: {e}"))),
        _ => RedisResult::single(QueryValue::Text(format!("{val:?}"))),
    };

    if is_write_command(cmd) {
        result.rows_affected = match val {
            redis::Value::Int(n) => Some(*n),
            redis::Value::Okay => Some(1),
            _ => Some(0),
        };
    }

    result
}

fn format_array(arr: &[redis::Value]) -> RedisResult {
    let columns = vec![
        ColumnSpec {
            name: "index".into(),
            type_hint: "int".into(),
        },
        ColumnSpec {
            name: "value".into(),
            type_hint: "text".into(),
        },
    ];

    let rows: Vec<Vec<QueryValue>> = arr
        .iter()
        .enumerate()
        .map(|(i, v)| vec![QueryValue::Int(i as i64), value_to_query_value(v)])
        .collect();

    RedisResult { columns, rows, rows_affected: None }
}

fn format_map(pairs: &[(redis::Value, redis::Value)]) -> RedisResult {
    let columns = vec![
        ColumnSpec {
            name: "key".into(),
            type_hint: "text".into(),
        },
        ColumnSpec {
            name: "value".into(),
            type_hint: "text".into(),
        },
    ];

    let rows: Vec<Vec<QueryValue>> = pairs
        .iter()
        .map(|(k, v)| vec![value_to_query_value(k), value_to_query_value(v)])
        .collect();

    RedisResult { columns, rows, rows_affected: None }
}

pub(super) fn value_to_query_value(val: &redis::Value) -> QueryValue {
    match val {
        redis::Value::Nil => QueryValue::Null,
        redis::Value::Int(i) => QueryValue::Int(*i),
        redis::Value::BulkString(bytes) => {
            QueryValue::Text(String::from_utf8_lossy(bytes).to_string())
        }
        redis::Value::SimpleString(s) => QueryValue::Text(s.clone()),
        redis::Value::Okay => QueryValue::Text("OK".into()),
        redis::Value::Double(f) => QueryValue::Double(*f),
        redis::Value::Boolean(b) => QueryValue::Bool(*b),
        redis::Value::Array(_) | redis::Value::Set(_) | redis::Value::Push { .. } => {
            let json = value_to_json(val);
            QueryValue::Json(serde_json::to_string(&json).unwrap_or_else(|_| format!("{val:?}")))
        }
        redis::Value::Map(_) => {
            let json = value_to_json(val);
            QueryValue::Json(serde_json::to_string(&json).unwrap_or_else(|_| format!("{val:?}")))
        }
        redis::Value::VerbatimString { text, .. } => QueryValue::Text(text.clone()),
        redis::Value::BigNumber(n) => QueryValue::Text(n.to_string()),
        redis::Value::ServerError(e) => QueryValue::Text(format!("ERR: {e}")),
        redis::Value::Attribute { data, .. } => value_to_query_value(data),
        _ => QueryValue::Text(format!("{val:?}")),
    }
}

pub(super) fn value_to_json(val: &redis::Value) -> serde_json::Value {
    match val {
        redis::Value::Nil => serde_json::Value::Null,
        redis::Value::Int(i) => serde_json::json!(*i),
        redis::Value::BulkString(bytes) => {
            serde_json::Value::String(String::from_utf8_lossy(bytes).to_string())
        }
        redis::Value::SimpleString(s) => serde_json::Value::String(s.clone()),
        redis::Value::Okay => serde_json::Value::String("OK".into()),
        redis::Value::Double(f) => {
            serde_json::Number::from_f64(*f)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null)
        }
        redis::Value::Boolean(b) => serde_json::Value::Bool(*b),
        redis::Value::Array(arr)
        | redis::Value::Set(arr)
        | redis::Value::Push { data: arr, .. } => {
            serde_json::Value::Array(arr.iter().map(value_to_json).collect())
        }
        redis::Value::Map(pairs) => {
            let obj: serde_json::Map<String, serde_json::Value> = pairs
                .iter()
                .map(|(k, v)| {
                    let key = match k {
                        redis::Value::BulkString(b) => String::from_utf8_lossy(b).to_string(),
                        redis::Value::SimpleString(s) => s.clone(),
                        redis::Value::Int(i) => i.to_string(),
                        other => format!("{other:?}"),
                    };
                    (key, value_to_json(v))
                })
                .collect();
            serde_json::Value::Object(obj)
        }
        redis::Value::VerbatimString { text, .. } => serde_json::Value::String(text.clone()),
        redis::Value::BigNumber(n) => serde_json::Value::String(n.to_string()),
        redis::Value::ServerError(e) => serde_json::Value::String(format!("ERR: {e}")),
        redis::Value::Attribute { data, .. } => value_to_json(data),
        _ => serde_json::Value::String(format!("{val:?}")),
    }
}

pub(super) fn value_sort_key(value: &QueryValue) -> String {
    match value {
        QueryValue::Text(s) => s.clone(),
        other => format!("{other:?}"),
    }
}
