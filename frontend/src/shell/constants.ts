const PANE_GROUPS_KEY = "arris.paneGroups";
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

export {
  APP_FOCUS_REFRESH_DEBOUNCE_MS,
  FS_WATCH_REFRESH_DEBOUNCE_MS,
  MAX_RECENTS,
  PANE_GROUPS_KEY,
  PANE_LAYOUT_SAVE_DEBOUNCE_MS,
  PROJECT_STORE_SAVE_DEBOUNCE_MS,
  RECENTS_STORAGE_KEY,
  TAB_SAVE_DEBOUNCE_MS,
};
