use std::collections::BTreeMap;

use futures::stream::{self, Stream, StreamExt, TryStreamExt};

use crate::drivers::common::RowChunkPump;
use crate::drivers::constants::STREAM_CHUNK_ROWS;
use crate::drivers::errors::{DriverError, Result};
use crate::drivers::types::RowChunkStream;
use crate::{ColumnSpec, QueryValue};

use super::api;
use super::constants::{TYPE_HINT_BIGINT, TYPE_HINT_BOOLEAN, TYPE_HINT_DOUBLE, TYPE_HINT_TEXT};
use super::sql_parser::{self, AggFunc, ColumnSelection, MixpanelQuery};

type RowStream = std::pin::Pin<Box<dyn Stream<Item = Result<BTreeMap<String, QueryValue>>> + Send>>;

pub(super) fn json_to_query_value(value: &serde_json::Value) -> QueryValue {
    match value {
        serde_json::Value::String(s) => QueryValue::Text(s.clone()),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                QueryValue::Int(i)
            } else if let Some(f) = n.as_f64() {
                QueryValue::Double(f)
            } else {
                QueryValue::Text(n.to_string())
            }
        }
        serde_json::Value::Bool(b) => QueryValue::Bool(*b),
        serde_json::Value::Null => QueryValue::Null,
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            QueryValue::Json(value.to_string())
        }
    }
}

fn select_columns_row(
    row: &BTreeMap<String, QueryValue>,
    query: &MixpanelQuery,
) -> BTreeMap<String, QueryValue> {
    let wants_all = query
        .columns
        .iter()
        .any(|c| matches!(c, ColumnSelection::All));
    if wants_all {
        return row.clone();
    }
    let names: Vec<&str> = query
        .columns
        .iter()
        .filter_map(|c| match c {
            ColumnSelection::Named(n) => Some(n.as_str()),
            _ => None,
        })
        .collect();
    if names.is_empty() {
        return row.clone();
    }
    names
        .into_iter()
        .map(|n| (n.to_string(), row.get(n).cloned().unwrap_or(QueryValue::Null)))
        .collect()
}

pub(super) fn select_columns(
    rows: &[BTreeMap<String, QueryValue>],
    query: &MixpanelQuery,
) -> Vec<BTreeMap<String, QueryValue>> {
    rows.iter().map(|row| select_columns_row(row, query)).collect()
}

fn type_hint(value: &QueryValue) -> &'static str {
    match value {
        QueryValue::Int(_) => TYPE_HINT_BIGINT,
        QueryValue::Double(_) => TYPE_HINT_DOUBLE,
        QueryValue::Bool(_) => TYPE_HINT_BOOLEAN,
        _ => TYPE_HINT_TEXT,
    }
}

// Column specs for an already-projected row set: names/types from the first row,
// or the parser's resolved names (typed `text`) when the result is empty.
pub(super) fn build_columns(
    query: &MixpanelQuery,
    projected: &[BTreeMap<String, QueryValue>],
) -> Vec<ColumnSpec> {
    match projected.first() {
        Some(first) => first
            .iter()
            .map(|(name, val)| ColumnSpec {
                name: name.clone(),
                type_hint: type_hint(val).into(),
            })
            .collect(),
        None => sql_parser::resolve_column_names(query)
            .into_iter()
            .map(|name| ColumnSpec {
                name,
                type_hint: TYPE_HINT_TEXT.into(),
            })
            .collect(),
    }
}

pub(super) fn project_row(
    row: &BTreeMap<String, QueryValue>,
    col_names: &[String],
) -> Vec<QueryValue> {
    col_names
        .iter()
        .map(|name| row.get(name).cloned().unwrap_or(QueryValue::Null))
        .collect()
}

pub(super) fn apply_aggregations(
    rows: &[BTreeMap<String, QueryValue>],
    query: &MixpanelQuery,
) -> Vec<BTreeMap<String, QueryValue>> {
    let mut groups: BTreeMap<String, Vec<&BTreeMap<String, QueryValue>>> = BTreeMap::new();
    for row in rows {
        let key = query
            .group_by
            .iter()
            .map(|gb| {
                row.get(gb)
                    .map(|v| v.display_string())
                    .unwrap_or_else(|| "NULL".into())
            })
            .collect::<Vec<_>>()
            .join("|");
        groups.entry(key).or_default().push(row);
    }

    let mut result = Vec::new();
    for group_rows in groups.values() {
        let mut out_row = BTreeMap::new();
        for gb in &query.group_by {
            out_row.insert(
                gb.clone(),
                group_rows
                    .first()
                    .and_then(|r| r.get(gb))
                    .cloned()
                    .unwrap_or(QueryValue::Null),
            );
        }
        for col in &query.columns {
            if let ColumnSelection::Aggregation(func, c, alias) = col {
                let name = alias.clone().unwrap_or_else(|| {
                    format!("{}({})", func.label(), c.as_deref().unwrap_or("*"))
                });
                out_row.insert(name, compute_agg(*func, c.as_deref(), group_rows));
            }
        }
        result.push(out_row);
    }
    result
}

