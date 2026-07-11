use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use datafusion::arrow::datatypes::SchemaRef;
use datafusion::arrow::record_batch::RecordBatch;
use datafusion::datasource::MemTable;
use datafusion::execution::disk_manager::DiskManagerBuilder;
use datafusion::execution::memory_pool::FairSpillPool;
use datafusion::execution::runtime_env::RuntimeEnvBuilder;
use datafusion::prelude::{SessionConfig, SessionContext};
use futures::stream::BoxStream;
use futures::StreamExt;
use tokio_util::sync::CancellationToken;

use super::constants::{CELL_INGEST_BYTE_BUDGET, CELL_RESULT_PAGE_ROWS, QUERY_MEMORY_POOL_SIZE};
use super::errors::CanvasError;
use super::impl_cell_cache_writer::CellCacheWriter;
use super::impl_cell_result_cache::CellResultCache;
use super::types::{CanvasCellSpec, CellIngestDone, IngestedCell, IngestedPage};
use crate::drivers::common::ArrowChunkBuilder;
use crate::federation::FederationEngine;
use crate::{DriverError, QueryResult, QueryStream, QueryValue, RowChunkStream};

/// Runs canvas query cells that read OTHER cells' results. Each cell's output is
/// kept (as Arrow) in a [`CellResultCache`]; when a cell's SQL references another
/// cell by its (sanitized) title, that cached result is registered as a DataFusion
/// `MemTable` and the query executes in-process. This is the engine half of the
/// canvas cell-chaining feature: cell B can `SELECT ... FROM a` where `a` is the
/// sanitized title of cell A.
///
/// Cache entries are board-scoped, so two boards may reuse the same cell titles
/// without colliding. Planning (`plan`) and reference parsing (`table_refs`) are
/// pure helpers the command layer uses to drive the auto-run-upstream order.
pub struct CanvasEngine {
    cache: Arc<CellResultCache>,
}

impl CanvasEngine {
    pub fn new(cache: Arc<CellResultCache>) -> Self {
        Self { cache }
    }

    pub fn cache(&self) -> &Arc<CellResultCache> {
        &self.cache
    }

    /// Turn a cell title into a SQL-safe table identifier: lowercased, every
    /// non-alphanumeric run collapsed to a single underscore, trimmed, and
    /// prefixed if it would otherwise start with a digit. This is the name a
    /// downstream cell uses to reference it.
    pub fn sanitize_title(title: &str) -> String {
        let mut out = String::new();
        let mut prev_underscore = false;
        for ch in title.chars() {
            if ch.is_ascii_alphanumeric() {
                out.push(ch.to_ascii_lowercase());
                prev_underscore = false;
            } else if !prev_underscore {
                out.push('_');
                prev_underscore = true;
            }
        }
        let trimmed = out.trim_matches('_');
        if trimmed.is_empty() {
            return "cell".to_string();
        }
        if trimmed.starts_with(|c: char| c.is_ascii_digit()) {
            return format!("_{trimmed}");
        }
        trimmed.to_string()
    }

    /// The table names referenced after `FROM`/`JOIN`, lowercased and stripped to
    /// their leading identifier. A dotted name (`conn.schema.table`) reduces to
    /// its first segment, which a cell title never matches, so a federation/live
    /// reference simply doesn't resolve to a cell here.
    pub fn table_refs(sql: &str) -> Vec<String> {
        let tokens: Vec<&str> = sql
            .split(|c: char| c.is_whitespace() || c == ',' || c == '(' || c == ')')
            .filter(|t| !t.is_empty())
            .collect();
        let mut out: Vec<String> = Vec::new();
        for (i, tok) in tokens.iter().enumerate() {
            let upper = tok.to_ascii_uppercase();
            if (upper == "FROM" || upper == "JOIN") && i + 1 < tokens.len() {
                let ident: String = tokens[i + 1]
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                    .collect::<String>()
                    .to_ascii_lowercase();
                if !ident.is_empty() && !out.contains(&ident) {
                    out.push(ident);
                }
            }
        }
        out
    }

    /// Board-scoped cache key for a cell title.
    fn key(board: &str, title: &str) -> String {
        format!("{board}\u{1}{}", Self::sanitize_title(title))
    }

    /// Topologically order the target cell and its transitive cell dependencies
    /// (dependencies first, target last), so the caller runs upstream cells
    /// before the ones that read them. Returns an error on a dependency cycle or
    /// an unknown target.
    pub fn plan(cells: &[CanvasCellSpec], target_id: &str) -> Result<Vec<String>, CanvasError> {
        let by_id: HashMap<&str, &CanvasCellSpec> =
            cells.iter().map(|c| (c.id.as_str(), c)).collect();
        if !by_id.contains_key(target_id) {
            return Err(CanvasError::Engine(format!("unknown target cell {target_id}")));
        }
        // Sanitized title -> cell id. Last cell wins on a title collision.
        let title_to_id: HashMap<String, String> = cells
            .iter()
            .map(|c| (Self::sanitize_title(&c.title), c.id.clone()))
            .collect();

        let mut order: Vec<String> = Vec::new();
        // 0 = on the current DFS stack (cycle if re-seen), 1 = finished.
        let mut state: HashMap<String, u8> = HashMap::new();
        Self::visit(target_id, &by_id, &title_to_id, &mut state, &mut order)?;
        Ok(order)
    }

