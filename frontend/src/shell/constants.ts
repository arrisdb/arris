const TAB_SAVE_DEBOUNCE_MS = 400;
const PANE_LAYOUT_SAVE_DEBOUNCE_MS = 200;
const PROJECT_STORE_SAVE_DEBOUNCE_MS = 400;
const APP_FOCUS_REFRESH_DEBOUNCE_MS = 300;
// The Rust watcher already coalesces event bursts (~250ms); this short debounce
// collapses the few events that still arrive back-to-back into one refresh.
const FS_WATCH_REFRESH_DEBOUNCE_MS = 150;

// Recents list (left-sidebar empty state), persisted to localStorage.
const MAX_RECENTS = 8;
const RECENTS_STORAGE_KEY = "arris.recents";

// App-level notification service: status-bar spinner while a task runs, then a
// snackbar with the outcome. Success snackbars auto-dismiss; errors stay until
// closed. At most SNACKBAR_MAX_VISIBLE stack (oldest evicted first).
const SNACKBAR_AUTO_DISMISS_MS = 4000;
const SNACKBAR_MAX_VISIBLE = 3;
const SNACKBAR_ID_PREFIX = "snackbar-";
const SNACKBAR_MESSAGE_SEPARATOR = ": ";
const NOTIFIED_TASK_ID_PREFIX = "notified-task-";
const TASK_LABEL_RUNNING_SUFFIX = "…";

export {
  NOTIFIED_TASK_ID_PREFIX,
  SNACKBAR_AUTO_DISMISS_MS,
  SNACKBAR_ID_PREFIX,
  SNACKBAR_MAX_VISIBLE,
  SNACKBAR_MESSAGE_SEPARATOR,
  TASK_LABEL_RUNNING_SUFFIX,
  APP_FOCUS_REFRESH_DEBOUNCE_MS,
  FS_WATCH_REFRESH_DEBOUNCE_MS,
  MAX_RECENTS,
  PANE_LAYOUT_SAVE_DEBOUNCE_MS,
  PROJECT_STORE_SAVE_DEBOUNCE_MS,
  RECENTS_STORAGE_KEY,
  TAB_SAVE_DEBOUNCE_MS,
};
