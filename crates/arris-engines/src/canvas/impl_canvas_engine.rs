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

use super::constants::{
    CELL_IDENT_FALLBACK, CELL_REF_QUOTE, CELL_RESULT_PAGE_ROWS, QUERY_MEMORY_POOL_SIZE,
};
use super::errors::CanvasError;
use super::impl_cell_cache_writer::CellCacheWriter;
use super::impl_cell_result_cache::CellResultCache;
use super::types::{CanvasCellSpec, CellIngestDone, IngestedCell};
use crate::drivers::common::ArrowChunkBuilder;
use crate::federation::FederationEngine;
use crate::{DriverError, QueryResult, QueryStream, QueryValue, RowChunkStream};

/// Runs canvas query cells that read other cells' results: each cell's output is
/// cached (as Arrow) per board and cell id, then registered as a DataFusion
/// `MemTable` when another cell's SQL names it.
///
/// Title is the reference alias, id is the cache identity, so an untitled or
/// duplicated title never merges two cells' results.
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

    /// Lowercase, collapse non-alphanumeric runs to `_`, trim, and prefix a
    /// leading digit. Idempotent, so re-sanitizing an identifier is safe.
    pub fn sanitize_ident(value: &str) -> String {
        let mut out = String::new();
        let mut prev_underscore = false;
        for ch in value.chars() {
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
            return CELL_IDENT_FALLBACK.to_string();
        }
        if trimmed.starts_with(|c: char| c.is_ascii_digit()) {
            return format!("_{trimmed}");
        }
        trimmed.to_string()
    }

    /// Rewrite backtick-quoted names to the identifier the cell registers under
    /// (DataFusion has no backticks). Quotes inside string literals are kept.
    pub fn normalize_cell_refs(sql: &str) -> String {
        let mut out = String::with_capacity(sql.len());
        let mut chars = sql.chars();
        let mut in_string = false;
        while let Some(ch) = chars.next() {
            if in_string {
                out.push(ch);
                if ch == '\'' {
                    in_string = false;
                }
                continue;
            }
            match ch {
                '\'' => {
                    in_string = true;
                    out.push(ch);
                }
                CELL_REF_QUOTE => {
                    let mut inner = String::new();
                    let mut closed = false;
                    for c in chars.by_ref() {
                        if c == CELL_REF_QUOTE {
                            closed = true;
                            break;
                        }
                        inner.push(c);
                    }
                    if closed {
                        out.push_str(&Self::sanitize_ident(&inner));
                    } else {
                        out.push(CELL_REF_QUOTE);
                        out.push_str(&inner);
                    }
                }
                _ => out.push(ch),
            }
        }
        out
    }

    /// The table names referenced after `FROM`/`JOIN`, lowercased and stripped to
    /// their leading identifier. A dotted name (`conn.schema.table`) reduces to
    /// its first segment, which a cell title never matches, so a federation/live
    /// reference simply doesn't resolve to a cell here.
    pub fn table_refs(sql: &str) -> Vec<String> {
        let normalized = Self::normalize_cell_refs(sql);
        let sql = normalized.as_str();
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

    /// Board-scoped cache key, on the cell id so an untitled or duplicated title
    /// never merges two cells' results.
    fn key(board: &str, cell_id: &str) -> String {
        format!("{board}\u{1}{}", Self::sanitize_ident(cell_id))
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
            .map(|c| (Self::sanitize_ident(&c.title), c.id.clone()))
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
        cell_id: &str,
        result: &QueryResult,
    ) -> Result<(), CanvasError> {
        let (_schema, batch) =
            FederationEngine::query_result_to_batch(result).map_err(CanvasError::Conversion)?;
        self.cache.put(&Self::key(board, cell_id), vec![batch])
    }

    /// Run one cell's SQL over the board's cached cells, caching the full output
    /// under its id and returning a page. `refs` maps sanitized title to cell id.
    pub async fn run_cell(
        &self,
        board: &str,
        cell_id: &str,
        sql: &str,
        refs: &HashMap<String, String>,
    ) -> Result<IngestedCell, CanvasError> {
        let start = Instant::now();
        let batches = self.execute_over_cache(board, sql, refs).await?;
        let total_rows: u64 = batches.iter().map(|b| b.num_rows() as u64).sum();
        let page = Self::slice_batches(&batches, 0, CELL_RESULT_PAGE_ROWS);
        let result =
            FederationEngine::batches_to_query_result(&page, start.elapsed().as_secs_f64());
        self.cache.put(&Self::key(board, cell_id), batches)?;
        Ok(IngestedCell {
            result,
            total_rows,
            complete: true,
        })
    }

    /// Run `sql` over the board's cached cells (each registered as a `MemTable`)
    /// and collect the whole result. Trailing semicolon stripped (DataFusion rejects it).
    async fn execute_over_cache(
        &self,
        board: &str,
        sql: &str,
        refs: &HashMap<String, String>,
    ) -> Result<Vec<RecordBatch>, CanvasError> {
        let normalized = Self::normalize_cell_refs(sql);
        let sql = normalized.trim().trim_end_matches(';').trim();
        let ctx = Self::session_context()?;
        for name in Self::table_refs(sql) {
            // A reference naming a cell by title resolves through `refs`; one that
            // is already a cell's table name (the chart path) keys the cache itself.
            let cell_id = refs.get(&name).map_or(name.as_str(), String::as_str);
            if let Some(batches) = self.cache.get(&Self::key(board, cell_id))? {
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

    /// Ephemeral read-only query over the board's cached cells: whole result, not
    /// cached. Chart SQL names its source by table name, so no title map.
    pub async fn query_cache(&self, board: &str, sql: &str) -> Result<QueryResult, CanvasError> {
        let start = Instant::now();
        let batches = self.execute_over_cache(board, sql, &HashMap::new()).await?;
        Ok(FederationEngine::batches_to_query_result(
            &batches,
            start.elapsed().as_secs_f64(),
        ))
    }

    /// Rows `[offset, offset + limit)` of a cached cell's full result; `None` when
    /// nothing is cached. Tables page through the full result with this.
    pub fn fetch_page(
        &self,
        board: &str,
        cell_id: &str,
        offset: usize,
        limit: usize,
    ) -> Result<Option<QueryResult>, CanvasError> {
        let Some(batches) = self.cache.get(&Self::key(board, cell_id))? else {
            return Ok(None);
        };
        let page = Self::slice_batches(&batches, offset, limit);
        Ok(Some(FederationEngine::batches_to_query_result(&page, 0.0)))
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

    /// Stream a driver's result into the cell cache in one call (page + full drain).
    /// A byte-`budget` stop reports `complete: false`; a `row_cap` stop is complete.
    pub async fn ingest_cell_stream(
        &self,
        board: &str,
        cell_id: &str,
        stream: QueryStream,
        cancel: Option<&CancellationToken>,
        budget: usize,
        row_cap: Option<u64>,
    ) -> Result<IngestedCell, CanvasError> {
        let start = Instant::now();
        let (mut result, cont) = self
            .start_cell_ingest(board, cell_id, stream, cancel, budget, row_cap)
            .await?;
        let done = cont.finish(cancel).await?;
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

    /// Begin streaming into the cell cache and return the UI page as soon as it
    /// fills; the continuation's `finish` drains the rest (inline or spawned).
    pub async fn start_cell_ingest(
        &self,
        board: &str,
        cell_id: &str,
        stream: QueryStream,
        cancel: Option<&CancellationToken>,
        budget: usize,
        row_cap: Option<u64>,
    ) -> Result<(QueryResult, CellIngestContinuation), CanvasError> {
        let key = Self::key(board, cell_id);
        let writer = self.cache.begin(&key, budget);
        match stream {
            QueryStream::Rows(rows) => Self::start_rows(rows, writer, cancel, row_cap).await,
            QueryStream::Arrow(batches) => Self::start_arrow(batches, writer, cancel, row_cap).await,
        }
    }

    /// Next stream item, or `Cancelled` as soon as the token fires.
    async fn next_or_cancelled<T>(
        stream: &mut BoxStream<'static, T>,
        cancel: Option<&CancellationToken>,
    ) -> Result<Option<T>, CanvasError> {
        match cancel {
            // Biased: a cancelled token wins over an already-ready chunk (a
            // synchronously-buffered first chunk would otherwise race the token).
            Some(token) => tokio::select! {
                biased;
                _ = token.cancelled() => Err(CanvasError::Cancelled),
                item = stream.next() => Ok(item),
            },
            None => Ok(stream.next().await),
        }
    }

    /// How many of `len` incoming rows fit under the cap given `written` so far.
    fn cap_take(row_cap: Option<u64>, written: u64, len: usize) -> usize {
        row_cap.map_or(len, |cap| (cap.saturating_sub(written) as usize).min(len))
    }

    /// Phase 1 for a row stream: read chunks (appending each to the cache) until
    /// the page fills, the stream ends, or the cap is reached.
    async fn start_rows(
        rows: RowChunkStream,
        mut writer: CellCacheWriter,
        cancel: Option<&CancellationToken>,
        row_cap: Option<u64>,
    ) -> Result<(QueryResult, CellIngestContinuation), CanvasError> {
        // Fuse so a re-poll after the stream ends (empty result: phase 1 hits
        // `None`, then `finish` still drains) yields `None` instead of panicking.
        let mut chunks = rows.chunks.fuse().boxed();
        let mut builder = ArrowChunkBuilder::new(&rows.columns);
        let columns = rows.columns;
        let mut page: Vec<Vec<QueryValue>> = Vec::new();
        let mut complete = true;
        while page.len() < CELL_RESULT_PAGE_ROWS {
            let next = match Self::next_or_cancelled(&mut chunks, cancel).await {
                Ok(n) => n,
                Err(e) => {
                    writer.abort();
                    return Err(e);
                }
            };
            let Some(item) = next else { break };
            let mut chunk = match item.map_err(Self::driver_stream_error) {
                Ok(c) => c,
                Err(e) => {
                    writer.abort();
                    return Err(e);
                }
            };
            chunk.truncate(Self::cap_take(row_cap, writer.rows(), chunk.len()));
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
            if row_cap.is_some_and(|cap| writer.rows() >= cap) {
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
            source: IngestSource::Rows { chunks, builder },
            complete,
            row_cap,
        };
        Ok((result, cont))
    }

    /// Phase 1 for an Arrow stream (no row DTO involved).
    async fn start_arrow(
        batches: BoxStream<'static, Result<RecordBatch, DriverError>>,
        mut writer: CellCacheWriter,
        cancel: Option<&CancellationToken>,
        row_cap: Option<u64>,
    ) -> Result<(QueryResult, CellIngestContinuation), CanvasError> {
        // Fuse: same reason as `start_rows` (re-poll after end must not panic).
        let mut batches = batches.fuse().boxed();
        let mut page: Vec<RecordBatch> = Vec::new();
        let mut page_rows = 0usize;
        let mut complete = true;
        while page_rows < CELL_RESULT_PAGE_ROWS {
            let next = match Self::next_or_cancelled(&mut batches, cancel).await {
                Ok(n) => n,
                Err(e) => {
                    writer.abort();
                    return Err(e);
                }
            };
            let Some(item) = next else { break };
            let mut batch = match item.map_err(Self::driver_stream_error) {
                Ok(b) => b,
                Err(e) => {
                    writer.abort();
                    return Err(e);
                }
            };
            let allowed = Self::cap_take(row_cap, writer.rows(), batch.num_rows());
            if batch.num_rows() > allowed {
                batch = batch.slice(0, allowed);
            }
            let take = (CELL_RESULT_PAGE_ROWS - page_rows).min(batch.num_rows());
            page.push(batch.slice(0, take));
            page_rows += take;
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
            if row_cap.is_some_and(|cap| writer.rows() >= cap) {
                break;
            }
        }
        let result = FederationEngine::batches_to_query_result(&page, 0.0);
        let cont = CellIngestContinuation {
            writer,
            source: IngestSource::Arrow(batches),
            complete,
            row_cap,
        };
        Ok((result, cont))
    }

    fn driver_stream_error(e: DriverError) -> CanvasError {
        match e {
            DriverError::Cancelled => CanvasError::Cancelled,
            other => CanvasError::Engine(other.to_string()),
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
/// its UI page was returned; `finish` (Send, spawnable) drains the rest.
pub struct CellIngestContinuation {
    writer: CellCacheWriter,
    source: IngestSource,
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
        let already_capped = self.row_cap.is_some_and(|cap| self.writer.rows() >= cap);
        // Skip the drain when phase 1 already stopped (byte budget or row cap).
        if self.complete && !already_capped {
            let row_cap = self.row_cap;
            let drained = match &mut self.source {
                IngestSource::Rows { chunks, builder } => {
                    Self::drain_rows(chunks, builder, &mut self.writer, cancel, row_cap).await
                }
                IngestSource::Arrow(batches) => {
                    Self::drain_arrow(batches, &mut self.writer, cancel, row_cap).await
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
        let complete = self.complete;
        let total_rows = self.writer.finish()?;
        Ok(CellIngestDone {
            total_rows,
            complete,
        })
    }

    async fn drain_rows(
        chunks: &mut BoxStream<'static, Result<Vec<Vec<QueryValue>>, DriverError>>,
        builder: &mut ArrowChunkBuilder,
        writer: &mut CellCacheWriter,
        cancel: Option<&CancellationToken>,
        row_cap: Option<u64>,
    ) -> Result<bool, CanvasError> {
        while let Some(item) = CanvasEngine::next_or_cancelled(chunks, cancel).await? {
            let mut chunk = item.map_err(CanvasEngine::driver_stream_error)?;
            chunk.truncate(CanvasEngine::cap_take(row_cap, writer.rows(), chunk.len()));
            let batch = builder.batch(&chunk).map_err(CanvasError::Conversion)?;
            if !writer.append(batch)? {
                return Ok(false);
            }
            if row_cap.is_some_and(|cap| writer.rows() >= cap) {
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
    ) -> Result<bool, CanvasError> {
        while let Some(item) = CanvasEngine::next_or_cancelled(batches, cancel).await? {
            let mut batch = item.map_err(CanvasEngine::driver_stream_error)?;
            let allowed = CanvasEngine::cap_take(row_cap, writer.rows(), batch.num_rows());
            if batch.num_rows() > allowed {
                batch = batch.slice(0, allowed);
            }
            if !writer.append(batch)? {
                return Ok(false);
            }
            if row_cap.is_some_and(|cap| writer.rows() >= cap) {
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

    use super::super::constants::CELL_INGEST_BYTE_BUDGET;
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

    /// No title aliases: the SQL in these tests names cells by id directly.
    fn no_refs() -> HashMap<String, String> {
        HashMap::new()
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
                &no_refs(),
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
        let out = engine.run_cell(BOARD, "query", "SELECT * fROM abc;", &no_refs()).await.unwrap();
        assert_eq!(out.result.rows.len(), 3);
        assert_eq!(out.result.columns.len(), 2);
    }

    #[tokio::test]
    async fn a_chained_cell_is_cached_for_its_own_downstream() {
        let engine = engine();
        engine.cache_result(BOARD, "a", &sales_result()).unwrap();
        engine
            .run_cell(BOARD, "b", "SELECT category, SUM(total) AS total FROM a GROUP BY category", &no_refs())
            .await
            .unwrap();
        assert!(engine.cache().contains(&CanvasEngine::key(BOARD, "b")));

        let out = engine
            .run_cell(BOARD, "c", "SELECT SUM(total) AS grand FROM b", &no_refs())
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
        let a = engine.run_cell("board-A", "x", "SELECT * FROM a", &no_refs()).await.unwrap();
        let b = engine.run_cell("board-B", "x", "SELECT * FROM a", &no_refs()).await.unwrap();
        assert_eq!(a.result.rows.len(), 3);
        assert_eq!(b.result.rows.len(), 0);
    }

    /// Two untitled cells used to sanitize to the same key and clobber each other.
    #[tokio::test]
    async fn untitled_cells_keep_separate_cache_entries() {
        let engine = engine();
        let mut empty = sales_result();
        empty.rows.clear();
        engine.cache_result(BOARD, "query-aaa", &sales_result()).unwrap();
        engine.cache_result(BOARD, "query-bbb", &empty).unwrap();

        let first = engine.fetch_page(BOARD, "query-aaa", 0, 10).unwrap().unwrap();
        let second = engine.fetch_page(BOARD, "query-bbb", 0, 10).unwrap().unwrap();
        assert_eq!(first.rows.len(), 3);
        assert_eq!(second.rows.len(), 0);
    }

    /// A chart names its source by the table name derived from the cell id, with
    /// no title map, so an untitled cell still charts.
    #[tokio::test]
    async fn a_cell_id_table_name_reads_that_cell_without_a_title() {
        let engine = engine();
        engine.cache_result(BOARD, "query-3f2a1b9c", &sales_result()).unwrap();

        let out = engine
            .query_cache(BOARD, "SELECT SUM(total) AS grand FROM query_3f2a1b9c")
            .await
            .unwrap();
        assert_eq!(int_at(&out, 0, 0), 18);
    }

    /// A `FROM <title>` reference resolves through the title map to the cell id.
    #[tokio::test]
    async fn a_title_reference_resolves_to_the_cells_id() {
        let engine = engine();
        engine.cache_result(BOARD, "query-aaa", &sales_result()).unwrap();
        let refs = HashMap::from([("monthly_sales".to_string(), "query-aaa".to_string())]);

        let out = engine
            .run_cell(BOARD, "query-bbb", "SELECT SUM(total) AS grand FROM monthly_sales", &refs)
            .await
            .unwrap();
        assert_eq!(int_at(&out.result, 0, 0), 18);
        assert!(engine.cache().contains(&CanvasEngine::key(BOARD, "query-bbb")));
    }

    /// A backtick-quoted title reads the cell, so the user can write the title
    /// exactly as it appears on the board (spaces and all).
    #[tokio::test]
    async fn a_backtick_quoted_title_reference_reads_the_cell() {
        let engine = engine();
        engine.cache_result(BOARD, "query-aaa", &sales_result()).unwrap();
        let refs = HashMap::from([("query_1".to_string(), "query-aaa".to_string())]);

        let out = engine
            .run_cell(BOARD, "query-bbb", "SELECT SUM(total) AS grand FROM `Query 1`", &refs)
            .await
            .unwrap();
        assert_eq!(int_at(&out.result, 0, 0), 18);
    }

    #[test]
    fn normalize_cell_refs_rewrites_quoted_names_only_outside_strings() {
        assert_eq!(
            CanvasEngine::normalize_cell_refs("SELECT * FROM `Query 1` JOIN `2nd cell`"),
            "SELECT * FROM query_1 JOIN _2nd_cell"
        );
        // A backtick inside a literal is data, not a reference.
        assert_eq!(
            CanvasEngine::normalize_cell_refs("SELECT '`Query 1`' AS s"),
            "SELECT '`Query 1`' AS s"
        );
        // An unbalanced quote is left as typed rather than swallowing the rest.
        assert_eq!(
            CanvasEngine::normalize_cell_refs("SELECT * FROM `Query 1"),
            "SELECT * FROM `Query 1"
        );
    }

    #[test]
    fn table_refs_sees_backtick_quoted_names() {
        let refs = CanvasEngine::table_refs("SELECT * FROM `Query 1` JOIN customers c ON true");
        assert_eq!(refs, vec!["query_1", "customers"]);
    }

    /// Renaming a cell must not orphan its cached result: the key is the id.
    #[tokio::test]
    async fn a_renamed_cell_keeps_its_cached_result() {
        let engine = engine();
        engine.cache_result(BOARD, "query-aaa", &sales_result()).unwrap();
        let refs = HashMap::from([("renamed".to_string(), "query-aaa".to_string())]);

        let out = engine
            .run_cell(BOARD, "query-bbb", "SELECT COUNT(*) AS c FROM renamed", &refs)
            .await
            .unwrap();
        assert_eq!(int_at(&out.result, 0, 0), 3);
    }

    #[tokio::test]
    async fn referencing_an_unknown_cell_errors() {
        let engine = engine();
        let err = engine
            .run_cell(BOARD, "b", "SELECT * FROM does_not_exist", &no_refs())
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
    fn sanitize_ident_makes_a_sql_safe_identifier() {
        assert_eq!(CanvasEngine::sanitize_ident("Monthly Sales"), "monthly_sales");
        assert_eq!(CanvasEngine::sanitize_ident("  spaced  "), "spaced");
        assert_eq!(CanvasEngine::sanitize_ident("2024 totals"), "_2024_totals");
        assert_eq!(CanvasEngine::sanitize_ident("a--b__c"), "a_b_c");
        assert_eq!(CanvasEngine::sanitize_ident("!!!"), "cell");
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
            .ingest_cell_stream(BOARD, "a", synthetic_stream(3, 300), None, CELL_INGEST_BYTE_BUDGET, None)
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
            .run_cell(BOARD, "b", "SELECT COUNT(*) AS c, SUM(n) AS s FROM a", &no_refs())
            .await
            .unwrap();
        assert_eq!(int_at(&agg.result, 0, 0), 900);
        assert_eq!(int_at(&agg.result, 0, 1), (0..900).sum::<i64>());
    }

    #[tokio::test]
    async fn terminal_empty_unfold_stream_finishes_without_panicking() {
        // Regression: an unfold stream that ends immediately (empty result, e.g.
        // a Mongo find on a missing collection) is polled by phase 1 (page fill)
        // AND again by finish's drain. Without a fuse the second poll panics
        // ("Unfold must not be polled after it returned None"), the ingest task
        // dies, and the cell spins forever.
        let engine = engine();
        let stream = QueryStream::Rows(RowChunkStream {
            columns: vec![col("n", "int64")],
            chunks: futures::stream::unfold((), |_| async {
                None::<(std::result::Result<Vec<Vec<QueryValue>>, DriverError>, ())>
            })
            .boxed(),
        });
        let (page, cont) = engine
            .start_cell_ingest(BOARD, "empty", stream, None, CELL_INGEST_BYTE_BUDGET, None)
            .await
            .unwrap();
        assert_eq!(page.rows.len(), 0);
        let done = cont.finish(None).await.unwrap();
        assert!(done.complete);
        assert_eq!(done.total_rows, 0);
    }

    #[tokio::test]
    async fn ingest_byte_budget_truncates_and_reports_incomplete() {
        let engine = engine();
        // A tiny budget admits the first chunk at most.
        let out = engine
            .ingest_cell_stream(BOARD, "a", synthetic_stream(4, 100), None, 1, None)
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
            .ingest_cell_stream(
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
            .run_cell(BOARD, "b", "SELECT COUNT(*) AS c FROM capped", &no_refs())
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
        assert_eq!(page.rows.len(), CELL_RESULT_PAGE_ROWS);
        assert_eq!(page.rows[0][0], QueryValue::Int(0));
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
            .ingest_cell_stream(BOARD, "a", stream, Some(&token), CELL_INGEST_BYTE_BUDGET, None)
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
            .ingest_cell_stream(BOARD, "a", stream, None, CELL_INGEST_BYTE_BUDGET, None)
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
            .ingest_cell_stream(BOARD, "a", stream, None, CELL_INGEST_BYTE_BUDGET, None)
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
            .ingest_cell_stream(BOARD, "a", synthetic_stream(2, 400), None, CELL_INGEST_BYTE_BUDGET, None)
            .await
            .unwrap();
        // `SELECT *` over 800 cached rows: page capped, totals exact.
        let out = engine
            .run_cell(BOARD, "b", "SELECT * FROM a ORDER BY n", &no_refs())
            .await
            .unwrap();
        assert_eq!(out.result.rows.len(), CELL_RESULT_PAGE_ROWS);
        assert_eq!(out.total_rows, 800);
        assert!(out.complete);

        // And b's own downstream still sees all 800 rows.
        let agg = engine
            .run_cell(BOARD, "c", "SELECT COUNT(*) AS c FROM b", &no_refs())
            .await
            .unwrap();
        assert_eq!(int_at(&agg.result, 0, 0), 800);
    }

    #[tokio::test]
    async fn query_cache_aggregates_over_the_full_cached_result() {
        let engine = engine();
        // 900 rows cached under "a"; the page only ever held 500.
        engine
            .ingest_cell_stream(BOARD, "a", synthetic_stream(3, 300), None, CELL_INGEST_BYTE_BUDGET, None)
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
            .ingest_cell_stream(BOARD, "a", synthetic_stream(3, 300), None, CELL_INGEST_BYTE_BUDGET, None)
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
            .ingest_cell_stream(BOARD, "a", synthetic_stream(2, 400), None, CELL_INGEST_BYTE_BUDGET, None)
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
            .ingest_cell_stream(BOARD, "a", synthetic_stream(1, 100), None, CELL_INGEST_BYTE_BUDGET, None)
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
            .ingest_cell_stream(BOARD, "a", stream, None, CELL_INGEST_BYTE_BUDGET, None)
            .await
            .unwrap();
        assert_eq!(out.total_rows, 0);
        assert!(out.complete);
        assert_eq!(out.result.columns.len(), 1);
        assert!(out.result.rows.is_empty());
    }
}
