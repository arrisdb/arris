use indexmap::IndexMap;
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde_json::Value;

use crate::QueryValue;

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
