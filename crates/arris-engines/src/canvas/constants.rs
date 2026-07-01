/// Hard cap on the combined in-memory + on-disk footprint of one board's
/// cell-result cache. Once crossed, least-recently-used cell results are evicted.
pub const CELL_CACHE_TOTAL_BUDGET: usize = 10 * 1024 * 1024 * 1024;

/// Soft cap on the in-memory tier of the cell-result cache. Results above this
/// (coldest first) spill to Arrow IPC on disk; they stay queryable, just read
/// back from the file on demand.
pub const CELL_CACHE_MEMORY_BUDGET: usize = 1024 * 1024 * 1024;

/// Memory pool for a single chained-cell DataFusion query. Separate from the
/// cache budget above: this bounds one query's working set (it spills to disk
/// past the limit), the cache budget bounds stored results.
pub(crate) const QUERY_MEMORY_POOL_SIZE: usize = 512 * 1024 * 1024;
