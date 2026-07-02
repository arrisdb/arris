import { useResultsTableStore, useRunHistoryStore } from "../../../../hooks";
import { type ResultsPaneMode } from "../../../../types";
import { Icon } from "@shared/ui/Icon";
import { useSettingsStore } from "@shared/settings";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useRequestedPaneMode } from "../../hooks";
import { selectGlobalRun } from "../../../RunHistoryChips/utils";

function ResultsFooterBar({ global: isGlobal = false }: { global?: boolean } = {}) {
  const activeId = useTabsStore((state) => state.activeId);
  // The global footer is detached from the active tab: it follows the globally
  // selected run's source tab (for the Plan label) and toggles a single global
  // pane mode, so Command Logs ⇄ Results stays consistent across every tab.
  const globalRunTabId = useRunHistoryStore((s) => (isGlobal ? selectGlobalRun(s)?.tabId ?? null : null));
  const resolvedTabId = isGlobal ? globalRunTabId : activeId;
  // Primitive selectors only: the tab OBJECT's identity changes on every
  // keystroke (updateTab rebuilds it), and this footer is always mounted, so
  // subscribing to the object re-rendered it per key. Existence and `pane`
  // are stable primitives across text edits.
  const tabExists = useTabsStore((state) =>
    resolvedTabId != null && state.tabs.some((item) => item.id === resolvedTabId),
  );
  const tabPane = useTabsStore((state) =>
    resolvedTabId != null
      ? state.tabs.find((item) => item.id === resolvedTabId)?.pane
      : undefined,
  );
  const bottomPaneVisible = useSettingsStore((state) => state.bottomPaneVisible);
  const toggleBottomPane = useSettingsStore((state) => state.toggleBottomPaneVisible);
  const tabId = tabExists ? resolvedTabId : null;
  const paneMode = useResultsTableStore((state) =>
    isGlobal ? state.globalMode : tabId ? state.modeByTab[tabId] ?? "results" : "results",
  );
  const setModeByTab = useResultsTableStore((state) => state.setMode);
  const setGlobalMode = useResultsTableStore((state) => state.setGlobalMode);
  const requestedPaneMode = useRunHistoryStore((state) => state.requestedPaneMode);
  const setRequestedPaneMode = useRunHistoryStore((state) => state.setRequestedPaneMode);

  const applyMode = (mode: ResultsPaneMode) => {
    if (isGlobal) setGlobalMode(mode);
    else if (tabId) setModeByTab(tabId, mode);
  };

  const handleFooterTab = (mode: ResultsPaneMode) => {
    if (mode === paneMode && bottomPaneVisible) {
      toggleBottomPane();
    } else {
      applyMode(mode);
      if (!bottomPaneVisible) toggleBottomPane();
    }
  };

  useRequestedPaneMode({
    tabId: isGlobal ? "global" : tabId,
    requestedPaneMode,
    bottomPaneVisible,
    setMode: isGlobal ? (_id, mode) => setGlobalMode(mode) : setModeByTab,
    setRequestedPaneMode,
    toggleBottomPane,
  });

  return (
    <div className="mdbc-results-footer" data-testid="results-footer">
      <button
        className={`mdbc-results-footer-tab${paneMode === "output" && bottomPaneVisible ? " active" : ""}`}
        onClick={() => handleFooterTab("output")}
        data-testid="footer-output-tab"
      >
        <Icon name="terminal" size={11} />
        Command Logs
      </button>
      <button
        className={`mdbc-results-footer-tab${paneMode === "results" && bottomPaneVisible ? " active" : ""}`}
        onClick={() => handleFooterTab("results")}
        data-testid="footer-results-tab"
      >
        <Icon name="table" size={11} />
        {tabPane === "plan" ? "Plan" : "Results"}
      </button>
    </div>
  );
}

export { ResultsFooterBar };
