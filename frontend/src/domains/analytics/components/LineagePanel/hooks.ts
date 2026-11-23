import { useEffect, useMemo, useState } from "react";
import { ipcErrorMessage } from "@shared";
import { lineageIPC } from "../../ipc";
import type { AnalyticsTool, ColumnLineageGraph, LineageResponse, SelectedColumn } from "../../types";
import { toLineageNodes } from "./utils";

/// The model graph for `name`, plus the column path for `selected` when one is picked.
function useLineagePanel(tool: AnalyticsTool, name: string | null, selected: SelectedColumn | null) {
  const [graph, setGraph] = useState<LineageResponse["graph"] | null>(null);
  const [columns, setColumns] = useState<ColumnLineageGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    lineageIPC(tool, name)
      .then((res) => live && (setGraph(res.graph), setError(null)))
      .catch((e) => live && setError(ipcErrorMessage(e)));
    return () => {
      live = false;
    };
  }, [tool, name]);

  const modelId = selected?.modelId ?? null;
  const column = selected?.column ?? null;
  useEffect(() => {
    let live = true;
    setColumns(null);
    if (modelId === null || column === null) return;
    lineageIPC(tool, modelId, column)
      .then((res) => live && setColumns(res.columns ?? null))
      .catch((e) => live && setError(ipcErrorMessage(e)));
    return () => {
      live = false;
    };
  }, [tool, modelId, column]);

  const nodes = useMemo(
    () => (graph ? toLineageNodes(graph, name, columns) : []),
    [graph, name, columns],
  );
  return { nodes, edges: graph?.edges ?? [], error, loading: graph === null && !error };
}

export { useLineagePanel };
