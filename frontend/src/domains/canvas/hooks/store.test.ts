import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc", () => ({
  runCanvasCellIPC: vi.fn(),
  cancelCanvasCellIPC: vi.fn(),
}));

import type { AgentCanvasSpec } from "../types";
import { makeComponent } from "../utils";
import { cancelCanvasCellIPC, runCanvasCellIPC } from "../ipc";
import { useCanvasStore } from "./store";

const TAB = "tab-1";
const get = () => useCanvasStore.getState();

describe("useCanvasStore", () => {
  beforeEach(() => {
    useCanvasStore.setState({ boards: {}, clipboard: null });
    vi.clearAllMocks();
  });

  it("ensureBoard parses once and never clobbers live edits", () => {
    get().ensureBoard(TAB, "");
    get().addComponent(TAB, makeComponent({ kind: "text", id: "t", text: "x" }));
    // A second ensure (e.g. a re-mount) must not reset the board.
    get().ensureBoard(TAB, JSON.stringify({ version: 1, components: [], edges: [] }));
    expect(get().boards[TAB].doc.components).toHaveLength(1);
  });

  it("adds, updates, and removes an object", () => {
    get().ensureBoard(TAB, "");
    get().addComponent(TAB, makeComponent({ kind: "text", id: "t", text: "a" }));
    get().updateComponent(TAB, "t", { x: 50 });
    expect(get().boards[TAB].doc.components[0]).toMatchObject({ x: 50 });
    get().removeComponent(TAB, "t");
    expect(get().boards[TAB].doc.components).toHaveLength(0);
  });

  it("draws, moves, and clears a binding arrow as a viewer's source changes", () => {
    get().ensureBoard(TAB, "");
    get().addComponent(TAB, makeComponent({ kind: "query", id: "q", title: "Sales" }));
    get().addComponent(TAB, makeComponent({ kind: "query", id: "q2", title: "Costs" }));
    get().addComponent(TAB, makeComponent({ kind: "table", id: "tbl" }));
    expect(get().boards[TAB].doc.edges).toHaveLength(0);

    // Binding via the properties picker draws the arrow.
    get().updateComponent(TAB, "tbl", { sourceQueryId: "q" });
    expect(get().boards[TAB].doc.edges).toMatchObject([{ source: "q", target: "tbl" }]);

    // Rebinding moves it; unbinding removes it.
    get().updateComponent(TAB, "tbl", { sourceQueryId: "q2" });
    expect(get().boards[TAB].doc.edges).toMatchObject([{ source: "q2", target: "tbl" }]);
    get().updateComponent(TAB, "tbl", { sourceQueryId: null });
    expect(get().boards[TAB].doc.edges).toHaveLength(0);
  });

  it("removing an object also drops its edges and run state", () => {
    get().ensureBoard(TAB, "");
    get().addComponent(TAB, makeComponent({ kind: "query", id: "q1", sql: "s" }));
    get().addComponent(TAB, makeComponent({ kind: "chart", id: "c1", sourceQueryId: "q1" }));
    get().setEdges(TAB, [{ id: "e", source: "q1", target: "c1" }]);
    get().setRun(TAB, "q1", { result: { columns: [], rows: [], elapsed: 0 } });
    get().removeComponent(TAB, "q1");
    expect(get().boards[TAB].doc.edges).toHaveLength(0);
    expect(get().boards[TAB].runs.q1).toBeUndefined();
  });

  it("setViewport persists the viewport", () => {
    get().ensureBoard(TAB, "");
    get().setViewport(TAB, { x: 1, y: 2, zoom: 1.5 });
    expect(get().boards[TAB].doc.viewport).toEqual({ x: 1, y: 2, zoom: 1.5 });
  });

  it("applyAgentSpec appends objects and returns the query ids to run", () => {
    get().ensureBoard(TAB, "");
    const spec: AgentCanvasSpec = {
      components: [
        { kind: "query", id: "q1", sql: "s" },
        {
          kind: "chart",
          id: "c1",
          sourceQueryId: "q1",
          spec: { kind: "bar", xColumn: "a", yColumns: ["b"] },
        },
      ],
      edges: [],
    };
    const ids = get().applyAgentSpec(TAB, spec, "conn");
    expect(ids).toEqual(["q1"]);
    expect(get().boards[TAB].doc.components).toHaveLength(2);
    expect(get().boards[TAB].doc.edges).toHaveLength(1);
  });

  it("applyAgentSpec patches an existing object by id and re-runs a changed query", () => {
    get().ensureBoard(TAB, "");
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn" }),
    );
    const ids = get().applyAgentSpec(
      TAB,
      { components: [{ kind: "query", id: "q1", sql: "select 2" }], edges: [] },
      "conn",
    );
    // No duplicate object; the existing one is patched; the changed query re-runs.
    expect(get().boards[TAB].doc.components).toHaveLength(1);
    expect(get().boards[TAB].doc.components[0]).toMatchObject({ id: "q1", sql: "select 2" });
    expect(ids).toEqual(["q1"]);
  });

  it("applyAgentSpec re-runs a query whose connection changed even without an sql edit", () => {
    get().ensureBoard(TAB, "");
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn-a" }),
    );
    const ids = get().applyAgentSpec(
      TAB,
      { components: [{ kind: "query", id: "q1", connectionId: "conn-b" }], edges: [] },
      "conn-a",
    );
    expect(get().boards[TAB].doc.components[0]).toMatchObject({
      id: "q1",
      connectionId: "conn-b",
    });
    expect(ids).toEqual(["q1"]);
  });

  it("runAllQueries dispatches only sink cells, letting the backend run upstreams", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([]);
    get().ensureBoard(TAB, "");
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

  it("runQueryComponent maps each cell's limit and null for select-all", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([]);
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
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

  it("applyAgentSpec removes the ids in the remove list, with their edges and runs", () => {
    get().ensureBoard(TAB, "");
    get().applyAgentSpec(
      TAB,
      {
        components: [
          { kind: "query", id: "q1", sql: "s" },
          {
            kind: "chart",
            id: "c1",
            sourceQueryId: "q1",
            spec: { kind: "bar", xColumn: "a", yColumns: ["b"] },
          },
        ],
        edges: [],
      },
      "conn",
    );
    get().setRun(TAB, "q1", { result: { columns: [], rows: [], elapsed: 0 } });
    get().applyAgentSpec(TAB, { components: [], edges: [], remove: ["q1"] }, "conn");
    const board = get().boards[TAB];
    expect(board.doc.components.map((c) => c.id)).toEqual(["c1"]);
    expect(board.doc.edges).toHaveLength(0);
    expect(board.runs.q1).toBeUndefined();
  });

  it("copy then paste clones with a new id, an offset, and raised z", () => {
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    get().pasteComponent(TAB);
    expect(get().boards[TAB].doc.components).toHaveLength(1);
  });

  it("setConnectionIds persists the board's connection set", () => {
    get().ensureBoard(TAB, "");
    get().setConnectionIds(TAB, ["conn-a", "conn-b"]);
    expect(get().boards[TAB].doc.connectionIds).toEqual(["conn-a", "conn-b"]);
  });

  it("addEdge connects two objects, ignoring self-links and duplicates", () => {
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "a", shape: "rect" }));
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "b", shape: "rect" }));
    get().addEdge(TAB, "a", "b");
    const edgeId = get().boards[TAB].doc.edges[0].id;
    get().removeEdges(TAB, [edgeId]);
    expect(get().boards[TAB].doc.edges).toHaveLength(0);
  });

  it("reorderComponent restacks objects by z", () => {
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
    get().addComponent(TAB, makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    get().updateComponent(TAB, "s", { locked: true });
    expect(get().boards[TAB].doc.components[0].locked).toBe(true);
  });

  it("runQueryComponent applies each executed cell's result", async () => {
    vi.mocked(runCanvasCellIPC).mockResolvedValue([
      { id: "q1", result: { columns: [], rows: [], elapsed: 1 }, totalRows: 0, complete: true },
    ]);
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: null }),
    );
    await get().runQueryComponent(TAB, "q1");
    expect(get().boards[TAB].runs.q1.error).toBeTruthy();
  });

  it("runQueryComponent errors (without calling IPC) on an empty query", async () => {
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
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
    get().ensureBoard(TAB, "");
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn" }),
    );
    await get().runQueryComponent(TAB, "q1");
    await get().runQueryComponent(TAB, "q1");
    const tables = get().boards[TAB].doc.components.filter((c) => c.kind === "table");
    expect(tables).toHaveLength(1);
  });

  it("setChat persists the chat log into the doc", () => {
    get().ensureBoard(TAB, "");
    get().setChat(TAB, [
      { id: "u1", role: "user", text: "hi" },
      { id: "a1", role: "agent", text: "done", action: "Added query" },
    ]);
    expect(get().boards[TAB].doc.chat).toEqual([
      { id: "u1", role: "user", text: "hi" },
      { id: "a1", role: "agent", text: "done", action: "Added query" },
    ]);
  });

  it("clearChat empties the persisted chat log", () => {
    get().ensureBoard(TAB, "");
    get().setChat(TAB, [{ id: "u1", role: "user", text: "hi" }]);
    get().clearChat(TAB);
    expect(get().boards[TAB].doc.chat).toEqual([]);
  });

  it("writing chat keeps the components/edges array references stable", () => {
    // Board nodes subscribe to `doc.components`/`doc.edges`; writing chat must not
    // swap those arrays, or every node would needlessly re-render per token.
    get().ensureBoard(TAB, "");
    get().addComponent(TAB, makeComponent({ kind: "text", id: "t", text: "x" }));
    const beforeComps = get().boards[TAB].doc.components;
    const beforeEdges = get().boards[TAB].doc.edges;
    get().setChat(TAB, [{ id: "u1", role: "user", text: "hi" }]);
    expect(get().boards[TAB].doc.components).toBe(beforeComps);
    expect(get().boards[TAB].doc.edges).toBe(beforeEdges);
  });
});
