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

use super::constants::QUERY_MEMORY_POOL_SIZE;
use super::errors::CanvasError;
use super::impl_cell_result_cache::CellResultCache;
use super::types::CanvasCellSpec;
use crate::federation::FederationEngine;
use crate::QueryResult;

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
    /// semicolon is stripped (DataFusion rejects it).
    pub async fn run_cell(
        &self,
        board: &str,
        title: &str,
        sql: &str,
    ) -> Result<QueryResult, CanvasError> {
        let sql = sql.trim().trim_end_matches(';').trim();
        let start = Instant::now();
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

        let result =
            FederationEngine::batches_to_query_result(&batches, start.elapsed().as_secs_f64());
        self.cache.put(&Self::key(board, title), batches)?;
        Ok(result)
    }

    /// Drop every cached result for a board (e.g. when its tab closes).
    pub fn clear_board(&self, board: &str, titles: &[String]) {
        for title in titles {
            self.cache.remove(&Self::key(board, title));
        }
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
            out.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["category", "total"]
        );
        assert_eq!(out.rows.len(), 2);
        assert_eq!(text_at(&out, 0, 0), "books");
        assert_eq!(int_at(&out, 0, 1), 13);
        assert_eq!(text_at(&out, 1, 0), "toys");
        assert_eq!(int_at(&out, 1, 1), 5);
    }

    #[tokio::test]
    async fn select_star_with_trailing_semicolon_reads_the_cell() {
        let engine = engine();
        engine.cache_result(BOARD, "abc", &sales_result()).unwrap();
        // Mirrors the UI: a `SELECT * fROM abc;` reading another cell's result.
        let out = engine.run_cell(BOARD, "query", "SELECT * fROM abc;").await.unwrap();
        assert_eq!(out.rows.len(), 3);
        assert_eq!(out.columns.len(), 2);
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
        assert_eq!(int_at(&out, 0, 0), 18);
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
        assert_eq!(a.rows.len(), 3);
        assert_eq!(b.rows.len(), 0);
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
}
