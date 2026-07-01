import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import type { NodeProps } from "reactflow";

vi.mock("@domains/chart", () => ({
  ChartView: () => <div data-testid="chart-view" />,
}));

import { useCanvasStore } from "../../../../hooks";
import { makeComponent } from "../../../../utils";
import type { CanvasNodeData } from "../../types";
import { ChartNode } from "./index";

const TAB = "tab-1";

const nodeProps = (id: string) =>
  ({ id, data: { tabId: TAB }, selected: false }) as unknown as NodeProps<CanvasNodeData>;

describe("ChartNode", () => {
  beforeEach(() => useCanvasStore.setState({ boards: {} }));

  it("renders the chart view bound to its source query's result", () => {
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
});
