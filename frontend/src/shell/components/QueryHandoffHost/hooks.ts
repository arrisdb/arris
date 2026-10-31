import { useEffect } from "react";
import { subscribe } from "@shared/api";
import { useSettingsStore } from "@shared/settings";
import { useRunHistoryStore } from "@domains/results/hooks/runHistoryStore";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { HANDOFF_PAGE_SIZE } from "./constants";
import { fetchRunPageIPC, takeQueryHandoffsIPC } from "./ipc";
import type { QueryHandoff } from "./types";

// Reads ran on the server, so the tab shows that result rather than running again.
async function openHandoff({ connectionId, sql, runId }: QueryHandoff): Promise<void> {
  const tabs = useTabsStore.getState();
  const tab = tabs.addTab({ connectionId });
  tabs.updateTab(tab.id, { text: sql });
  if (!runId) return;
  const result = await fetchRunPageIPC(runId, 0, HANDOFF_PAGE_SIZE);
  const history = useRunHistoryStore.getState();
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  history.appendRun(tab.id, { id, sqlSnapshot: sql, status: "pending", startedAt, connectionId });
  history.patchRun(tab.id, id, { status: "success", result, endedAt: Date.now() });
  useTabsStore.getState().updateTab(tab.id, { result, pane: "results" });
  useSettingsStore.getState().showBottomPane();
  history.setRequestedPaneMode("results");
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
