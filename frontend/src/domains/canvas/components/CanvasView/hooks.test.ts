import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { EditorTab } from "@shell/types";

import { useCanvasStore } from "../../hooks";
import { makeComponent } from "../../utils";
import { useCanvas } from "./hooks";

const tab = { id: "tab-1", text: "", connectionId: "conn-1" } as unknown as EditorTab;

describe("useCanvas", () => {
  beforeEach(() => useCanvasStore.setState({ boards: {} }));

  it("parses the tab text into a board on mount", () => {
    renderHook(() => useCanvas(tab));
    expect(useCanvasStore.getState().boards["tab-1"]).toBeDefined();
  });

  it("defaults to move mode", () => {
    const { result } = renderHook(() => useCanvas(tab));
    expect(result.current.mode).toBe("move");
  });

  it("setMode switches the pointer tool", () => {
    const { result } = renderHook(() => useCanvas(tab));
    act(() => result.current.setMode("hand"));
    expect(result.current.mode).toBe("hand");
  });

  it("addText appends a text object", () => {
    const { result } = renderHook(() => useCanvas(tab));
    act(() => result.current.addText());
    const comps = useCanvasStore.getState().boards["tab-1"].doc.components;
    expect(comps).toHaveLength(1);
    expect(comps[0].kind).toBe("text");
  });

  it("addSticky appends a sticky note", () => {
    const { result } = renderHook(() => useCanvas(tab));
    act(() => result.current.addSticky());
    expect(useCanvasStore.getState().boards["tab-1"].doc.components[0].kind).toBe("sticky");
  });

  it("addShape appends the requested shape kind", () => {
    const { result } = renderHook(() => useCanvas(tab));
    act(() => result.current.addShape("ellipse"));
    const comp = useCanvasStore.getState().boards["tab-1"].doc.components[0];
    expect(comp).toMatchObject({ kind: "shape", shape: "ellipse" });
  });

  it("addQuery binds the new object to the tab's connection", () => {
    const { result } = renderHook(() => useCanvas(tab));
    act(() => result.current.addQuery());
    const comp = useCanvasStore.getState().boards["tab-1"].doc.components[0];
    expect(comp).toMatchObject({ kind: "query", connectionId: "conn-1" });
  });

  it("addChart appends a chart object", () => {
    const { result } = renderHook(() => useCanvas(tab));
    act(() => result.current.addChart());
    expect(useCanvasStore.getState().boards["tab-1"].doc.components[0].kind).toBe("chart");
  });

  it("toggleLock flips an object's locked flag", () => {
    const store = useCanvasStore.getState();
    store.ensureBoard("tab-1", "");
    store.addComponent("tab-1", makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    const { result } = renderHook(() => useCanvas(tab));
    act(() => result.current.toggleLock("s"));
    expect(useCanvasStore.getState().boards["tab-1"].doc.components[0].locked).toBe(true);
    act(() => result.current.toggleLock("s"));
    expect(useCanvasStore.getState().boards["tab-1"].doc.components[0].locked).toBe(false);
  });

  it("duplicate appends a clone and componentById resolves an object", () => {
    const store = useCanvasStore.getState();
    store.ensureBoard("tab-1", "");
    store.addComponent("tab-1", makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    const { result } = renderHook(() => useCanvas(tab));
    expect(result.current.componentById("s")?.kind).toBe("shape");
    act(() => result.current.duplicate("s"));
    expect(useCanvasStore.getState().boards["tab-1"].doc.components).toHaveLength(2);
  });

  it("exposes the single selected object and nothing when 0 or 2 are selected", () => {
    const store = useCanvasStore.getState();
    store.ensureBoard("tab-1", "");
    store.addComponent("tab-1", makeComponent({ kind: "shape", id: "a", shape: "rect" }));
    store.addComponent("tab-1", makeComponent({ kind: "shape", id: "b", shape: "rect" }));
    const { result } = renderHook(() => useCanvas(tab));
    expect(result.current.selectedComponent).toBeUndefined();
    act(() => result.current.onNodesChange([{ id: "a", type: "select", selected: true }]));
    expect(result.current.selectedComponent?.id).toBe("a");
    act(() => result.current.onNodesChange([{ id: "b", type: "select", selected: true }]));
    expect(result.current.selectedComponent).toBeUndefined();
  });

  it("update writes a patch and the node picks up the new position when not dragging", () => {
    const store = useCanvasStore.getState();
    store.ensureBoard("tab-1", "");
    store.addComponent("tab-1", makeComponent({ kind: "shape", id: "a", shape: "rect", x: 0 }));
    const { result } = renderHook(() => useCanvas(tab));
    act(() => result.current.onNodesChange([{ id: "a", type: "select", selected: true }]));
    act(() => result.current.update("a", { x: 50 }));
    expect(useCanvasStore.getState().boards["tab-1"].doc.components[0].x).toBe(50);
    expect(result.current.rfNodes.find((n) => n.id === "a")?.position.x).toBe(50);
  });

  it("keeps a node selected across a non-structural store update", () => {
    const store = useCanvasStore.getState();
    store.ensureBoard("tab-1", "");
    store.addComponent("tab-1", makeComponent({ kind: "shape", id: "a", shape: "rect" }));
    store.addComponent("tab-1", makeComponent({ kind: "shape", id: "b", shape: "rect" }));
    const { result } = renderHook(() => useCanvas(tab));
    act(() => result.current.onNodesChange([{ id: "a", type: "select", selected: true }]));
    expect(result.current.rfNodes.find((n) => n.id === "a")?.selected).toBe(true);
    // Moving a different object reseeds the nodes; selection (and its anchors)
    // must survive so the resize handles do not blink out.
    act(() => useCanvasStore.getState().updateComponent("tab-1", "b", { x: 99 }));
    expect(result.current.rfNodes.find((n) => n.id === "a")?.selected).toBe(true);
  });
});
