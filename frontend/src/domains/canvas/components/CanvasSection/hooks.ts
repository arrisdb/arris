import { useCallback, useEffect, useMemo, useState } from "react";

import { ipcErrorMessage } from "@shared";
import { currentProject, subscribe } from "@shared/api";
import { useSnackbarStore } from "@shell/hooks/snackbarStore";
import { useTabsStore } from "@shell/hooks/tabsStore";

import { CANVAS_CHANGED_EVENT } from "../../constants";
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

  // Each listing also closes tabs of canvases deleted elsewhere (e.g. by the CLI).
  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
      const listed = await listCanvasesIPC();
      setCanvases(listed);
      const ids = new Set(listed.map((c) => c.id));
      const tabs = useTabsStore.getState();
      for (const tab of tabs.tabs) {
        if (tab.tabType === "canvas" && !ids.has(tab.id)) tabs.deleteTab(tab.id);
      }
    } catch (e) {
      useSnackbarStore.getState().enqueue(ipcErrorMessage(e), "error");
    }
  }, []);

  useEffect(() => {
    void run(async () => {});
  }, [run, canvasTabKey]);

  // The CLI adds and deletes canvases too; re-list when one changes.
  useEffect(() => {
    return subscribe((event) => {
      if (event.project !== currentProject() || event.kind !== CANVAS_CHANGED_EVENT) return;
      void run(async () => {});
    });
  }, [run]);

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
