import { create } from "zustand";

import type {
  KernelOutput,
  KernelStatus,
  NotebookCell,
  NotebookCellType,
  NotebookOutput,
  NotebookState,
} from "../types";

let cellSeq = 0;
let outputSeq = 0;

function newCellId(): string {
  cellSeq += 1;
  return `nb-cell-${cellSeq}`;
}

function newOutputId(): string {
  outputSeq += 1;
  return `nb-out-${outputSeq}`;
}

function emptyNotebook(): NotebookState {
  return {
    status: "none",
    interpreter: null,
    cells: [],
    metadata: {},
    nbformatMinor: 5,
    execCount: 0,
    dirty: false,
    pending: {},
  };
}

/// Default pandas variable name for the Nth SQL cell: `df1`, `df2`, … Counts
/// existing SQL cells so a freshly added cell gets a unique-ish name.
function defaultSqlVarName(cells: NotebookCell[]): string {
  const count = cells.filter((c) => c.cellType === "sql").length;
  return `df${count + 1}`;
}

/// A fresh, empty cell of the given kind. Code cells start in edit mode; new
/// markdown cells too, so the user can type before rendering. SQL cells get an
/// empty connection and a default DataFrame variable name.
function makeCell(cellType: NotebookCellType, sqlVarName = ""): NotebookCell {
  return {
    id: newCellId(),
    cellType,
    source: "",
    outputs: [],
    executionCount: null,
    metadata: {},
    rendered: false,
    pendingMsgId: null,
    ...(cellType === "sql" ? { sqlConnectionId: null, sqlVarName } : {}),
  };
}

/// Map a backend execution-state string to the coarse kernel status (shared
/// shape with the Python console).
function statusFromState(state: string): KernelStatus {
  switch (state) {
    case "busy":
      return "busy";
    case "idle":
      return "idle";
    case "starting":
    case "restarting":
      return "starting";
    case "dead":
    case "terminating":
      return "dead";
    default:
      return "idle";
  }
}

/// Append an output to a cell, merging consecutive stream chunks of one name so
/// a chatty `print` loop doesn't produce hundreds of fragments.
function pushOutput(cell: NotebookCell, output: NotebookOutput): NotebookCell {
  if (output.outputType === "stream") {
    const last = cell.outputs[cell.outputs.length - 1];
    if (last && last.outputType === "stream" && last.name === output.name) {
      const merged: NotebookOutput = { ...last, text: last.text + output.text };
      return { ...cell, outputs: [...cell.outputs.slice(0, -1), merged] };
    }
  }
  return { ...cell, outputs: [...cell.outputs, output] };
}

/// Replace the cell whose `pendingMsgId` matches `parent`, leaving others as-is.
/// Returns the cells unchanged when no cell owns the output (e.g. it arrived
/// after the notebook was reset).
function routeToCell(
  cells: NotebookCell[],
  parent: string | null,
  update: (cell: NotebookCell) => NotebookCell,
): NotebookCell[] {
  if (!parent) return cells;
  return cells.map((c) => (c.pendingMsgId === parent ? update(c) : c));
}

/// Fold one kernel output into a notebook's cells, routing by the parent
/// `execute_request` id so output lands in the cell that produced it.
///
/// A fast cell can emit its whole output (busy → result → idle) before
/// `beginRun` records its `pendingMsgId`. Such output has a parent that matches
/// no cell yet, so it is buffered under `pending[parent]` and replayed by
/// `beginRun` once the cell is marked running, otherwise the idle status that
/// clears the spinner (and any stdout/result) would be silently dropped.
function applyOutput(prev: NotebookState, output: KernelOutput): NotebookState {
  const parent = output.parent;
  if (parent && !prev.cells.some((c) => c.pendingMsgId === parent)) {
    return {
      ...prev,
      pending: { ...prev.pending, [parent]: [...(prev.pending[parent] ?? []), output] },
    };
  }
  switch (output.kind) {
    case "status": {
      const next = { ...prev, status: statusFromState(output.state) };
      if (output.state === "idle" && output.parent) {
        next.cells = routeToCell(prev.cells, output.parent, (c) => ({ ...c, pendingMsgId: null }));
      }
      return next;
    }
    case "stream":
      return {
        ...prev,
        cells: routeToCell(prev.cells, output.parent, (cell) =>
          pushOutput(cell, {
            id: newOutputId(),
            outputType: "stream",
            name: output.name,
            text: output.text,
          }),
        ),
      };
    case "result":
      return {
        ...prev,
        cells: routeToCell(prev.cells, output.parent, (cell) =>
          pushOutput(cell, {
            id: newOutputId(),
            outputType: "executeResult",
            data: output.data,
            executionCount: cell.executionCount,
          }),
        ),
      };
    case "display":
      return {
        ...prev,
        cells: routeToCell(prev.cells, output.parent, (cell) =>
          pushOutput(cell, { id: newOutputId(), outputType: "displayData", data: output.data }),
        ),
      };
    case "error":
      return {
        ...prev,
        cells: routeToCell(prev.cells, output.parent, (cell) =>
          pushOutput(cell, {
            id: newOutputId(),
            outputType: "error",
            ename: output.ename,
            evalue: output.evalue,
            traceback: output.traceback,
          }),
        ),
      };
  }
}

