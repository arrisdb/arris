import { useEffect } from "react";
import { currentProject, isWebShell, subscribe } from "@shared/api";
import { useConnectionsStore } from "@domains/connection/hooks";
import { listConnectionsIPC } from "@domains/connection/components/CombinedConnectionsTree/ipc";
import type { RunRecord } from "@domains/results/types";
import { usePinnedQueriesStore } from "@domains/pinnedQueries";
import { appendServerRun, loadSelectedRunResult, useRunHistoryStore } from "@domains/results/hooks";

// Keeps pins, connections and the run log current when the CLI or another tab changes them.
// The desktop keeps its own run log, so only the browser follows server runs.
function useServerEvents(): void {
  useEffect(() => {
    const web = isWebShell();
    void usePinnedQueriesStore.getState().hydrate().catch(() => {});
    if (web) loadSelectedRunResult();
    const stopFollowing = useRunHistoryStore.subscribe((state, previous) => {
      if (web && state.selectedRunId !== previous.selectedRunId) loadSelectedRunResult();
    });
    const stopListening = subscribe((event) => {
      if (event.project !== currentProject()) return;
      if (web && event.kind === "history_changed") appendServerRun(event.payload as RunRecord);
      if (event.kind === "pins_changed") {
        void usePinnedQueriesStore.getState().hydrate().catch(() => {});
      }
      if (event.kind === "connections_changed") {
        listConnectionsIPC()
          .then((rows) => useConnectionsStore.getState().setConnections(rows))
          .catch(() => {});
      }
    });
    return () => {
      stopFollowing();
      stopListening();
    };
  }, []);
}

export { useServerEvents };
