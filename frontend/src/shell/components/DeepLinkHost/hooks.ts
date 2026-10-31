import { useEffect } from "react";
import { getCanvasIPC } from "@domains/canvas/ipc";
import { openServerRun, useRunHistoryStore } from "@domains/results/hooks";
import { useSettingsStore } from "@shared/settings";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useRoute } from "../../utils";

async function showRun(runId: string): Promise<void> {
  const connectionId = await openServerRun(runId);
  const tabs = useTabsStore.getState();
  if (tabs.tabs.length === 0) tabs.addTab({ connectionId });
  useSettingsStore.getState().showBottomPane();
  useRunHistoryStore.getState().setRequestedPaneMode("results");
}

// Links from the CLI and skill open as tabs. The URL stays, so a reload reopens the same view.
function useDeepLink(): void {
  const route = useRoute();
  const path = window.location.pathname;

  useEffect(() => {
    if (route.kind === "run") void showRun(route.runId).catch(() => {});
    if (route.kind === "canvas") {
      getCanvasIPC(route.canvasId)
        .then(({ id, title }) => useTabsStore.getState().openCanvasTab({ id, title }))
        .catch(() => {});
    }
    if ("tool" in route) useTabsStore.getState().openAnalyticsTab(route.tool, path);
    // The route object is rebuilt each render; the path is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
}

export { useDeepLink };
