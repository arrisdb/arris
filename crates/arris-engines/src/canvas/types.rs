use serde::{Deserialize, Serialize};

use crate::QueryResult;

/// One query cell on a board, as sent from the frontend for a chained run. The
/// engine builds the dependency graph from each cell's `sql` (its `FROM`/`JOIN`
/// references that match another cell's sanitized `title`).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasCellSpec {
    pub id: String,
    pub title: String,
    pub sql: String,
    pub connection_id: Option<String>,
    /// Per-cell row limit: `Some(n)` caps the fetch to n rows, `None` fetches
    /// the full result ("Select all rows").
    #[serde(default)]
    pub limit: Option<u64>,
}

/// One cell's ingested run: the UI page plus the full-result totals.
/// `complete: false` means the byte budget stopped ingestion early ("N+ rows").
#[derive(Clone, Debug)]
pub struct IngestedCell {
    pub result: QueryResult,
    pub total_rows: u64,
    pub complete: bool,
}

/// Totals reported once a cell's background ingest finishes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellIngestDone {
    pub total_rows: u64,
    pub complete: bool,
}

/// The outcome of running one cell during a chained run: either its result or the
/// error that stopped it (a failed upstream blocks its descendants).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasCellRun {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<QueryResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Rows in the FULL cached result (the `result` page may hold fewer).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_rows: Option<u64>,
    /// `false` when the byte budget truncated ingestion ("N+ rows").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub complete: Option<bool>,
}

impl CanvasCellRun {
    pub fn ok(id: String, result: QueryResult) -> Self {
        Self {
            id,
            result: Some(result),
            error: None,
            total_rows: None,
            complete: None,
        }
    }

    pub fn ingested(id: String, cell: IngestedCell) -> Self {
        Self {
            id,
            result: Some(cell.result),
            error: None,
            total_rows: Some(cell.total_rows),
            complete: Some(cell.complete),
        }
    }

    pub fn failed(id: String, error: String) -> Self {
        Self {
            id,
            result: None,
            error: Some(error),
            total_rows: None,
            complete: None,
        }
    }
}
