import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";
import type { QueryResult } from "@shared";

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
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
    const manyRows: QueryResult = {
      columns: [{ name: "n", type: "number" }],
      rows: Array.from({ length: 5 }, (_, i) => [{ kind: "int", value: i }]),
    } as unknown as QueryResult;
    useCanvasStore.setState({ boards: {} });
    useCanvasStore.getState().ensureBoard(TAB, "");
    useCanvasStore
      .getState()
      .addComponent(TAB, makeComponent({ kind: "table", id: "tbl", sourceQueryId: "q", previewRows: 2 }));
    useCanvasStore.getState().setRun(TAB, "q", { result: manyRows });
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
});
