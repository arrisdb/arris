import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { EditorTab } from "@shell/types";

import { useCanvasStore } from "../../hooks";
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
});
