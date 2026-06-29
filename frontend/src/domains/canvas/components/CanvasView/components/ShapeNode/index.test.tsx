import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
import type { CanvasComponent } from "../../../../types";
import type { CanvasNodeData } from "../../types";
import { ShapeNode } from "./index";

const TAB = "tab-1";

function seed(component: CanvasComponent) {
  useCanvasStore.setState({ boards: {} });
  useCanvasStore.getState().ensureBoard(TAB, "");
  useCanvasStore.getState().addComponent(TAB, component);
}

const nodeProps = (id: string, selected = false) =>
  ({ id, data: { tabId: TAB }, selected }) as unknown as NodeProps<CanvasNodeData>;

function renderNode(id: string, selected = false) {
  return render(
    <ReactFlowProvider>
      <ShapeNode {...nodeProps(id, selected)} />
    </ReactFlowProvider>,
  );
}

describe("ShapeNode", () => {
  beforeEach(() => useCanvasStore.setState({ boards: {} }));

  it("renders a shape box for the object", () => {
    seed(makeComponent({ kind: "shape", id: "s", shape: "ellipse" }));
    const { container } = renderNode("s");
    expect(container.querySelector(".mdbc-canvas-shape")).toBeTruthy();
  });

  it("renders nothing for an unknown object", () => {
    useCanvasStore.getState().ensureBoard(TAB, "");
    const { container } = renderNode("missing");
    expect(container.querySelector(".mdbc-canvas-shape")).toBeNull();
  });

  it("shows the 'Add text' hint only while selected", () => {
    seed(makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    const idle = renderNode("s", false);
    expect(idle.queryByText("Add text")).toBeNull();
    idle.unmount();
    const selected = renderNode("s", true);
    expect(selected.queryByText("Add text")).toBeTruthy();
  });

  it("swaps the label for an editable textarea on double-click", () => {
    seed(makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    const { container } = renderNode("s", true);
    // Idle: a label, no textarea (a single click falls through to select/drag).
    expect(container.querySelector("textarea")).toBeNull();
    fireEvent.doubleClick(container.querySelector(".mdbc-canvas-shape") as Element);
    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "Label" } });
    expect(useCanvasStore.getState().boards[TAB].doc.components[0]).toMatchObject({
      kind: "shape",
      text: "Label",
    });
  });

  it("never shows a label or editor for a line", () => {
    seed(makeComponent({ kind: "shape", id: "s", shape: "line" }));
    const { container } = renderNode("s", true);
    expect(container.querySelector(".mdbc-canvas-shape-label")).toBeNull();
    fireEvent.doubleClick(container.querySelector(".mdbc-canvas-shape") as Element);
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("shows the radius handle only for a selected rectangle", () => {
    seed(makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    const idle = renderNode("s", false);
    expect(idle.queryByTestId("canvas-radius-handle")).toBeNull();
    idle.unmount();

    const selected = renderNode("s", true);
    expect(selected.queryByTestId("canvas-radius-handle")).toBeTruthy();
    selected.unmount();

    seed(makeComponent({ kind: "shape", id: "e", shape: "ellipse" }));
    const ellipse = renderNode("e", true);
    expect(ellipse.queryByTestId("canvas-radius-handle")).toBeNull();
  });
});
