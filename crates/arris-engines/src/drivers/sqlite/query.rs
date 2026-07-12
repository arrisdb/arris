use std::time::Instant;

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, params_from_iter};
use tokio::sync::{mpsc, oneshot};

use crate::{ColumnSpec, DriverError, QueryResult, QueryValue};
use crate::drivers::constants::STREAM_CHUNK_ROWS;
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

/// Send columns over `col_tx`, then row chunks over `chunk_tx`. Holds the
/// connection lock; a dropped receiver ends the query and frees the conn.
pub(super) fn stream_select(
    conn: &Connection,
    sql: &str,
    params: &[QueryValue],
    col_tx: oneshot::Sender<Result<Vec<ColumnSpec>>>,
    chunk_tx: mpsc::Sender<std::result::Result<Vec<Vec<QueryValue>>, DriverError>>,
) {
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(e) => {
            let _ = col_tx.send(Err(DriverError::QueryFailed(e.to_string())));
            return;
        }
    };
    let columns: Vec<ColumnSpec> = stmt
        .columns()
        .iter()
        .map(|c| ColumnSpec::new(c.name().to_owned(), c.decl_type().unwrap_or("").to_owned()))
        .collect();
    let col_count = columns.len();
    let bound: Vec<SqlValue> = params.iter().map(map_query_value).collect();
    let mut rows = match stmt.query(params_from_iter(bound)) {
        Ok(r) => r,
        Err(e) => {
            let _ = col_tx.send(Err(DriverError::QueryFailed(e.to_string())));
            return;
        }
    };
    if col_tx.send(Ok(columns)).is_err() {
        return;
    }
    let mut chunk: Vec<Vec<QueryValue>> = Vec::with_capacity(STREAM_CHUNK_ROWS);
    loop {
        match rows.next() {
            Ok(Some(row)) => {
                let mut r = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    match row.get_ref(i) {
                        Ok(v) => r.push(map_value_ref(v)),
                        Err(e) => {
                            let _ = chunk_tx
                                .blocking_send(Err(DriverError::QueryFailed(e.to_string())));
                            return;
                        }
                    }
                }
                chunk.push(r);
                if chunk.len() >= STREAM_CHUNK_ROWS {
                    let full =
                        std::mem::replace(&mut chunk, Vec::with_capacity(STREAM_CHUNK_ROWS));
                    if chunk_tx.blocking_send(Ok(full)).is_err() {
                        return;
                    }
                }
            }
            Ok(None) => break,
            Err(e) => {
                let _ = chunk_tx.blocking_send(Err(DriverError::QueryFailed(e.to_string())));
                return;
            }
        }
    }
    if !chunk.is_empty() {
        let _ = chunk_tx.blocking_send(Ok(chunk));
    }
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