    fn visit(
        id: &str,
        by_id: &HashMap<&str, &CanvasCellSpec>,
        title_to_id: &HashMap<String, String>,
        state: &mut HashMap<String, u8>,
        order: &mut Vec<String>,
    ) -> Result<(), CanvasError> {
        match state.get(id) {
            Some(1) => return Ok(()),
            Some(_) => {
                return Err(CanvasError::Engine(format!(
                    "dependency cycle involving cell {id}"
                )))
            }
            None => {}
        }
        state.insert(id.to_string(), 0);
        if let Some(cell) = by_id.get(id) {
            for dep_title in Self::table_refs(&cell.sql) {
                if let Some(dep_id) = title_to_id.get(&dep_title) {
                    if dep_id != id {
                        Self::visit(dep_id, by_id, title_to_id, state, order)?;
                    }
                }
            }
        }
        state.insert(id.to_string(), 1);
        order.push(id.to_string());
        Ok(())
    }

    /// A DataFusion session with a bounded, disk-spilling memory pool. Mirrors the
    /// federation engine's setup so chained-cell queries spill rather than OOM.
    fn session_context() -> Result<SessionContext, CanvasError> {
        let runtime = RuntimeEnvBuilder::new()
            .with_memory_pool(Arc::new(FairSpillPool::new(QUERY_MEMORY_POOL_SIZE)))
            .with_disk_manager_builder(DiskManagerBuilder::default())
            .build_arc()
            .map_err(|e| CanvasError::Engine(e.to_string()))?;
        let mut config = SessionConfig::new();
        config.options_mut().optimizer.prefer_hash_join = false;
        Ok(SessionContext::new_with_config_rt(config, runtime))
    }

    /// Store a plain (non-chained) cell's result so downstream cells on the same
    /// board can read it. Call this after running any ordinary query object.
    pub fn cache_result(
        &self,
        board: &str,
        title: &str,
        result: &QueryResult,
    ) -> Result<(), CanvasError> {
        let (_schema, batch) =
            FederationEngine::query_result_to_batch(result).map_err(CanvasError::Conversion)?;
        self.cache.put(&Self::key(board, title), vec![batch])
    }

    /// Run one cell's SQL, registering every referenced cell on this board that has
    /// a cached result as a `MemTable`, then cache this cell's own output under its
    /// sanitized title (so cells downstream of it can read it in turn). A trailing
    /// semicolon is stripped (DataFusion rejects it). The returned page holds at
    /// most `CELL_RESULT_PAGE_ROWS` rows; the full result lives in the cache.
    pub async fn run_cell(
        &self,
        board: &str,
        title: &str,
        sql: &str,
    ) -> Result<IngestedCell, CanvasError> {
        let start = Instant::now();
        let batches = self.execute_over_cache(board, sql).await?;
        let total_rows: u64 = batches.iter().map(|b| b.num_rows() as u64).sum();
        let page = Self::page_batches(&batches, CELL_RESULT_PAGE_ROWS);
        let result =
            FederationEngine::batches_to_query_result(&page, start.elapsed().as_secs_f64());
        self.cache.put(&Self::key(board, title), batches)?;
        Ok(IngestedCell {
            result,
            total_rows,
            complete: true,
        })
    }

    /// Run `sql` against this board's cached cells (each referenced cell registered
    /// as a `MemTable`) and collect the whole result. Shared by `run_cell` (pages +
    /// caches the output) and `query_cache` (returns it uncached). A trailing
    /// semicolon is stripped (DataFusion rejects it).
    async fn execute_over_cache(
        &self,
        board: &str,
        sql: &str,
    ) -> Result<Vec<RecordBatch>, CanvasError> {
        let sql = sql.trim().trim_end_matches(';').trim();
        let ctx = Self::session_context()?;
        for name in Self::table_refs(sql) {
            if let Some(batches) = self.cache.get(&Self::key(board, &name))? {
                let schema = batches[0].schema();
                let table = MemTable::try_new(schema, vec![batches])
                    .map_err(|e| CanvasError::Engine(e.to_string()))?;
                ctx.register_table(name.as_str(), Arc::new(table))
                    .map_err(|e| CanvasError::Engine(e.to_string()))?;
            }
        }
        let df = ctx
            .sql(sql)
            .await
            .map_err(|e| CanvasError::Engine(e.to_string()))?;
        let schema: SchemaRef = Arc::new(df.schema().as_arrow().clone());
        let mut batches = df
            .collect()
            .await
            .map_err(|e| CanvasError::Engine(e.to_string()))?;
        if batches.is_empty() {
            batches.push(RecordBatch::new_empty(schema));
        }
        Ok(batches)
    }

    /// Run an ephemeral read-only query over this board's cached cells and return
    /// the WHOLE result, not paged and not cached. A chart uses this to aggregate
    /// over its source cell's full cached result: the chart's `GROUP BY` (or a
    /// `LIMIT` sample for raw kinds) keeps the output small regardless of how many
    /// rows the source holds, so it never floods the IPC bridge.
    pub async fn query_cache(&self, board: &str, sql: &str) -> Result<QueryResult, CanvasError> {
        let start = Instant::now();
        let batches = self.execute_over_cache(board, sql).await?;
        Ok(FederationEngine::batches_to_query_result(
            &batches,
            start.elapsed().as_secs_f64(),
        ))
    }

