use gcp_bigquery_client::model::query_response::QueryResponse;

use crate::{ColumnSpec, QueryValue};

fn field_type_str(ft: &gcp_bigquery_client::model::field_type::FieldType) -> &'static str {
    use gcp_bigquery_client::model::field_type::FieldType;
    match ft {
        FieldType::String => "STRING",
        FieldType::Bytes => "BYTES",
        FieldType::Integer | FieldType::Int64 => "INT64",
        FieldType::Float | FieldType::Float64 => "FLOAT64",
        FieldType::Numeric => "NUMERIC",
        FieldType::Bignumeric => "BIGNUMERIC",
        FieldType::Boolean | FieldType::Bool => "BOOL",
        FieldType::Timestamp => "TIMESTAMP",
        FieldType::Date => "DATE",
        FieldType::Time => "TIME",
        FieldType::Datetime => "DATETIME",
        FieldType::Record | FieldType::Struct => "RECORD",
        FieldType::Geography => "GEOGRAPHY",
        FieldType::Json => "JSON",
        FieldType::Interval => "INTERVAL",
    }
}

pub(super) fn columns_from_response(resp: &QueryResponse) -> Vec<ColumnSpec> {
    let Some(schema) = &resp.schema else {
        return Vec::new();
    };
    let Some(fields) = &schema.fields else {
        return Vec::new();
    };
    fields
        .iter()
        .map(|f| ColumnSpec::new(&f.name, field_type_str(&f.r#type)))
        .collect()
}

pub(super) fn rows_from_response(
    resp: &QueryResponse,
    col_count: usize,
) -> Vec<Vec<QueryValue>> {
    let Some(raw_rows) = &resp.rows else {
        return Vec::new();
    };
    raw_rows
        .iter()
        .map(|row| {
            let Some(cells) = &row.columns else {
                return vec![QueryValue::Null; col_count];
            };
            cells
                .iter()
                .map(|cell| match &cell.value {
                    Some(serde_json::Value::Null) | None => QueryValue::Null,
                    Some(serde_json::Value::Bool(b)) => QueryValue::Bool(*b),
                    Some(serde_json::Value::Number(n)) => {
                        if let Some(i) = n.as_i64() {
                            QueryValue::Int(i)
                        } else if let Some(f) = n.as_f64() {
                            QueryValue::Double(f)
                        } else {
                            QueryValue::Text(n.to_string())
                        }
                    }
                    Some(serde_json::Value::String(s)) => {
                        QueryValue::Text(s.clone()).coerce_text()
                    }
                    Some(other) => QueryValue::Json(other.to_string()),
                })
                .collect()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use gcp_bigquery_client::model::field_type::FieldType;
    use gcp_bigquery_client::model::table_cell::TableCell;
    use gcp_bigquery_client::model::table_field_schema::TableFieldSchema;
    use gcp_bigquery_client::model::table_row::TableRow;
    use gcp_bigquery_client::model::table_schema::TableSchema;

    fn make_response(
        fields: Vec<(&str, FieldType)>,
        rows: Vec<Vec<Option<serde_json::Value>>>,
    ) -> QueryResponse {
        let schema_fields: Vec<TableFieldSchema> = fields
            .iter()
            .map(|(name, ft)| TableFieldSchema::new(name, ft.clone()))
            .collect();

        let table_rows: Vec<TableRow> = rows
            .iter()
            .map(|r| TableRow {
                columns: Some(
                    r.iter()
                        .map(|v| TableCell { value: v.clone() })
                        .collect(),
                ),
            })
            .collect();

        QueryResponse {
            schema: Some(TableSchema {
                fields: Some(schema_fields),
            }),
            rows: Some(table_rows),
            ..Default::default()
        }
    }

    #[test]
    fn columns_from_response_extracts_names_and_types() {
        let resp = make_response(
            vec![("id", FieldType::Int64), ("name", FieldType::String)],
            vec![],
        );
        let cols = columns_from_response(&resp);
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].name, "id");
        assert_eq!(cols[0].type_hint, "INT64");
        assert_eq!(cols[1].name, "name");
        assert_eq!(cols[1].type_hint, "STRING");
    }

    #[test]
    fn rows_from_response_parses_values() {
        let resp = make_response(
            vec![("n", FieldType::Int64), ("s", FieldType::String)],
            vec![vec![
                Some(serde_json::Value::String("42".into())),
                Some(serde_json::Value::String("hello".into())),
            ]],
        );
        let rows = rows_from_response(&resp, 2);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0][0], QueryValue::Int(42));
        assert_eq!(rows[0][1], QueryValue::Text("hello".into()));
    }

    #[test]
    fn rows_from_response_handles_nulls() {
        let resp = make_response(
            vec![("x", FieldType::String)],
            vec![vec![None]],
        );
        let rows = rows_from_response(&resp, 1);
        assert_eq!(rows[0][0], QueryValue::Null);
    }

    #[test]
    fn empty_response_returns_empty() {
        let resp = QueryResponse::default();
        assert!(columns_from_response(&resp).is_empty());
        assert!(rows_from_response(&resp, 0).is_empty());
    }
}