fn compute_agg(
    func: AggFunc,
    column: Option<&str>,
    rows: &[&BTreeMap<String, QueryValue>],
) -> QueryValue {
    match func {
        AggFunc::Count => {
            if let Some(col) = column {
                let count = rows
                    .iter()
                    .filter(|row| {
                        row.get(col)
                            .is_some_and(|v| !matches!(v, QueryValue::Null))
                    })
                    .count();
                QueryValue::Int(count as i64)
            } else {
                QueryValue::Int(rows.len() as i64)
            }
        }
        AggFunc::Sum => {
            let Some(col) = column else {
                return QueryValue::Null;
            };
            let mut sum = 0.0;
            for row in rows {
                match row.get(col) {
                    Some(QueryValue::Int(i)) => sum += *i as f64,
                    Some(QueryValue::Double(d)) => sum += d,
                    _ => {}
                }
            }
            QueryValue::Double(sum)
        }
        AggFunc::Avg => {
            let Some(col) = column else {
                return QueryValue::Null;
            };
            let mut sum = 0.0;
            let mut count = 0;
            for row in rows {
                match row.get(col) {
                    Some(QueryValue::Int(i)) => {
                        sum += *i as f64;
                        count += 1;
                    }
                    Some(QueryValue::Double(d)) => {
                        sum += d;
                        count += 1;
                    }
                    _ => {}
                }
            }
            if count > 0 {
                QueryValue::Double(sum / count as f64)
            } else {
                QueryValue::Null
            }
        }
        AggFunc::Min => {
            let Some(col) = column else {
                return QueryValue::Null;
            };
            let mut min_val: Option<f64> = None;
            for row in rows {
                let d = match row.get(col) {
                    Some(QueryValue::Int(i)) => Some(*i as f64),
                    Some(QueryValue::Double(d)) => Some(*d),
                    _ => None,
                };
                if let Some(d) = d {
                    min_val = Some(min_val.map_or(d, |m: f64| m.min(d)));
                }
            }
            min_val
                .map(QueryValue::Double)
                .unwrap_or(QueryValue::Null)
        }
        AggFunc::Max => {
            let Some(col) = column else {
                return QueryValue::Null;
            };
            let mut max_val: Option<f64> = None;
            for row in rows {
                let d = match row.get(col) {
                    Some(QueryValue::Int(i)) => Some(*i as f64),
                    Some(QueryValue::Double(d)) => Some(*d),
                    _ => None,
                };
                if let Some(d) = d {
                    max_val = Some(max_val.map_or(d, |m: f64| m.max(d)));
                }
            }
            max_val
                .map(QueryValue::Double)
                .unwrap_or(QueryValue::Null)
        }
    }
}

pub(super) fn apply_order_by(rows: &mut [BTreeMap<String, QueryValue>], order_by: &[(String, bool)]) {
    rows.sort_by(|a, b| {
        for (col, asc) in order_by {
            let va = a.get(col).unwrap_or(&QueryValue::Null);
            let vb = b.get(col).unwrap_or(&QueryValue::Null);
            let cmp = compare_query_values(va, vb);
            if cmp != std::cmp::Ordering::Equal {
                return if *asc { cmp } else { cmp.reverse() };
            }
        }
        std::cmp::Ordering::Equal
    });
}

fn compare_query_values(a: &QueryValue, b: &QueryValue) -> std::cmp::Ordering {
    match (a, b) {
        (QueryValue::Null, QueryValue::Null) => std::cmp::Ordering::Equal,
        (QueryValue::Null, _) => std::cmp::Ordering::Less,
        (_, QueryValue::Null) => std::cmp::Ordering::Greater,
        (QueryValue::Int(ai), QueryValue::Int(bi)) => ai.cmp(bi),
        (QueryValue::Double(ad), QueryValue::Double(bd)) => {
            ad.partial_cmp(bd).unwrap_or(std::cmp::Ordering::Equal)
        }
        (QueryValue::Int(ai), QueryValue::Double(bd)) => {
            (*ai as f64)
                .partial_cmp(bd)
                .unwrap_or(std::cmp::Ordering::Equal)
        }
        (QueryValue::Double(ad), QueryValue::Int(bi)) => {
            ad.partial_cmp(&(*bi as f64))
                .unwrap_or(std::cmp::Ordering::Equal)
        }
        _ => a.display_string().cmp(&b.display_string()),
    }
}