    /// A slice of a cached cell's full result: rows `[offset, offset + limit)` as a
    /// `QueryResult`. `None` when the cell has no cached result (never run, or
    /// evicted). The table object pages through the full result with this, never
    /// shipping more than one page across the IPC bridge at a time.
    pub fn fetch_page(
        &self,
        board: &str,
        title: &str,
        offset: usize,
        limit: usize,
    ) -> Result<Option<QueryResult>, CanvasError> {
        let Some(batches) = self.cache.get(&Self::key(board, title))? else {
            return Ok(None);
        };
        let page = Self::slice_batches(&batches, offset, limit);
        Ok(Some(FederationEngine::batches_to_query_result(&page, 0.0)))
    }

    /// The first `limit` rows of `batches` (whole batches plus one final slice),
    /// keeping at least one batch so an empty result preserves its columns.
    fn page_batches(batches: &[RecordBatch], limit: usize) -> Vec<RecordBatch> {
        let mut out = Vec::new();
        let mut remaining = limit;
        for batch in batches {
            if remaining == 0 && !out.is_empty() {
                break;
            }
            if batch.num_rows() <= remaining {
                remaining -= batch.num_rows();
                out.push(batch.clone());
            } else {
                out.push(batch.slice(0, remaining));
                remaining = 0;
            }
        }
        out
    }

    /// Rows `[offset, offset + limit)` across batch boundaries. Keeps at least one
    /// (empty) batch so the columns survive an out-of-range offset.
    fn slice_batches(batches: &[RecordBatch], offset: usize, limit: usize) -> Vec<RecordBatch> {
        let mut out: Vec<RecordBatch> = Vec::new();
        let mut skip = offset;
        let mut remaining = limit;
        for batch in batches {
            if remaining == 0 {
                break;
            }
            let rows = batch.num_rows();
            if skip >= rows {
                skip -= rows;
                continue;
            }
            let take = (rows - skip).min(remaining);
            out.push(batch.slice(skip, take));
            remaining -= take;
            skip = 0;
        }
        if out.is_empty() {
            if let Some(first) = batches.first() {
                out.push(first.slice(0, 0));
            }
        }
        out
    }

    /// Stream a driver's query result into this board's cell cache, peeling the
    /// first `CELL_RESULT_PAGE_ROWS` rows as the UI page. Cancellation is
    /// checked between chunks; a cancel (or any error) aborts the writer so no
    /// partial entry is registered.
    pub async fn ingest_cell_stream(
        &self,
        board: &str,
        title: &str,
        stream: QueryStream,
        cancel: Option<&CancellationToken>,
    ) -> Result<IngestedCell, CanvasError> {
        self.ingest_cell_stream_with_budget(
            board,
            title,
            stream,
            cancel,
            CELL_INGEST_BYTE_BUDGET,
            None,
        )
        .await
    }

    /// `ingest_cell_stream` with an explicit byte budget (tests shrink it to
    /// force the truncated, `complete: false` path) and an optional voluntary
    /// row cap (a per-cell LIMIT on order-sensitive dialects that cannot be
    /// SQL-wrapped; a cap stop reports `complete: true`).
    pub async fn ingest_cell_stream_with_budget(
        &self,
        board: &str,
        title: &str,
        stream: QueryStream,
        cancel: Option<&CancellationToken>,
        budget: usize,
        row_cap: Option<u64>,
    ) -> Result<IngestedCell, CanvasError> {
        let start = Instant::now();
        let (page, cont) = self
            .start_cell_ingest(board, title, stream, cancel, budget, row_cap)
            .await?;
        let done = cont.finish(cancel).await?;
        let mut result = page.result;
        result.elapsed = start.elapsed().as_secs_f64();
        // A budget stop can refuse a chunk whose rows were already peeled into
        // the page; the reported total is at least what the UI shows.
        let total_rows = done.total_rows.max(result.rows.len() as u64);
        Ok(IngestedCell {
            result,
            total_rows,
            complete: done.complete,
        })
    }

    /// Begin streaming a driver's result into the cell cache and return the UI
    /// page as soon as it is filled (or the stream ends / the cap is hit). The
    /// returned continuation drains the remainder; call `finish` on it in the
    /// foreground or a spawned task. A phase-1 error or cancel aborts the cache
    /// writer so no partial entry is registered.
    pub async fn start_cell_ingest(
        &self,
        board: &str,
        title: &str,
        stream: QueryStream,
        cancel: Option<&CancellationToken>,
        budget: usize,
        row_cap: Option<u64>,
    ) -> Result<(IngestedPage, CellIngestContinuation), CanvasError> {
        let key = Self::key(board, title);
        let writer = self.cache.begin_with_budget(&key, budget);
        match stream {
            QueryStream::Rows(rows) => Self::start_rows(rows, writer, cancel, row_cap).await,
            QueryStream::Arrow(batches) => Self::start_arrow(batches, writer, cancel, row_cap).await,
        }
    }

