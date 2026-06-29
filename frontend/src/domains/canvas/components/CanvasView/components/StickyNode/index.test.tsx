import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
import type { CanvasNodeData } from "../../types";
import { StickyNode } from "./index";

const TAB = "tab-1";

const nodeProps = (id: string) =>
  ({ id, data: { tabId: TAB }, selected: false }) as unknown as NodeProps<CanvasNodeData>;

function renderNode(id: string) {
  return render(
    <ReactFlowProvider>
      <StickyNode {...nodeProps(id)} />
    </ReactFlowProvider>,
  );
}

describe("StickyNode", () => {
  beforeEach(() => useCanvasStore.setState({ boards: {} }));

  it("renders the note's text and writes edits back to the store", () => {
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "sticky", id: "s", text: "todo" }));
    renderNode("s");
    const input = screen.getByPlaceholderText("Note…") as HTMLTextAreaElement;
    expect(input.value).toBe("todo");
    fireEvent.change(input, { target: { value: "done" } });
    expect(useCanvasStore.getState().boards[TAB].doc.components[0]).toMatchObject({
      kind: "sticky",
      text: "done",
    });
  });

  it("applies the note's colour class", () => {
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "sticky", id: "s", color: "green" }));
    const { container } = renderNode("s");
    expect(container.querySelector(".mdbc-canvas-sticky.color-green")).toBeTruthy();
  });

  it("renders nothing for an unknown object", () => {
    useCanvasStore.getState().ensureBoard(TAB, "");
    const { container } = renderNode("missing");
    expect(container.querySelector(".mdbc-canvas-sticky")).toBeNull();
  });
});
