use std::time::Instant;

use duckdb::arrow::datatypes::DataType;
use duckdb::types::Value as DuckValue;
use duckdb::{params_from_iter, Connection};

use crate::{ColumnSpec, DriverError, QueryResult, QueryValue};
use crate::drivers::errors::Result;

use super::values::{map_query_value, map_value_ref};

/// Map an Arrow logical type (DuckDB exposes result column types as Arrow types)
/// to a DuckDB-native type label, matching the names shown in the schema browser
/// so result-grid type chips read the same as the tree (e.g. `BIGINT`, `VARCHAR`,
/// `DECIMAL(12,2)`).
fn duck_type_label(dt: &DataType) -> String {
    match dt {
        DataType::Boolean => "BOOLEAN".to_owned(),
        DataType::Int8 => "TINYINT".to_owned(),
        DataType::Int16 => "SMALLINT".to_owned(),
        DataType::Int32 => "INTEGER".to_owned(),
        DataType::Int64 => "BIGINT".to_owned(),
        DataType::UInt8 => "UTINYINT".to_owned(),
        DataType::UInt16 => "USMALLINT".to_owned(),
        DataType::UInt32 => "UINTEGER".to_owned(),
        DataType::UInt64 => "UBIGINT".to_owned(),
        DataType::Float16 | DataType::Float32 => "FLOAT".to_owned(),
        DataType::Float64 => "DOUBLE".to_owned(),
        DataType::Decimal128(p, s) | DataType::Decimal256(p, s) => format!("DECIMAL({p},{s})"),
        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => "VARCHAR".to_owned(),
        DataType::Binary | DataType::LargeBinary | DataType::BinaryView | DataType::FixedSizeBinary(_) => {
            "BLOB".to_owned()
        }
        DataType::Date32 | DataType::Date64 => "DATE".to_owned(),
        DataType::Time32(_) | DataType::Time64(_) => "TIME".to_owned(),
        DataType::Timestamp(_, Some(_)) => "TIMESTAMP WITH TIME ZONE".to_owned(),
        DataType::Timestamp(_, None) => "TIMESTAMP".to_owned(),
        DataType::Duration(_) | DataType::Interval(_) => "INTERVAL".to_owned(),
        DataType::List(_) | DataType::LargeList(_) | DataType::FixedSizeList(_, _) => "LIST".to_owned(),
        DataType::Struct(_) => "STRUCT".to_owned(),
        DataType::Map(_, _) => "MAP".to_owned(),
        DataType::Null => "NULL".to_owned(),
        other => format!("{other:?}").to_uppercase(),
    }
}

pub(super) fn run_select(conn: &Connection, sql: &str, params: &[QueryValue]) -> Result<QueryResult> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let started = Instant::now();
    let bound: Vec<DuckValue> = params.iter().map(map_query_value).collect();

    {
        let mut rows = stmt
            .query(params_from_iter(bound))
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let mut rows_out: Vec<Vec<QueryValue>> = Vec::new();
        while let Some(row) = rows
            .next()
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?
        {
            let mut r = Vec::new();
            let mut i = 0;
            loop {
                match row.get_ref(i) {
                    Ok(v) => r.push(map_value_ref(v)),
                    Err(_) => break,
                }
                i += 1;
            }
            rows_out.push(r);
        }
        drop(rows);

        let col_count = stmt.column_count();
        let columns: Vec<ColumnSpec> = (0..col_count)
            .map(|i| {
                let name = stmt.column_name(i).map_or("?", |v| v).to_owned();
                ColumnSpec::new(name, duck_type_label(&stmt.column_type(i)))
            })
            .collect();

        Ok(QueryResult {
            columns,
            rows: rows_out,
            rows_affected: None,
            elapsed: started.elapsed().as_secs_f64(),
            ..Default::default()
        })
    }
}

pub(super) fn run_exec(conn: &Connection, sql: &str, params: &[QueryValue]) -> Result<QueryResult> {
    let started = Instant::now();
    let bound: Vec<DuckValue> = params.iter().map(map_query_value).collect();
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

pub(super) fn query_rows<F, T>(conn: &Connection, sql: &str, mut map_row: F) -> Result<Vec<T>>
where
    F: FnMut(&duckdb::Row<'_>) -> T,
{
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let mut out = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?
    {
        out.push(map_row(row));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use duckdb::arrow::datatypes::TimeUnit;

    #[test]
    fn maps_arrow_types_to_duckdb_native_labels() {
        assert_eq!(duck_type_label(&DataType::Boolean), "BOOLEAN");
        assert_eq!(duck_type_label(&DataType::Int32), "INTEGER");
        assert_eq!(duck_type_label(&DataType::Int64), "BIGINT");
        assert_eq!(duck_type_label(&DataType::Float64), "DOUBLE");
        assert_eq!(duck_type_label(&DataType::Utf8), "VARCHAR");
        assert_eq!(duck_type_label(&DataType::Date32), "DATE");
        assert_eq!(duck_type_label(&DataType::Decimal128(12, 2)), "DECIMAL(12,2)");
        assert_eq!(
            duck_type_label(&DataType::Timestamp(TimeUnit::Microsecond, None)),
            "TIMESTAMP"
        );
        assert_eq!(
            duck_type_label(&DataType::Timestamp(TimeUnit::Microsecond, Some("UTC".into()))),
            "TIMESTAMP WITH TIME ZONE"
        );
    }
}
