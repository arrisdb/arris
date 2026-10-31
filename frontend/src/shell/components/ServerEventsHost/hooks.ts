import { useEffect } from "react";
import { currentProject, subscribe } from "@shared/api";
import { useConnectionsStore } from "@domains/connection/hooks";
import { listConnectionsIPC } from "@domains/connection/components/CombinedConnectionsTree/ipc";
import type { RunRecord } from "@domains/history";
import { usePinnedQueriesStore } from "@domains/pinnedQueries";
import { appendServerRun, loadSelectedRunResult, useRunHistoryStore } from "@domains/results/hooks";

// Keeps pins, connections and the run log current when the CLI or another tab changes them.
function useServerEvents(): void {
  useEffect(() => {
    void usePinnedQueriesStore.getState().hydrate().catch(() => {});
    loadSelectedRunResult();
    const stopFollowing = useRunHistoryStore.subscribe((state, previous) => {
      if (state.selectedRunId !== previous.selectedRunId) loadSelectedRunResult();
    });
    const stopListening = subscribe((event) => {
      if (event.project !== currentProject()) return;
      if (event.kind === "history_changed") appendServerRun(event.payload as RunRecord);
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
