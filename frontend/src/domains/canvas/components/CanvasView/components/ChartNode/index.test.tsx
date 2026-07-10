import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";

vi.mock("@domains/chart", () => ({
  ChartView: () => <div data-testid="chart-view" />,
}));

vi.mock("../../../../ipc", () => ({
  queryCanvasCacheIPC: vi.fn(() => Promise.resolve({ columns: [], rows: [], elapsed: 0 })),
  fetchCanvasCellPageIPC: vi.fn(),
  runCanvasCellIPC: vi.fn(),
  cancelCanvasCellIPC: vi.fn(),
}));

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
import { queryCanvasCacheIPC } from "../../../../ipc";
import type { CanvasNodeData } from "../../types";
import { ChartNode } from "./index";

const TAB = "tab-1";

const nodeProps = (id: string) =>
  ({ id, data: { tabId: TAB }, selected: false }) as unknown as NodeProps<CanvasNodeData>;

describe("ChartNode", () => {
  beforeEach(() => {
    vi.mocked(queryCanvasCacheIPC).mockClear();
    useCanvasStore.setState({ boards: {} });
  });

  it("renders the chart view for its bound source", () => {
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore.getState().addComponent(
      TAB,
      makeComponent({
        kind: "chart",
        id: "c",
        sourceQueryId: "q",
        spec: { kind: "bar", xColumn: "x", yColumns: ["y"] },
      }),
    );
    useCanvasStore.getState().setRun(TAB, "q", { result: { columns: [], rows: [], elapsed: 0 } });
    render(
      <ReactFlowProvider>
        <ChartNode {...nodeProps("c")} />
      </ReactFlowProvider>,
    );
    expect(screen.getByTestId("chart-view")).toBeTruthy();
  });

  it("aggregates over the source cell's full cached result, not the page", async () => {
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "query", id: "q", title: "Sales" }));
    useCanvasStore.getState().addComponent(
      TAB,
      makeComponent({
        kind: "chart",
        id: "c",
        sourceQueryId: "q",
        spec: { kind: "bar", xColumn: "event_type", yColumns: ["amount"], aggregation: "count" },
      }),
    );
    useCanvasStore
      .getState()
      .setRun(TAB, "q", { result: { columns: [], rows: [], elapsed: 0 }, totalRows: 1000 });
    render(
      <ReactFlowProvider>
        <ChartNode {...nodeProps("c")} />
      </ReactFlowProvider>,
    );
    await waitFor(() => expect(queryCanvasCacheIPC).toHaveBeenCalled());
    const [board, sql] = vi.mocked(queryCanvasCacheIPC).mock.calls[0];
    expect(board).toBe(TAB);
    expect(sql).toContain('GROUP BY "event_type"');
    expect(sql).toContain('COUNT("amount")');
    expect(sql).toContain("FROM sales");
  });

  it("does not query when the source has not produced a result", () => {
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "query", id: "q", title: "Sales" }));
    useCanvasStore.getState().addComponent(
      TAB,
      makeComponent({
        kind: "chart",
        id: "c",
        sourceQueryId: "q",
        spec: { kind: "bar", xColumn: "x", yColumns: ["y"], aggregation: "sum" },
      }),
    );
    render(
      <ReactFlowProvider>
        <ChartNode {...nodeProps("c")} />
      </ReactFlowProvider>,
    );
    expect(queryCanvasCacheIPC).not.toHaveBeenCalled();
  });
});
