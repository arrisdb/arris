import { useCallback, useState } from "react";

import { ipcErrorMessage } from "@shared";

import { DEFAULT_CANVAS_TITLE, NEW_CANVAS_PROMPT } from "../../constants";
import { addRunToCanvasIPC, createCanvasIPC, listCanvasesIPC } from "../../ipc";
import type { CanvasSummary } from "../../types";

/// Canvas picker state: the list loads when the menu opens.
function useSendToCanvas(runId: string, onSent: (canvasId: string) => void) {
  const [canvases, setCanvases] = useState<CanvasSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guarded = useCallback(async (action: () => Promise<void>) => {
    setPending(true);
    try {
      await action();
      setError(null);
    } catch (failure) {
      setError(ipcErrorMessage(failure));
    } finally {
      setPending(false);
    }
  }, []);

  const toggle = useCallback(() => {
    if (open) return setOpen(false);
    setOpen(true);
    setCanvases(null);
    void guarded(async () => setCanvases(await listCanvasesIPC()));
  }, [guarded, open]);

  const sendTo = useCallback(
    (canvasId: string) =>
      guarded(async () => {
        await addRunToCanvasIPC(canvasId, runId);
        setOpen(false);
        onSent(canvasId);
      }),
    [guarded, onSent, runId],
  );

  const sendToNew = useCallback(() => {
    const title = window.prompt(NEW_CANVAS_PROMPT, DEFAULT_CANVAS_TITLE)?.trim();
    if (!title) return;
    void guarded(async () => {
      const { id } = await createCanvasIPC(title);
      await addRunToCanvasIPC(id, runId);
      setOpen(false);
      onSent(id);
    });
  }, [guarded, onSent, runId]);

  return { canvases, open, pending, error, toggle, sendTo, sendToNew };
}

export { useSendToCanvas };
