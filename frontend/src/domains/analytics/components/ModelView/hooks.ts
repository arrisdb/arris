import { useCallback, useEffect, useState } from "react";
import { ipcErrorMessage } from "@shared";
import { modelIPC } from "../../ipc";
import type { AnalyticsTool, ModelDetail, SelectedColumn } from "../../types";
import type { SqlTab } from "./types";

/// One model's detail plus the SQL tab and the column whose lineage is traced.
function useModelView(tool: AnalyticsTool, name: string) {
  const [model, setModel] = useState<ModelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SqlTab>("raw");
  const [selected, setSelected] = useState<SelectedColumn | null>(null);

  useEffect(() => {
    let live = true;
    setModel(null);
    setSelected(null);
    modelIPC(tool, name)
      .then((res) => live && (setModel(res), setError(null)))
      .catch((e) => live && setError(ipcErrorMessage(e)));
    return () => {
      live = false;
    };
  }, [tool, name]);

  // A second click on the traced column clears it.
  const selectColumn = useCallback((modelId: string, column: string) => {
    setSelected((cur) =>
      cur?.modelId === modelId && cur.column === column ? null : { modelId, column },
    );
  }, []);

  return { model, error, tab, setTab, selected, selectColumn };
}

export { useModelView };