// Split a raw byte stream into JSONL rows lazily. `\n` never appears inside a
// UTF-8 multibyte sequence, so splitting on the raw byte is safe; each complete
// line is parsed, blank/malformed lines dropped, the trailing partial flushed at EOF.
fn line_row_stream<B, E, S>(bytes: S) -> impl Stream<Item = Result<BTreeMap<String, QueryValue>>>
where
    B: AsRef<[u8]> + Send + 'static,
    E: std::fmt::Display + Send + 'static,
    S: Stream<Item = std::result::Result<B, E>> + Send + 'static,
{
    let bytes = Box::pin(bytes);
    stream::unfold(
        (bytes, Vec::<u8>::new(), false),
        |(mut bytes, mut buf, mut done)| async move {
            loop {
                if let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                    let mut line: Vec<u8> = buf.drain(..=pos).collect();
                    line.pop();
                    if let Some(row) = parse_line(&line) {
                        return Some((Ok(row), (bytes, buf, done)));
                    }
                    continue;
                }
                if done {
                    if !buf.is_empty() {
                        let line = std::mem::take(&mut buf);
                        if let Some(row) = parse_line(&line) {
                            return Some((Ok(row), (bytes, buf, true)));
                        }
                    }
                    return None;
                }
                match bytes.next().await {
                    Some(Ok(chunk)) => buf.extend_from_slice(chunk.as_ref()),
                    Some(Err(e)) => {
                        let err = DriverError::QueryFailed(format!(
                            "Mixpanel export stream failed: {e}"
                        ));
                        return Some((Err(err), (bytes, Vec::new(), true)));
                    }
                    None => done = true,
                }
            }
        },
    )
}

fn export_row_stream(
    resp: reqwest::Response,
) -> impl Stream<Item = Result<BTreeMap<String, QueryValue>>> {
    line_row_stream(resp.bytes_stream())
}

