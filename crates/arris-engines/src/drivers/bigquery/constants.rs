//! Constants for the BigQuery driver.

/// Rows asked for on the opening `jobs.query`. Kept small so the editor paints
/// first rows quickly.
pub(super) const BQ_FIRST_PAGE_ROWS: i32 = 10_000;

/// Rows asked for per follow-up `getQueryResults` page. Large because each round
/// trip costs more than the bytes: BigQuery caps a page at ~10 MB regardless.
pub(super) const BQ_STREAM_PAGE_ROWS: i32 = 100_000;

/// Poll interval while a submitted job is not yet complete (`jobComplete=false`).
pub(super) const BQ_JOB_POLL_INTERVAL_MS: u64 = 200;
