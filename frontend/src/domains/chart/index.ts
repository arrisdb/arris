import { registerPane } from "@shared";
import { useChartEditorStore } from "./hooks/store";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { ChartEditorPanel } from "./components/ChartEditorPanel";
import { ChartView } from "./components/ChartView";
import { defaultChartSpec, exportChartPng, reconcileChartSpec } from "./components/ChartView/utils";

// The chart editor only applies to a center editor tab (a query/notebook), not
// to a terminal or git-diff tab, so it yields the rail back to the connections
// pane in those cases.
function useChartPaneActive(): boolean {
  const chartOpen = useChartEditorStore((state) => state.targetTabId !== null);
  const activeTabType = useTabsStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeId);
    return tab?.tabType;
  });
  const isCenterTab = activeTabType !== "terminal" && activeTabType !== "gitdiff";
  return chartOpen && isCenterTab;
}

function registerChartPane(): void {
  registerPane({
    id: "chart",
    side: "right",
    kind: "primary",
    priority: 20,
    useActive: useChartPaneActive,
    Component: ChartEditorPanel,
  });
}

export {
  ChartEditorPanel,
  ChartView,
  defaultChartSpec,
  exportChartPng,
  reconcileChartSpec,
  registerChartPane,
};
