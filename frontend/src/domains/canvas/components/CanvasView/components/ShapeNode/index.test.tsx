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

  it("offers the 'Add text' placeholder only while selected", () => {
    seed(makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    const idle = renderNode("s", false);
    expect(
      (idle.container.querySelector("textarea") as HTMLTextAreaElement).placeholder,
    ).toBe("");
    idle.unmount();
    const selected = renderNode("s", true);
    expect(
      (selected.container.querySelector("textarea") as HTMLTextAreaElement).placeholder,
    ).toBe("Add text");
  });

  it("makes the label editable on double-click and writes typed text back", () => {
    seed(makeComponent({ kind: "shape", id: "s", shape: "rect" }));
    const { container } = renderNode("s", true);
    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    // Idle: read-only so a single click falls through to select/drag.
    expect(input.readOnly).toBe(true);
    fireEvent.doubleClick(container.querySelector(".mdbc-canvas-shape") as Element);
    expect(input.readOnly).toBe(false);
    fireEvent.change(input, { target: { value: "Label" } });
    expect(useCanvasStore.getState().boards[TAB].doc.components[0]).toMatchObject({
      kind: "shape",
      text: "Label",
    });
  });

  it("never shows a label for a line", () => {
    seed(makeComponent({ kind: "shape", id: "s", shape: "line" }));
    const { container } = renderNode("s", true);
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
