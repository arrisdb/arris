import { useCallback, useEffect, useMemo, useState } from "react";

import { ipcErrorMessage } from "@shared";
import { useSnackbarStore } from "@shell/hooks/snackbarStore";
import { useTabsStore } from "@shell/hooks/tabsStore";

import { createAndOpenCanvas } from "../../hooks";
import { deleteCanvasIPC, listCanvasesIPC, renameCanvasIPC } from "../../ipc";
import type { CanvasSummary } from "../../types";

/// The project's stored canvases plus the section's actions. Reloads whenever the
/// set of open canvas tabs changes, so a canvas created elsewhere shows up.
function useCanvasSummaries() {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const allTabs = useTabsStore((s) => s.tabs);
  const canvasTabKey = useMemo(
    () => allTabs.filter((t) => t.tabType === "canvas").map((t) => t.id).join(","),
    [allTabs],
  );

  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
      setCanvases(await listCanvasesIPC());
    } catch (e) {
      useSnackbarStore.getState().enqueue(ipcErrorMessage(e), "error");
    }
  }, []);

  useEffect(() => {
    void run(async () => {});
  }, [run, canvasTabKey]);

  const open = useCallback(
    (canvas: CanvasSummary) => useTabsStore.getState().openCanvasTab(canvas),
    [],
  );

  const rename = useCallback(
    (id: string, title: string) =>
      run(async () => {
        await renameCanvasIPC(id, title);
        const tabs = useTabsStore.getState();
        if (tabs.tabs.some((t) => t.id === id)) tabs.updateTab(id, { title });
      }),
    [run],
  );

  const remove = useCallback(
    (id: string) =>
      run(async () => {
        await deleteCanvasIPC(id);
        const tabs = useTabsStore.getState();
        if (tabs.tabs.some((t) => t.id === id)) tabs.deleteTab(id);
      }),
    [run],
  );

  const create = useCallback(() => run(() => createAndOpenCanvas()), [run]);

  return { canvases, open, rename, remove, create };
}

export { useCanvasSummaries };
