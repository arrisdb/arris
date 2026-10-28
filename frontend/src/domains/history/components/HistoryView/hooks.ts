import { useEffect, useState } from "react";
import { ipcErrorMessage } from "@shared";
import { currentProject, subscribe } from "@shared/api";
import { HISTORY_CHANGED_EVENT, HISTORY_VIEW_LIMIT } from "./constants";
import { listHistoryIPC } from "./ipc";
import type { RunRecord } from "./types";

// Loads recent runs and reloads them when the server says this project's history changed.
function useHistory(): { runs: RunRecord[]; error: string | null } {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Only the newest request may write, so a slow earlier response cannot clobber it.
    let latest = 0;
    let cancelled = false;
    const load = () => {
      const request = ++latest;
      return listHistoryIPC(HISTORY_VIEW_LIMIT)
        .then((rows) => {
          if (cancelled || request !== latest) return;
          setError(null);
          setRuns(rows);
        })
        .catch((loadError) => {
          if (!cancelled && request === latest) setError(ipcErrorMessage(loadError));
        });
    };
    void load();
    const unsubscribe = subscribe((event) => {
      if (event.kind === HISTORY_CHANGED_EVENT && event.project === currentProject())
        void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { runs, error };
}

export { useHistory };
