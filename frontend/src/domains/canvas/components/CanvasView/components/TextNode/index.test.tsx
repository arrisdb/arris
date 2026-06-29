import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
import type { CanvasComponent } from "../../../../types";
import type { CanvasNodeData } from "../../types";
import { TextNode } from "./index";

const TAB = "tab-1";

function seed(component: CanvasComponent) {
  useCanvasStore.setState({ boards: {} });
  useCanvasStore.getState().ensureBoard(TAB, "");
  useCanvasStore.getState().addComponent(TAB, component);
}

const nodeProps = (id: string) =>
  ({ id, data: { tabId: TAB }, selected: false }) as unknown as NodeProps<CanvasNodeData>;

function renderNode(id: string) {
  return render(
    <ReactFlowProvider>
      <TextNode {...nodeProps(id)} />
    </ReactFlowProvider>,
  );
}

describe("TextNode", () => {
  beforeEach(() => useCanvasStore.setState({ boards: {} }));

  it("shows the text and writes edits back once editing", () => {
    seed(makeComponent({ kind: "text", id: "t", text: "hello" }));
    const { container } = renderNode("t");
    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(input.value).toBe("hello");
    // Double-click enters editing; only then is the field writable.
    fireEvent.doubleClick(container.querySelector(".mdbc-canvas-text") as Element);
    fireEvent.change(input, { target: { value: "world" } });
    expect(useCanvasStore.getState().boards[TAB].doc.components[0]).toMatchObject({
      kind: "text",
      text: "world",
    });
  });

  it("is read-only and draggable until double-clicked, then editable", () => {
    seed(makeComponent({ kind: "text", id: "t", text: "" }));
    const { container } = renderNode("t");
    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    // Idle: read-only (clicks fall through to the node) and not nodrag.
    expect(input.readOnly).toBe(true);
    expect(input.classList.contains("nodrag")).toBe(false);
    fireEvent.doubleClick(container.querySelector(".mdbc-canvas-text") as Element);
    expect(input.readOnly).toBe(false);
    expect(input.classList.contains("nodrag")).toBe(true);
    fireEvent.blur(input);
    expect(input.readOnly).toBe(true);
    expect(input.classList.contains("nodrag")).toBe(false);
  });
});
