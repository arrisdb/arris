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
}

impl CanvasCellRun {
    pub fn ok(id: String, result: QueryResult) -> Self {
        Self {
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn failed(id: String, error: String) -> Self {
        Self {
            id,
            result: None,
            error: Some(error),
        }
    }
}
