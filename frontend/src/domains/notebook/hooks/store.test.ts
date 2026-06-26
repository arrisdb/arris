import { beforeEach, describe, expect, it } from "vitest";

import { useNotebookStore } from "./store";
import type { KernelOutput, NotebookCell } from "../types";

const NB = "nb-tab-1";

function load(cells: Partial<NotebookCell>[], execCount = 0): void {
  const full = cells.map((c, i) => ({
    id: `c${i}`,
    cellType: "code" as const,
    source: "",
    outputs: [],
    executionCount: null,
    metadata: {},
    rendered: false,
    pendingMsgId: null,
    ...c,
  }));
  useNotebookStore.getState().loadNotebook(NB, {
    cells: full,
    metadata: {},
    nbformatMinor: 5,
    execCount,
  });
}

function nb() {
  return useNotebookStore.getState().notebooks[NB];
}

beforeEach(() => {
  useNotebookStore.setState({ notebooks: {} });
  useNotebookStore.getState().ensureNotebook(NB);
});

describe("notebook store", () => {
  it("ensures an empty notebook", () => {
    expect(nb()).toMatchObject({ status: "none", cells: [], execCount: 0, dirty: false });
  });

  it("loads cells and clears dirty", () => {
    load([{ id: "a", source: "print(1)" }]);
    expect(nb().cells).toHaveLength(1);
    expect(nb().dirty).toBe(false);
  });

  it("editing a cell source marks the notebook dirty", () => {
    load([{ id: "a", source: "x" }]);
    useNotebookStore.getState().setCellSource(NB, "a", "y");
    expect(nb().cells[0].source).toBe("y");
    expect(nb().dirty).toBe(true);
  });

  it("adds a cell after the given one", () => {
    load([{ id: "a" }, { id: "b" }]);
    useNotebookStore.getState().addCell(NB, "a", "markdown");
    expect(nb().cells.map((c) => c.cellType)).toEqual(["code", "markdown", "code"]);
    expect(nb().dirty).toBe(true);
  });

  it("appends a cell when afterCellId is null", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().addCell(NB, null, "code");
    expect(nb().cells).toHaveLength(2);
  });

  it("deletes a cell", () => {
    load([{ id: "a" }, { id: "b" }]);
    useNotebookStore.getState().deleteCell(NB, "a");
    expect(nb().cells.map((c) => c.id)).toEqual(["b"]);
  });

  it("moves a cell up and clamps at the edges", () => {
    load([{ id: "a" }, { id: "b" }]);
    useNotebookStore.getState().moveCell(NB, "b", "up");
    expect(nb().cells.map((c) => c.id)).toEqual(["b", "a"]);
    // Already first, no-op.
    useNotebookStore.getState().moveCell(NB, "b", "up");
    expect(nb().cells.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("changing a code cell to markdown drops its outputs", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().beginRun(NB, "a", "m1");
    useNotebookStore.getState().appendOutput(NB, {
      kind: "stream",
      parent: "m1",
      name: "stdout",
      text: "hi",
    });
    expect(nb().cells[0].outputs).toHaveLength(1);
    useNotebookStore.getState().setCellType(NB, "a", "markdown");
    expect(nb().cells[0].outputs).toHaveLength(0);
    expect(nb().cells[0].executionCount).toBeNull();
  });

  it("beginRun assigns a monotonic execution count and clears prior outputs", () => {
    load([{ id: "a" }, { id: "b" }]);
    useNotebookStore.getState().beginRun(NB, "a", "m1");
    expect(nb().cells[0].executionCount).toBe(1);
    expect(nb().cells[0].pendingMsgId).toBe("m1");
    expect(nb().status).toBe("busy");
    useNotebookStore.getState().beginRun(NB, "b", "m2");
    expect(nb().cells[1].executionCount).toBe(2);
  });

  it("routes output to the cell whose pending msg id matches the parent", () => {
    load([{ id: "a" }, { id: "b" }]);
    useNotebookStore.getState().beginRun(NB, "a", "m1");
    useNotebookStore.getState().beginRun(NB, "b", "m2");
    const out: KernelOutput = { kind: "stream", parent: "m2", name: "stdout", text: "from b" };
    useNotebookStore.getState().appendOutput(NB, out);
    expect(nb().cells[0].outputs).toHaveLength(0);
    expect(nb().cells[1].outputs).toEqual([
      { id: expect.any(String), outputType: "stream", name: "stdout", text: "from b" },
    ]);
  });

  it("merges consecutive stdout stream chunks", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().beginRun(NB, "a", "m1");
    useNotebookStore.getState().appendOutput(NB, { kind: "stream", parent: "m1", name: "stdout", text: "a" });
    useNotebookStore.getState().appendOutput(NB, { kind: "stream", parent: "m1", name: "stdout", text: "b" });
    expect(nb().cells[0].outputs).toHaveLength(1);
    expect((nb().cells[0].outputs[0] as { text: string }).text).toBe("ab");
  });

  it("maps result and display kernel outputs to nbformat output types", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().beginRun(NB, "a", "m1");
    useNotebookStore.getState().appendOutput(NB, {
      kind: "result",
      parent: "m1",
      data: { "text/plain": "42" },
    });
    useNotebookStore.getState().appendOutput(NB, {
      kind: "display",
      parent: "m1",
      data: { "image/png": "AAAA" },
    });
    const types = nb().cells[0].outputs.map((o) => o.outputType);
    expect(types).toEqual(["executeResult", "displayData"]);
  });

  it("records errors with traceback", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().beginRun(NB, "a", "m1");
    useNotebookStore.getState().appendOutput(NB, {
      kind: "error",
      parent: "m1",
      ename: "ValueError",
      evalue: "bad",
      traceback: ["line1", "line2"],
    });
    expect(nb().cells[0].outputs[0]).toMatchObject({
      outputType: "error",
      ename: "ValueError",
      evalue: "bad",
    });
  });

  it("status output updates kernel status without touching cells", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().appendOutput(NB, { kind: "status", parent: null, state: "idle" });
    expect(nb().status).toBe("idle");
  });

  it("an idle status clears the matching cell's pending flag and leaves others running", () => {
    load([{ id: "a" }, { id: "b" }]);
    useNotebookStore.getState().beginRun(NB, "a", "m1");
    useNotebookStore.getState().beginRun(NB, "b", "m2");
    expect(nb().cells[0].pendingMsgId).toBe("m1");
    expect(nb().cells[1].pendingMsgId).toBe("m2");

    useNotebookStore.getState().appendOutput(NB, { kind: "status", parent: "m1", state: "idle" });
    expect(nb().status).toBe("idle");
    expect(nb().cells[0].pendingMsgId).toBeNull();
    // Cell b is still running; its run wasn't the one that went idle.
    expect(nb().cells[1].pendingMsgId).toBe("m2");
  });

  it("an idle status with no/unknown parent does not clear a running cell", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().beginRun(NB, "a", "m1");

    useNotebookStore.getState().appendOutput(NB, { kind: "status", parent: null, state: "idle" });
    expect(nb().cells[0].pendingMsgId).toBe("m1");

    useNotebookStore.getState().appendOutput(NB, { kind: "status", parent: "other", state: "idle" });
    expect(nb().cells[0].pendingMsgId).toBe("m1");
  });

  it("a busy status never clears a pending flag", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().beginRun(NB, "a", "m1");
    useNotebookStore.getState().appendOutput(NB, { kind: "status", parent: "m1", state: "busy" });
    expect(nb().cells[0].pendingMsgId).toBe("m1");
    expect(nb().status).toBe("busy");
  });

  it("resetRuns clears outputs and execution counts", () => {
    load([{ id: "a" }], 5);
    useNotebookStore.getState().beginRun(NB, "a", "m1");
    useNotebookStore.getState().resetRuns(NB);
    expect(nb().execCount).toBe(0);
    expect(nb().cells[0].executionCount).toBeNull();
    expect(nb().cells[0].outputs).toHaveLength(0);
  });

  it("markSaved clears the dirty flag", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().setCellSource(NB, "a", "z");
    expect(nb().dirty).toBe(true);
    useNotebookStore.getState().markSaved(NB);
    expect(nb().dirty).toBe(false);
  });

  it("removeNotebook drops the entry", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().removeNotebook(NB);
    expect(useNotebookStore.getState().notebooks[NB]).toBeUndefined();
  });

  it("adds SQL cells with a null connection and an incrementing default var name", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().addCell(NB, null, "sql");
    useNotebookStore.getState().addCell(NB, null, "sql");
    const sqlCells = nb().cells.filter((c) => c.cellType === "sql");
    expect(sqlCells.map((c) => c.sqlVarName)).toEqual(["df1", "df2"]);
    expect(sqlCells.every((c) => c.sqlConnectionId === null)).toBe(true);
  });

  it("converting a cell to SQL seeds a default var name and connection slot", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().setCellType(NB, "a", "sql");
    expect(nb().cells[0].cellType).toBe("sql");
    expect(nb().cells[0].sqlVarName).toBe("df1");
    expect(nb().cells[0].sqlConnectionId).toBeNull();
  });

  it("leaving SQL drops the SQL-only fields", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().setCellType(NB, "a", "sql");
    useNotebookStore.getState().setCellType(NB, "a", "code");
    expect(nb().cells[0].sqlConnectionId).toBeUndefined();
    expect(nb().cells[0].sqlVarName).toBeUndefined();
  });

  it("setCellConnection and setCellVarName update the cell and mark dirty", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().setCellType(NB, "a", "sql");
    useNotebookStore.getState().markSaved(NB);
    useNotebookStore.getState().setCellConnection(NB, "a", "conn-1");
    expect(nb().cells[0].sqlConnectionId).toBe("conn-1");
    expect(nb().dirty).toBe(true);
    useNotebookStore.getState().setCellVarName(NB, "a", "orders");
    expect(nb().cells[0].sqlVarName).toBe("orders");
  });

  it("SQL cells keep their outputs and exec count (executable like code)", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().setCellType(NB, "a", "sql");
    useNotebookStore.getState().beginRun(NB, "a", "m1");
    useNotebookStore.getState().appendOutput(NB, {
      kind: "stream",
      parent: "m1",
      name: "stdout",
      text: "bound `df1`: 3 rows, 2 cols",
    });
    expect(nb().cells[0].executionCount).toBe(1);
    expect(nb().cells[0].outputs).toHaveLength(1);
  });
});

