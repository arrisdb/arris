use serde_json::Value;

use super::api::{RowStream, TrinoColumn, TrinoResponse};
use crate::drivers::common::RowChunkPump;
use crate::drivers::types::RowChunkStream;
use crate::{ColumnSpec, QueryResult, QueryValue};

pub(super) fn cell_to_value(cell: Value) -> QueryValue {
    match cell {
        Value::Null => QueryValue::Null,
        Value::Bool(b) => QueryValue::Bool(b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                QueryValue::Int(i)
            } else if let Some(u) = n.as_u64() {
                QueryValue::Int(u as i64)
            } else {
                QueryValue::Double(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => QueryValue::Text(s),
        other => QueryValue::Json(other.to_string()),
    }
}

pub(super) fn response_to_query_result(resp: TrinoResponse, elapsed: f64) -> QueryResult {
    let columns: Vec<ColumnSpec> = resp
        .columns
        .iter()
        .map(|c| ColumnSpec::new(&c.name, &c.data_type))
        .collect();

    let rows: Vec<Vec<QueryValue>> = resp
        .rows
        .into_iter()
        .map(|row| row.into_iter().map(cell_to_value).collect())
        .collect();

    QueryResult {
        columns,
        rows,
        elapsed,
        ..Default::default()
    }
}

pub(super) fn row_chunk_stream(columns: Vec<TrinoColumn>, rows: RowStream) -> RowChunkStream {
    let specs: Vec<ColumnSpec> = columns
        .iter()
        .map(|c| ColumnSpec::new(&c.name, &c.data_type))
        .collect();
    RowChunkPump::spawn(
        specs,
        move || async move { Ok(rows) },
        |row: Vec<Value>| row.into_iter().map(cell_to_value).collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cell_null_maps_to_null() {
        assert_eq!(cell_to_value(Value::Null), QueryValue::Null);
    }

    #[test]
    fn cell_bool_maps_to_bool() {
        assert_eq!(cell_to_value(Value::Bool(true)), QueryValue::Bool(true));
    }

    #[test]
    fn cell_integer_maps_to_int() {
        assert_eq!(cell_to_value(serde_json::json!(42)), QueryValue::Int(42));
        assert_eq!(cell_to_value(serde_json::json!(-7)), QueryValue::Int(-7));
    }

    #[test]
    fn cell_float_maps_to_double() {
        assert_eq!(cell_to_value(serde_json::json!(3.5)), QueryValue::Double(3.5));
    }

    #[test]
    fn cell_string_maps_to_text() {
        assert_eq!(
            cell_to_value(serde_json::json!("hi")),
            QueryValue::Text("hi".into())
        );
    }

    #[test]
    fn cell_array_and_object_map_to_json() {
        assert_eq!(
            cell_to_value(serde_json::json!([1, 2, 3])),
            QueryValue::Json("[1,2,3]".into())
        );
        assert_eq!(
            cell_to_value(serde_json::json!({"a": 1})),
            QueryValue::Json(r#"{"a":1}"#.into())
        );
    }

    #[tokio::test]
    async fn row_chunk_stream_carries_columns_and_maps_cells() {
        use futures::stream::{self, StreamExt};

        let cols = vec![
            TrinoColumn { name: "id".into(), data_type: "integer".into() },
            TrinoColumn { name: "name".into(), data_type: "varchar".into() },
        ];
        let rows: RowStream = stream::iter(vec![
            Ok(vec![serde_json::json!(1), serde_json::json!("alice")]),
            Ok(vec![serde_json::json!(2), serde_json::json!("bob")]),
        ])
        .boxed();

        let mut rs = row_chunk_stream(cols, rows);
        assert_eq!(
            rs.columns,
            vec![ColumnSpec::new("id", "integer"), ColumnSpec::new("name", "varchar")]
        );

        let mut all: Vec<Vec<QueryValue>> = Vec::new();
        while let Some(chunk) = rs.chunks.next().await {
            all.extend(chunk.unwrap());
        }
        assert_eq!(
            all,
            vec![
                vec![QueryValue::Int(1), QueryValue::Text("alice".into())],
                vec![QueryValue::Int(2), QueryValue::Text("bob".into())],
            ]
        );
    }
}
