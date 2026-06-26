import { useEffect } from "react";
import { useSettingsStore } from "@shared/settings";
import { useTabsStore } from "../../hooks/tabsStore";
import { useChartEditorStore } from "@domains/chart/hooks";
import { applyEditorFontFamily } from "@shared/ui/utils/editorFont";
import { applyUiFontFamily } from "@shared/ui/utils/uiFont";

export function useContentViewState() {
  const uiFontSize = useSettingsStore((s) => s.uiFontSize);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const uiFontFamily = useSettingsStore((s) => s.uiFontFamily);
  const leftVisible = useSettingsStore((s) => s.sidebarLeftVisible);
  const rightVisible = useSettingsStore((s) => s.sidebarRightVisible);
  const activeTabType = useTabsStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeId);
    return tab?.tabType;
  });
  const bottomPaneVisible = useSettingsStore((s) => s.bottomPaneVisible);
  const chartEditorOpen = useChartEditorStore((s) => s.targetTabId !== null);

  useEffect(() => {
    const el = document.documentElement;
    el.style.setProperty("--m-fs-base", `${uiFontSize}px`);
    return () => {
      el.style.removeProperty("--m-fs-base");
    };
  }, [uiFontSize]);

  useEffect(() => {
    applyEditorFontFamily(editorFontFamily);
  }, [editorFontFamily]);

  useEffect(() => {
    applyUiFontFamily(uiFontFamily);
  }, [uiFontFamily]);

  const isTerminalTab = activeTabType === "terminal";
  // Git content tabs and table/terminal tabs own the full center pane, so the
  // chart editor (which docks into the editor area) stays hidden on them.
  const isGitFullPaneTab =
    activeTabType === "gitdiff" ||
    activeTabType === "githistory" ||
    activeTabType === "gitconflict";
  const isTableTab = activeTabType === "table";
  const isFullPaneTab = isTerminalTab || isGitFullPaneTab || isTableTab;
  const showChartEditor = chartEditorOpen && !isFullPaneTab;
  // The Command Logs / Results pane is global: always available (footer + pane),
  // independent of the active tab type or whether any tab is open. Only the
  // bottom-pane visibility toggle controls whether the pane is expanded. Opening
  // a table tab leaves that toggle untouched (its run never pokes the pane), so
  // the pane stays exactly as the user left it.
  const resultsInPanel = bottomPaneVisible;

  return {
    leftVisible,
    rightVisible,
    showChartEditor,
    resultsInPanel,
  };
}
