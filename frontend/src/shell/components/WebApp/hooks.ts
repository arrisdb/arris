import { useCallback, useEffect, useState } from "react";
import { ANALYTICS_TOOLS, modelsIPC } from "@domains/analytics";
import type { AnalyticsTool } from "@domains/analytics";
import { ipcErrorMessage } from "@shared";
import { apiCall, currentProject, subscribe } from "@shared/api";
import { useConnectionsStore } from "@domains/connection/hooks";
import { listConnectionsIPC } from "@domains/connection/components/CombinedConnectionsTree/ipc";
import { usePinnedQueriesStore } from "@domains/pinnedQueries";
import type { PinnedQuery } from "@domains/pinnedQueries";
import type { RunRecord } from "@domains/history";
import { navigate, runPath } from "../../utils";
import { CONNECTIONS_CHANGED_EVENT, PIN_RUN_SOURCE, PINS_CHANGED_EVENT } from "./constants";

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

/// Loads the project's pins, shared with the desktop app, and reloads them on change.
function usePins(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const load = () => void usePinnedQueriesStore.getState().hydrate();
    load();
    return subscribe((event) => {
      if (event.kind === PINS_CHANGED_EVENT && event.project === currentProject()) load();
    });
  }, [enabled]);
}

/// Opening a pin runs it and shows the run, since the browser has no editor tabs.
function useOpenPin(): { openPin: (query: PinnedQuery) => void; pinError: string | null } {
  const [pinError, setPinError] = useState<string | null>(null);
  const openPin = useCallback((query: PinnedQuery) => {
    setPinError(null);
    apiCall<{ run: RunRecord }>("query_run", {
      connection: query.connectionId,
      sql: query.text,
      source: PIN_RUN_SOURCE,
    })
      .then(({ run }) => navigate(runPath(run.id)))
      .catch((error) => setPinError(ipcErrorMessage(error)));
  }, []);
  return { openPin, pinError };
}

export { useAnalyticsTools, useConnectionList, useOpenPin, usePins };
