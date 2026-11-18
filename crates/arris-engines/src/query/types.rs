use std::sync::Arc;

use crate::{DatabaseDriver, QueryLanguage, QueryValue};
use tokio_util::sync::CancellationToken;

pub struct RunningQuery {
    pub(super) cancel_token: CancellationToken,
    pub(super) driver: Option<Arc<dyn DatabaseDriver>>,
}

/// One statement for `QueryEngine::run_query`; `query_id` makes it cancellable.
pub struct QueryRequest {
    pub sql: String,
    pub params: Vec<QueryValue>,
    pub language: Option<QueryLanguage>,
    pub page_size: Option<u32>,
    pub page: Option<u32>,
    pub query_id: Option<String>,
}
