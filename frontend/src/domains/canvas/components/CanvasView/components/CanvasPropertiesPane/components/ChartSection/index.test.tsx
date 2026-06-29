import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { useCanvasStore } from "../../../../../../hooks";
import { makeComponent } from "../../../../../../utils";
import { ChartSection } from "./index";

const TAB = "t";
const chart = makeComponent({ kind: "chart", id: "ch", sourceQueryId: "" });

describe("ChartSection", () => {
  beforeEach(() => {
    useCanvasStore.setState({ boards: {} });
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "query", id: "q1", title: "Orders", connectionId: null }));
  });

  it("writes the chart kind", () => {
    const onChange = vi.fn();
    const { getByTestId, getByText } = render(
      <ChartSection tabId={TAB} component={chart} onChange={onChange} />,
    );
    fireEvent.click(getByTestId("chart-kind-select"));
    fireEvent.click(getByText("Line"));
    expect(onChange).toHaveBeenCalledWith({
      spec: { kind: "line", xColumn: "", yColumns: [] },
    });
  });

  it("offers the board's query objects as the source", () => {
    const onChange = vi.fn();
    const { getByTestId, getByText } = render(
      <ChartSection tabId={TAB} component={chart} onChange={onChange} />,
    );
    fireEvent.click(getByTestId("chart-source-select"));
    fireEvent.click(getByText("Orders"));
    expect(onChange).toHaveBeenCalledWith({ sourceQueryId: "q1" });
  });

  it("renders nothing for a non-chart object", () => {
    const other = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const { container } = render(
      <ChartSection tabId={TAB} component={other} onChange={vi.fn()} />,
    );
    expect(container.querySelector(".mdbc-pane-form")).toBeNull();
  });
});
