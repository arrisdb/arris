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

// Keep the real results components; stub only the file-picking/writing helpers.
vi.mock("@domains/results", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@domains/results")>()),
  pickExportPath: vi.fn(() => Promise.resolve("/tmp/results.out")),
  writeExport: vi.fn(),
}));

// Deterministic virtualizer: render every visible row (jsdom has no layout).
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        index: i,
        start: i * 24,
        end: (i + 1) * 24,
        key: i,
      })),
    getTotalSize: () => opts.count * 24,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

import { pickExportPath, writeExport } from "@domains/results";

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
import { fetchCanvasCellPageIPC } from "../../../../ipc";
import { DOWNLOAD_CHUNK_ROWS } from "./constants";
import type { CanvasNodeData } from "../../types";
import { TableNode } from "./index";

const TAB = "tab-1";

const RESULT: QueryResult = {
  columns: [
    { name: "month", type_hint: "text" },
    { name: "total", type_hint: "int" },
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
    columns: [{ name: "n", type_hint: "int" }],
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

function seedBound(extra: Record<string, unknown> = {}) {
  useCanvasStore.setState({ boards: {} });
  useCanvasStore.getState().ensureBoard(TAB, "");
  useCanvasStore
    .getState()
    .addComponent(TAB, makeComponent({ kind: "query", id: "q", title: "Sales" }));
  useCanvasStore
    .getState()
    .addComponent(TAB, makeComponent({ kind: "table", id: "tbl", sourceQueryId: "q", ...extra }));
}

describe("TableNode", () => {
  beforeEach(() => {
    vi.mocked(fetchCanvasCellPageIPC).mockClear();
    seedBound();
  });

  it("renders the source query's result rows in the reused grid", () => {
    useCanvasStore.getState().setRun(TAB, "q", { result: RESULT, totalRows: 1 });
    const { container } = renderNode("tbl");
    expect(container.querySelector(".mdbc-table")).toBeTruthy();
    expect(screen.getByText("month")).toBeTruthy();
    expect(screen.getByText("total")).toBeTruthy();
    expect(screen.getByText("Jan")).toBeTruthy();
  });

  it("prompts to run the source query when it has no result yet", () => {
    renderNode("tbl");
    expect(screen.getByText(/Run the source query/)).toBeTruthy();
  });

  it("prompts to pick a source when the table is unbound", () => {
    useCanvasStore.setState({ boards: {} });
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore.getState().addComponent(TAB, makeComponent({ kind: "table", id: "tbl" }));
    renderNode("tbl");
    expect(screen.getByText(/Pick a source query/)).toBeTruthy();
  });

  it("surfaces the source query's error", () => {
    useCanvasStore.getState().setRun(TAB, "q", { error: "boom" });
    renderNode("tbl");
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("caps the rendered rows at the table's previewRows", () => {
    seedBound({ previewRows: 2 });
    useCanvasStore.getState().setRun(TAB, "q", { result: manyRows(5), totalRows: 5 });
    renderNode("tbl");
    expect(document.querySelectorAll(".mdbc-table td.rownum").length).toBe(2);
  });

  it("shows a footer with the total rows, columns, page and refresh timestamp", () => {
    seedBound({ previewRows: 2 });
    const endedAt = new Date(2026, 6, 12, 23, 17, 34).getTime();
    useCanvasStore.getState().setRun(TAB, "q", { result: manyRows(2), totalRows: 5, endedAt });
    renderNode("tbl");
    expect(screen.getByText(/Page 1 · 2 of 5 rows · 1 column · 2026-07-12 23:17:34/)).toBeTruthy();
  });

  it("pages through the full cached result from the backend", async () => {
    seedBound({ previewRows: 2 });
    useCanvasStore.getState().setRun(TAB, "q", { result: manyRows(2), totalRows: 5 });
    vi.mocked(fetchCanvasCellPageIPC).mockResolvedValueOnce(manyRows(2));
    renderNode("tbl");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(fetchCanvasCellPageIPC).toHaveBeenCalledWith(TAB, "sales", 2, 2),
    );
  });

  it("disables paging when the whole result fits one page", () => {
    useCanvasStore.getState().setRun(TAB, "q", { result: RESULT, totalRows: 1 });
    renderNode("tbl");
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a spinner and no data while the source is streaming", () => {
    seedBound({ previewRows: 2 });
    // Early page landed, but the run is still streaming: no partial grid is shown.
    useCanvasStore.getState().setRun(TAB, "q", { result: manyRows(3), running: true });
    renderNode("tbl");
    expect(screen.getByText("Running…")).toBeTruthy();
    // Spinning database icon, matching the results viewer's running state.
    expect(document.querySelector(".mdbc-canvas-table-running .mdbc-spin")).toBeTruthy();
    expect(document.querySelector(".mdbc-table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });

  it("shows the bound query name as the cell header", () => {
    useCanvasStore.getState().setRun(TAB, "q", { result: RESULT, totalRows: 1 });
    renderNode("tbl");
    expect(screen.getByText("Sales")).toBeTruthy();
  });

  it("shows a cancellable download progress status and disables the download button", async () => {
    vi.mocked(writeExport).mockClear();
    seedBound({ previewRows: 2 });
    useCanvasStore.getState().setRun(TAB, "q", { result: manyRows(2), totalRows: 5 });
    let resolveFetch: (r: QueryResult) => void = () => {};
    vi.mocked(fetchCanvasCellPageIPC).mockReturnValueOnce(
      new Promise<QueryResult>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderNode("tbl");

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    fireEvent.click(screen.getByTestId("table-export-csv"));

    // A chunk fetch is in flight: progress status shown, download disabled.
    expect(await screen.findByText(/Downloading… \d+%/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(true);

    // Cancelling clears the status and skips the file write even once the fetch lands.
    fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));
    expect(screen.queryByText(/Downloading/)).toBeNull();
    resolveFetch(manyRows(5));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(vi.mocked(writeExport)).not.toHaveBeenCalled();
  });

  it("refreshes by re-running the source query", () => {
    const run = vi.fn();
    useCanvasStore.getState().setRun(TAB, "q", { result: RESULT, totalRows: 1 });
    useCanvasStore.setState({ runQueryComponent: run } as never);
    renderNode("tbl");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(run).toHaveBeenCalledWith(TAB, "q");
  });

  it("toggles the in-view search bar", () => {
    useCanvasStore.getState().setRun(TAB, "q", { result: RESULT, totalRows: 1 });
    renderNode("tbl");
    expect(screen.queryByTestId("results-search-bar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Find in results" }));
    expect(screen.getByTestId("results-search-bar")).toBeTruthy();
  });

  it("toggles the JSON row-detail pane", () => {
    useCanvasStore.getState().setRun(TAB, "q", { result: RESULT, totalRows: 1 });
    renderNode("tbl");
    expect(screen.queryByText(/Select a row to inspect/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "JSON detail" }));
    expect(screen.getByText(/Select a row to inspect/)).toBeTruthy();
  });

  it("downloads every row in chunks after picking the destination first", async () => {
    vi.mocked(writeExport).mockClear();
    vi.mocked(pickExportPath).mockClear();
    seedBound({ previewRows: 2 });
    // The page holds 2 rows; the full cached result has 5.
    useCanvasStore.getState().setRun(TAB, "q", { result: manyRows(2), totalRows: 5 });
    vi.mocked(fetchCanvasCellPageIPC).mockResolvedValueOnce(manyRows(5));
    renderNode("tbl");

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    fireEvent.click(screen.getByTestId("table-export-csv"));

    // Destination picked before any fetch, then the full result is paged in.
    await waitFor(() => expect(vi.mocked(pickExportPath)).toHaveBeenCalled());
    await waitFor(() =>
      expect(fetchCanvasCellPageIPC).toHaveBeenCalledWith(TAB, "sales", 0, DOWNLOAD_CHUNK_ROWS),
    );
    await waitFor(() => expect(vi.mocked(writeExport)).toHaveBeenCalled());
    expect(vi.mocked(writeExport).mock.calls[0][2]).toHaveLength(5);
  });
});
