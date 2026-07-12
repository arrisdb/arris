use std::collections::VecDeque;
use std::sync::Arc;

use futures::stream::{self, Stream};
use gcp_bigquery_client::Client;
use gcp_bigquery_client::model::get_query_results_parameters::GetQueryResultsParameters;
use gcp_bigquery_client::model::query_response::QueryResponse;
use gcp_bigquery_client::model::table_cell::TableCell;
use gcp_bigquery_client::model::table_row::TableRow;

use super::constants::{BQ_JOB_POLL_INTERVAL_MS, BQ_STREAM_PAGE_ROWS};
use super::driver::build_query_request;
use crate::drivers::common::RowChunkPump;
use crate::drivers::errors::{DriverError, Result};
use crate::{ColumnSpec, QueryValue, RowChunkStream};

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

fn cell_to_value(cell: &TableCell) -> QueryValue {
    match &cell.value {
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
        Some(serde_json::Value::String(s)) => QueryValue::Text(s.clone()).coerce_text(),
        Some(other) => QueryValue::Json(other.to_string()),
    }
}

/// Converts one `TableRow` to cells; a row with no columns becomes all-null.
pub(super) fn row_to_values(row: &TableRow, col_count: usize) -> Vec<QueryValue> {
    match &row.columns {
        Some(cells) => cells.iter().map(cell_to_value).collect(),
        None => vec![QueryValue::Null; col_count],
    }
}

pub(super) fn rows_from_response(
    resp: &QueryResponse,
    col_count: usize,
) -> Vec<Vec<QueryValue>> {
    let Some(raw_rows) = &resp.rows else {
        return Vec::new();
    };
    raw_rows.iter().map(|row| row_to_values(row, col_count)).collect()
}

// ── streaming ─────────────────────────────────────────────────────────────

/// What the page iterator does next given its buffer/job state. Split out as a
/// pure decision so the termination edges are unit-testable without HTTP.
#[derive(Debug, PartialEq, Eq)]
enum PageStep {
    Yield,
    Fetch,
    Done,
}

fn page_step(buf_empty: bool, complete: bool, has_token: bool) -> PageStep {
    if !buf_empty {
        PageStep::Yield
    } else if complete && !has_token {
        PageStep::Done
    } else {
        PageStep::Fetch
    }
}

/// Paging state carried across the row stream's `unfold` steps.
struct PageIter {
    client: Arc<Client>,
    project: String,
    job_id: String,
    location: Option<String>,
    next_token: Option<String>,
    complete: bool,
    buf: VecDeque<TableRow>,
}

fn row_stream(state: PageIter) -> impl Stream<Item = Result<TableRow>> {
    stream::unfold(state, |mut s| async move {
        loop {
            match page_step(s.buf.is_empty(), s.complete, s.next_token.is_some()) {
                PageStep::Yield => return s.buf.pop_front().map(|row| (Ok(row), s)),
                PageStep::Done => return None,
                PageStep::Fetch => {
                    let params = GetQueryResultsParameters {
                        page_token: s.next_token.clone(),
                        max_results: Some(BQ_STREAM_PAGE_ROWS),
                        location: s.location.clone(),
                        ..Default::default()
                    };
                    match s.client.job().get_query_results(&s.project, &s.job_id, params).await {
                        Ok(qr) => {
                            // A submitted job may not be ready yet; poll with the
                            // same token until it completes.
                            if !qr.job_complete.unwrap_or(false) {
                                tokio::time::sleep(std::time::Duration::from_millis(
                                    BQ_JOB_POLL_INTERVAL_MS,
                                ))
                                .await;
                                continue;
                            }
                            s.complete = true;
                            s.buf.extend(qr.rows.unwrap_or_default());
                            s.next_token = qr.page_token;
                        }
                        Err(e) => {
                            s.complete = true;
                            s.next_token = None;
                            return Some((Err(DriverError::QueryFailed(e.to_string())), s));
                        }
                    }
                }
            }
        }
    })
}

/// Streams a SELECT: one `jobs.query` for the schema and first page, then pages
/// the rest through `getQueryResults`. Columns come from the first response, so
/// the shared `RowChunkPump` rechunks the paged rows. `run_query` returns only
/// the first page, so streaming is what makes large results whole.
pub(super) async fn stream_query(
    client: Arc<Client>,
    project: String,
    location: Option<String>,
    text: String,
) -> Result<RowChunkStream> {
    let mut req = build_query_request(&text, location.as_deref());
    req.max_results = Some(BQ_STREAM_PAGE_ROWS);
    let resp = client
        .job()
        .query(&project, req)
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let columns = columns_from_response(&resp);
    let col_count = columns.len();
    let job_id = resp
        .job_reference
        .and_then(|r| r.job_id)
        .ok_or_else(|| DriverError::QueryFailed("BigQuery response carried no job id".into()))?;

    let state = PageIter {
        client,
        project,
        job_id,
        location,
        next_token: resp.page_token,
        complete: resp.job_complete.unwrap_or(false),
        buf: resp.rows.unwrap_or_default().into(),
    };

    Ok(RowChunkPump::spawn(
        columns,
        move || async move { Ok(row_stream(state)) },
        move |row: TableRow| row_to_values(&row, col_count),
    ))
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

    #[test]
    fn row_to_values_missing_columns_are_all_null() {
        let row = TableRow { columns: None };
        assert_eq!(row_to_values(&row, 3), vec![QueryValue::Null; 3]);
    }

    #[test]
    fn row_to_values_converts_each_cell() {
        let row = TableRow {
            columns: Some(vec![
                TableCell { value: Some(serde_json::Value::String("7".into())) },
                TableCell { value: None },
                TableCell { value: Some(serde_json::Value::Bool(true)) },
            ]),
        };
        assert_eq!(
            row_to_values(&row, 3),
            vec![QueryValue::Int(7), QueryValue::Null, QueryValue::Bool(true)]
        );
    }

    #[test]
    fn page_step_yields_while_buffer_has_rows() {
        // A non-empty buffer always drains first, regardless of job state.
        assert_eq!(page_step(false, true, true), PageStep::Yield);
        assert_eq!(page_step(false, false, false), PageStep::Yield);
    }

    #[test]
    fn page_step_done_only_when_complete_and_no_token() {
        assert_eq!(page_step(true, true, false), PageStep::Done);
    }

    #[test]
    fn page_step_fetches_for_more_pages_or_incomplete_job() {
        // Complete with a token → next page. Incomplete with no token → poll.
        assert_eq!(page_step(true, true, true), PageStep::Fetch);
        assert_eq!(page_step(true, false, false), PageStep::Fetch);
        assert_eq!(page_step(true, false, true), PageStep::Fetch);
    }
}