fn parse_line(line: &[u8]) -> Option<BTreeMap<String, QueryValue>> {
    std::str::from_utf8(line).ok().and_then(api::parse_export_line)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query_with(columns: Vec<ColumnSelection>) -> MixpanelQuery {
        MixpanelQuery {
            columns,
            event_filter: vec![],
            from_date: "2025-01-01".into(),
            to_date: "2025-01-02".into(),
            where_expression: None,
            group_by: vec![],
            order_by: vec![],
            limit: None,
        }
    }

    fn row(pairs: &[(&str, QueryValue)]) -> BTreeMap<String, QueryValue> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    #[test]
    fn select_columns_row_named_picks_subset_and_nulls_missing() {
        let q = query_with(vec![
            ColumnSelection::Named("event".into()),
            ColumnSelection::Named("missing".into()),
        ]);
        let src = row(&[("event", QueryValue::Text("a".into())), ("extra", QueryValue::Int(9))]);
        let out = select_columns_row(&src, &q);
        assert_eq!(out.len(), 2);
        assert_eq!(out["event"], QueryValue::Text("a".into()));
        assert_eq!(out["missing"], QueryValue::Null);
        assert!(!out.contains_key("extra"));
    }

    #[test]
    fn select_columns_row_star_keeps_all() {
        let q = query_with(vec![ColumnSelection::All]);
        let src = row(&[("a", QueryValue::Int(1)), ("b", QueryValue::Text("x".into()))]);
        assert_eq!(select_columns_row(&src, &q), src);
    }

    #[test]
    fn build_columns_infers_types_from_first_row() {
        let q = query_with(vec![ColumnSelection::All]);
        let rows = vec![row(&[
            ("i", QueryValue::Int(1)),
            ("d", QueryValue::Double(2.0)),
            ("b", QueryValue::Bool(true)),
            ("s", QueryValue::Text("x".into())),
        ])];
        let cols = build_columns(&q, &rows);
        let by: BTreeMap<_, _> = cols.iter().map(|c| (c.name.as_str(), c.type_hint.as_str())).collect();
        assert_eq!(by["i"], TYPE_HINT_BIGINT);
        assert_eq!(by["d"], TYPE_HINT_DOUBLE);
        assert_eq!(by["b"], TYPE_HINT_BOOLEAN);
        assert_eq!(by["s"], TYPE_HINT_TEXT);
    }

    #[test]
    fn build_columns_empty_falls_back_to_resolved_text_names() {
        let q = query_with(vec![
            ColumnSelection::Named("event".into()),
            ColumnSelection::Named("page".into()),
        ]);
        let cols = build_columns(&q, &[]);
        assert_eq!(cols.iter().map(|c| c.name.clone()).collect::<Vec<_>>(), vec!["event", "page"]);
        assert!(cols.iter().all(|c| c.type_hint == TYPE_HINT_TEXT));
    }

    #[test]
    fn project_row_aligns_columns_and_nulls_missing() {
        let src = row(&[("a", QueryValue::Int(1)), ("b", QueryValue::Text("x".into()))]);
        let cols = vec!["b".to_string(), "a".to_string(), "c".to_string()];
        assert_eq!(
            project_row(&src, &cols),
            vec![QueryValue::Text("x".into()), QueryValue::Int(1), QueryValue::Null]
        );
    }

    fn bytes_stream(
        chunks: Vec<&'static [u8]>,
    ) -> impl Stream<Item = std::result::Result<&'static [u8], std::io::Error>> {
        stream::iter(chunks.into_iter().map(Ok))
    }

    async fn collect_rows(
        s: impl Stream<Item = Result<BTreeMap<String, QueryValue>>>,
    ) -> Vec<BTreeMap<String, QueryValue>> {
        s.map(|r| r.unwrap()).collect().await
    }

    #[tokio::test]
    async fn line_stream_splits_lines_across_chunk_boundaries() {
        let s = line_row_stream(bytes_stream(vec![
            b"{\"event\":\"a\",\"prope",
            b"rties\":{\"x\":1}}\n{\"event\":\"b\",\"properties\":{\"x\":2}}\n",
        ]));
        let rows = collect_rows(s).await;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["event"], QueryValue::Text("a".into()));
        assert_eq!(rows[0]["x"], QueryValue::Int(1));
        assert_eq!(rows[1]["event"], QueryValue::Text("b".into()));
    }

    #[tokio::test]
    async fn line_stream_flushes_trailing_partial_and_skips_bad_lines() {
        let s = line_row_stream(bytes_stream(vec![
            b"\nnot json\n{\"event\":\"c\",\"properties\":{}}",
        ]));
        let rows = collect_rows(s).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["event"], QueryValue::Text("c".into()));
    }

    #[tokio::test]
    async fn line_stream_surfaces_a_read_error() {
        let s = line_row_stream(stream::iter(vec![
            Ok::<&[u8], std::io::Error>(b"{\"event\":\"a\",\"properties\":{}}\n"),
            Err(std::io::Error::other("wire dropped")),
        ]));
        let items: Vec<_> = s.collect().await;
        assert!(items.iter().any(|r| r.is_err()));
    }
}

// Stream the export result as chunked rows: filter each event by WHERE, cap at
// LIMIT, then fix the schemaless columns from the first buffered chunk (mirroring
// the buffered path) before streaming the rest. Caller guarantees no aggregation
// or ORDER BY, both of which need the full result and take the materialized path.
pub(super) async fn stream_export(
    resp: reqwest::Response,
    parsed_query: &MixpanelQuery,
) -> Result<RowChunkStream> {
    let where_expr = parsed_query.where_expression.clone();
    let filtered = export_row_stream(resp).try_filter(move |row| {
        let keep = where_expr
            .as_ref()
            .is_none_or(|w| sql_parser::evaluate(w, row));
        async move { keep }
    });
    let mut rows: RowStream = match parsed_query.limit {
        Some(limit) => filtered.take(limit).boxed(),
        None => filtered.boxed(),
    };

    let mut first: Vec<BTreeMap<String, QueryValue>> = Vec::new();
    while first.len() < STREAM_CHUNK_ROWS {
        match rows.next().await {
            Some(Ok(row)) => first.push(row),
            Some(Err(e)) => return Err(e),
            None => break,
        }
    }
    let sample: Vec<BTreeMap<String, QueryValue>> = first
        .first()
        .map(|row| vec![select_columns_row(row, parsed_query)])
        .unwrap_or_default();
    let columns = build_columns(parsed_query, &sample);
    let col_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();

    let chained = stream::iter(first.into_iter().map(Ok)).chain(rows);
    Ok(RowChunkPump::spawn(
        columns,
        move || async move { Ok(chained) },
        move |row: BTreeMap<String, QueryValue>| project_row(&row, &col_names),
    ))
}