    /// Phase 1 for a row stream: read chunks (appending each to the cache) until
    /// the page fills, the stream ends, or the cap is reached.
    async fn start_rows(
        mut rows: RowChunkStream,
        mut writer: CellCacheWriter,
        cancel: Option<&CancellationToken>,
        row_cap: Option<u64>,
    ) -> Result<(IngestedPage, CellIngestContinuation), CanvasError> {
        let mut builder = ArrowChunkBuilder::new(&rows.columns);
        let columns = rows.columns.clone();
        let mut page: Vec<Vec<QueryValue>> = Vec::new();
        let mut total: u64 = 0;
        let mut complete = true;
        while page.len() < CELL_RESULT_PAGE_ROWS {
            let next = match cancel {
                Some(token) => tokio::select! {
                    item = rows.chunks.next() => item,
                    _ = token.cancelled() => {
                        writer.abort();
                        return Err(CanvasError::Cancelled);
                    }
                },
                None => rows.chunks.next().await,
            };
            let Some(item) = next else { break };
            let mut chunk = match item.map_err(Self::driver_stream_error) {
                Ok(c) => c,
                Err(e) => {
                    writer.abort();
                    return Err(e);
                }
            };
            if let Some(cap) = row_cap {
                let remaining = cap.saturating_sub(total) as usize;
                if chunk.len() > remaining {
                    chunk.truncate(remaining);
                }
            }
            let take = (CELL_RESULT_PAGE_ROWS - page.len()).min(chunk.len());
            page.extend_from_slice(&chunk[..take]);
            let batch = match builder.batch(&chunk).map_err(CanvasError::Conversion) {
                Ok(b) => b,
                Err(e) => {
                    writer.abort();
                    return Err(e);
                }
            };
            match writer.append(batch) {
                Ok(true) => {}
                Ok(false) => {
                    complete = false;
                    break;
                }
                Err(e) => {
                    writer.abort();
                    return Err(e);
                }
            }
            total += chunk.len() as u64;
            if row_cap.is_some_and(|cap| total >= cap) {
                break;
            }
        }
        let result = QueryResult {
            columns,
            rows: page,
            ..Default::default()
        };
        let cont = CellIngestContinuation {
            writer,
            source: IngestSource::Rows {
                chunks: rows.chunks,
                builder,
            },
            total,
            complete,
            row_cap,
        };
        Ok((IngestedPage { result }, cont))
    }

    /// Phase 1 for an Arrow stream (no row DTO involved).
    async fn start_arrow(
        mut batches: BoxStream<'static, Result<RecordBatch, DriverError>>,
        mut writer: CellCacheWriter,
        cancel: Option<&CancellationToken>,
        row_cap: Option<u64>,
    ) -> Result<(IngestedPage, CellIngestContinuation), CanvasError> {
        let mut page: Vec<RecordBatch> = Vec::new();
        let mut page_rows = 0usize;
        let mut total: u64 = 0;
        let mut complete = true;
        while page_rows < CELL_RESULT_PAGE_ROWS {
            let next = match cancel {
                Some(token) => tokio::select! {
                    item = batches.next() => item,
                    _ = token.cancelled() => {
                        writer.abort();
                        return Err(CanvasError::Cancelled);
                    }
                },
                None => batches.next().await,
            };
            let Some(item) = next else { break };
            let mut batch = match item.map_err(Self::driver_stream_error) {
                Ok(b) => b,
                Err(e) => {
                    writer.abort();
                    return Err(e);
                }
            };
            if let Some(cap) = row_cap {
                let remaining = cap.saturating_sub(total) as usize;
                if batch.num_rows() > remaining {
                    batch = batch.slice(0, remaining);
                }
            }
            let take = (CELL_RESULT_PAGE_ROWS - page_rows).min(batch.num_rows());
            page.push(batch.slice(0, take));
            page_rows += take;
            let rows = batch.num_rows() as u64;
            match writer.append(batch) {
                Ok(true) => {}
                Ok(false) => {
                    complete = false;
                    break;
                }
                Err(e) => {
                    writer.abort();
                    return Err(e);
                }
            }
            total += rows;
            if row_cap.is_some_and(|cap| total >= cap) {
                break;
            }
        }
        let result = FederationEngine::batches_to_query_result(&page, 0.0);
        let cont = CellIngestContinuation {
            writer,
            source: IngestSource::Arrow(batches),
            total,
            complete,
            row_cap,
        };
        Ok((IngestedPage { result }, cont))
    }

    fn driver_stream_error(e: DriverError) -> CanvasError {
        match e {
            DriverError::Cancelled => CanvasError::Cancelled,
            other => CanvasError::Engine(other.to_string()),
        }
    }

    /// Drop every cached result for a board (e.g. when its tab closes).
    pub fn clear_board(&self, board: &str, titles: &[String]) {
        for title in titles {
            self.cache.remove(&Self::key(board, title));
        }
    }
}

/// The stream a `CellIngestContinuation` drains after the page has been peeled.
enum IngestSource {
    Rows {
        chunks: BoxStream<'static, Result<Vec<Vec<QueryValue>>, DriverError>>,
        builder: ArrowChunkBuilder,
    },
    Arrow(BoxStream<'static, Result<RecordBatch, DriverError>>),
}

/// Owns the open cache writer and the remainder of a streamed cell result after
/// its UI page was returned. `finish` drains the rest into the cache (bounded
/// memory) and reports the totals; it is `Send` so it can run on a spawned task.
pub struct CellIngestContinuation {
    writer: CellCacheWriter,
    source: IngestSource,
    total: u64,
    complete: bool,
    row_cap: Option<u64>,
}

impl CellIngestContinuation {
    /// Drain the remaining stream into the cache and finalize the entry. A
    /// cancel or driver error aborts the writer (no entry registered).
    pub async fn finish(
        mut self,
        cancel: Option<&CancellationToken>,
    ) -> Result<CellIngestDone, CanvasError> {
        let already_capped = self.row_cap.is_some_and(|cap| self.total >= cap);
        // Skip the drain when phase 1 already stopped (byte budget or row cap).
        if self.complete && !already_capped {
            let row_cap = self.row_cap;
            let drained = match &mut self.source {
                IngestSource::Rows { chunks, builder } => {
                    Self::drain_rows(chunks, builder, &mut self.writer, cancel, row_cap, &mut self.total)
                        .await
                }
                IngestSource::Arrow(batches) => {
                    Self::drain_arrow(batches, &mut self.writer, cancel, row_cap, &mut self.total).await
                }
            };
            match drained {
                Ok(complete) => self.complete = complete,
                Err(e) => {
                    self.writer.abort();
                    return Err(e);
                }
            }
        }
        let stats = self.writer.finish()?;
        Ok(CellIngestDone {
            total_rows: stats.total_rows,
            complete: self.complete,
        })
    }

