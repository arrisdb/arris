import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc", () => ({
  runCanvasCellIPC: vi.fn(),
  cancelCanvasCellIPC: vi.fn(),
}));

import { makeComponent } from "../utils";
import { cancelCanvasCellIPC, runCanvasCellIPC } from "../ipc";
import { useCanvasStore } from "./store";

const TAB = "tab-1";
const get = () => useCanvasStore.getState();

describe("useCanvasStore", () => {
  beforeEach(() => {
    useCanvasStore.setState({ boards: {}, clipboard: null, lastQueryConnection: {} });
    vi.clearAllMocks();
  });

  it("loadBoard replaces the doc but keeps runs; setRevision keeps the doc", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 1);
    get().setRun(TAB, "q", { running: true });
    get().addComponent(TAB, makeComponent({ kind: "text", id: "t", text: "x" }));
    get().setRevision(TAB, 2);
    expect(get().boards[TAB].revision).toBe(2);
    expect(get().boards[TAB].doc.components).toHaveLength(1);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 3);
    expect(get().boards[TAB]).toMatchObject({ revision: 3, runs: { q: { running: true } } });
    expect(get().boards[TAB].doc.components).toHaveLength(0);
  });

  it("adds, updates, and removes an object", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(TAB, makeComponent({ kind: "text", id: "t", text: "a" }));
    get().updateComponent(TAB, "t", { x: 50 });
    expect(get().boards[TAB].doc.components[0]).toMatchObject({ x: 50 });
    get().removeComponent(TAB, "t");
    expect(get().boards[TAB].doc.components).toHaveLength(0);
  });

  it("remembers the connection last picked for a query object", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(TAB, makeComponent({ kind: "query", id: "q", sql: "" }));
    get().addComponent(TAB, makeComponent({ kind: "table", id: "t" }));
    get().updateComponent(TAB, "q", { connectionId: "conn-a" });
    expect(get().lastQueryConnection[TAB]).toBe("conn-a");
    // A viewer object bound to a source is not a connection pick.
    get().updateComponent(TAB, "t", { sourceQueryId: "q" });
    expect(get().lastQueryConnection[TAB]).toBe("conn-a");
  });

  it("removing an object also drops its edges and run state", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(TAB, makeComponent({ kind: "query", id: "q1", sql: "s" }));
    get().addComponent(TAB, makeComponent({ kind: "chart", id: "c1", sourceQueryId: "q1" }));
    get().setEdges(TAB, [{ id: "e", source: "q1", target: "c1" }]);
    get().setRun(TAB, "q1", { result: { columns: [], rows: [], elapsed: 0 } });
    get().removeComponent(TAB, "q1");
    expect(get().boards[TAB].doc.edges).toHaveLength(0);
    expect(get().boards[TAB].runs.q1).toBeUndefined();
  });

  it("setViewport persists the viewport", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().setViewport(TAB, { x: 1, y: 2, zoom: 1.5 });
    expect(get().boards[TAB].doc.viewport).toEqual({ x: 1, y: 2, zoom: 1.5 });
  });

  it("runAllQueries dispatches only sink cells, letting the backend run upstreams", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "abc", title: "abc", sql: "select 1", connectionId: "c" }),
    );
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q2", title: "q2", sql: "select * from abc", connectionId: "c" }),
    );
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q3", title: "q3", sql: "select 9", connectionId: "c" }),
    );
    await get().runAllQueries(TAB);
    // abc feeds q2, so only the sinks q2 and q3 are dispatched; abc runs as q2's
    // upstream inside the backend, not as a separate top-level run.
    const targets = vi.mocked(runCanvasCellIPC).mock.calls.map((c) => c[1]).sort();
    expect(targets).toEqual(["q2", "q3"]);
  });

  it("runAutoRunQueries runs only marked queries once and clears the mark", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "a", sql: "select 1", connectionId: "c" }),
    );
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "b", sql: "select 2", connectionId: "c" }),
    );
    get().updateComponent(TAB, "a", { autoRun: true });
    await get().runAutoRunQueries(TAB);
    await get().runAutoRunQueries(TAB);
    expect(vi.mocked(runCanvasCellIPC).mock.calls.map((c) => c[1])).toEqual(["a"]);
    expect(get().boards[TAB].doc.components[0]).not.toHaveProperty("autoRun", true);
  });

  it("runQueryComponent maps each cell's limit and null for select-all", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "c1", sql: "select 1", connectionId: "c" }),
    );
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "c2", sql: "select 2", connectionId: "c" }),
    );
    get().updateComponent(TAB, "c1", { limit: 1000 });
    get().updateComponent(TAB, "c2", { selectAll: true });
    await get().runQueryComponent(TAB, "c1");
    const cells = vi.mocked(runCanvasCellIPC).mock.calls[0][2];
    expect(cells.find((c) => c.id === "c1")!.limit).toBe(1000);
    expect(cells.find((c) => c.id === "c2")!.limit).toBe(null);
  });

  it("keeps a totals-less run spinning until applyIngestDone lands the event", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([
      { id: "c1", result: { columns: [], rows: [], elapsed: 0 } },
    ]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "c1", sql: "select 1", connectionId: "c" }),
    );
    await get().runQueryComponent(TAB, "c1");
    // No totals in the response: the page landed but the background drain is
    // still running, so the spinner stays on until the ingest event.
    expect(get().boards[TAB].runs.c1.running).toBe(true);
    expect(get().boards[TAB].runs.c1.result).toBeTruthy();
    get().applyIngestDone(TAB, "c1", 42, true);
    const run = get().boards[TAB].runs.c1;
    expect(run.running).toBe(false);
    expect(run.totalRows).toBe(42);
    expect(run.complete).toBe(true);
    expect(run.result).toBeTruthy();
  });

  it("a run that already carries totals settles immediately", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([
      { id: "c1", result: { columns: [], rows: [], elapsed: 0 }, totalRows: 7, complete: true },
    ]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "c1", sql: "select 1", connectionId: "c" }),
    );
    await get().runQueryComponent(TAB, "c1");
    const run = get().boards[TAB].runs.c1;
    expect(run.running).toBeFalsy();
    expect(run.totalRows).toBe(7);
  });

  it("stamps startedAt/endedAt on a settled run for total time + timestamp", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([
      { id: "c1", result: { columns: [], rows: [], elapsed: 0 }, totalRows: 3, complete: true },
    ]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "c1", sql: "select 1", connectionId: "c" }),
    );
    await get().runQueryComponent(TAB, "c1");
    const run = get().boards[TAB].runs.c1;
    expect(typeof run.startedAt).toBe("number");
    expect(typeof run.endedAt).toBe("number");
    expect(run.endedAt!).toBeGreaterThanOrEqual(run.startedAt!);
  });

  it("carries startedAt through the ingest event and stamps endedAt on it", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([
      { id: "c1", result: { columns: [], rows: [], elapsed: 0 } },
    ]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "c1", sql: "select 1", connectionId: "c" }),
    );
    await get().runQueryComponent(TAB, "c1");
    const started = get().boards[TAB].runs.c1.startedAt;
    expect(typeof started).toBe("number");
    expect(get().boards[TAB].runs.c1.endedAt).toBeUndefined();
    get().applyIngestDone(TAB, "c1", 42, true);
    const run = get().boards[TAB].runs.c1;
    expect(run.startedAt).toBe(started);
    expect(typeof run.endedAt).toBe("number");
  });

  it("applyIngestDone keeps event totals when it beats the run response", async () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "c1", sql: "select 1", connectionId: "c" }),
    );
    // The background drain can finish (event applied) before the awaited run
    // response is processed; the response must not restart the spinner.
    vi.mocked(runCanvasCellIPC).mockImplementation(async () => {
      get().applyIngestDone(TAB, "c1", 9, true);
      return [{ id: "c1", result: { columns: [], rows: [], elapsed: 0 } }];
    });
    await get().runQueryComponent(TAB, "c1");
    const run = get().boards[TAB].runs.c1;
    expect(run.running).toBe(false);
    expect(run.totalRows).toBe(9);
    expect(run.result).toBeTruthy();
  });

  it("copy then paste clones with a new id, an offset, and raised z", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "shape", id: "s", shape: "rect", x: 10, y: 20, z: 0 }),
    );
    get().copyComponent(TAB, "s");
    get().pasteComponent(TAB);
    const comps = get().boards[TAB].doc.components;
    expect(comps).toHaveLength(2);
    const clone = comps[1];
    expect(clone.id).not.toBe("s");
    expect(clone).toMatchObject({ kind: "shape", x: 34, y: 44 });
    expect(clone.z).toBeGreaterThan(comps[0].z);
  });

  it("pasteComponent is a no-op when the clipboard is empty", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    get().pasteComponent(TAB);
    expect(get().boards[TAB].doc.components).toHaveLength(1);
  });

  it("addEdge connects two objects, ignoring self-links and duplicates", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "a", shape: "rect" }));
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "b", shape: "rect" }));
    get().addEdge(TAB, "a", "b");
    expect(get().boards[TAB].doc.edges).toMatchObject([{ source: "a", target: "b" }]);
    // A self-link and a duplicate are both no-ops.
    get().addEdge(TAB, "a", "a");
    get().addEdge(TAB, "a", "b");
    expect(get().boards[TAB].doc.edges).toHaveLength(1);
  });

  it("removeEdges drops arrows by id", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "a", shape: "rect" }));
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "b", shape: "rect" }));
    get().addEdge(TAB, "a", "b");
    const edgeId = get().boards[TAB].doc.edges[0].id;
    get().removeEdges(TAB, [edgeId]);
    expect(get().boards[TAB].doc.edges).toHaveLength(0);
  });

  it("reorderComponent restacks objects by z", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "a", shape: "rect", z: 0 }));
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "b", shape: "rect", z: 1 }));
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "c", shape: "rect", z: 2 }));
    const zOf = (id: string) =>
      get().boards[TAB].doc.components.find((x) => x.id === id)!.z;

    get().reorderComponent(TAB, "a", "front");
    expect(zOf("a")).toBeGreaterThan(zOf("b"));
    expect(zOf("a")).toBeGreaterThan(zOf("c"));

    get().reorderComponent(TAB, "a", "back");
    expect(zOf("a")).toBeLessThan(zOf("b"));

    // Forward swaps with the immediate neighbour above.
    get().reorderComponent(TAB, "a", "forward");
    expect(zOf("a")).toBe(1);
  });

  it("updateComponent toggles the locked flag", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    get().updateComponent(TAB, "s", { locked: true });
    expect(get().boards[TAB].doc.components[0].locked).toBe(true);
  });

  it("runQueryComponent applies each executed cell's result", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([
      { id: "q1", result: { columns: [], rows: [], elapsed: 1 }, totalRows: 0, complete: true },
    ]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn" }),
    );
    await get().runQueryComponent(TAB, "q1");
    expect(get().boards[TAB].runs.q1.result).toBeDefined();
    expect(get().boards[TAB].runs.q1.running).toBeFalsy();
  });

  it("runQueryComponent passes a cancellation queryId scoped to the cell", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([
      { id: "q1", result: { columns: [], rows: [], elapsed: 1 } },
    ]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn" }),
    );
    const done = get().runQueryComponent(TAB, "q1");
    expect(get().boards[TAB].runs.q1).toMatchObject({ running: true });
    const queryId = vi.mocked(runCanvasCellIPC).mock.calls[0][3];
    expect(queryId).toContain("q1");
    await done;
  });

  it("cancelQueryComponent cancels the in-flight run by its queryId", async () => {
    let resolveRun: (runs: never[]) => void = () => {};
    vi.mocked(runCanvasCellIPC).mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve;
      }),
    );
    vi.mocked(cancelCanvasCellIPC).mockResolvedValue(undefined);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn" }),
    );
    const done = get().runQueryComponent(TAB, "q1");
    get().cancelQueryComponent(TAB, "q1");
    // The cancel handle is derived, matching the id passed to the run call.
    expect(cancelCanvasCellIPC).toHaveBeenCalledWith(
      vi.mocked(runCanvasCellIPC).mock.calls[0][3],
    );
    resolveRun([]);
    await done;
  });

  it("cancelQueryComponent is a no-op when the cell is not running", () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn" }),
    );
    get().cancelQueryComponent(TAB, "q1");
    expect(cancelCanvasCellIPC).not.toHaveBeenCalled();
  });

  it("runQueryComponent auto-runs upstream cells and applies their results too", async () => {
    // The user runs `query` (reads `abc`); the backend returns abc + query.
    vi.mocked(runCanvasCellIPC).mockResolvedValue([
      { id: "abc", result: { columns: [], rows: [], elapsed: 1 } },
      { id: "query", result: { columns: [], rows: [], elapsed: 1 } },
    ]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "abc", title: "abc", sql: "SELECT 1", connectionId: "conn" }),
    );
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "query", title: "query", sql: "SELECT * FROM abc" }),
    );
    await get().runQueryComponent(TAB, "query");
    expect(get().boards[TAB].runs.abc.result).toBeDefined();
    expect(get().boards[TAB].runs.query.result).toBeDefined();
    // The dependency arrow abc -> query is auto-derived from the SQL.
    expect(get().boards[TAB].doc.edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "abc", target: "query" })]),
    );
  });

  it("runQueryComponent surfaces a per-cell backend error", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([
      { id: "q1", error: "pick a connection for this query cell" },
    ]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: null }),
    );
    await get().runQueryComponent(TAB, "q1");
    expect(get().boards[TAB].runs.q1.error).toBeTruthy();
  });

  it("runQueryComponent errors (without calling IPC) on an empty query", async () => {
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "   ", connectionId: "conn" }),
    );
    await get().runQueryComponent(TAB, "q1");
    expect(get().boards[TAB].runs.q1.error).toBeTruthy();
    expect(runCanvasCellIPC).not.toHaveBeenCalled();
  });

  it("runQueryComponent auto-adds a preview table + arrow bound to the query", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([
      { id: "q1", result: { columns: [], rows: [], elapsed: 1 } },
    ]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn" }),
    );
    await get().runQueryComponent(TAB, "q1");
    const board = get().boards[TAB];
    const table = board.doc.components.find((c) => c.kind === "table");
    expect(table).toBeDefined();
    expect(table).toMatchObject({ sourceQueryId: "q1" });
    expect(board.doc.edges).toEqual([
      expect.objectContaining({ source: "q1", target: table!.id }),
    ]);
  });

  it("a second run does not pile on a duplicate preview table", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([
      { id: "q1", result: { columns: [], rows: [], elapsed: 1 } },
    ]);
    get().loadBoard(TAB, { version: 1, components: [], edges: [] }, 0);
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn" }),
    );
    await get().runQueryComponent(TAB, "q1");
    await get().runQueryComponent(TAB, "q1");
    const tables = get().boards[TAB].doc.components.filter((c) => c.kind === "table");
    expect(tables).toHaveLength(1);
  });

});
