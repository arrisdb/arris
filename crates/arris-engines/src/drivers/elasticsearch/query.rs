use std::collections::VecDeque;

use futures_util::stream;
use indexmap::IndexMap;
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use reqwest::Client;
use serde_json::Value;

use crate::drivers::common::RowChunkPump;
use crate::drivers::errors::{DriverError, Result};
use crate::{ColumnSpec, QueryValue, RowChunkStream};

use super::constants::ES_SQL_FETCH_SIZE;

pub(super) struct ParsedRequest {
    pub(super) method: String,
    pub(super) path: String,
    pub(super) body: Option<String>,
}

pub(super) fn parse_request(text: &str, default_index: &str) -> ParsedRequest {
    let trimmed = text.trim();
    let first_line_end = trimmed.find('\n').unwrap_or(trimmed.len());
    let first_line = trimmed[..first_line_end].trim();

    let methods = ["GET", "POST", "PUT", "DELETE", "HEAD"];
    for m in &methods {
        if let Some(rest) = first_line.strip_prefix(m) {
            let path = rest.trim().to_owned();
            let body = if first_line_end < trimmed.len() {
                let b = trimmed[first_line_end + 1..].trim();
                if b.is_empty() {
                    None
                } else {
                    Some(b.to_owned())
                }
            } else {
                None
            };
            return ParsedRequest {
                method: m.to_string(),
                path,
                body,
            };
        }
    }

    let index = if default_index.is_empty() {
        "_all"
    } else {
        default_index
    };
    ParsedRequest {
        method: "POST".into(),
        path: format!("/{index}/_search"),
        body: Some(trimmed.to_owned()),
    }
}

pub(super) fn es_value_to_query(v: &Value) -> QueryValue {
    match v {
        Value::Null => QueryValue::Null,
        Value::Bool(b) => QueryValue::Bool(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                QueryValue::Int(i)
            } else if let Some(f) = n.as_f64() {
                QueryValue::Double(f)
            } else {
                QueryValue::Text(n.to_string())
            }
        }
        Value::String(s) => QueryValue::Text(s.clone()),
        Value::Array(_) | Value::Object(_) => QueryValue::Json(v.to_string()),
    }
}

pub(super) fn flatten_source(source: &Value) -> IndexMap<String, QueryValue> {
    let mut map = IndexMap::new();
    if let Value::Object(obj) = source {
        for (k, v) in obj {
            map.insert(k.clone(), es_value_to_query(v));
        }
    }
    map
}

pub(super) fn query_value_to_json(v: &QueryValue) -> Value {
    match v {
        QueryValue::Null => Value::Null,
        QueryValue::Bool(b) => Value::Bool(*b),
        QueryValue::Int(i) => Value::Number((*i).into()),
        QueryValue::Double(f) => serde_json::Number::from_f64(*f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        QueryValue::Text(s) => Value::String(s.clone()),
        QueryValue::Data(b) => Value::String(b.iter().map(|byte| format!("{byte:02x}")).collect()),
        QueryValue::Json(j) => serde_json::from_str(j).unwrap_or(Value::String(j.clone())),
        // Emit the decimal as a JSON number so numeric queries match; fall back
        // to a string if it can't be parsed (e.g. out of f64 range).
        QueryValue::Decimal(s) => serde_json::from_str(s).unwrap_or_else(|_| Value::String(s.clone())),
    }
}

pub(super) fn encode_path_part(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

/// POST a `_sql` payload (first page or cursor continuation) and return the
/// parsed body, surfacing Elasticsearch's structured error on a non-2xx status.
pub(super) async fn post_sql_page(
    client: &Client,
    sql_url: &str,
    payload: &Value,
) -> Result<Value> {
    let resp = client
        .post(sql_url)
        .header("content-type", "application/json")
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    if !status.is_success() {
        let err_msg = body["error"]["reason"]
            .as_str()
            .or_else(|| body["error"]["root_cause"][0]["reason"].as_str())
            .or_else(|| body["error"].as_str())
            .unwrap_or("Unknown error");
        return Err(DriverError::QueryFailed(format!("HTTP {status}: {err_msg}")));
    }
    Ok(body)
}

/// The initial `_sql` request body: the query plus the cursor page size.
pub(super) fn sql_first_payload(sql: &str) -> Value {
    serde_json::json!({
        "query": sql.trim().trim_end_matches(';'),
        "fetch_size": ES_SQL_FETCH_SIZE,
    })
}

pub(super) fn sql_columns(body: &Value) -> Vec<ColumnSpec> {
    body["columns"]
        .as_array()
        .map(|cols| {
            cols.iter()
                .map(|c| {
                    ColumnSpec::new(
                        c["name"].as_str().unwrap_or("?"),
                        c["type"].as_str().unwrap_or("dynamic"),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn sql_rows(body: &Value) -> Vec<Vec<QueryValue>> {
    body["rows"]
        .as_array()
        .map(|rs| {
            rs.iter()
                .map(|row| {
                    row.as_array()
                        .map(|cells| cells.iter().map(es_value_to_query).collect())
                        .unwrap_or_default()
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The pagination cursor, present until the final page.
pub(super) fn sql_cursor(body: &Value) -> Option<String> {
    body["cursor"]
        .as_str()
        .filter(|c| !c.is_empty())
        .map(ToOwned::to_owned)
}

/// State threaded through the cursor unfold: buffered rows of the current page
/// plus the token for the next page (`None` once exhausted or on error).
struct SqlCursor {
    client: Client,
    sql_url: String,
    pending: VecDeque<Vec<QueryValue>>,
    cursor: Option<String>,
}

/// Stream a SQL SELECT via the `_sql` cursor: the first page carries the column
/// metadata and first rows, then each cursor round trip yields the next page,
/// pumped onto a chunked, backpressured stream. Column types are declared by ES,
/// so no sampling is needed.
pub(super) async fn stream_sql(
    client: Client,
    base_url: String,
    sql: &str,
) -> Result<RowChunkStream> {
    let sql_url = format!("{base_url}/_sql");
    let first = post_sql_page(&client, &sql_url, &sql_first_payload(sql)).await?;
    let columns = sql_columns(&first);
    let state = SqlCursor {
        client,
        sql_url,
        pending: sql_rows(&first).into(),
        cursor: sql_cursor(&first),
    };

    let rows = stream::unfold(state, |mut s| async move {
        loop {
            if let Some(row) = s.pending.pop_front() {
                return Some((Ok(row), s));
            }
            let cursor = s.cursor.take()?;
            match post_sql_page(&s.client, &s.sql_url, &serde_json::json!({ "cursor": cursor })).await
            {
                Ok(body) => {
                    s.pending = sql_rows(&body).into();
                    s.cursor = sql_cursor(&body);
                }
                // cursor is now None and pending empty, so the next poll ends the stream.
                Err(e) => return Some((Err(e), s)),
            }
        }
    });

    Ok(RowChunkPump::spawn(
        columns,
        move || async move { Ok(rows) },
        |row| row,
    ))
}