    async fn drain_rows(
        chunks: &mut BoxStream<'static, Result<Vec<Vec<QueryValue>>, DriverError>>,
        builder: &mut ArrowChunkBuilder,
        writer: &mut CellCacheWriter,
        cancel: Option<&CancellationToken>,
        row_cap: Option<u64>,
        total: &mut u64,
    ) -> Result<bool, CanvasError> {
        loop {
            let next = match cancel {
                Some(token) => tokio::select! {
                    item = chunks.next() => item,
                    _ = token.cancelled() => return Err(CanvasError::Cancelled),
                },
                None => chunks.next().await,
            };
            let Some(item) = next else { break };
            let mut chunk = item.map_err(CanvasEngine::driver_stream_error)?;
            if let Some(cap) = row_cap {
                let remaining = cap.saturating_sub(*total) as usize;
                if chunk.len() > remaining {
                    chunk.truncate(remaining);
                }
            }
            let batch = builder.batch(&chunk).map_err(CanvasError::Conversion)?;
            if !writer.append(batch)? {
                return Ok(false);
            }
            *total += chunk.len() as u64;
            if row_cap.is_some_and(|cap| *total >= cap) {
                break;
            }
        }
        Ok(true)
    }

    async fn drain_arrow(
        batches: &mut BoxStream<'static, Result<RecordBatch, DriverError>>,
        writer: &mut CellCacheWriter,
        cancel: Option<&CancellationToken>,
        row_cap: Option<u64>,
        total: &mut u64,
    ) -> Result<bool, CanvasError> {
        loop {
            let next = match cancel {
                Some(token) => tokio::select! {
                    item = batches.next() => item,
                    _ = token.cancelled() => return Err(CanvasError::Cancelled),
                },
                None => batches.next().await,
            };
            let Some(item) = next else { break };
            let mut batch = item.map_err(CanvasEngine::driver_stream_error)?;
            if let Some(cap) = row_cap {
                let remaining = cap.saturating_sub(*total) as usize;
                if batch.num_rows() > remaining {
                    batch = batch.slice(0, remaining);
                }
            }
            let rows = batch.num_rows() as u64;
            if !writer.append(batch)? {
                return Ok(false);
            }
            *total += rows;
            if row_cap.is_some_and(|cap| *total >= cap) {
                break;
            }
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use crate::{ColumnSpec, QueryValue, StatementType};

    use super::*;

    const BOARD: &str = "board-1";

    static DIR_SEQ: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let n = DIR_SEQ.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("arris-canvasengine-{}-{}", std::process::id(), n))
    }

    fn engine() -> CanvasEngine {
        let cache = Arc::new(CellResultCache::new(temp_dir(), 1 << 30, 1 << 30));
        CanvasEngine::new(cache)
    }

    fn col(name: &str, hint: &str) -> ColumnSpec {
        ColumnSpec {
            name: name.to_string(),
            type_hint: hint.to_string(),
        }
    }

    /// A two-column (category TEXT, total INT) result used as the upstream cell.
    fn sales_result() -> QueryResult {
        QueryResult {
            columns: vec![col("category", "text"), col("total", "int")],
            rows: vec![
                vec![QueryValue::Text("books".into()), QueryValue::Int(10)],
                vec![QueryValue::Text("toys".into()), QueryValue::Int(5)],
                vec![QueryValue::Text("books".into()), QueryValue::Int(3)],
            ],
            rows_affected: None,
            elapsed: 0.0,
            has_more: None,
            statement_type: StatementType::Query,
        }
    }

    fn spec(id: &str, title: &str, sql: &str) -> CanvasCellSpec {
        CanvasCellSpec {
            id: id.to_string(),
            title: title.to_string(),
            sql: sql.to_string(),
            connection_id: None,
            limit: None,
        }
    }

    fn text_at(result: &QueryResult, row: usize, col: usize) -> String {
        match &result.rows[row][col] {
            QueryValue::Text(s) => s.clone(),
            other => panic!("expected text, got {other:?}"),
        }
    }

