import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { apiCall, currentProject, isWebShell, setCurrentProject } from "@shared/api";
import type {
  AppPreferences,
  FileTreeEntry,
  PersistedTab,
  ProjectOpenResult,
  ScopedConnection,
} from "@shared";
import { WEB_LAYOUT_STORAGE_PREFIX, WEB_TABS_STORAGE_PREFIX } from "./constants";
import type { PaneNode } from "./types";

type PersistedPaneLayout = ProjectOpenResult["paneLayout"];

const EMPTY_PANE_LAYOUT: PersistedPaneLayout = { layout: null, focusedPaneGroupId: null };

// The browser has no project folder to write into, so tabs and layout live in localStorage.
function readWebState<T>(prefix: string, project: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`${prefix}${project}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeWebState(prefix: string, value: unknown): void {
  const project = currentProject();
  if (!project) return;
  try {
    window.localStorage.setItem(`${prefix}${project}`, JSON.stringify(value));
  } catch {
    // Storage unavailable; the session keeps its in-memory tabs.
  }
}

function appPreferencesLoadIPC(): Promise<AppPreferences> {
  return invoke("cmd_app_preferences_load");
}

function closeFileIndexIPC(): Promise<void> {
  return invoke("cmd_close_file_index");
}

function closeProjectIPC(): Promise<void> {
  return isWebShell() ? Promise.resolve() : invoke("cmd_close_project");
}

function listConnectionsIPC(): Promise<ScopedConnection[]> {
  if (!isWebShell()) return invoke("cmd_list_connections");
  return currentProject() ? apiCall("connection_list") : Promise.resolve([]);
}

function listFolderTreeIPC(root: string, skipDirs: string[]): Promise<FileTreeEntry> {
  return invoke("cmd_list_folder_tree", { root, skipDirs });
}

function openFileIndexIPC(root: string): Promise<void> {
  return invoke("cmd_open_file_index", { root });
}

async function openProjectIPC(root: string): Promise<ProjectOpenResult> {
  if (!isWebShell()) return invoke("cmd_open_project", { root });
  setCurrentProject(root);
  return {
    root,
    connections: await apiCall("connection_list"),
    tabs: readWebState(WEB_TABS_STORAGE_PREFIX, root, []),
    federationTabs: [],
    paneLayout: readWebState(WEB_LAYOUT_STORAGE_PREFIX, root, EMPTY_PANE_LAYOUT),
  };
}

function openProjectInNewWindowIPC(path: string): Promise<void> {
  return invoke("cmd_open_project_in_new_window", { path });
}

// This process's launch project path (set by "open in new window"), returned
// once then cleared so a later reload does not reopen it. The browser opens the URL's project.
function takePendingLaunchIPC(): Promise<string | null> {
  return isWebShell() ? Promise.resolve(currentProject()) : invoke("cmd_take_pending_launch");
}

function readTextFileIPC(path: string): Promise<string> {
  return invoke("cmd_read_text_file", { path });
}

async function saveTabsIPC(tabs: PersistedTab[]): Promise<void> {
  if (!isWebShell()) return invoke("cmd_save_console_tabs", { tabs });
  writeWebState(WEB_TABS_STORAGE_PREFIX, tabs);
}

async function savePaneLayoutIPC(
  layout: PaneNode | null,
  focusedPaneGroupId: string | null,
): Promise<void> {
  const paneLayout: PersistedPaneLayout = { layout, focusedPaneGroupId };
  if (!isWebShell()) return invoke("cmd_save_pane_layout", { layout: paneLayout });
  writeWebState(WEB_LAYOUT_STORAGE_PREFIX, paneLayout);
}

// Move a virtual console/notebook's sidecar file out of `.arris/files/` to the
// project root, returning the new absolute path. The tab then becomes a normal
// file-backed tab.
function moveTabToProjectIPC(id: string): Promise<string> {
  return invoke("cmd_move_tab_to_project", { id });
}

function openProjectDialogIPC(title?: string) {
  return openDialog({ directory: true, multiple: false, title });
}

function listenAppEventIPC<T = unknown>(
  event: string,
  handler: (payload: T) => void,
) {
  return listen<T>(event, (e) => handler(e.payload));
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
  openProjectInNewWindowIPC,
  readTextFileIPC,
  takePendingLaunchIPC,
  savePaneLayoutIPC,
  saveTabsIPC,
};
