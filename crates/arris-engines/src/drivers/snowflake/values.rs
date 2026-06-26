use super::api::QueryResponse;
use crate::{ColumnSpec, QueryResult, QueryValue};

pub(super) fn response_to_query_result(resp: QueryResponse, elapsed: f64) -> QueryResult {
    let columns: Vec<ColumnSpec> = resp
        .columns
        .iter()
        .map(|c| ColumnSpec::new(&c.name, &c.data_type))
        .collect();

    let rows: Vec<Vec<QueryValue>> = resp
        .rows
        .into_iter()
        .map(|row| {
            row.into_iter()
                .map(|cell| match cell {
                    Some(s) => QueryValue::Text(s).coerce_text(),
                    None => QueryValue::Null,
                })
                .collect()
        })
        .collect();

    QueryResult {
        columns,
        rows,
        elapsed,
        ..Default::default()
    }
}
