import { useCallback, useEffect, useState } from "react";
import { ipcErrorMessage } from "@shared";
import { currentProject, subscribe } from "@shared/api";
import { TOOL_RUNS_CHANGED_EVENT } from "../../constants";
import { toolRunGetIPC, toolRunListIPC } from "../../ipc";
import type { AnalyticsTool, ToolRunMeta, ToolRunRecord } from "../../types";

/// The tool's run list and the open run, both reloaded on `tool_runs_changed` for this project.
function useToolRuns(tool: AnalyticsTool, runId: string | null) {
  const [runs, setRuns] = useState<ToolRunMeta[]>([]);
  const [run, setRun] = useState<ToolRunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await toolRunListIPC(tool));
      setRun(runId ? await toolRunGetIPC(runId) : null);
      setError(null);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, [tool, runId]);

  useEffect(() => {
    void load();
    return subscribe((event) => {
      if (event.kind === TOOL_RUNS_CHANGED_EVENT && event.project === currentProject()) void load();
    });
  }, [load]);

  return { runs, run, error };
}

export { useToolRuns };
