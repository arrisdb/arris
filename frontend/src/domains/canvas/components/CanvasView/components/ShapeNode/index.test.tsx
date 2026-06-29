import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
import type { CanvasNodeData } from "../../types";
import { ShapeNode } from "./index";

const TAB = "tab-1";

const nodeProps = (id: string) =>
  ({ id, data: { tabId: TAB }, selected: false }) as unknown as NodeProps<CanvasNodeData>;

function renderNode(id: string) {
  return render(
    <ReactFlowProvider>
      <ShapeNode {...nodeProps(id)} />
    </ReactFlowProvider>,
  );
}

describe("ShapeNode", () => {
  beforeEach(() => useCanvasStore.setState({ boards: {} }));

  it("renders a shape box for the object", () => {
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore.getState().addComponent(TAB, makeComponent({ kind: "shape", id: "s", shape: "ellipse" }));
    const { container } = renderNode("s");
    expect(container.querySelector(".mdbc-canvas-shape")).toBeTruthy();
  });

  it("renders nothing for an unknown object", () => {
    useCanvasStore.getState().ensureBoard(TAB, "");
    const { container } = renderNode("missing");
    expect(container.querySelector(".mdbc-canvas-shape")).toBeNull();
  });
});
