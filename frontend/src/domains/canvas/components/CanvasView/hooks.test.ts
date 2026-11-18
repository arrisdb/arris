import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ServerEvent } from "@shared/api";

const events = vi.hoisted(() => ({ handler: null as ((e: ServerEvent) => void) | null }));
vi.mock("@shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/api")>()),
  currentProject: () => PROJECT,
  subscribe: (handler: (e: ServerEvent) => void) => {
    events.handler = handler;
    return () => {
      events.handler = null;
    };
  },
}));
vi.mock("../../ipc", () => ({
  getCanvasIPC: vi.fn(),
  saveCanvasIPC: vi.fn(),
  runCanvasCellIPC: vi.fn(),
  cancelCanvasCellIPC: vi.fn(),
}));

import { ApiError } from "@shared/api";
import { CANVAS_RELOADED_MESSAGE } from "../../constants";
import { useCanvasStore } from "../../hooks";
import { getCanvasIPC, saveCanvasIPC } from "../../ipc";
import type { CanvasDoc } from "../../types";
import { emptyDoc, makeComponent } from "../../utils";
import { useCanvas } from "./hooks";
import { enableWebShell } from "@shared/api";

// These cover the browser shell, which talks to the arris server.
enableWebShell();

const BOARD = "board-1";
const PROJECT = "/proj";
const TITLE = "Board";
const SAVE_WAIT = { timeout: 2000 };

/// Serve whatever the store holds (or `doc`) as the server's copy at `revision`.
function serve(revision: number, doc?: CanvasDoc) {
  vi.mocked(getCanvasIPC).mockImplementation(async (id) => ({
    id,
    title: TITLE,
    createdAt: "",
    updatedAt: "",
    revision,
    doc: doc ?? useCanvasStore.getState().boards[id]?.doc ?? emptyDoc(),
  }));
}

async function renderBoard() {
  const hook = renderHook(() => useCanvas(BOARD));
  await waitFor(() => expect(hook.result.current.title).toBe(TITLE));
  return hook;
}

function emit(event: ServerEvent) {
  act(() => events.handler?.(event));
}

