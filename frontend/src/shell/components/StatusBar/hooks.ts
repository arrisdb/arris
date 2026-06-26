import { useResultsTableStore } from "@domains/results/hooks";
import { usePinnedQueriesStore } from "@domains/pinnedQueries/hooks";
import { useSettingsStore, type KeymapAction } from "@shared/settings";
import { runCommand, shortcutDisplay } from "@shell/utils";
import { useAgentStore } from "@domains/agent/hooks";
import { useBackgroundTasksStore } from "../../hooks/backgroundTasksStore";
import { useChartEditorStore } from "@domains/chart/hooks";
import { useTabsStore } from "../../hooks/tabsStore";
import type { SidebarMetaTab } from "@shared";
import { LEFT_RAIL_ITEMS } from "./constants";
import type { StatusBarViewModel } from "./types";

function useStatusBar(): StatusBarViewModel {
  const tab = useSettingsStore((state) => state.sidebarLeftTab);
  const leftVisible = useSettingsStore((state) => state.sidebarLeftVisible);
  const rightVisible = useSettingsStore((state) => state.sidebarRightVisible);
  const setTab = useSettingsStore((state) => state.setSidebarLeftTab);
  const shortcuts = useSettingsStore((state) => state.shortcuts);
  const bgTasks = useBackgroundTasksStore((state) => state.tasks);
  const agentPanelOpen = useAgentStore((state) => state.paneOpen);
  const pinnedQueriesOpen = usePinnedQueriesStore((state) => state.paneOpen);
  const chartEditorTabId = useChartEditorStore((state) => state.targetTabId);
  const activeId = useTabsStore((state) => state.activeId);
  const openGitDiffTab = useTabsStore((state) => state.openGitDiffTab);
  const activeResultsMode = useResultsTableStore((state) =>
    activeId ? state.modeByTab[activeId] : undefined,
  );

  const bgLabel = bgTasks.size > 0 ? bgTasks.values().next().value ?? null : null;
  const chartEditorOpen = chartEditorTabId !== null;
  // The chart button only acts on a query result that is *currently shown as a
  // chart*, it edits that chart. So it is enabled iff the active tab's results
  // pane is in Chart view (or the editor is already open, so it can be closed);
  // otherwise it stays visible but disabled.
  const canChart = activeResultsMode === "chart" || chartEditorOpen;
  const connectionsOpen =
    rightVisible && !chartEditorOpen && !pinnedQueriesOpen && !agentPanelOpen;

  function key(action: KeymapAction): string | undefined {
    return shortcutDisplay(shortcuts[action]) ?? undefined;
  }

  // Every right-rail button routes through the command registry, the same
  // handler the keyboard shortcut runs. Each toggle command closes the other
  // right panes (including the agent panel), so switching panes always works.
  function onClickAgentPanel() {
    runCommand("showAgentPanel");
  }

  function onClickChartEditor() {
    runCommand("showChartEditor");
  }

  function onClickConnections() {
    runCommand("showConnections");
  }

  function onClickPinnedQueries() {
    runCommand("showPinnedQueries");
  }

  function onClickLeftRail(nextTab: SidebarMetaTab) {
    // Entering Git view opens (or refocuses) the shared "Uncommitted Changes"
    // tab in the center, but not when the click is just toggling the pane off.
    const togglingOff = nextTab === tab && leftVisible;
    if (nextTab === "git" && !togglingOff) openGitDiffTab();
    setTab(nextTab);
  }

  return {
    agentPanelOpen,
    bgLabel,
    canChart,
    chartEditorOpen,
    connectionsOpen,
    key,
    leftRailItems: LEFT_RAIL_ITEMS,
    leftVisible,
    onClickAgentPanel,
    onClickChartEditor,
    onClickConnections,
    onClickLeftRail,
    onClickPinnedQueries,
    pinnedQueriesOpen,
    tab,
  };
}

export {
  useStatusBar,
};
