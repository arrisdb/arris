import { invoke } from "@tauri-apps/api/core";
import type { QueryResult } from "@shared";
import { apiCall, isWebShell } from "@shared/api";

import type { CanvasAddResponse, CanvasDoc, CanvasRecord, CanvasSummary } from "./types";

/// One query cell sent to the backend for a chained run. The backend builds the
/// dependency graph from each cell's `sql` (a `FROM`/`JOIN` reference to another
/// cell's sanitized title is a dependency).
interface CanvasCellSpec {
  id: string;
  title: string;
  sql: string;
  connectionId: string | null;
  /// Row limit for the fetch; `null` fetches the full result ("Select all rows").
  limit: number | null;
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
  const args = { boardId, targetId, cells, queryId };
  return !isWebShell() ? invoke("cmd_run_canvas_cell", args) : apiCall("canvas_run_cell", args);
}

/// Cancel an in-flight canvas cell run started with the same `queryId`.
function cancelCanvasCellIPC(queryId: string): Promise<void> {
  return !isWebShell()
    ? invoke("cmd_cancel_query", { queryId })
    : apiCall("query_cancel", { queryId });
}

/// Aggregate (or sample) a chart's data over a source cell's FULL cached result.
/// `sql` is built from the chart spec against the source cell's table name;
/// the backend runs it over the cache and returns the small result.
function queryCanvasCacheIPC(boardId: string, sql: string): Promise<QueryResult> {
  return !isWebShell()
    ? invoke("cmd_query_canvas_cache", { boardId, sql })
    : apiCall("canvas_query_cache", { boardId, sql });
}

/// One page (`offset`..`offset + limit`) of a cell's full cached result, keyed by
/// the cell's id. `null` when the cell has no cached result.
function fetchCanvasCellPageIPC(
  boardId: string,
  cellId: string,
  offset: number,
  limit: number,
): Promise<QueryResult | null> {
  const args = { boardId, cellId, offset, limit };
  return !isWebShell()
    ? invoke("cmd_fetch_canvas_cell_page", args)
    : apiCall("canvas_fetch_page", args);
}

/// Adds a run's query to a canvas, placed below its existing objects. Browser only:
/// runs live in the server's query log.
function addRunToCanvasIPC(canvas: string, runId: string): Promise<CanvasAddResponse> {
  return apiCall("canvas_add", { canvas, source: { runId } });
}

/// Canvases of the current project (newest first).
function listCanvasesIPC(): Promise<CanvasSummary[]> {
  return !isWebShell() ? invoke("cmd_canvas_list") : apiCall("canvas_list", {});
}

/// One canvas by id.
function getCanvasIPC(canvas: string): Promise<CanvasRecord> {
  return !isWebShell() ? invoke("cmd_canvas_get", { canvas }) : apiCall("canvas_get", { canvas });
}

function createCanvasIPC(title: string): Promise<CanvasRecord> {
  return !isWebShell()
    ? invoke("cmd_canvas_create", { title })
    : apiCall("canvas_create", { title });
}

/// Save a board; a stale `revision` rejects with the `conflict` code.
function saveCanvasIPC(id: string, doc: CanvasDoc, revision: number): Promise<CanvasRecord> {
  const args = { id, doc, revision };
  return !isWebShell() ? invoke("cmd_canvas_save", args) : apiCall("canvas_save", args);
}

function renameCanvasIPC(id: string, title: string): Promise<CanvasRecord> {
  return !isWebShell()
    ? invoke("cmd_canvas_rename", { id, title })
    : apiCall("canvas_rename", { id, title });
}

function deleteCanvasIPC(id: string): Promise<void> {
  return !isWebShell() ? invoke("cmd_canvas_delete", { id }) : apiCall("canvas_delete", { id });
}

export {
  addRunToCanvasIPC,
  createCanvasIPC,
  deleteCanvasIPC,
  getCanvasIPC,
  listCanvasesIPC,
  renameCanvasIPC,
  saveCanvasIPC,
  cancelCanvasCellIPC,
  fetchCanvasCellPageIPC,
  queryCanvasCacheIPC,
  runCanvasCellIPC,
};
export type { CanvasCellRun, CanvasCellSpec };