    fn int_at(result: &QueryResult, row: usize, col: usize) -> i64 {
        match &result.rows[row][col] {
            QueryValue::Int(n) => *n,
            other => panic!("expected int, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn cell_b_aggregates_cell_a_cached_result() {
        let engine = engine();
        engine.cache_result(BOARD, "a", &sales_result()).unwrap();

        let out = engine
            .run_cell(
                BOARD,
                "b",
                "SELECT category, SUM(total) AS total FROM a GROUP BY category ORDER BY category",
            )
            .await
            .unwrap();

        assert_eq!(
            out.result.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["category", "total"]
        );
        assert_eq!(out.result.rows.len(), 2);
        assert_eq!(out.total_rows, 2);
        assert!(out.complete);
        assert_eq!(text_at(&out.result, 0, 0), "books");
        assert_eq!(int_at(&out.result, 0, 1), 13);
        assert_eq!(text_at(&out.result, 1, 0), "toys");
        assert_eq!(int_at(&out.result, 1, 1), 5);
    }

    #[tokio::test]
    async fn select_star_with_trailing_semicolon_reads_the_cell() {
        let engine = engine();
        engine.cache_result(BOARD, "abc", &sales_result()).unwrap();
        // Mirrors the UI: a `SELECT * fROM abc;` reading another cell's result.
        let out = engine.run_cell(BOARD, "query", "SELECT * fROM abc;").await.unwrap();
        assert_eq!(out.result.rows.len(), 3);
        assert_eq!(out.result.columns.len(), 2);
    }

    #[tokio::test]
    async fn a_chained_cell_is_cached_for_its_own_downstream() {
        let engine = engine();
        engine.cache_result(BOARD, "a", &sales_result()).unwrap();
        engine
            .run_cell(BOARD, "b", "SELECT category, SUM(total) AS total FROM a GROUP BY category")
            .await
            .unwrap();
        assert!(engine.cache().contains(&CanvasEngine::key(BOARD, "b")));

        let out = engine
            .run_cell(BOARD, "c", "SELECT SUM(total) AS grand FROM b")
            .await
            .unwrap();
        assert_eq!(int_at(&out.result, 0, 0), 18);
    }

    #[tokio::test]
    async fn board_scoping_keeps_same_titled_cells_apart() {
        let engine = engine();
        let mut other = sales_result();
        other.rows.clear();
        engine.cache_result("board-A", "a", &sales_result()).unwrap();
        engine.cache_result("board-B", "a", &other).unwrap();
        let a = engine.run_cell("board-A", "x", "SELECT * FROM a").await.unwrap();
        let b = engine.run_cell("board-B", "x", "SELECT * FROM a").await.unwrap();
        assert_eq!(a.result.rows.len(), 3);
        assert_eq!(b.result.rows.len(), 0);
    }

    #[tokio::test]
    async fn referencing_an_unknown_cell_errors() {
        let engine = engine();
        let err = engine
            .run_cell(BOARD, "b", "SELECT * FROM does_not_exist")
            .await
            .unwrap_err();
        assert!(matches!(err, CanvasError::Engine(_)));
    }

    #[test]
    fn plan_orders_dependencies_before_the_target() {
        let cells = vec![
            spec("id_q", "Query", "SELECT * FROM abc"),
            spec("id_abc", "abc", "SELECT * FROM public.sales"),
        ];
        let order = CanvasEngine::plan(&cells, "id_q").unwrap();
        assert_eq!(order, vec!["id_abc".to_string(), "id_q".to_string()]);
    }

    #[test]
    fn plan_runs_only_the_targets_ancestors() {
        let cells = vec![
            spec("a", "a", "SELECT 1"),
            spec("b", "b", "SELECT * FROM a"),
            spec("c", "c", "SELECT 2"),
        ];
        // Target b pulls in a, but not the unrelated c.
        let order = CanvasEngine::plan(&cells, "b").unwrap();
        assert_eq!(order, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn plan_detects_a_dependency_cycle() {
        let cells = vec![
            spec("a", "a", "SELECT * FROM b"),
            spec("b", "b", "SELECT * FROM a"),
        ];
        let err = CanvasEngine::plan(&cells, "a").unwrap_err();
        assert!(matches!(err, CanvasError::Engine(_)));
    }

    #[test]
    fn sanitize_title_makes_a_sql_safe_identifier() {
        assert_eq!(CanvasEngine::sanitize_title("Monthly Sales"), "monthly_sales");
        assert_eq!(CanvasEngine::sanitize_title("  spaced  "), "spaced");
        assert_eq!(CanvasEngine::sanitize_title("2024 totals"), "_2024_totals");
        assert_eq!(CanvasEngine::sanitize_title("a--b__c"), "a_b_c");
        assert_eq!(CanvasEngine::sanitize_title("!!!"), "cell");
    }

    #[test]
    fn table_refs_picks_out_from_and_join_targets() {
        let refs =
            CanvasEngine::table_refs("SELECT * FROM Orders o JOIN customers c ON o.cid = c.id");
        assert_eq!(refs, vec!["orders", "customers"]);
    }

    // ── ingest_cell_stream (synthetic in-memory streams) ─────────────────────

    /// A row stream of `chunks` chunks x `chunk_rows` rows of (n INT, s TEXT).
    fn synthetic_stream(chunks: usize, chunk_rows: usize) -> QueryStream {
        let columns = vec![col("n", "int8"), col("s", "text")];
        let mut all = Vec::new();
        for c in 0..chunks {
            let chunk: Vec<Vec<QueryValue>> = (0..chunk_rows)
                .map(|r| {
                    let n = (c * chunk_rows + r) as i64;
                    vec![QueryValue::Int(n), QueryValue::Text(format!("row-{n}"))]
                })
                .collect();
            all.push(Ok(chunk));
        }
        QueryStream::Rows(RowChunkStream {
            columns,
            chunks: futures::stream::iter(all).boxed(),
        })
    }

    #[tokio::test]
    async fn ingest_peels_the_page_and_caches_the_full_result() {
        let engine = engine();
        // 3 chunks x 300 rows = 900 total; page is capped at 500.
        let out = engine
            .ingest_cell_stream(BOARD, "a", synthetic_stream(3, 300), None)
            .await
            .unwrap();
        assert_eq!(out.total_rows, 900);
        assert!(out.complete);
        assert_eq!(out.result.rows.len(), CELL_RESULT_PAGE_ROWS);
        assert_eq!(out.result.columns.len(), 2);
        assert_eq!(out.result.rows[0][0], QueryValue::Int(0));
        assert_eq!(out.result.rows[499][0], QueryValue::Int(499));

        // A chained aggregate reads the FULL cached result, not the page.
        let agg = engine
            .run_cell(BOARD, "b", "SELECT COUNT(*) AS c, SUM(n) AS s FROM a")
            .await
            .unwrap();
        assert_eq!(int_at(&agg.result, 0, 0), 900);
        assert_eq!(int_at(&agg.result, 0, 1), (0..900).sum::<i64>());
    }

    #[tokio::test]
    async fn ingest_byte_budget_truncates_and_reports_incomplete() {
        let engine = engine();
        // A tiny budget admits the first chunk at most.
        let out = engine
            .ingest_cell_stream_with_budget(BOARD, "a", synthetic_stream(4, 100), None, 1, None)
            .await
            .unwrap();
        assert!(!out.complete, "budget stop must be surfaced, never silent");
        // The first chunk was refused by the budget but its rows were already
        // peeled into the page, so the total covers at least the page.
        assert_eq!(out.total_rows, 100);
        assert_eq!(out.result.rows.len(), 100);
        assert!(!engine.cache().contains(&CanvasEngine::key(BOARD, "a")));
    }

    #[tokio::test]
    async fn row_cap_stops_ingest_and_reports_complete() {
        let engine = engine();
        // 3 chunks x 300 = 900 rows; a cap of 500 stops mid-second-chunk.
        let out = engine
            .ingest_cell_stream_with_budget(
                BOARD,
                "capped",
                synthetic_stream(3, 300),
                None,
                CELL_INGEST_BYTE_BUDGET,
                Some(500),
            )
            .await
            .unwrap();
        assert_eq!(out.total_rows, 500);
        assert!(out.complete, "a voluntary row cap is complete, not truncated");
        assert_eq!(out.result.rows.len(), CELL_RESULT_PAGE_ROWS);
        assert_eq!(out.result.rows[0][0], QueryValue::Int(0));
        assert_eq!(out.result.rows[499][0], QueryValue::Int(499));
        // The full capped result is cached and queryable.
        let agg = engine
            .run_cell(BOARD, "b", "SELECT COUNT(*) AS c FROM capped")
            .await
            .unwrap();
        assert_eq!(int_at(&agg.result, 0, 0), 500);
    }

    #[tokio::test]
    async fn start_cell_ingest_returns_page_before_finish() {
        use futures::channel::mpsc;
        let engine = engine();
        // One chunk fills the whole page; the channel stays open so the drain
        // would block, proving the page is returned before `finish`.
        let first: Vec<Vec<QueryValue>> = (0..CELL_RESULT_PAGE_ROWS as i64)
            .map(|n| vec![QueryValue::Int(n), QueryValue::Text(format!("row-{n}"))])
            .collect();
        let (mut tx, rx) = mpsc::channel::<Result<Vec<Vec<QueryValue>>, DriverError>>(4);
        tx.try_send(Ok(first)).unwrap();
        let rows = RowChunkStream {
            columns: vec![col("n", "int8"), col("s", "text")],
            chunks: rx.boxed(),
        };
        let (page, cont) = engine
            .start_cell_ingest(
                BOARD,
                "big",
                QueryStream::Rows(rows),
                None,
                CELL_INGEST_BYTE_BUDGET,
                None,
            )
            .await
            .unwrap();
        assert_eq!(page.result.rows.len(), CELL_RESULT_PAGE_ROWS);
        assert_eq!(page.result.rows[0][0], QueryValue::Int(0));
        // Close the stream so the background drain can complete.
        tx.close_channel();
        let done = cont.finish(None).await.unwrap();
        assert_eq!(done.total_rows, CELL_RESULT_PAGE_ROWS as u64);
        assert!(done.complete);
    }

    #[tokio::test]
    async fn ingest_cancel_between_chunks_aborts_without_a_cache_entry() {
        let engine = engine();
        let stream = QueryStream::Rows(RowChunkStream {
            columns: vec![col("n", "int8")],
            chunks: futures::stream::pending().boxed(),
        });
        let token = CancellationToken::new();
        token.cancel();
        let err = engine
            .ingest_cell_stream(BOARD, "a", stream, Some(&token))
            .await
            .unwrap_err();
        assert!(matches!(err, CanvasError::Cancelled));
        assert!(!engine.cache().contains(&CanvasEngine::key(BOARD, "a")));
    }

    #[tokio::test]
    async fn ingest_driver_error_aborts_without_a_cache_entry() {
        let engine = engine();
        let stream = QueryStream::Rows(RowChunkStream {
            columns: vec![col("n", "int8")],
            chunks: futures::stream::iter(vec![
                Ok(vec![vec![QueryValue::Int(1)]]),
                Err(DriverError::QueryFailed("wire dropped".into())),
            ])
            .boxed(),
        });
        let err = engine
            .ingest_cell_stream(BOARD, "a", stream, None)
            .await
            .unwrap_err();
        assert!(matches!(err, CanvasError::Engine(_)));
        assert!(!engine.cache().contains(&CanvasEngine::key(BOARD, "a")));
    }

    #[tokio::test]
    async fn ingest_arrow_stream_pages_and_caches() {
        use datafusion::arrow::array::Int64Array;
        use datafusion::arrow::datatypes::{DataType, Field, Schema};

        let engine = engine();
        let schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, false)]));
        let make = |values: Vec<i64>| {
            RecordBatch::try_new(schema.clone(), vec![Arc::new(Int64Array::from(values))]).unwrap()
        };
        let stream = QueryStream::Arrow(
            futures::stream::iter(vec![
                Ok(make((0..400).collect())),
                Ok(make((400..900).collect())),
            ])
            .boxed(),
        );
        let out = engine
            .ingest_cell_stream(BOARD, "a", stream, None)
            .await
            .unwrap();
        assert_eq!(out.total_rows, 900);
        assert!(out.complete);
        assert_eq!(out.result.rows.len(), CELL_RESULT_PAGE_ROWS);
        assert_eq!(out.result.columns[0].name, "n");
        assert_eq!(int_at(&out.result, 499, 0), 499);
    }

