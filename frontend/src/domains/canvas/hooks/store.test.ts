import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc", () => ({ runCanvasQueryIPC: vi.fn() }));

import type { AgentCanvasSpec } from "../types";
import { makeComponent } from "../utils";
import { runCanvasQueryIPC } from "../ipc";
import { useCanvasStore } from "./store";

const TAB = "tab-1";
const get = () => useCanvasStore.getState();

describe("useCanvasStore", () => {
  beforeEach(() => {
    useCanvasStore.setState({ boards: {} });
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

  it("duplicateComponent clones with a new id, an offset, and raised z", () => {
    get().ensureBoard(TAB, "");
    get().addComponent(
      TAB,
      makeComponent({ kind: "shape", id: "s", shape: "rect", x: 10, y: 20, z: 0 }),
    );
    get().duplicateComponent(TAB, "s");
    const comps = get().boards[TAB].doc.components;
    expect(comps).toHaveLength(2);
    const clone = comps[1];
    expect(clone.id).not.toBe("s");
    expect(clone).toMatchObject({ kind: "shape", x: 34, y: 44 });
    expect(clone.z).toBeGreaterThan(comps[0].z);
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

  it("runQueryComponent stores the result on success", async () => {
    vi.mocked(runCanvasQueryIPC).mockResolvedValue({ columns: [], rows: [], elapsed: 1 });
    get().ensureBoard(TAB, "");
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "select 1", connectionId: "conn" }),
    );
    await get().runQueryComponent(TAB, "q1");
    expect(get().boards[TAB].runs.q1.result).toBeDefined();
    expect(get().boards[TAB].runs.q1.running).toBe(false);
  });

  it("runQueryComponent errors (without calling IPC) when no connection is set", async () => {
    get().ensureBoard(TAB, "");
    get().addComponent(
      TAB,
      makeComponent({ kind: "query", id: "q1", sql: "s", connectionId: null }),
    );
    await get().runQueryComponent(TAB, "q1");
    expect(get().boards[TAB].runs.q1.error).toBeTruthy();
    expect(runCanvasQueryIPC).not.toHaveBeenCalled();
  });
});
