import type { EditorTab } from "../types";
import { useAgentStore } from "@domains/agent/hooks";
import { useTabsStore } from "../hooks/tabsStore";
import { useFilesStore } from "@domains/files/hooks";
import { useGitStore } from "@domains/git/hooks";
import { useProjectStore } from "@shell/hooks/projectStore";
import { useRecentsStore } from "@shell/hooks/recentsStore";
import type { DatabaseKind, PersistedTab, QueryLanguage } from "@shared";
import { useSettingsStore } from "@shared/settings";
import {
  openProjectDialogIPC,
  openProjectInNewWindowIPC,
  readTextFileIPC,
} from "../ipc";
import { isSelfWrite } from "./selfWrites";

function toPersisted(tabs: EditorTab[]): PersistedTab[] {
  // The "Uncommitted Changes" git-diff tab is transient: never restore it on
  // launch; it's reopened on demand from the Git rail.
  // NOTE: terminal tabs MUST stay persisted here. The pane layout references
  // tab ids; dropping terminals would make reconcileLayout prune their leaves
  // and silently lose the split on restart.
  return tabs
    .filter((t) => t.tabType !== "gitdiff")
    .map(({ id, title, text, kind, connectionId, cursor, tabType, filePath, tableRef, tableEditable, closed, createdAt, chart }) => ({
    id,
    title,
    text,
    kind,
    connectionId,
    cursor,
    tabType,
    filePath,
    tableRef,
    tableEditable,
    closed: closed || undefined,
    createdAt,
    chart,
  }));
}

async function openProjectFromMenu(): Promise<void> {
  const selected = await openProjectDialogIPC();
  if (typeof selected === "string") {
    await useProjectStore.getState().openProject(selected);
  }
}

async function handleDroppedPath(path: string): Promise<void> {
  await useProjectStore.getState().openProject(path);
}

// Open a project in a new window (a fresh app process), leaving this window's
// project untouched. Caller supplies the path (recent card, drop, menu dialog).
async function openProjectInNewWindow(path: string): Promise<void> {
  await openProjectInNewWindowIPC(path);
}

async function pickAndOpenFolderInNewWindow(title?: string): Promise<void> {
  const selected = await openProjectDialogIPC(title);
  if (typeof selected === "string") {
    await openProjectInNewWindow(selected);
  }
}

// On launch, a path handed to this process by "open in new window" (read once in
// bootstrap) wins over the auto-reopen-last-project setting; a plain launch (null)
// falls back to reopen-last.
async function openPendingLaunchOrReopenLast(pending: string | null): Promise<void> {
  if (typeof pending === "string" && pending.length > 0) {
    await useProjectStore.getState().openProject(pending).catch(() => {});
    return;
  }
  await reopenLastProjectIfNeeded();
}

async function refreshOnAppFocus(): Promise<void> {
  if (!useProjectStore.getState().activeProjectPath) return;
  const gitState = useGitStore.getState();
  if (gitState.repoPath) {
    gitState.refreshFileStatuses().catch(() => {});
  }
  useFilesStore.getState().refresh().catch(() => {});

  const tabs = useTabsStore.getState().tabs;
  const fileTabReads = tabs
    .filter((tab) => tab.tabType === "file" && tab.filePath)
    .map(refreshFileTabFromDisk);
  await Promise.all(fileTabReads);
}

async function refreshFileTabFromDisk(tab: EditorTab): Promise<void> {
  if (!tab.filePath) return;
  try {
    const diskText = await readTextFileIPC(tab.filePath);
    // Skip our own autosave echo; overwriting would revert keystrokes typed since
    // the save and remount-jump the scroll. Only external edits reconcile.
    if (isSelfWrite(tab.filePath, diskText)) return;
    const current = useTabsStore.getState().tabs.find((candidate) => candidate.id === tab.id);
    if (current && current.text !== diskText) {
      useTabsStore.getState().updateTab(tab.id, {
        text: diskText,
        refreshToken: (current.refreshToken ?? 0) + 1,
      });
    }
  } catch {
    // File may have been deleted externally.
  }
}

function hydrateFrontendStores(): void {
  useAgentStore.getState().checkAgent().catch(() => {});
}

