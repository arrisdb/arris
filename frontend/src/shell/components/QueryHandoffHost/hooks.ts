import { useEffect } from "react";
import { subscribe } from "@shared/api";
import { useSettingsStore } from "@shared/settings";
import { useRunHistoryStore } from "@domains/results/hooks/runHistoryStore";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";
import { HANDOFF_PAGE_SIZE, HANDOFF_SQL_SEPARATOR, HANDOFF_TAB_TITLE } from "./constants";
import { fetchRunPageIPC, takeQueryHandoffsIPC } from "./ipc";
import type { QueryHandoff, QueryTarget } from "./types";

/// The connection's shared Claude console, focused, or a new tab when asked for one.
function handoffTab(connectionId: string, newTab: boolean): EditorTab {
  const tabs = useTabsStore.getState();
  const shared = newTab
    ? undefined
    : tabs.tabs.find(
        (t) =>
          t.tabType === "console" &&
          t.title === HANDOFF_TAB_TITLE &&
          t.connectionId === connectionId,
      );
  if (!shared) return tabs.addTab({ connectionId, title: newTab ? undefined : HANDOFF_TAB_TITLE });
  tabs.focusTab(shared.id);
  return shared;
}

// Reads ran on the server, so the tab shows that result rather than running again.
async function openQuery({ connectionId, sql, runId, newTab }: QueryTarget): Promise<void> {
  const tab = handoffTab(connectionId, newTab);
  const text = tab.text ? `${tab.text}${HANDOFF_SQL_SEPARATOR}${sql}` : sql;
  useTabsStore.getState().updateTab(tab.id, { text, cursor: text.length - sql.length });
  if (!runId) return;
  const result = await fetchRunPageIPC(runId, 0, HANDOFF_PAGE_SIZE);
  const history = useRunHistoryStore.getState();
  const startedAt = Date.now();
  history.appendRun(tab.id, { id: runId, sqlSnapshot: sql, status: "pending", startedAt, connectionId });
  history.patchRun(tab.id, runId, { status: "success", result, endedAt: Date.now() });
  useTabsStore.getState().updateTab(tab.id, { result, pane: "results" });
  useSettingsStore.getState().showBottomPane();
  history.setRequestedPaneMode("results");
}

async function openHandoff(handoff: QueryHandoff): Promise<void> {
  if (handoff.kind === "canvas") {
    useTabsStore.getState().openCanvasTab({ id: handoff.canvasId, title: handoff.title });
    return;
  }
  await openQuery(handoff);
}

function useQueryHandoffs(): void {
  useEffect(() => {
    const pull = () => {
      takeQueryHandoffsIPC()
        .then((handoffs) => Promise.all(handoffs.map(openHandoff)))
        .catch(() => {});
    };
    pull();
    return subscribe((event) => {
      if (event.kind === "query_open_requested") pull();
    });
  }, []);
}

export { useQueryHandoffs };
