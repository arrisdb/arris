use tokio_postgres::Row;

use crate::{ColumnSpec, QueryResult, QueryValue};

use super::values::{PgValue, row_value};

pub(super) fn pg_err_msg(e: &tokio_postgres::Error) -> String {
    if let Some(db) = e.as_db_error() {
        let mut msg = format!("{}: {}", db.severity(), db.message());
        if let Some(detail) = db.detail() {
            msg.push_str(&format!(" ({})", detail));
        }
        if let Some(hint) = db.hint() {
            msg.push_str(&format!(" [hint: {}]", hint));
        }
        msg
    } else {
        e.to_string()
    }
}

pub(super) fn rows_to_query_result(rows: Vec<Row>, elapsed: f64) -> QueryResult {
    let columns: Vec<ColumnSpec> = if let Some(first) = rows.first() {
        first
            .columns()
            .iter()
            .map(|c| ColumnSpec::new(c.name(), c.type_().name()))
            .collect()
    } else {
        Vec::new()
    };
    let mut out_rows: Vec<Vec<QueryValue>> = Vec::with_capacity(rows.len());
    for row in &rows {
        let mut values = Vec::with_capacity(row.columns().len());
        for i in 0..row.columns().len() {
            values.push(row_value(row, i));
        }
        out_rows.push(values);
    }
    QueryResult {
        columns,
        rows: out_rows,
        rows_affected: None,
        elapsed,
        ..Default::default()
    }
}

pub(super) fn pg_to_sql_refs<'a>(
    wrapped: &'a [PgValue<'a>],
) -> Vec<&'a (dyn tokio_postgres::types::ToSql + Sync)> {
    wrapped
        .iter()
        .map(|v| v as &(dyn tokio_postgres::types::ToSql + Sync))
        .collect()
}
