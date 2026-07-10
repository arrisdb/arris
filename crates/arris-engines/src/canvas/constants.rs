/// Hard cap on the combined in-memory + on-disk footprint of one board's
/// cell-result cache. Once crossed, least-recently-used cell results are evicted.
pub const CELL_CACHE_TOTAL_BUDGET: usize = 10 * 1024 * 1024 * 1024;

/// Soft cap on the in-memory tier of the cell-result cache. Results above this
/// (coldest first) spill to Arrow IPC on disk; they stay queryable, just read
/// back from the file on demand.
pub const CELL_CACHE_MEMORY_BUDGET: usize = 1024 * 1024 * 1024;

/// Hard cap on the Arrow bytes one streamed cell run may ingest. Crossing it
/// stops ingestion; the run keeps what it has and reports `complete: false`.
pub const CELL_INGEST_BYTE_BUDGET: usize = 4 * 1024 * 1024 * 1024;

/// Rows of a cell result sent to the webview as JSON (the UI page); the full
/// result lives only in the Arrow cache.
pub const CELL_RESULT_PAGE_ROWS: usize = 500;

/// Memory pool for a single chained-cell DataFusion query. Separate from the
/// cache budget above: this bounds one query's working set (it spills to disk
/// past the limit), the cache budget bounds stored results.
pub(crate) const QUERY_MEMORY_POOL_SIZE: usize = 512 * 1024 * 1024;

/// Subdirectory of the app data dir holding spilled cell-cache files. Purged on
/// startup and clean shutdown so cached query data never persists across runs.
pub const CANVAS_CELL_CACHE_DIR_NAME: &str = "canvas-cell-cache";

/// XChaCha20-Poly1305 key length (256-bit) for the per-session spill cipher.
pub(super) const SPILL_KEY_LEN: usize = 32;

/// XChaCha20-Poly1305 nonce length (192-bit), safe to sample at random per frame.
pub(super) const SPILL_NONCE_LEN: usize = 24;
