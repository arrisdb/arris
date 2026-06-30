import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { EditorTab } from "@shell/types";

import { useCanvasStore } from "../../hooks";
import { useCanvas } from "./hooks";

const tab = { id: "tab-1", text: "" } as unknown as EditorTab;

describe("useCanvas", () => {
  beforeEach(() => useCanvasStore.setState({ boards: {} }));

  it("parses the tab text into a board on mount", () => {
    renderHook(() => useCanvas(tab));
    expect(useCanvasStore.getState().boards["tab-1"]).toBeDefined();
  });

  it("addText appends a text object", () => {
    const { result } = renderHook(() => useCanvas(tab));
    act(() => result.current.addText());
    const comps = useCanvasStore.getState().boards["tab-1"].doc.components;
    expect(comps).toHaveLength(1);
    expect(comps[0].kind).toBe("text");
  });

  it("addShape appends a shape object", () => {
    const { result } = renderHook(() => useCanvas(tab));
    act(() => result.current.addShape());
    const comps = useCanvasStore.getState().boards["tab-1"].doc.components;
    expect(comps[0].kind).toBe("shape");
  });
});
