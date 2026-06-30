import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";

import { CanvasResizer } from "./index";

function renderResizer(visible: boolean) {
  return render(
    <ReactFlowProvider>
      <CanvasResizer tabId="t" id="n" visible={visible} />
    </ReactFlowProvider>,
  );
}

describe("CanvasResizer", () => {
  it("renders draggable resize controls when the node is selected", () => {
    const { container } = renderResizer(true);
    expect(container.querySelector(".react-flow__resize-control")).toBeTruthy();
  });

  it("renders nothing when the node is not selected", () => {
    const { container } = renderResizer(false);
    expect(container.querySelector(".react-flow__resize-control")).toBeNull();
  });
});
