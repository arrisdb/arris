import { invoke } from "@tauri-apps/api/core";
import type { QueryResult } from "@shared";

/// One query cell sent to the backend for a chained run. The backend builds the
/// dependency graph from each cell's `sql` (a `FROM`/`JOIN` reference to another
/// cell's sanitized title is a dependency).
interface CanvasCellSpec {
  id: string;
  title: string;
  sql: string;
  connectionId: string | null;
}

/// The outcome of one executed cell: its result page, or the error that stopped
/// it. `totalRows` counts the FULL cached result (the page may hold fewer);
/// `complete: false` means the ingestion byte budget truncated the run.
interface CanvasCellRun {
  id: string;
  result?: QueryResult;
  error?: string;
  totalRows?: number;
  complete?: boolean;
}

/// Run a canvas query cell, auto-running its upstream cells first. `cells` is the
/// board's full set of query cells (so the backend can resolve title references);
/// `targetId` is the cell the user clicked Run on. Returns one entry per executed
/// cell (the target and its transitive dependencies), so the board can refresh
/// every affected grid in one round-trip. `queryId` names the run so
/// `cancelCanvasCellIPC` can stop it.
function runCanvasCellIPC(
  boardId: string,
  targetId: string,
  cells: CanvasCellSpec[],
  queryId: string,
): Promise<CanvasCellRun[]> {
  return invoke("cmd_run_canvas_cell", { boardId, targetId, cells, queryId });
}

/// Cancel an in-flight canvas cell run started with the same `queryId`.
function cancelCanvasCellIPC(queryId: string): Promise<void> {
  return invoke("cmd_cancel_query", { queryId });
}

/// Aggregate (or sample) a chart's data over a source cell's FULL cached result.
/// `sql` is built from the chart spec against the source cell's sanitized title;
/// the backend runs it over the cache and returns the small result.
function queryCanvasCacheIPC(boardId: string, sql: string): Promise<QueryResult> {
  return invoke("cmd_query_canvas_cache", { boardId, sql });
}

/// One page (`offset`..`offset + limit`) of a cell's full cached result, by the
/// cell's sanitized `title`. `null` when the cell has no cached result.
function fetchCanvasCellPageIPC(
  boardId: string,
  title: string,
  offset: number,
  limit: number,
): Promise<QueryResult | null> {
  return invoke("cmd_fetch_canvas_cell_page", { boardId, title, offset, limit });
}

export {
  cancelCanvasCellIPC,
  fetchCanvasCellPageIPC,
  queryCanvasCacheIPC,
  runCanvasCellIPC,
};
export type { CanvasCellRun, CanvasCellSpec };
