use std::time::Instant;

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, params_from_iter};

use crate::{ColumnSpec, DriverError, QueryResult, QueryValue};
use crate::drivers::errors::Result;

use super::values::{map_query_value, map_value_ref};

pub(super) fn run_select(conn: &Connection, sql: &str, params: &[QueryValue]) -> Result<QueryResult> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let cols_meta: Vec<(String, String)> = stmt
        .columns()
        .iter()
        .map(|c| {
            (
                c.name().to_owned(),
                c.decl_type().unwrap_or("").to_owned(),
            )
        })
        .collect();
    let column_count = cols_meta.len();
    let columns: Vec<ColumnSpec> = cols_meta
        .into_iter()
        .map(|(n, t)| ColumnSpec::new(n, t))
        .collect();

    let started = Instant::now();
    let bound: Vec<SqlValue> = params.iter().map(map_query_value).collect();
    let mut rows = stmt
        .query(params_from_iter(bound))
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let mut out_rows: Vec<Vec<QueryValue>> = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?
    {
        let mut r = Vec::with_capacity(column_count);
        for i in 0..column_count {
            let v = row
                .get_ref(i)
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
            r.push(map_value_ref(v));
        }
        out_rows.push(r);
    }

    Ok(QueryResult {
        columns,
        rows: out_rows,
        rows_affected: None,
        elapsed: started.elapsed().as_secs_f64(),
        ..Default::default()
    })
}

pub(super) fn run_exec(conn: &Connection, sql: &str, params: &[QueryValue]) -> Result<QueryResult> {
    let started = Instant::now();
    let bound: Vec<SqlValue> = params.iter().map(map_query_value).collect();
    let affected = conn
        .execute(sql, params_from_iter(bound))
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    Ok(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: Some(affected as i64),
        elapsed: started.elapsed().as_secs_f64(),
        ..Default::default()
    })
}
