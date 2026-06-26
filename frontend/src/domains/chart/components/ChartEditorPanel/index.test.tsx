import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChartEditorPanel } from "./index";
import { useChartEditorStore } from "../../hooks/store";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { ChartSpec } from "@shared";
import type { EditorTab } from "@shell/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(undefined),
}));
import { useRunHistoryStore } from "@domains/results";

const RESULT = {
  columns: [
    { name: "day", type_hint: "text" },
    { name: "count", type_hint: "int" },
  ],
  rows: [
    [{ kind: "text", value: "Mon" }, { kind: "int", value: 10 }],
  ],
  elapsed: 0,
};

function reset() {
  useChartEditorStore.setState({ targetTabId: null });
  useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
  useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined } as never);
}

function setupTab(chart?: ChartSpec) {
  const tab: EditorTab = {
    id: "t1",
    title: "Console 1",
    text: "SELECT day, count FROM t",
    kind: "sql",
    cursor: 0,
    tabType: "console",
    chart,
  };
  useTabsStore.setState({
    tabs: [tab],
    layout: { kind: "leaf", id: "g1", tabIds: ["t1"], selectedTabId: "t1" },
    focusedPaneGroupId: "g1",
    activeId: "t1",
  });
  useRunHistoryStore.setState({
    runsByTab: {
      t1: [
        {
          id: "r1",
          seq: 1,
          tabId: "t1",
          tabTitle: "Console 1",
          status: "success",
          sqlSnapshot: "SELECT day, count FROM t",
          startedAt: 1,
          result: RESULT,
        },
      ],
    },
    selectedRunId: "r1",
  } as never);
  useChartEditorStore.getState().open("t1");
}

const BAR_SPEC: ChartSpec = { kind: "bar", xColumn: "day", yColumns: ["count"], title: "Revenue" };