function patchCell(
  prev: NotebookState,
  cellId: string,
  update: (cell: NotebookCell) => NotebookCell,
): NotebookState {
  return {
    ...prev,
    dirty: true,
    cells: prev.cells.map((c) => (c.id === cellId ? update(c) : c)),
  };
}

interface NotebookLoad {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformatMinor: number;
  execCount: number;
}

interface NotebookStore {
  notebooks: Record<string, NotebookState>;
  ensureNotebook: (id: string) => void;
  /// Replace a notebook's document with freshly parsed contents (dirty cleared).
  loadNotebook: (id: string, load: NotebookLoad) => void;
  setInterpreter: (id: string, interpreter: string | null) => void;
  setStatus: (id: string, status: KernelStatus) => void;
  setCellSource: (id: string, cellId: string, source: string) => void;
  setCellType: (id: string, cellId: string, cellType: NotebookCellType) => void;
  setCellRendered: (id: string, cellId: string, rendered: boolean) => void;
  /// SQL cells only: pick the connection the query runs against.
  setCellConnection: (id: string, cellId: string, connectionId: string | null) => void;
  /// SQL cells only: set the pandas variable name the result binds to.
  setCellVarName: (id: string, cellId: string, varName: string) => void;
  /// Insert a new cell after `afterCellId` (or at the end when null).
  addCell: (id: string, afterCellId: string | null, cellType: NotebookCellType) => void;
  deleteCell: (id: string, cellId: string) => void;
  moveCell: (id: string, cellId: string, dir: "up" | "down") => void;
  /// Mark a code cell as running: assign the next execution number, clear its
  /// prior outputs, and record the kernel message id for output routing.
  beginRun: (id: string, cellId: string, msgId: string) => void;
  appendOutput: (id: string, output: KernelOutput) => void;
  /// Clear all execution counts and outputs (e.g. after a kernel restart).
  resetRuns: (id: string) => void;
  markSaved: (id: string) => void;
  removeNotebook: (id: string) => void;
}