describe("useCanvas", () => {
  beforeEach(() => {
    useCanvasStore.setState({ boards: {}, lastQueryConnection: {} });
    vi.clearAllMocks();
    serve(0);
    vi.mocked(saveCanvasIPC).mockImplementation(async (id, doc, revision) => ({
      id,
      title: TITLE,
      createdAt: "",
      updatedAt: "",
      revision: revision + 1,
      doc,
    }));
  });

  it("board loads doc and saves with revision", async () => {
    const text = makeComponent({ kind: "text", id: "t", text: "hi" });
    serve(4, { version: 1, components: [text], edges: [] });
    const { result } = await renderBoard();
    expect(useCanvasStore.getState().boards[BOARD].doc.components).toEqual([text]);
    expect(saveCanvasIPC).not.toHaveBeenCalled();
    act(() => result.current.addSticky());
    await waitFor(() => expect(saveCanvasIPC).toHaveBeenCalledTimes(1), SAVE_WAIT);
    const [id, doc, revision] = vi.mocked(saveCanvasIPC).mock.calls[0];
    expect(id).toBe(BOARD);
    expect(revision).toBe(4);
    expect(doc.components).toHaveLength(2);
    await waitFor(() => expect(useCanvasStore.getState().boards[BOARD].revision).toBe(5));
  });

  it("409 on save reloads board", async () => {
    const { result } = await renderBoard();
    vi.mocked(saveCanvasIPC).mockRejectedValue(new ApiError("conflict", "stale", 409));
    serve(7, emptyDoc());
    act(() => result.current.addSticky());
    await waitFor(() => expect(result.current.notice).toBe(CANVAS_RELOADED_MESSAGE), SAVE_WAIT);
    expect(useCanvasStore.getState().boards[BOARD].revision).toBe(7);
    expect(useCanvasStore.getState().boards[BOARD].doc.components).toHaveLength(0);
  });

  it("canvas_changed with newer revision reloads", async () => {
    const { result } = await renderBoard();
    const added = makeComponent({ kind: "text", id: "cli", text: "" });
    serve(1, { version: 1, components: [added], edges: [] });
    emit({ kind: "canvas_changed", project: "/other", payload: { id: BOARD, revision: 1 } });
    emit({ kind: "canvas_changed", project: PROJECT, payload: { id: "x", revision: 1 } });
    emit({ kind: "canvas_changed", project: PROJECT, payload: { id: BOARD, revision: 0 } });
    expect(getCanvasIPC).toHaveBeenCalledTimes(1);
    emit({ kind: "canvas_changed", project: PROJECT, payload: { id: BOARD, revision: 1 } });
    await waitFor(() =>
      expect(useCanvasStore.getState().boards[BOARD].doc.components).toEqual([added]),
    );
    expect(result.current.notice).toBeNull();
  });

  it("canvas_cell_ingested settles the matching cell only", async () => {
    await renderBoard();
    useCanvasStore.getState().setRun(BOARD, "q", { running: true });
    const ingested = { boardId: BOARD, cellId: "q", totalRows: 9, complete: true };
    emit({ kind: "canvas_cell_ingested", project: PROJECT, payload: { ...ingested, boardId: "x" } });
    expect(useCanvasStore.getState().boards[BOARD].runs.q.running).toBe(true);
    emit({ kind: "canvas_cell_ingested", project: PROJECT, payload: ingested });
    expect(useCanvasStore.getState().boards[BOARD].runs.q).toMatchObject({
      running: false,
      totalRows: 9,
    });
  });

  it("defaults to move mode", async () => {
    const { result } = await renderBoard();
    expect(result.current.mode).toBe("move");
  });

  it("setMode switches the pointer tool", async () => {
    const { result } = await renderBoard();
    act(() => result.current.setMode("hand"));
    expect(result.current.mode).toBe("hand");
  });

  it("addText appends a text object", async () => {
    const { result } = await renderBoard();
    act(() => result.current.addText());
    const comps = useCanvasStore.getState().boards[BOARD].doc.components;
    expect(comps).toHaveLength(1);
    expect(comps[0].kind).toBe("text");
  });

  it("addSticky appends a sticky note", async () => {
    const { result } = await renderBoard();
    act(() => result.current.addSticky());
    expect(useCanvasStore.getState().boards[BOARD].doc.components[0].kind).toBe("sticky");
  });

  it("addShape appends the requested shape kind", async () => {
    const { result } = await renderBoard();
    act(() => result.current.addShape("ellipse"));
    const comp = useCanvasStore.getState().boards[BOARD].doc.components[0];
    expect(comp).toMatchObject({ kind: "shape", shape: "ellipse" });
  });

  it("addQuery starts a first query with no connection", async () => {
    const { result } = await renderBoard();
    act(() => result.current.addQuery());
    const comp = useCanvasStore.getState().boards[BOARD].doc.components[0];
    expect(comp).toMatchObject({ kind: "query", connectionId: null });
  });

  it("keeps the ReactFlow nodes identical across an SQL edit (input-loss guard)", async () => {
    const { result } = await renderBoard();
    act(() => result.current.addQuery());
    const id = useCanvasStore.getState().boards[BOARD].doc.components[0].id;
    const before = result.current.rfNodes;
    act(() => useCanvasStore.getState().updateComponent(BOARD, id, { sql: "SELECT 1" }));
    expect(result.current.rfNodes).toBe(before);
  });

  it("rebuilds the ReactFlow nodes when geometry changes", async () => {
    const { result } = await renderBoard();
    act(() => result.current.addQuery());
    const id = useCanvasStore.getState().boards[BOARD].doc.components[0].id;
    const before = result.current.rfNodes;
    act(() => useCanvasStore.getState().updateComponent(BOARD, id, { x: 999 }));
    expect(result.current.rfNodes).not.toBe(before);
    expect(result.current.rfNodes[0].position.x).toBe(999);
  });

  it("a new query cell reuses the connection last picked on the board", async () => {
    const { result } = await renderBoard();
    act(() => result.current.addQuery());
    const first = useCanvasStore.getState().boards[BOARD].doc.components[0];
    act(() =>
      useCanvasStore.getState().updateComponent(BOARD, first.id, { connectionId: "conn-2" }),
    );
    act(() => result.current.addQuery());
    const second = useCanvasStore.getState().boards[BOARD].doc.components[1];
    expect(second).toMatchObject({ kind: "query", connectionId: "conn-2" });
  });

  it("addChart appends a chart object", async () => {
    const { result } = await renderBoard();
    act(() => result.current.addChart());
    expect(useCanvasStore.getState().boards[BOARD].doc.components[0].kind).toBe("chart");
  });

  it("toggleLock flips an object's locked flag", async () => {
    const store = useCanvasStore.getState();
    store.loadBoard(BOARD, { version: 1, components: [], edges: [] }, 0);
    store.addComponent(BOARD, makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    const { result } = await renderBoard();
    act(() => result.current.toggleLock("s"));
    expect(useCanvasStore.getState().boards[BOARD].doc.components[0].locked).toBe(true);
    act(() => result.current.toggleLock("s"));
    expect(useCanvasStore.getState().boards[BOARD].doc.components[0].locked).toBe(false);
  });

  it("copy then paste appends a clone and componentById resolves an object", async () => {
    const store = useCanvasStore.getState();
    store.loadBoard(BOARD, { version: 1, components: [], edges: [] }, 0);
    store.addComponent(BOARD, makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    const { result } = await renderBoard();
    expect(result.current.componentById("s")?.kind).toBe("shape");
    act(() => result.current.copy("s"));
    act(() => result.current.paste());
    expect(useCanvasStore.getState().boards[BOARD].doc.components).toHaveLength(2);
  });

  it("removeEdge deletes an arrow by id", async () => {
    const store = useCanvasStore.getState();
    store.loadBoard(BOARD, { version: 1, components: [], edges: [] }, 0);
    store.addComponent(BOARD, makeComponent({ kind: "shape", id: "a", shape: "rect" }));
    store.addComponent(BOARD, makeComponent({ kind: "shape", id: "b", shape: "rect" }));
    store.addEdge(BOARD, "a", "b");
    const edgeId = useCanvasStore.getState().boards[BOARD].doc.edges[0].id;
    const { result } = await renderBoard();
    act(() => result.current.removeEdge(edgeId));
    expect(useCanvasStore.getState().boards[BOARD].doc.edges).toHaveLength(0);
  });

  it("remove deletes the object from the board", async () => {
    const store = useCanvasStore.getState();
    store.loadBoard(BOARD, { version: 1, components: [], edges: [] }, 0);
    store.addComponent(BOARD, makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    const { result } = await renderBoard();
    act(() => result.current.remove("s"));
    expect(useCanvasStore.getState().boards[BOARD].doc.components).toHaveLength(0);
  });

  it("exposes the single selected object and nothing when 0 or 2 are selected", async () => {
    const store = useCanvasStore.getState();
    store.loadBoard(BOARD, { version: 1, components: [], edges: [] }, 0);
    store.addComponent(BOARD, makeComponent({ kind: "shape", id: "a", shape: "rect" }));
    store.addComponent(BOARD, makeComponent({ kind: "shape", id: "b", shape: "rect" }));
    const { result } = await renderBoard();
    expect(result.current.selectedComponent).toBeUndefined();
    act(() => result.current.onNodesChange([{ id: "a", type: "select", selected: true }]));
    expect(result.current.selectedComponent?.id).toBe("a");
    act(() => result.current.onNodesChange([{ id: "b", type: "select", selected: true }]));
    expect(result.current.selectedComponent).toBeUndefined();
  });

  it("update writes a patch and the node picks up the new position when not dragging", async () => {
    const store = useCanvasStore.getState();
    store.loadBoard(BOARD, { version: 1, components: [], edges: [] }, 0);
    store.addComponent(BOARD, makeComponent({ kind: "shape", id: "a", shape: "rect", x: 0 }));
    const { result } = await renderBoard();
    act(() => result.current.onNodesChange([{ id: "a", type: "select", selected: true }]));
    act(() => result.current.update("a", { x: 50 }));
    expect(useCanvasStore.getState().boards[BOARD].doc.components[0].x).toBe(50);
    expect(result.current.rfNodes.find((n) => n.id === "a")?.position.x).toBe(50);
  });

  it("keeps a node selected across a non-structural store update", async () => {
    const store = useCanvasStore.getState();
    store.loadBoard(BOARD, { version: 1, components: [], edges: [] }, 0);
    store.addComponent(BOARD, makeComponent({ kind: "shape", id: "a", shape: "rect" }));
    store.addComponent(BOARD, makeComponent({ kind: "shape", id: "b", shape: "rect" }));
    const { result } = await renderBoard();
    act(() => result.current.onNodesChange([{ id: "a", type: "select", selected: true }]));
    expect(result.current.rfNodes.find((n) => n.id === "a")?.selected).toBe(true);
    // Moving a different object reseeds the nodes; selection (and its anchors)
    // must survive so the resize handles do not blink out.
    act(() => useCanvasStore.getState().updateComponent(BOARD, "b", { x: 99 }));
    expect(result.current.rfNodes.find((n) => n.id === "a")?.selected).toBe(true);
  });
});
