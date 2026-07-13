use super::api::{ColumnMeta, QueryResponse, RowStream};
use crate::drivers::common::RowChunkPump;
use crate::drivers::types::RowChunkStream;
use crate::{ColumnSpec, QueryResult, QueryValue};

fn cell_to_value(cell: Option<String>) -> QueryValue {
    match cell {
        Some(s) => QueryValue::Text(s).coerce_text(),
        None => QueryValue::Null,
    }
}

pub(super) fn response_to_query_result(resp: QueryResponse, elapsed: f64) -> QueryResult {
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

pub(super) fn row_chunk_stream(columns: Vec<ColumnMeta>, rows: RowStream) -> RowChunkStream {
    let specs: Vec<ColumnSpec> = columns
        .iter()
        .map(|c| ColumnSpec::new(&c.name, &c.data_type))
        .collect();
    RowChunkPump::spawn(
        specs,
        move || async move { Ok(rows) },
        |row: Vec<Option<String>>| row.into_iter().map(cell_to_value).collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::stream::{self, StreamExt};

    #[test]
    fn cell_some_maps_to_coerced_text() {
        assert_eq!(cell_to_value(Some("42".to_owned())), QueryValue::Text("42".to_owned()).coerce_text());
    }

    #[test]
    fn cell_none_maps_to_null() {
        assert_eq!(cell_to_value(None), QueryValue::Null);
    }

    #[tokio::test]
    async fn row_chunk_stream_carries_columns_and_maps_cells() {
        let cols = vec![
            ColumnMeta { name: "id".into(), data_type: "FIXED".into() },
            ColumnMeta { name: "name".into(), data_type: "TEXT".into() },
        ];
        let rows: RowStream = stream::iter(vec![
            Ok(vec![Some("1".to_owned()), Some("alice".to_owned())]),
            Ok(vec![Some("2".to_owned()), None]),
        ])
        .boxed();

        let mut rs = row_chunk_stream(cols, rows);
        assert_eq!(
            rs.columns,
            vec![ColumnSpec::new("id", "FIXED"), ColumnSpec::new("name", "TEXT")]
        );

        let mut all: Vec<Vec<QueryValue>> = Vec::new();
        while let Some(chunk) = rs.chunks.next().await {
            all.extend(chunk.unwrap());
        }
        assert_eq!(
            all,
            vec![
                vec![QueryValue::Text("1".to_owned()).coerce_text(), QueryValue::Text("alice".to_owned()).coerce_text()],
                vec![QueryValue::Text("2".to_owned()).coerce_text(), QueryValue::Null],
            ]
        );
    }
}
