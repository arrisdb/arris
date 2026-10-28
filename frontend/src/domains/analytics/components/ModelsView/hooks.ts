import { useEffect, useMemo, useState } from "react";
import { ipcErrorMessage } from "@shared";
import { modelsIPC } from "../../ipc";
import type { AnalyticsTool, ModelSummary } from "../../types";
import { filterModels } from "./utils";

/// The tool's models (summaries only) and the filtered view of them.
function useModels(tool: AnalyticsTool) {
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    setModels(null);
    modelsIPC(tool)
      .then((res) => live && (setModels(res.models), setError(null)))
      .catch((e) => live && setError(ipcErrorMessage(e)));
    return () => {
      live = false;
    };
  }, [tool]);

  const visible = useMemo(() => filterModels(models ?? [], query), [models, query]);
  return { loading: models === null && !error, error, query, setQuery, visible };
}

export { useModels };