    #[tokio::test]
    async fn run_cell_pages_its_result_but_caches_everything() {
        let engine = engine();
        engine
            .ingest_cell_stream(BOARD, "a", synthetic_stream(2, 400), None)
            .await
            .unwrap();
        // `SELECT *` over 800 cached rows: page capped, totals exact.
        let out = engine
            .run_cell(BOARD, "b", "SELECT * FROM a ORDER BY n")
            .await
            .unwrap();
        assert_eq!(out.result.rows.len(), CELL_RESULT_PAGE_ROWS);
        assert_eq!(out.total_rows, 800);
        assert!(out.complete);

        // And b's own downstream still sees all 800 rows.
        let agg = engine
            .run_cell(BOARD, "c", "SELECT COUNT(*) AS c FROM b")
            .await
            .unwrap();
        assert_eq!(int_at(&agg.result, 0, 0), 800);
    }

    #[tokio::test]
    async fn query_cache_aggregates_over_the_full_cached_result() {
        let engine = engine();
        // 900 rows cached under "a"; the page only ever held 500.
        engine
            .ingest_cell_stream(BOARD, "a", synthetic_stream(3, 300), None)
            .await
            .unwrap();
        // A GROUP BY over the full result: one row per parity, counts sum to 900.
        let agg = engine
            .query_cache(BOARD, "SELECT n % 2 AS bucket, COUNT(*) AS c FROM a GROUP BY n % 2 ORDER BY bucket")
            .await
            .unwrap();
        assert_eq!(agg.rows.len(), 2);
        assert_eq!(int_at(&agg, 0, 1), 450);
        assert_eq!(int_at(&agg, 1, 1), 450);
        // The query result is NOT cached back (ephemeral): no "cell" entry appears.
        assert!(!engine.cache().contains(&CanvasEngine::key(BOARD, "bucket")));
    }

