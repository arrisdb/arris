import { invoke } from "@tauri-apps/api/core";

import type { Completion, CreatedVenv, PythonInterpreter } from "./types";

// The notebook reuses the Python console's kernel commands verbatim, keyed by
// the notebook tab id in place of a console id, plus the file write command for
// saving the `.ipynb`.

function listInterpretersIPC(): Promise<PythonInterpreter[]> {
  return invoke("cmd_python_list_interpreters");
}

function addInterpreterIPC(python: string): Promise<PythonInterpreter> {
  return invoke("cmd_python_add_interpreter", { python });
}

function createVenvIPC(basePython: string, dest: string): Promise<CreatedVenv> {
  return invoke("cmd_python_create_venv", { basePython, dest });
}

function ensureKernelIPC(python: string): Promise<boolean> {
  return invoke("cmd_python_ensure_kernel", { python });
}

function startKernelIPC(notebookId: string, python: string): Promise<void> {
  return invoke("cmd_python_start_kernel", { consoleId: notebookId, python });
}

function executeIPC(notebookId: string, code: string): Promise<string> {
  return invoke("cmd_python_execute", { consoleId: notebookId, code });
}

/// Run a SQL cell: execute `sql` against `connectionId`, bind the result into
/// the notebook's kernel as the pandas DataFrame `varName`, and return the
/// kernel `execute_request` id so output routes back to the cell.
function runSqlCellIPC(
  notebookId: string,
  connectionId: string,
  sql: string,
  varName: string,
): Promise<string> {
  return invoke("cmd_notebook_run_sql", {
    consoleId: notebookId,
    connectionId,
    sql,
    varName,
  });
}

function completeIPC(notebookId: string, code: string, cursorPos: number): Promise<Completion> {
  return invoke("cmd_python_complete", { consoleId: notebookId, code, cursorPos });
}

function interruptIPC(notebookId: string): Promise<void> {
  return invoke("cmd_python_interrupt", { consoleId: notebookId });
}

function shutdownIPC(notebookId: string): Promise<void> {
  return invoke("cmd_python_shutdown", { consoleId: notebookId });
}

function writeNotebookFileIPC(path: string, content: string): Promise<void> {
  return invoke("cmd_write_text_file", { path, content });
}

export {
  addInterpreterIPC,
  completeIPC,
  createVenvIPC,
  ensureKernelIPC,
  executeIPC,
  interruptIPC,
  listInterpretersIPC,
  runSqlCellIPC,
  shutdownIPC,
  startKernelIPC,
  writeNotebookFileIPC,
};
