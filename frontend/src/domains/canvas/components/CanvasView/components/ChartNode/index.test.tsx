import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";

vi.mock("@domains/chart", async (importActual) => {
  const actual = await importActual<typeof import("@domains/chart")>();
  return { ...actual, ChartView: () => <div data-testid="chart-view" /> };
});

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
    useCanvasStore.getState().setRun(TAB, "q", {
      result: {
        columns: [
          { name: "event_type", type_hint: "text" },
          { name: "amount", type_hint: "int" },
        ],
        rows: [],
        elapsed: 0,
      },
      totalRows: 1000,
    });
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

  it("drops a stale axis column the source no longer has instead of querying it", async () => {
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
        // "amount" is not a column of the (re-pointed) source result below.
        spec: { kind: "bar", xColumn: "event_type", yColumns: ["amount"], aggregation: "sum" },
      }),
    );
    useCanvasStore.getState().setRun(TAB, "q", {
      result: {
        columns: [
          { name: "event_type", type_hint: "text" },
          { name: "duration_ms", type_hint: "int" },
        ],
        rows: [],
        elapsed: 0,
      },
      totalRows: 1000,
    });
    render(
      <ReactFlowProvider>
        <ChartNode {...nodeProps("c")} />
      </ReactFlowProvider>,
    );
    // No SQL is built for the missing column, so no cache query fires...
    await waitFor(() => {
      const chart = useCanvasStore
        .getState()
        .boards[TAB].doc.components.find((c) => c.id === "c");
      expect(chart?.kind === "chart" && chart.spec.yColumns).toEqual([]);
    });
    expect(queryCanvasCacheIPC).not.toHaveBeenCalled();
  });

  it("defaults the top-bar title to the bound query's name", () => {
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
        spec: { kind: "bar", xColumn: "x", yColumns: ["y"] },
      }),
    );
    render(
      <ReactFlowProvider>
        <ChartNode {...nodeProps("c")} />
      </ReactFlowProvider>,
    );
    expect(screen.getByText("Sales")).toBeTruthy();
  });

  it("shows the source run error in the bottom status bar", () => {
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
        spec: { kind: "bar", xColumn: "x", yColumns: ["y"] },
      }),
    );
    useCanvasStore
      .getState()
      .setRun(TAB, "q", { error: "query engine error: No field named device" });
    render(
      <ReactFlowProvider>
        <ChartNode {...nodeProps("c")} />
      </ReactFlowProvider>,
    );
    expect(screen.getByTestId("chart-node-error").textContent).toContain("No field named device");
  });

  it("shows a sample-size and refresh status once the source has run", async () => {
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
        maxRows: 250,
        spec: { kind: "bar", xColumn: "event_type", yColumns: [] },
      }),
    );
    useCanvasStore.getState().setRun(TAB, "q", {
      result: { columns: [{ name: "event_type", type_hint: "text" }], rows: [], elapsed: 0 },
      totalRows: 1000,
      endedAt: 1_700_000_000_000,
    });
    render(
      <ReactFlowProvider>
        <ChartNode {...nodeProps("c")} />
      </ReactFlowProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("chart-node-status").textContent).toContain("up to 250 rows sampled"),
    );
  });

  it("waits for the source's full result to settle before querying the cache", async () => {
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
        spec: { kind: "bar", xColumn: "event_type", yColumns: ["amount"], aggregation: "sum" },
      }),
    );
    const result = {
      columns: [
        { name: "event_type", type_hint: "text" },
        { name: "amount", type_hint: "int" },
      ],
      rows: [],
      elapsed: 0,
    };
    // Early page: the first page is in, but the full result has not drained yet
    // (no totalRows), so the cell's table is not registered.
    useCanvasStore.getState().setRun(TAB, "q", { result, running: true });
    render(
      <ReactFlowProvider>
        <ChartNode {...nodeProps("c")} />
      </ReactFlowProvider>,
    );
    expect(queryCanvasCacheIPC).not.toHaveBeenCalled();

    // The drain completes: totals land and the table becomes queryable.
    act(() => {
      useCanvasStore.getState().setRun(TAB, "q", { result, totalRows: 1000, running: false });
    });
    await waitFor(() => expect(queryCanvasCacheIPC).toHaveBeenCalled());
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
