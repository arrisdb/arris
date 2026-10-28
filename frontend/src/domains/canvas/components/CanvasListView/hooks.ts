import { useCallback, useEffect, useState } from "react";

import { currentProject, subscribe } from "@shared/api";

import { CANVAS_CHANGED_EVENT, DEFAULT_CANVAS_TITLE, NEW_CANVAS_PROMPT } from "../../constants";
import { createCanvasIPC, deleteCanvasIPC, listCanvasesIPC, renameCanvasIPC } from "../../ipc";
import type { CanvasSummary } from "../../types";
import { RENAME_PROMPT, deleteConfirm } from "./constants";

/// The project's canvases, kept fresh by `canvas_changed`, plus list actions.
function useCanvasList(onOpenCanvas: (id: string) => void) {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCanvases(await listCanvasesIPC());
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribe((event) => {
      if (event.kind === CANVAS_CHANGED_EVENT && event.project === currentProject()) void load();
    });
  }, [load]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await load();
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    },
    [load],
  );

  const create = useCallback(() => {
    const title = window.prompt(NEW_CANVAS_PROMPT, DEFAULT_CANVAS_TITLE)?.trim();
    if (!title) return;
    void run(async () => onOpenCanvas((await createCanvasIPC(title)).id));
  }, [onOpenCanvas, run]);

  const rename = useCallback(
    (canvas: CanvasSummary) => {
      const title = window.prompt(RENAME_PROMPT, canvas.title)?.trim();
      if (!title || title === canvas.title) return;
      void run(() => renameCanvasIPC(canvas.id, title));
    },
    [run],
  );

  const remove = useCallback(
    (canvas: CanvasSummary) => {
      if (!window.confirm(deleteConfirm(canvas.title))) return;
      void run(() => deleteCanvasIPC(canvas.id));
    },
    [run],
  );

  return { canvases, error, create, rename, remove };
}

export { useCanvasList };
