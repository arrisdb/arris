import { useEffect, useState } from "react";
import { ANALYTICS_TOOLS, modelsIPC } from "@domains/analytics";
import type { AnalyticsTool } from "@domains/analytics";
import { ipcErrorMessage } from "@shared";
import { currentProject, subscribe } from "@shared/api";
import { useConnectionsStore } from "@domains/connection/hooks";
import { listConnectionsIPC } from "@domains/connection/components/CombinedConnectionsTree/ipc";
import { CONNECTIONS_CHANGED_EVENT } from "./constants";

// Loads the project's connections and reloads them when the server says this project's changed.
function useConnectionList(enabled: boolean): string | null {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const load = () =>
      listConnectionsIPC()
        .then((rows) => {
          setError(null);
          useConnectionsStore.getState().setConnections(rows);
        })
        .catch((loadError) => {
          setError(ipcErrorMessage(loadError));
          // Settle the loaded flag so consumers stop showing a loading label.
          const { connections, setConnections } = useConnectionsStore.getState();
          setConnections(connections);
        });
    void load();
    return subscribe((event) => {
      if (
        event.kind === CONNECTIONS_CHANGED_EVENT &&
        event.project === currentProject()
      )
        void load();
    });
  }, [enabled]);

  return error;
}

/// The tools whose project scan succeeds here; the sidebar links only those.
function useAnalyticsTools(project: string | null): AnalyticsTool[] {
  const [tools, setTools] = useState<AnalyticsTool[]>([]);

  useEffect(() => {
    let live = true;
    setTools([]);
    if (project === null) return;
    void Promise.all(
      ANALYTICS_TOOLS.map((tool) =>
        modelsIPC(tool).then(
          () => tool,
          () => null,
        ),
      ),
    ).then((found) => live && setTools(found.filter((t): t is AnalyticsTool => t !== null)));
    return () => {
      live = false;
    };
  }, [project]);

  return tools;
}

export { useAnalyticsTools, useConnectionList };
