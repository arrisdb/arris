import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { useSettingsStore } from "@shared/settings";
import { useNotebookStore } from "../../hooks/store";
import type { EditorTab } from "@shell/types";
import type { KernelOutput, NotebookCell, NotebookState } from "../../types";

import {
  addInterpreterIPC,
  completeIPC,
  createVenvIPC,
  ensureKernelIPC,
  executeIPC,
  interruptIPC,
  listInterpretersIPC,
  runSqlCellIPC,
  startKernelIPC,
  writeNotebookFileIPC,
} from "./ipc";
import { parseNotebook, serializeNotebook } from "./utils/nbformat";
import type { Completion, PythonInterpreter } from "./types";
import { errToString } from "./utils";

const EMPTY: NotebookState = {
  status: "none",
  interpreter: null,
  cells: [],
  metadata: {},
  nbformatMinor: 5,
  execCount: 0,
  dirty: false,
  pending: {},
};

// One process-wide listener routes kernel output into the notebook store keyed
// by the notebook tab id, mirroring the Python console. Torn down on HMR dispose
// so hot updates don't stack duplicate listeners.
let listenerReady = false;
let unlisten: (() => void) | null = null;
let disposed = false;

function ensureOutputListener() {
  if (listenerReady) return;
  listenerReady = true;
  void listen<{ consoleId: string; output: KernelOutput }>("python-output", (event) => {
    const { consoleId, output } = event.payload;
    useNotebookStore.getState().appendOutput(consoleId, output);
  }).then((un) => {
    if (disposed) un();
    else unlisten = un;
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  });
}

/// Send one executable cell to the kernel and return its `execute_request` id.
/// Python cells run their source directly; SQL cells run their query against the
/// chosen connection and bind the result as a pandas DataFrame. Throws a
/// readable error when a SQL cell is missing its connection or variable name.
function dispatchCellIPC(notebookId: string, cell: NotebookCell): Promise<string> {
  if (cell.cellType === "sql") {
    const connectionId = cell.sqlConnectionId;
    const varName = (cell.sqlVarName ?? "").trim();
    if (!connectionId) throw new Error("Pick a connection for this SQL cell.");
    if (!varName) throw new Error("Enter a variable name for this SQL cell.");
    return runSqlCellIPC(notebookId, connectionId, cell.source, varName);
  }
  return executeIPC(notebookId, cell.source);
}

