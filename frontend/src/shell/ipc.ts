import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  AppPreferences,
  FileTreeEntry,
  PersistedTab,
  ProjectOpenResult,
  ScopedConnection,
} from "@shared";
import type { PaneNode } from "./types";

function appPreferencesLoadIPC(): Promise<AppPreferences> {
  return invoke("cmd_app_preferences_load");
}

function closeFileIndexIPC(): Promise<void> {
  return invoke("cmd_close_file_index");
}

function closeProjectIPC(): Promise<void> {
  return invoke("cmd_close_project");
}

function listConnectionsIPC(): Promise<ScopedConnection[]> {
  return invoke("cmd_list_connections");
}

function listFolderTreeIPC(root: string, skipDirs: string[]): Promise<FileTreeEntry> {
  return invoke("cmd_list_folder_tree", { root, skipDirs });
}

function openFileIndexIPC(root: string): Promise<void> {
  return invoke("cmd_open_file_index", { root });
}

function openProjectIPC(root: string): Promise<ProjectOpenResult> {
  return invoke("cmd_open_project", { root });
}

function readTextFileIPC(path: string): Promise<string> {
  return invoke("cmd_read_text_file", { path });
}

function saveTabsIPC(tabs: PersistedTab[]): Promise<void> {
  return invoke("cmd_save_console_tabs", { tabs });
}

function savePaneLayoutIPC(
  layout: PaneNode | null,
  focusedPaneGroupId: string | null,
): Promise<void> {
  return invoke("cmd_save_pane_layout", { layout: { layout, focusedPaneGroupId } });
}

// Move a virtual console/notebook's sidecar file out of `.arris/files/` to the
// project root, returning the new absolute path. The tab then becomes a normal
// file-backed tab.
function moveTabToProjectIPC(id: string): Promise<string> {
  return invoke("cmd_move_tab_to_project", { id });
}

function openProjectDialogIPC() {
  return openDialog({ directory: true, multiple: false });
}

function listenAppEventIPC(event: string, handler: () => void) {
  return listen(event, handler);
}

function getCurrentWebviewIPC() {
  return getCurrentWebview();
}

export {
  appPreferencesLoadIPC,
  closeFileIndexIPC,
  closeProjectIPC,
  getCurrentWebviewIPC,
  listConnectionsIPC,
  listFolderTreeIPC,
  listenAppEventIPC,
  moveTabToProjectIPC,
  openFileIndexIPC,
  openProjectDialogIPC,
  openProjectIPC,
  readTextFileIPC,
  savePaneLayoutIPC,
  saveTabsIPC,
};
