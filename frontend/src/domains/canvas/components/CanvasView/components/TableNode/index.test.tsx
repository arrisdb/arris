import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";
import type { QueryResult } from "@shared";

vi.mock("../../../../ipc", () => ({
  fetchCanvasCellPageIPC: vi.fn(() => Promise.resolve(null)),
  queryCanvasCacheIPC: vi.fn(),
  runCanvasCellIPC: vi.fn(),
  cancelCanvasCellIPC: vi.fn(),
}));

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
import { fetchCanvasCellPageIPC } from "../../../../ipc";
import type { CanvasNodeData } from "../../types";
import { TableNode } from "./index";

const TAB = "tab-1";

const RESULT: QueryResult = {
  columns: [
    { name: "month", type: "text" },
    { name: "total", type: "number" },
  ],
  rows: [
    [
      { kind: "text", value: "Jan" },
      { kind: "int", value: 10 },
    ],
  ],
} as unknown as QueryResult;

const manyRows = (n: number): QueryResult =>
  ({
    columns: [{ name: "n", type: "number" }],
    rows: Array.from({ length: n }, (_, i) => [{ kind: "int", value: i }]),
  }) as unknown as QueryResult;

const nodeProps = (id: string) =>
  ({ id, data: { tabId: TAB }, selected: false }) as unknown as NodeProps<CanvasNodeData>;

function renderNode(id: string) {
  return render(
    <ReactFlowProvider>
      <TableNode {...nodeProps(id)} />
    </ReactFlowProvider>,
  );
}

describe("TableNode", () => {
  beforeEach(() => {
    vi.mocked(fetchCanvasCellPageIPC).mockClear();
    useCanvasStore.setState({ boards: {} });
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "table", id: "tbl", sourceQueryId: "q" }));
  });

  it("renders the source query's result rows", () => {
    useCanvasStore.getState().setRun(TAB, "q", { result: RESULT });
    renderNode("tbl");
    expect(screen.getByText("month")).toBeTruthy();
    expect(screen.getByText("total")).toBeTruthy();
    expect(screen.getByText("Jan")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
  });

  it("prompts to run the source query when it has no result yet", () => {
    renderNode("tbl");
    expect(screen.getByText(/Run the source query/)).toBeTruthy();
  });

  it("surfaces the source query's error", () => {
    useCanvasStore.getState().setRun(TAB, "q", { error: "boom" });
    renderNode("tbl");
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("caps the rendered rows at the table's previewRows", () => {
    useCanvasStore.setState({ boards: {} });
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "table", id: "tbl", sourceQueryId: "q", previewRows: 2 }));
    useCanvasStore.getState().setRun(TAB, "q", { result: manyRows(5) });
    renderNode("tbl");
    // Header row + 2 capped body rows = 3 <tr>.
    expect(document.querySelectorAll(".mdbc-canvas-result-table tr").length).toBe(3);
  });

  it("prompts to pick a source when the table is unbound", () => {
    useCanvasStore.setState({ boards: {} });
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore.getState().addComponent(TAB, makeComponent({ kind: "table", id: "tbl" }));
    renderNode("tbl");
    expect(screen.getByText(/Pick a source query/)).toBeTruthy();
  });

  it("pages through the full cached result from the backend", async () => {
    useCanvasStore.setState({ boards: {} });
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "query", id: "q", title: "Sales" }));
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "table", id: "tbl", sourceQueryId: "q", previewRows: 2 }));
    // Page held 2 rows; the full result has 5.
    useCanvasStore.getState().setRun(TAB, "q", { result: manyRows(2), totalRows: 5 });
    vi.mocked(fetchCanvasCellPageIPC).mockResolvedValueOnce(manyRows(2));
    renderNode("tbl");

    // Pager reports the first page against the full total.
    expect(screen.getByText("1-2 of 5")).toBeTruthy();

    fireEvent.click(screen.getByText("Next"));
    await waitFor(() =>
      expect(fetchCanvasCellPageIPC).toHaveBeenCalledWith(TAB, "sales", 2, 2),
    );
  });

  it("shows no pager when the whole result fits one page", () => {
    useCanvasStore.getState().setRun(TAB, "q", { result: RESULT, totalRows: 1 });
    renderNode("tbl");
    expect(screen.queryByText("Next")).toBeNull();
  });
});