    #[tokio::test]
    async fn query_cache_orders_by_position_and_limits_without_duplicate_field() {
        let engine = engine();
        engine
            .ingest_cell_stream(BOARD, "a", synthetic_stream(3, 300), None)
            .await
            .unwrap();
        // Reproduces the chart shape: the aggregate is aliased to the same name as
        // an input column and the query orders by that column's POSITION (not the
        // aggregate expression, which would trip "duplicate unqualified field
        // name"), then caps the group count.
        let agg = engine
            .query_cache(
                BOARD,
                "SELECT n % 2 AS bucket, COUNT(s) AS s FROM a GROUP BY n % 2 ORDER BY 2 DESC LIMIT 1",
            )
            .await
            .unwrap();
        assert_eq!(agg.rows.len(), 1);
        assert_eq!(int_at(&agg, 0, 1), 450);
    }

    #[tokio::test]
    async fn fetch_page_slices_across_batch_boundaries() {
        let engine = engine();
        // Two 400-row batches cached under "a" (rows 0..800).
        engine
            .ingest_cell_stream(BOARD, "a", synthetic_stream(2, 400), None)
            .await
            .unwrap();
        // A page straddling the 400-row batch boundary.
        let page = engine.fetch_page(BOARD, "a", 350, 100).unwrap().unwrap();
        assert_eq!(page.rows.len(), 100);
        assert_eq!(int_at(&page, 0, 0), 350);
        assert_eq!(int_at(&page, 99, 0), 449);
    }

    #[tokio::test]
    async fn fetch_page_past_the_end_returns_zero_rows_with_columns() {
        let engine = engine();
        engine
            .ingest_cell_stream(BOARD, "a", synthetic_stream(1, 100), None)
            .await
            .unwrap();
        let page = engine.fetch_page(BOARD, "a", 500, 100).unwrap().unwrap();
        assert_eq!(page.rows.len(), 0);
        assert_eq!(page.columns.len(), 2);
    }

    #[tokio::test]
    async fn fetch_page_missing_cell_returns_none() {
        let engine = engine();
        assert!(engine.fetch_page(BOARD, "nope", 0, 100).unwrap().is_none());
    }

    #[tokio::test]
    async fn ingest_empty_stream_keeps_columns_with_zero_rows() {
        let engine = engine();
        let stream = QueryStream::Rows(RowChunkStream {
            columns: vec![col("n", "int8")],
            chunks: futures::stream::iter(Vec::<Result<Vec<Vec<QueryValue>>, DriverError>>::new())
                .boxed(),
        });
        let out = engine
            .ingest_cell_stream(BOARD, "a", stream, None)
            .await
            .unwrap();
        assert_eq!(out.total_rows, 0);
        assert!(out.complete);
        assert_eq!(out.result.columns.len(), 1);
        assert!(out.result.rows.is_empty());
    }
}
