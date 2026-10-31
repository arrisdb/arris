import { useEffect } from "react";
import { currentProject, subscribe } from "@shared/api";
import { useConnectionsStore } from "@domains/connection/hooks";
import { listConnectionsIPC } from "@domains/connection/components/CombinedConnectionsTree/ipc";
import { usePinnedQueriesStore } from "@domains/pinnedQueries";

// Keeps pins and connections current when the CLI or another tab changes them.
function useServerEvents(): void {
  useEffect(() => {
    void usePinnedQueriesStore.getState().hydrate().catch(() => {});
    return subscribe((event) => {
      if (event.project !== currentProject()) return;
      if (event.kind === "pins_changed") {
        void usePinnedQueriesStore.getState().hydrate().catch(() => {});
      }
      if (event.kind === "connections_changed") {
        listConnectionsIPC()
          .then((rows) => useConnectionsStore.getState().setConnections(rows))
          .catch(() => {});
      }
    });
  }, []);
}

export { useServerEvents };