// A fast cell can finish (kernel emits busy → outputs → idle) before the
// `await cmd_python_execute` resolves and `beginRun` records the cell's
// `pendingMsgId`. Those early outputs must be buffered by parent msg id and
// replayed once the cell is marked running, or the spinner sticks on "busy"
// forever and any output is lost.
describe("notebook store — output arriving before beginRun", () => {
  it("replays a pre-beginRun idle status so the cell stops running", () => {
    load([{ id: "a" }]);
    // Kernel events land before the execute call's promise resolves.
    useNotebookStore.getState().appendOutput(NB, { kind: "status", parent: "m1", state: "busy" });
    useNotebookStore.getState().appendOutput(NB, { kind: "status", parent: "m1", state: "idle" });
    // No cell is marked yet, nothing should be stuck and nothing applied.
    expect(nb().cells[0].pendingMsgId).toBeNull();

    useNotebookStore.getState().beginRun(NB, "a", "m1");
    // Replayed: the idle clears the pending flag and the kernel reads idle.
    expect(nb().cells[0].pendingMsgId).toBeNull();
    expect(nb().status).toBe("idle");
  });

  it("does not lose stream/result output produced before beginRun", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().appendOutput(NB, { kind: "stream", parent: "m1", name: "stdout", text: "hi" });
    useNotebookStore.getState().appendOutput(NB, { kind: "result", parent: "m1", data: { "text/plain": "42" } });
    useNotebookStore.getState().appendOutput(NB, { kind: "status", parent: "m1", state: "idle" });

    useNotebookStore.getState().beginRun(NB, "a", "m1");
    expect(nb().cells[0].outputs.map((o) => o.outputType)).toEqual(["stream", "executeResult"]);
    expect((nb().cells[0].outputs[0] as { text: string }).text).toBe("hi");
    expect(nb().cells[0].pendingMsgId).toBeNull();
  });

  it("buffers per parent — a cell only replays its own early output", () => {
    load([{ id: "a" }, { id: "b" }]);
    useNotebookStore.getState().appendOutput(NB, { kind: "stream", parent: "m1", name: "stdout", text: "for a" });
    useNotebookStore.getState().appendOutput(NB, { kind: "stream", parent: "m2", name: "stdout", text: "for b" });

    useNotebookStore.getState().beginRun(NB, "a", "m1");
    expect((nb().cells[0].outputs[0] as { text: string }).text).toBe("for a");
    expect(nb().cells[1].outputs).toHaveLength(0);

    useNotebookStore.getState().beginRun(NB, "b", "m2");
    expect((nb().cells[1].outputs[0] as { text: string }).text).toBe("for b");
  });

  it("resetRuns drops buffered output so a stale msg id never replays", () => {
    load([{ id: "a" }]);
    useNotebookStore.getState().appendOutput(NB, { kind: "stream", parent: "ghost", name: "stdout", text: "stale" });
    useNotebookStore.getState().resetRuns(NB);
    // Reusing the orphaned id for a real run must not resurrect the stale output.
    useNotebookStore.getState().beginRun(NB, "a", "ghost");
    expect(nb().cells[0].outputs).toHaveLength(0);
  });
});
