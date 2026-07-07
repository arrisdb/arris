import { ipcErrorMessage } from "@shared";
import {
  NOTIFIED_TASK_ID_PREFIX,
  SNACKBAR_MESSAGE_SEPARATOR,
  TASK_LABEL_RUNNING_SUFFIX,
} from "../constants";
import { useBackgroundTasksStore } from "../hooks/backgroundTasksStore";
import { useSnackbarStore } from "../hooks/snackbarStore";
import type { NotifiedTaskResult } from "../types";

let nextTaskId = 0;

/// Status-bar spinner while running, outcome snackbar when done. Never
/// rejects; callers branch on `ok`.
async function runNotifiedTask(
  label: string,
  task: () => Promise<string>,
): Promise<NotifiedTaskResult> {
  nextTaskId += 1;
  const id = `${NOTIFIED_TASK_ID_PREFIX}${nextTaskId}`;
  useBackgroundTasksStore.getState().startTask(id, `${label}${TASK_LABEL_RUNNING_SUFFIX}`);
  try {
    const message = await task();
    useSnackbarStore
      .getState()
      .enqueue(`${label}${SNACKBAR_MESSAGE_SEPARATOR}${message}`, "success");
    return { ok: true, message };
  } catch (error) {
    const message = ipcErrorMessage(error);
    useSnackbarStore
      .getState()
      .enqueue(`${label}${SNACKBAR_MESSAGE_SEPARATOR}${message}`, "error");
    return { ok: false, message };
  } finally {
    useBackgroundTasksStore.getState().endTask(id);
  }
}

export {
  runNotifiedTask,
};
