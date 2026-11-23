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
import { DESKTOP_ONLY_TAB_TYPES } from "./constants";
import type { PaneNode } from "./types";

type PersistedPaneLayout = ProjectOpenResult["paneLayout"];

// Tabs only the desktop can show stay out of the browser but must survive its saves.
let desktopOnlyTabs: PersistedTab[] = [];

function appPreferencesLoadIPC(): Promise<AppPreferences> {
  return invoke("cmd_app_preferences_load");
}

function closeFileIndexIPC(): Promise<void> {
  if (isWebShell()) return apiCall("file_index_close");
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
  if (isWebShell()) return apiCall("file_tree", { root, skipDirs });
  return invoke("cmd_list_folder_tree", { root, skipDirs });
}

function openFileIndexIPC(root: string): Promise<void> {
  if (isWebShell()) return apiCall("file_index_open", { path: root });
  return invoke("cmd_open_file_index", { root });
}

async function openProjectIPC(root: string): Promise<ProjectOpenResult> {
  setCurrentProject(root);
  if (!isWebShell()) return invoke("cmd_open_project", { root });
  const [connections, workspace] = await Promise.all([
    apiCall<ScopedConnection[]>("connection_list"),
    apiCall<{ tabs: PersistedTab[]; paneLayout: PersistedPaneLayout }>("workspace_load"),
  ]);
  const isDesktopOnly = (tab: PersistedTab) => DESKTOP_ONLY_TAB_TYPES.has(tab.tabType ?? "");
  desktopOnlyTabs = workspace.tabs.filter(isDesktopOnly);
  return {
    root,
    connections,
    tabs: workspace.tabs.filter((tab) => !isDesktopOnly(tab)),
    federationTabs: [],
    paneLayout: workspace.paneLayout,
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
  if (isWebShell()) return apiCall("file_read", { path });
  return invoke("cmd_read_text_file", { path });
}

async function saveTabsIPC(tabs: PersistedTab[]): Promise<void> {
  if (!isWebShell()) return invoke("cmd_save_console_tabs", { tabs });
  await apiCall("workspace_tabs_save", { tabs: [...desktopOnlyTabs, ...tabs] });
}

async function savePaneLayoutIPC(
  layout: PaneNode | null,
  focusedPaneGroupId: string | null,
): Promise<void> {
  const paneLayout: PersistedPaneLayout = { layout, focusedPaneGroupId };
  if (!isWebShell()) return invoke("cmd_save_pane_layout", { layout: paneLayout });
  await apiCall("workspace_layout_save", { layout: paneLayout });
}

// Move a virtual console/notebook's sidecar file out of `.arris/files/` to the
// project root, returning the new absolute path. The tab then becomes a normal
// file-backed tab.
function moveTabToProjectIPC(id: string): Promise<string> {
  if (isWebShell()) return apiCall("tab_move_to_project", { id });
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
