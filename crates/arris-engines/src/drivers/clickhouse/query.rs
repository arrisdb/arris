//! JSONCompact result parsing for the ClickHouse driver.
//!
//! `SELECT`-shape statements are fetched in ClickHouse's `JSONCompact` format,
//! a single document of the form:
//! ```json
//! { "meta": [ {"name": "x", "type": "UInt8"} ],
//!   "data": [ ["1"] ],
//!   "rows": 1 }
//! ```
//! [`parse_jsoncompact`] turns that into a [`QueryResult`], deriving
//! [`ColumnSpec`]s from `meta` (the ClickHouse type string is kept verbatim as
//! the `type_hint`) and decoding each cell against its column type.

use serde::Deserialize;

use crate::drivers::errors::{DriverError, Result};
use crate::{ColumnSpec, QueryResult, QueryValue};

use super::values::decode_cell;

#[derive(Deserialize)]
struct MetaEntry {
    name: String,
    #[serde(rename = "type")]
    ty: String,
}

#[derive(Deserialize)]
struct JsonCompact {
    #[serde(default)]
    meta: Vec<MetaEntry>,
    #[serde(default)]
    data: Vec<Vec<serde_json::Value>>,
}

/// Parses a `JSONCompact` response body into a [`QueryResult`].
pub(super) fn parse_jsoncompact(body: &[u8], elapsed: f64) -> Result<QueryResult> {
    let parsed: JsonCompact = serde_json::from_slice(body).map_err(DriverError::Serde)?;

    let columns: Vec<ColumnSpec> = parsed
        .meta
        .iter()
        .map(|m| ColumnSpec::new(&m.name, &m.ty))
        .collect();

    let types: Vec<&str> = parsed.meta.iter().map(|m| m.ty.as_str()).collect();
    let rows: Vec<Vec<QueryValue>> = parsed
        .data
        .iter()
        .map(|row| {
            row.iter()
                .enumerate()
                .map(|(i, cell)| decode_cell(types.get(i).copied().unwrap_or("String"), cell))
                .collect()
        })
        .collect();

    Ok(QueryResult {
        columns,
        rows,
        rows_affected: None,
        elapsed,
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_columns_rows_and_types() {
        let body = br#"{
            "meta": [
                {"name": "id", "type": "UInt64"},
                {"name": "name", "type": "String"},
                {"name": "score", "type": "Float64"}
            ],
            "data": [
                ["1", "alice", 9.5],
                ["2", "bob", 7.0]
            ],
            "rows": 2
        }"#;
        let r = parse_jsoncompact(body, 0.1).unwrap();
        assert_eq!(r.columns.len(), 3);
        assert_eq!(r.columns[0].name, "id");
        assert_eq!(r.columns[0].type_hint, "UInt64");
        assert_eq!(r.columns[2].type_hint, "Float64");
        assert_eq!(r.rows.len(), 2);
        assert_eq!(r.rows[0][0], QueryValue::Int(1));
        assert_eq!(r.rows[0][1], QueryValue::Text("alice".into()));
        assert_eq!(r.rows[0][2], QueryValue::Double(9.5));
    }

    #[test]
    fn parses_empty_result() {
        let body = br#"{"meta": [{"name":"x","type":"UInt8"}], "data": [], "rows": 0}"#;
        let r = parse_jsoncompact(body, 0.0).unwrap();
        assert_eq!(r.columns.len(), 1);
        assert!(r.rows.is_empty());
    }
}