describe("ChartEditorPanel", () => {
  beforeEach(reset);

  it("renders nothing when no editor target", () => {
    const { container } = render(<ChartEditorPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("renders panel with Chart header", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    expect(screen.getByText("Chart")).toBeTruthy();
    expect(screen.getByTestId("chart-editor-panel")).toBeTruthy();
  });

  it("populates form fields from the tab's chart spec", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    const titleInput = screen.getByTestId("chart-editor-title") as HTMLInputElement;
    expect(titleInput.value).toBe("Revenue");
  });

  it("title change updates the tab chart immediately", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    fireEvent.change(screen.getByTestId("chart-editor-title"), { target: { value: "New" } });
    expect(useTabsStore.getState().tabs[0].chart?.title).toBe("New");
  });

  it("chart type change updates the tab chart immediately", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    fireEvent.click(screen.getByTestId("chart-editor-kind-line"));
    expect(useTabsStore.getState().tabs[0].chart?.kind).toBe("line");
  });

  it("uses standard pane header classes", () => {
    setupTab(BAR_SPEC);
    const { container } = render(<ChartEditorPanel />);
    expect(container.querySelector(".mdbc-pane-header")).toBeTruthy();
    expect(container.querySelector(".mdbc-pane-title")).toBeTruthy();
    expect(screen.queryByTestId("chart-editor-close")).toBeNull();
  });

  it("reset restores the default spec", () => {
    setupTab({ kind: "line", xColumn: "day", yColumns: ["count"], title: "Custom" });
    render(<ChartEditorPanel />);
    fireEvent.click(screen.getByTestId("chart-editor-reset"));
    expect(useTabsStore.getState().tabs[0].chart?.kind).toBeUndefined();
    expect(useTabsStore.getState().tabs[0].chart?.yColumns).toEqual([]);
    expect(useTabsStore.getState().tabs[0].chart?.title).toBeUndefined();
  });

  it("reset button uses the standard mdbc-btn styling, not ghost", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    const reset = screen.getByTestId("chart-editor-reset");
    expect(reset.className).toContain("mdbc-btn");
    expect(reset.className).not.toContain("ghost");
  });

  it("wraps each section in a mdbc-chart-section separator container", () => {
    setupTab(BAR_SPEC);
    const { container } = render(<ChartEditorPanel />);
    // Data + Axes + Appearance + Extras for a bar chart.
    expect(container.querySelectorAll(".mdbc-chart-section").length).toBe(4);
  });

  it("renders all 13 chart type buttons", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    const kinds = ["bar","line","area","pie","scatter","bubble","combo","histogram","donut","radar","treemap","funnel","kpi"];
    for (const k of kinds) {
      expect(screen.getByTestId(`chart-editor-kind-${k}`)).toBeTruthy();
    }
  });

  it("selecting scatter shows z-column select", () => {
    setupTab({ kind: "scatter", xColumn: "day", yColumns: ["count"] });
    render(<ChartEditorPanel />);
    expect(screen.getByTestId("chart-editor-z-axis")).toBeTruthy();
  });

  it("pie hides axes section", () => {
    setupTab({ kind: "pie", xColumn: "day", yColumns: ["count"] });
    render(<ChartEditorPanel />);
    expect(screen.queryByTestId("chart-section-axes")).toBeNull();
  });

  it("bar shows axes section", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    expect(screen.getByTestId("chart-section-axes")).toBeTruthy();
  });

  it("uses mdbc-pane-form class in sections", () => {
    setupTab(BAR_SPEC);
    const { container } = render(<ChartEditorPanel />);
    expect(container.querySelector(".mdbc-pane-form")).toBeTruthy();
    expect(container.querySelector(".mdbc-pane-input")).toBeTruthy();
    expect(container.querySelector(".mdbc-select")).toBeTruthy();
    expect(container.querySelector(".mdbc-section-head")).toBeTruthy();
  });

  it("chart type grid uses responsive class", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    const btn = screen.getByTestId("chart-editor-kind-bar");
    const grid = btn.parentElement!;
    expect(grid.className).toContain("mdbc-grid-options");
  });

  it("no save or cancel buttons exist", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    expect(screen.queryByTestId("chart-editor-save")).toBeNull();
    expect(screen.queryByTestId("chart-editor-cancel")).toBeNull();
  });

  it("bar shows the series (split by) select", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    expect(screen.getByTestId("chart-editor-series")).toBeTruthy();
  });

  it("pie hides the series select", () => {
    setupTab({ kind: "pie", xColumn: "day", yColumns: ["count"] });
    render(<ChartEditorPanel />);
    expect(screen.queryByTestId("chart-editor-series")).toBeNull();
  });

  it("setting a series column swaps the multi-select for a single measure picker", () => {
    setupTab({ kind: "line", xColumn: "day", yColumns: ["count"], seriesColumn: "day" });
    render(<ChartEditorPanel />);
    expect(screen.getByTestId("chart-editor-measure")).toBeTruthy();
    expect(screen.queryByTestId("chart-editor-y-axis")).toBeNull();
  });

  it("combo hides the series select (series-split unsupported)", () => {
    setupTab({ kind: "combo", xColumn: "day", yColumns: ["count"] });
    render(<ChartEditorPanel />);
    expect(screen.queryByTestId("chart-editor-series")).toBeNull();
  });

  it("series colors list the category values, not the measure, when split is active", () => {
    setupTab({ kind: "line", xColumn: "day", yColumns: ["count"], seriesColumn: "day" });
    render(<ChartEditorPanel />);
    fireEvent.click(screen.getByTestId("chart-section-appearance"));
    // Category value "Mon" gets a color row; the measure "count" does not.
    expect(screen.getByText("Mon")).toBeTruthy();
  });

  it("bar shows the aggregation select", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    expect(screen.getByTestId("chart-editor-aggregation")).toBeTruthy();
  });

  it("scatter hides the aggregation select (plots raw points)", () => {
    setupTab({ kind: "scatter", xColumn: "day", yColumns: ["count"] });
    render(<ChartEditorPanel />);
    expect(screen.queryByTestId("chart-editor-aggregation")).toBeNull();
  });

  it("choosing an aggregation writes spec.aggregation", () => {
    setupTab(BAR_SPEC);
    render(<ChartEditorPanel />);
    fireEvent.click(screen.getByTestId("chart-editor-aggregation"));
    fireEvent.click(screen.getByRole("option", { name: "Sum" }));
    expect(useTabsStore.getState().tabs[0].chart?.aggregation).toBe("sum");
  });

  it("choosing None clears spec.aggregation", () => {
    setupTab({ ...BAR_SPEC, aggregation: "sum" });
    render(<ChartEditorPanel />);
    fireEvent.click(screen.getByTestId("chart-editor-aggregation"));
    // role="option" disambiguates from the Sort section's "None" toggle button.
    fireEvent.click(screen.getByRole("option", { name: "None" }));
    expect(useTabsStore.getState().tabs[0].chart?.aggregation).toBeUndefined();
  });
});
