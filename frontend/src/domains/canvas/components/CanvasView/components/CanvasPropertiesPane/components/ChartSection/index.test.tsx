import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { QueryResult } from "@shared";

import { useCanvasStore } from "../../../../../../hooks";
import { makeComponent } from "../../../../../../utils";
import { ChartSection } from "./index";

const TAB = "t";
const chart = makeComponent({ kind: "chart", id: "ch", sourceQueryId: "q1" });

const RESULT: QueryResult = {
  columns: [
    { name: "month", type: "text" },
    { name: "total", type: "number" },
  ],
  rows: [["Jan", 10]],
} as unknown as QueryResult;

describe("ChartSection", () => {
  beforeEach(() => {
    useCanvasStore.setState({ boards: {} });
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "query", id: "q1", title: "Orders", connectionId: null }));
  });

  it("writes the chart kind through the shared editor's type grid", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <ChartSection tabId={TAB} component={chart} onChange={onChange} />,
    );
    fireEvent.click(getByTestId("chart-editor-kind-line"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ spec: expect.objectContaining({ kind: "line" }) }),
    );
  });

  it("offers the board's query objects as the source", () => {
    const onChange = vi.fn();
    const { getByTestId, getByRole } = render(
      <ChartSection tabId={TAB} component={chart} onChange={onChange} />,
    );
    fireEvent.click(getByTestId("chart-source-select"));
    fireEvent.click(getByRole("option", { name: "Orders" }));
    expect(onChange).toHaveBeenCalledWith({ sourceQueryId: "q1" });
  });

  it("exposes the bound query's columns to the X-axis picker after a run", () => {
    useCanvasStore.setState((s) => ({
      boards: {
        ...s.boards,
        [TAB]: { ...s.boards[TAB], runs: { q1: { result: RESULT } } },
      },
    }));
    const onChange = vi.fn();
    const { getByTestId, getAllByText } = render(
      <ChartSection tabId={TAB} component={chart} onChange={onChange} />,
    );
    fireEvent.click(getByTestId("chart-editor-x-axis"));
    // The column appears in the menu (and possibly the trigger), so allow many.
    expect(getAllByText("month").length).toBeGreaterThan(0);
  });

  it("edits the object title through the shared Title field, peeled off the spec", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <ChartSection tabId={TAB} component={chart} onChange={onChange} />,
    );
    fireEvent.change(getByTestId("chart-editor-title"), { target: { value: "Sales" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Sales" }),
    );
    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall.spec.title).toBeUndefined();
  });

  it("renders nothing for a non-chart object", () => {
    const other = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const { container } = render(
      <ChartSection tabId={TAB} component={other} onChange={vi.fn()} />,
    );
    expect(container.querySelector(".mdbc-pane-form")).toBeNull();
  });
});
