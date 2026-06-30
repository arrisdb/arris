import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
import { CanvasPropertiesPane } from "./index";

const TAB = "t";

describe("CanvasPropertiesPane", () => {
  beforeEach(() => {
    useCanvasStore.setState({ boards: {} });
    useCanvasStore.getState().ensureBoard(TAB, "");
  });

  it("labels the pane with the object kind and always shows the geometry fields", () => {
    const comp = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const { getByTestId, getByText, container } = render(
      <CanvasPropertiesPane tabId={TAB} component={comp} onChange={vi.fn()} />,
    );
    expect(getByTestId("canvas-properties-pane")).toBeTruthy();
    expect(getByText("Shape")).toBeTruthy();
    // CommonSection geometry grid: X/Y/W/H.
    expect(container.querySelectorAll('input[type="number"]').length).toBeGreaterThanOrEqual(4);
  });

  it("shows the shape section for a shape", () => {
    const comp = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const { container } = render(
      <CanvasPropertiesPane tabId={TAB} component={comp} onChange={vi.fn()} />,
    );
    expect(container.querySelector('input[type="color"]')).toBeTruthy();
  });

  it("shows the chart section (kind + source pickers) for a chart", () => {
    const comp = makeComponent({ kind: "chart", id: "c", sourceQueryId: "" });
    const { getByTestId } = render(
      <CanvasPropertiesPane tabId={TAB} component={comp} onChange={vi.fn()} />,
    );
    expect(getByTestId("chart-kind-select")).toBeTruthy();
    expect(getByTestId("chart-source-select")).toBeTruthy();
  });
});
