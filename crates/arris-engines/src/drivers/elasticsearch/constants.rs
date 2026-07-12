//! Constants for the Elasticsearch driver.

/// `_sql` cursor page size. Larger pages mean fewer HTTP round trips when
/// draining a big result through the cursor; both the buffered and streamed
/// SQL paths use it.
pub(super) const ES_SQL_FETCH_SIZE: usize = 10_000;
