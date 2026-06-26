use tiberius::{Column, Row};

use crate::{ColumnSpec, QueryResult, QueryValue};

use super::values::{column_data_to_query, mssql_column_type_name};

pub(super) fn rows_to_query_result(columns: &[Column], rows: Vec<Row>, elapsed: f64) -> QueryResult {
    let column_specs: Vec<ColumnSpec> = columns
        .iter()
        .map(|c| ColumnSpec::new(c.name(), mssql_column_type_name(c.column_type())))
        .collect();

    let num_cols = columns.len();
    let mut out: Vec<Vec<QueryValue>> = Vec::with_capacity(rows.len());
    for row in rows {
        let mut vals: Vec<QueryValue> = row.into_iter().map(column_data_to_query).collect();
        vals.truncate(num_cols);
        out.push(vals);
    }

    QueryResult {
        columns: column_specs,
        rows: out,
        rows_affected: None,
        elapsed,
        ..Default::default()
    }
}
