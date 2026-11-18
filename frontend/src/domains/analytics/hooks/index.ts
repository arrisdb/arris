import { useEffect, useState } from "react";
import { ANALYTICS_TOOLS } from "../constants";
import { modelsIPC } from "../ipc";
import type { AnalyticsTool } from "../types";

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

export { useAnalyticsTools };
