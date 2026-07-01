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

/// The outcome of one executed cell: its result, or the error that stopped it.
interface CanvasCellRun {
  id: string;
  result?: QueryResult;
  error?: string;
}

/// Run a canvas query cell, auto-running its upstream cells first. `cells` is the
/// board's full set of query cells (so the backend can resolve title references);
/// `targetId` is the cell the user clicked Run on. Returns one entry per executed
/// cell (the target and its transitive dependencies), so the board can refresh
/// every affected grid in one round-trip.
function runCanvasCellIPC(
  boardId: string,
  targetId: string,
  cells: CanvasCellSpec[],
): Promise<CanvasCellRun[]> {
  return invoke("cmd_run_canvas_cell", { boardId, targetId, cells });
}

export { runCanvasCellIPC };
export type { CanvasCellRun, CanvasCellSpec };