function useNotebook(tab: EditorTab) {
  const notebookId = tab.id;
  const filePath = tab.filePath ?? "";
  const state = useNotebookStore((s) => s.notebooks[notebookId]) ?? EMPTY;
  const ensureNotebook = useNotebookStore((s) => s.ensureNotebook);
  const loadNotebook = useNotebookStore((s) => s.loadNotebook);
  const setStatus = useNotebookStore((s) => s.setStatus);
  const setInterpreter = useNotebookStore((s) => s.setInterpreter);
  const beginRun = useNotebookStore((s) => s.beginRun);
  const resetRuns = useNotebookStore((s) => s.resetRuns);
  const markSaved = useNotebookStore((s) => s.markSaved);

  const [interpreters, setInterpreters] = useState<PythonInterpreter[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Parse the file into cells exactly once per tab, before any kernel attaches.
  useEffect(() => {
    ensureNotebook(notebookId);
    ensureOutputListener();
    const parsed = parseNotebook(tab.text ?? "");
    loadNotebook(notebookId, parsed);
    let active = true;
    listInterpretersIPC()
      .then((list) => {
        if (active) setInterpreters(list);
      })
      .catch((e) => setError(errToString(e)));
    return () => {
      active = false;
    };
    // Parse only on mount / when the backing file identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  // Ensure ipykernel is available, then launch the kernel. Returns whether the
  // kernel came up; marks the notebook dead with a readable reason otherwise.
  const startKernel = useCallback(
    async (python: string, kernelReady = false): Promise<boolean> => {
      setStatus(notebookId, "starting");
      try {
        if (!kernelReady) {
          const ready = await ensureKernelIPC(python);
          if (!ready) {
            setError("ipykernel is not available for this interpreter. Create a venv to install it.");
            setStatus(notebookId, "dead");
            return false;
          }
        }
        await startKernelIPC(notebookId, python);
        setStatus(notebookId, "idle");
        return true;
      } catch (e) {
        setError(errToString(e));
        setStatus(notebookId, "dead");
        return false;
      }
    },
    [notebookId, setStatus],
  );

  const onSelectInterpreter = useCallback(
    async (path: string, kernelReady = false) => {
      setError(null);
      setInterpreter(notebookId, path);
      resetRuns(notebookId);
      await startKernel(path, kernelReady);
    },
    [notebookId, resetRuns, setInterpreter, startKernel],
  );

  const onComplete = useCallback(
    (code: string, cursorPos: number): Promise<Completion> =>
      completeIPC(notebookId, code, cursorPos),
    [notebookId],
  );

  // Run one code cell: make sure a kernel is up, send the source, then mark the
  // cell running with the returned request id so its output routes back.
  const runCell = useCallback(
    async (cellId: string) => {
      const nb = useNotebookStore.getState().notebooks[notebookId];
      const cell = nb?.cells.find((c) => c.id === cellId);
      if (!cell || (cell.cellType !== "code" && cell.cellType !== "sql")) return;
      if (!cell.source.trim()) return;
      const python = nb?.interpreter;
      if (!python) {
        setError("Select an interpreter first to run Python and SQL cells.");
        return;
      }
      setError(null);
      if (nb.status === "none" || nb.status === "dead") {
        const ok = await startKernel(python);
        if (!ok) return;
      }
      try {
        const msgId = await dispatchCellIPC(notebookId, cell);
        beginRun(notebookId, cellId, msgId);
      } catch (e) {
        setError(errToString(e));
      }
    },
    [beginRun, notebookId, startKernel],
  );

  // Run every code cell top-to-bottom. The kernel processes requests serially,
  // so firing them in order preserves execution order; output routes by id.
  const runAll = useCallback(async () => {
    const nb = useNotebookStore.getState().notebooks[notebookId];
    if (!nb) return;
    const python = nb.interpreter;
    if (!python) {
      setError("Select a Python interpreter first.");
      return;
    }
    setError(null);
    if (nb.status === "none" || nb.status === "dead") {
      const ok = await startKernel(python);
      if (!ok) return;
    }
    for (const cell of nb.cells) {
      if ((cell.cellType !== "code" && cell.cellType !== "sql") || !cell.source.trim()) continue;
      try {
        const msgId = await dispatchCellIPC(notebookId, cell);
        beginRun(notebookId, cell.id, msgId);
      } catch (e) {
        setError(errToString(e));
        return;
      }
    }
  }, [beginRun, notebookId, startKernel]);

  const onInterrupt = useCallback(() => {
    interruptIPC(notebookId).catch((e) => setError(errToString(e)));
  }, [notebookId]);

  const onRestart = useCallback(async () => {
    const python = useNotebookStore.getState().notebooks[notebookId]?.interpreter;
    resetRuns(notebookId);
    if (python) await startKernel(python);
  }, [notebookId, resetRuns, startKernel]);

  // Serialize the live document back to nbformat and write it to disk.
  const onSave = useCallback(async (): Promise<boolean> => {
    const nb = useNotebookStore.getState().notebooks[notebookId];
    if (!nb || !filePath) return false;
    try {
      await writeNotebookFileIPC(filePath, serializeNotebook(nb));
      markSaved(notebookId);
      return true;
    } catch (e) {
      setError(errToString(e));
      return false;
    }
  }, [filePath, markSaved, notebookId]);

  // Build a venv from a base interpreter, then bind it. ipykernel is installed
  // during creation, so launch without a second probe.
  const onCreateVenv = useCallback(
    async (basePython: string, dest: string): Promise<boolean> => {
      setError(null);
      try {
        const created = await createVenvIPC(basePython, dest);
        setInterpreters((list) => [created.interpreter, ...list]);
        await onSelectInterpreter(created.interpreter.path, created.ipykernelReady);
        return true;
      } catch (e) {
        setError(errToString(e));
        return false;
      }
    },
    [onSelectInterpreter],
  );

  // Open a directory picker for the venv's parent folder; returns the chosen
  // absolute path, or null if the user cancelled.
  const onBrowseVenvDir = useCallback(async (): Promise<string | null> => {
    const picked = await openDialog({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  }, []);

  const onBrowseInterpreter = useCallback(async () => {
    setError(null);
    const picked = await openDialog({ directory: false, multiple: false });
    if (typeof picked !== "string") return;
    try {
      const interpreter = await addInterpreterIPC(picked);
      setInterpreters((list) =>
        list.some((i) => i.path === interpreter.path) ? list : [interpreter, ...list],
      );
      await onSelectInterpreter(interpreter.path);
    } catch (e) {
      setError(errToString(e));
    }
  }, [onSelectInterpreter]);

  // Autosave: when enabled, persist the notebook a short debounce after any
  // edit/run dirties it, mirroring the code editor's autosave. ⌘S (the global
  // saveFile command) covers the autosave-off case.
  const autosave = useSettingsStore((s) => s.autosave);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!autosave || !filePath || !state.dirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void onSave(), 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [autosave, filePath, state.dirty, state.cells, onSave]);

  return {
    state,
    interpreters,
    error,
    onSelectInterpreter,
    onComplete,
    runCell,
    runAll,
    onInterrupt,
    onRestart,
    onCreateVenv,
    onBrowseVenvDir,
    onBrowseInterpreter,
  };
}

export { useNotebook };
