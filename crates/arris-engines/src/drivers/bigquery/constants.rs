//! Constants for the BigQuery driver.

/// Rows fetched per `getQueryResults` page while streaming a SELECT. BigQuery
/// also caps each page at ~10 MB, so a large page still yields at that ceiling.
pub(super) const BQ_STREAM_PAGE_ROWS: i32 = 10_000;

/// Poll interval while a submitted job is not yet complete (`jobComplete=false`).
pub(super) const BQ_JOB_POLL_INTERVAL_MS: u64 = 200;