const useNotebookStore = create<NotebookStore>((set) => ({
  notebooks: {},

  ensureNotebook: (id) =>
    set((s) =>
      s.notebooks[id]
        ? s
        : { notebooks: { ...s.notebooks, [id]: emptyNotebook() } },
    ),

  loadNotebook: (id, load) =>
    set((s) => {
      const prev = s.notebooks[id] ?? emptyNotebook();
      return {
        notebooks: {
          ...s.notebooks,
          [id]: {
            ...prev,
            cells: load.cells,
            metadata: load.metadata,
            nbformatMinor: load.nbformatMinor,
            execCount: load.execCount,
            dirty: false,
          },
        },
      };
    }),

  setInterpreter: (id, interpreter) =>
    set((s) => {
      const prev = s.notebooks[id] ?? emptyNotebook();
      return { notebooks: { ...s.notebooks, [id]: { ...prev, interpreter } } };
    }),

  setStatus: (id, status) =>
    set((s) => {
      const prev = s.notebooks[id] ?? emptyNotebook();
      return { notebooks: { ...s.notebooks, [id]: { ...prev, status } } };
    }),

  setCellSource: (id, cellId, source) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      return { notebooks: { ...s.notebooks, [id]: patchCell(prev, cellId, (c) => ({ ...c, source })) } };
    }),

  setCellType: (id, cellId, cellType) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      return {
        notebooks: {
          ...s.notebooks,
          [id]: patchCell(prev, cellId, (c) => ({
            ...c,
            cellType,
            // Outputs/exec count apply to executable cells (code + sql).
            outputs: cellType === "code" || cellType === "sql" ? c.outputs : [],
            executionCount:
              cellType === "code" || cellType === "sql" ? c.executionCount : null,
            rendered: false,
            // Entering SQL: ensure a connection slot + default var name. Leaving
            // SQL: drop the SQL-only fields so they never round-trip.
            ...(cellType === "sql"
              ? {
                  sqlConnectionId: c.sqlConnectionId ?? null,
                  sqlVarName: c.sqlVarName || defaultSqlVarName(prev.cells),
                }
              : { sqlConnectionId: undefined, sqlVarName: undefined }),
          })),
        },
      };
    }),

  setCellRendered: (id, cellId, rendered) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      // Toggling render is a view change, not a document edit; keep dirty as-is.
      return {
        notebooks: {
          ...s.notebooks,
          [id]: { ...prev, cells: prev.cells.map((c) => (c.id === cellId ? { ...c, rendered } : c)) },
        },
      };
    }),

  setCellConnection: (id, cellId, connectionId) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      return {
        notebooks: {
          ...s.notebooks,
          [id]: patchCell(prev, cellId, (c) => ({ ...c, sqlConnectionId: connectionId })),
        },
      };
    }),

  setCellVarName: (id, cellId, varName) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      return {
        notebooks: {
          ...s.notebooks,
          [id]: patchCell(prev, cellId, (c) => ({ ...c, sqlVarName: varName })),
        },
      };
    }),

  addCell: (id, afterCellId, cellType) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      const cell = makeCell(
        cellType,
        cellType === "sql" ? defaultSqlVarName(prev.cells) : "",
      );
      const idx = afterCellId ? prev.cells.findIndex((c) => c.id === afterCellId) : -1;
      const cells =
        idx < 0
          ? [...prev.cells, cell]
          : [...prev.cells.slice(0, idx + 1), cell, ...prev.cells.slice(idx + 1)];
      return { notebooks: { ...s.notebooks, [id]: { ...prev, cells, dirty: true } } };
    }),

  deleteCell: (id, cellId) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      const cells = prev.cells.filter((c) => c.id !== cellId);
      return { notebooks: { ...s.notebooks, [id]: { ...prev, cells, dirty: true } } };
    }),

  moveCell: (id, cellId, dir) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      const idx = prev.cells.findIndex((c) => c.id === cellId);
      const target = dir === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || target < 0 || target >= prev.cells.length) return s;
      const cells = prev.cells.slice();
      [cells[idx], cells[target]] = [cells[target], cells[idx]];
      return { notebooks: { ...s.notebooks, [id]: { ...prev, cells, dirty: true } } };
    }),

  beginRun: (id, cellId, msgId) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      const execCount = prev.execCount + 1;
      let next: NotebookState = {
        ...prev,
        status: "busy",
        execCount,
        cells: prev.cells.map((c) =>
          c.id === cellId
            ? { ...c, outputs: [], executionCount: execCount, pendingMsgId: msgId }
            : c,
        ),
      };
      // Replay any output that finished before this cell was marked running
      // (a fast cell whose kernel events beat the execute promise). The cell now
      // owns `msgId`, so each buffered output routes correctly.
      const buffered = prev.pending[msgId];
      if (buffered) {
        const { [msgId]: _drained, ...rest } = next.pending;
        next = { ...next, pending: rest };
        for (const output of buffered) next = applyOutput(next, output);
      }
      return { notebooks: { ...s.notebooks, [id]: next } };
    }),

  appendOutput: (id, output) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      return { notebooks: { ...s.notebooks, [id]: applyOutput(prev, output) } };
    }),

  resetRuns: (id) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      return {
        notebooks: {
          ...s.notebooks,
          [id]: {
            ...prev,
            execCount: 0,
            pending: {},
            cells: prev.cells.map((c) => ({
              ...c,
              outputs: [],
              executionCount: null,
              pendingMsgId: null,
            })),
          },
        },
      };
    }),

  markSaved: (id) =>
    set((s) => {
      const prev = s.notebooks[id];
      if (!prev) return s;
      return { notebooks: { ...s.notebooks, [id]: { ...prev, dirty: false } } };
    }),

  removeNotebook: (id) =>
    set((s) => {
      if (!s.notebooks[id]) return s;
      const next = { ...s.notebooks };
      delete next[id];
      return { notebooks: next };
    }),
}));

export { useNotebookStore };
