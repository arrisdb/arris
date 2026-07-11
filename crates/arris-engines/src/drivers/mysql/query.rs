use std::sync::Arc;

use mysql_async::{Column, Params, Row, Value as MyValue, consts::ColumnType};

use crate::{ColumnSpec, QueryResult, QueryValue};

use super::values::{column_type_str, mysql_to_query, query_to_mysql};

/// Column specs for a prepared statement's result set, seeding a streamed
/// `RowChunkStream` before any row arrives.
pub(super) fn stmt_columns_to_specs(cols: &[Column]) -> Vec<ColumnSpec> {
    cols.iter()
        .map(|c| ColumnSpec::new(c.name_str().into_owned(), column_type_str(c.column_type())))
        .collect()
}

/// One streamed row to `QueryValue`s (values moved out, not cloned).
pub(super) fn row_to_query_values(row: Row) -> Vec<QueryValue> {
    let types: Vec<ColumnType> = row.columns_ref().iter().map(|c| c.column_type()).collect();
    row.unwrap()
        .into_iter()
        .zip(types)
        .map(|(v, t)| mysql_to_query(v, t))
        .collect()
}

pub(super) fn rows_to_query_result(
    rows: Vec<Row>,
    cols: Option<Arc<[mysql_async::Column]>>,
    elapsed: f64,
) -> QueryResult {
    let column_specs: Vec<ColumnSpec> = cols
        .as_deref()
        .map(|c| {
            c.iter()
                .map(|col| {
                    ColumnSpec::new(col.name_str().into_owned(), column_type_str(col.column_type()))
                })
                .collect()
        })
        .unwrap_or_default();
    let column_types: Vec<ColumnType> = cols
        .as_deref()
        .map(|c| c.iter().map(|col| col.column_type()).collect())
        .unwrap_or_default();
    let mut out: Vec<Vec<QueryValue>> = Vec::with_capacity(rows.len());
    for row in rows {
        let raw: Vec<MyValue> = row.unwrap();
        let mut values = Vec::with_capacity(raw.len());
        for (i, v) in raw.into_iter().enumerate() {
            let t = column_types
                .get(i)
                .copied()
                .unwrap_or(ColumnType::MYSQL_TYPE_VAR_STRING);
            values.push(mysql_to_query(v, t));
        }
        out.push(values);
    }
    QueryResult {
        columns: column_specs,
        rows: out,
        rows_affected: None,
        elapsed,
        ..Default::default()
    }
}

/// Pulls the first column of every row, decodes any byte payload as UTF-8,
/// and joins with newlines. Mirrors what `EXPLAIN [ANALYZE] FORMAT=JSON|TREE`
/// returns from MySQL.
pub(super) fn rows_first_column_to_string(rows: Vec<Row>) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(rows.len());
    for r in rows {
        let raw_vals: Vec<MyValue> = r.unwrap();
        if let Some(v) = raw_vals.into_iter().next() {
            match v {
                MyValue::Bytes(bs) => {
                    if let Ok(s) = String::from_utf8(bs) {
                        parts.push(s);
                    }
                }
                MyValue::NULL => {}
                other => parts.push(format!("{other:?}")),
            }
        }
    }
    parts.join("\n")
}

pub(super) fn params_to_mysql(params: &[QueryValue]) -> Params {
    if params.is_empty() {
        Params::Empty
    } else {
        Params::Positional(params.iter().map(query_to_mysql).collect())
    }
}