async function reopenLastProjectIfNeeded(): Promise<void> {
  const prefs = useSettingsStore.getState();
  if (!prefs.reopenLastProject) return;
  const last = useRecentsStore.getState().recents.find((recent) => recent.kind === "folder");
  if (last) {
    await useProjectStore.getState().openProject(last.path).catch(() => {});
  }
}

// --- Editor kind mapping ----------------------------------------------------
// Maps a connection's DatabaseKind to the editor kind that drives syntax,
// running, and result rendering; pure lookups with no React/store deps.

function kindForConnection(kind: DatabaseKind): string {
  switch (kind) {
    case "mongodb":
      return "mongodb";
    case "redis":
      return "redis";
    case "kafka":
      return "kafka";
    case "elasticsearch":
      return "elasticsearch";
    default:
      return "sql";
  }
}

function queryLanguageForEditorKind(kind: string): QueryLanguage | undefined {
  if (kind === "redis" || kind === "mongodb" || kind === "kafka" || kind === "elasticsearch") return "sql";
  if (kind === "mongoshell" || kind === "esrest" || kind === "rediscli") return "native";
  return undefined;
}

function isRunnableQueryKind(kind: string | undefined): boolean {
  if (!kind) return false;
  return kind === "sql" || queryLanguageForEditorKind(kind) !== undefined;
}

// --- Font zoom --------------------------------------------------------------
// Editor and terminal font sizes share the same bounds as the Settings
// NumberStepper (10–20). Zoom moves in whole-point steps like common IDEs.
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 20;
const FONT_SIZE_STEP = 1;

type ZoomDirection = "in" | "out";

function clampFontSize(size: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size));
}

// Round to the nearest half-point so a custom stepper value (e.g. 13.5) stays
// on a clean grid after zooming, then clamp to the allowed range.
function nextFontSize(current: number, direction: ZoomDirection): number {
  const delta = direction === "in" ? FONT_SIZE_STEP : -FONT_SIZE_STEP;
  return clampFontSize(Math.round((current + delta) * 2) / 2);
}

// A "terminal" tab zooms the terminal font; every other (editor) tab zooms the
// editor font. This is the focused-pane rule for keyboard zoom.
function activeTabIsTerminal(): boolean {
  const tabs = useTabsStore.getState();
  const active = tabs.tabs.find((tab) => tab.id === tabs.activeId);
  return active?.tabType === "terminal";
}

function zoomEditor(direction: ZoomDirection): void {
  const settings = useSettingsStore.getState();
  settings.setEditorFontSize(nextFontSize(settings.editorFontSize, direction));
}

function zoomTerminal(direction: ZoomDirection): void {
  const settings = useSettingsStore.getState();
  settings.setTerminalFontSize(nextFontSize(settings.terminalFontSize, direction));
}

function zoomFocusedPane(direction: ZoomDirection): void {
  if (activeTabIsTerminal()) zoomTerminal(direction);
  else zoomEditor(direction);
}

// Cmd/Ctrl + "=" (or "+") zooms in; Cmd/Ctrl + "-" (or "_") zooms out. These
// minus/equals bindings can't be expressed in the keymap registry (its specs
// split on "-"), so zoom owns its own listener instead of a KeymapAction.
function zoomDirectionFromKey(event: KeyboardEvent): ZoomDirection | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (event.key === "=" || event.key === "+") return "in";
  if (event.key === "-" || event.key === "_") return "out";
  return null;
}

// Ctrl + wheel is the cross-platform IDE zoom gesture; macOS trackpad
// pinch-to-zoom also arrives as a ctrl-modified wheel event.
function zoomDirectionFromWheel(event: WheelEvent): ZoomDirection | null {
  if (!event.ctrlKey) return null;
  if (event.deltaY < 0) return "in";
  if (event.deltaY > 0) return "out";
  return null;
}

export {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  clampFontSize,
  handleDroppedPath,
  hydrateFrontendStores,
  isRunnableQueryKind,
  kindForConnection,
  nextFontSize,
  openPendingLaunchOrReopenLast,
  openProjectFromMenu,
  openProjectInNewWindow,
  pickAndOpenFolderInNewWindow,
  queryLanguageForEditorKind,
  refreshOnAppFocus,
  reopenLastProjectIfNeeded,
  toPersisted,
  zoomDirectionFromKey,
  zoomDirectionFromWheel,
  zoomEditor,
  zoomFocusedPane,
  zoomTerminal,
};
