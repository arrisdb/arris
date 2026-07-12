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

use clickhouse::Client;
use clickhouse::query::BytesCursor;
use futures::stream::{self, BoxStream, StreamExt};
use serde::Deserialize;

use crate::drivers::constants::STREAM_CHUNK_ROWS;
use crate::drivers::errors::{DriverError, Result};
use crate::{ColumnSpec, QueryResult, QueryValue, RowChunkStream};

use super::constants::STREAM_FORMAT;
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

// ── streaming (JSONCompactEachRowWithNamesAndTypes) ─────────────────────────

/// Owns the byte cursor plus a buffer of not-yet-split bytes for the stream's
/// life. Dropping it drops the cursor, which aborts the ClickHouse HTTP request.
struct StreamState {
    cursor: BytesCursor,
    buf: Vec<u8>,
    types: Vec<String>,
    cursor_done: bool,
}

/// Pops the next newline-delimited line out of `buf`; on `cursor_done` the
/// trailing unterminated bytes count as the final line.
fn take_line(buf: &mut Vec<u8>, cursor_done: bool) -> Option<Vec<u8>> {
    if let Some(pos) = buf.iter().position(|&b| b == b'\n') {
        let line = buf[..pos].to_vec();
        buf.drain(..=pos);
        Some(line)
    } else if cursor_done && !buf.is_empty() {
        Some(std::mem::take(buf))
    } else {
        None
    }
}

/// Reads the next line, refilling from the cursor until one is complete or the
/// response ends.
async fn read_line(
    cursor: &mut BytesCursor,
    buf: &mut Vec<u8>,
    cursor_done: &mut bool,
) -> Result<Option<Vec<u8>>> {
    loop {
        if let Some(line) = take_line(buf, *cursor_done) {
            return Ok(Some(line));
        }
        if *cursor_done {
            return Ok(None);
        }
        match cursor
            .next()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
        {
            Some(chunk) => buf.extend_from_slice(&chunk),
            None => *cursor_done = true,
        }
    }
}

/// A header line (names or types) is a JSON array of strings.
fn parse_string_array(line: &[u8]) -> Result<Vec<String>> {
    serde_json::from_slice(line).map_err(DriverError::Serde)
}

/// Decodes one JSON row array against the column types.
fn decode_row(line: &[u8], types: &[String]) -> Result<Vec<QueryValue>> {
    let cells: Vec<serde_json::Value> = serde_json::from_slice(line).map_err(DriverError::Serde)?;
    Ok(cells
        .iter()
        .enumerate()
        .map(|(i, cell)| decode_cell(types.get(i).map(String::as_str).unwrap_or("String"), cell))
        .collect())
}

/// Fetches a `SELECT`-shape statement in a row-per-line format, reading the two
/// header lines up front for columns, then streaming row chunks as they arrive.
pub(super) async fn stream_select(client: &Client, sql: &str) -> Result<RowChunkStream> {
    let mut cursor = client
        .query(sql)
        .fetch_bytes(STREAM_FORMAT)
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let mut buf: Vec<u8> = Vec::new();
    let mut cursor_done = false;

    let header_err = || DriverError::QueryFailed("clickhouse stream missing header".into());
    let names = read_line(&mut cursor, &mut buf, &mut cursor_done)
        .await?
        .ok_or_else(header_err)?;
    let types_line = read_line(&mut cursor, &mut buf, &mut cursor_done)
        .await?
        .ok_or_else(header_err)?;
    let names = parse_string_array(&names)?;
    let types = parse_string_array(&types_line)?;
    let columns: Vec<ColumnSpec> = names
        .iter()
        .zip(types.iter())
        .map(|(n, t)| ColumnSpec::new(n, t))
        .collect();

    let state = StreamState { cursor, buf, types, cursor_done };
    let chunks: BoxStream<'static, std::result::Result<Vec<Vec<QueryValue>>, DriverError>> =
        stream::unfold(state, |mut st| async move {
            let mut chunk: Vec<Vec<QueryValue>> = Vec::new();
            loop {
                match read_line(&mut st.cursor, &mut st.buf, &mut st.cursor_done).await {
                    Ok(Some(line)) => {
                        if line.is_empty() {
                            continue;
                        }
                        match decode_row(&line, &st.types) {
                            Ok(row) => {
                                chunk.push(row);
                                if chunk.len() >= STREAM_CHUNK_ROWS {
                                    break;
                                }
                            }
                            Err(e) => {
                                st.cursor_done = true;
                                return Some((Err(e), st));
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        st.cursor_done = true;
                        return Some((Err(e), st));
                    }
                }
            }
            if chunk.is_empty() {
                None
            } else {
                Some((Ok(chunk), st))
            }
        })
        .boxed();

    Ok(RowChunkStream { columns, chunks })
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

    #[test]
    fn take_line_splits_on_newline_and_keeps_remainder() {
        let mut buf = b"one\ntwo\nthr".to_vec();
        assert_eq!(take_line(&mut buf, false), Some(b"one".to_vec()));
        assert_eq!(take_line(&mut buf, false), Some(b"two".to_vec()));
        // No trailing newline and more may come: hold the partial line.
        assert_eq!(take_line(&mut buf, false), None);
        // Cursor drained: the partial line is the last line.
        assert_eq!(take_line(&mut buf, true), Some(b"thr".to_vec()));
        assert_eq!(take_line(&mut buf, true), None);
    }

    #[test]
    fn parse_string_array_reads_header() {
        assert_eq!(
            parse_string_array(br#"["id","name"]"#).unwrap(),
            vec!["id".to_owned(), "name".to_owned()]
        );
    }

    #[test]
    fn decode_row_uses_column_types() {
        let types = vec!["UInt64".to_owned(), "String".to_owned(), "Float64".to_owned()];
        let row = decode_row(br#"["1","alice",9.5]"#, &types).unwrap();
        assert_eq!(
            row,
            vec![
                QueryValue::Int(1),
                QueryValue::Text("alice".into()),
                QueryValue::Double(9.5),
            ]
        );
    }
}
