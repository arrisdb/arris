import type { ContextMenuItem } from "@shared/ui/ContextMenu";
import { useRecentsStore } from "@shell/hooks/recentsStore";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";
import { useDbtStore } from "@domains/dbt/hooks";
import { useGitStore } from "@domains/git/hooks";
import { useSqlMeshStore } from "@domains/sqlmesh/hooks";
import {
  FILE_KIND_GITIGNORE_NAMES,
  FILE_KIND_MAKEFILE_NAMES,
  FILE_TREE_DBT_MARKERS,
  FILE_TREE_SQLMESH_MARKERS,
} from "./constants";
import {
  fileTreeViewCopyEntryIPC,
  fileTreeViewDeleteEntryIPC,
  fileTreeViewDuplicateEntryIPC,
  fileTreeViewListFolderTreeIPC,
  fileTreeViewMoveEntryIPC,
  fileTreeViewMoveTabToScratchIPC,
  fileTreeViewReadClipboardFilePathsIPC,
  fileTreeViewReadTextFileIPC,
} from "./ipc";
import { useFilesStore } from "../../hooks";
import { useSettingsStore } from "@shared/settings";
import { isMediaFileName } from "../MediaView/utils";
import type { FileTreeEntry } from "./types";

function basenameOf(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function findProjectRoot(
  tree: FileTreeEntry,
  targets: string[],
): string | null {
  const targetSet = new Set(targets.map((target) => target.toLowerCase()));
  const stack: FileTreeEntry[] = [tree];
  while (stack.length) {
    const node = stack.pop()!;
    if (!node.isDir) continue;
    for (const child of node.children) {
      if (!child.isDir && targetSet.has(child.name.toLowerCase())) return node.path;
    }
    for (const child of node.children) {
      if (child.isDir) stack.push(child);
    }
  }
  return null;
}

// Collect EVERY directory whose direct children include a marker file, so a
// workspace with several dbt/sqlmesh projects surfaces all of them (not just the
// first). Descent stops at a matched root: nested marker files inside it (e.g.
// `dbt_packages/<pkg>/dbt_project.yml`) are vendored sub-projects, not separate
// workspace projects. Results are sorted for a stable dropdown order.
function findAllProjectRoots(
  tree: FileTreeEntry,
  targets: string[],
): string[] {
  const targetSet = new Set(targets.map((target) => target.toLowerCase()));
  const roots: string[] = [];
  const stack: FileTreeEntry[] = [tree];
  while (stack.length) {
    const node = stack.pop()!;
    if (!node.isDir) continue;
    const isRoot = node.children.some(
      (child) => !child.isDir && targetSet.has(child.name.toLowerCase()),
    );
    if (isRoot) {
      roots.push(node.path);
      continue;
    }
    for (const child of node.children) {
      if (child.isDir) stack.push(child);
    }
  }
  roots.sort();
  return roots;
}

function fileContextMenuItems({
  node,
  rootPath,
  hasClipboard,
  hasOsFiles,
  hasTree,
  onOpenFile,
  onOpenFolder,
}: {
  node: FileTreeEntry | null;
  rootPath: string | null;
  hasClipboard: boolean;
  hasOsFiles: boolean;
  hasTree: boolean;
  onOpenFile: () => void;
  onOpenFolder: () => void;
}): ContextMenuItem[] {
  if (!hasTree) {
    return [
      { id: "open-file", label: "Open File", action: onOpenFile },
      { id: "open-folder", label: "Open Folder", action: onOpenFolder },
    ];
  }
  if (!rootPath) return [];

  if (!node) {
    return [
      { id: "new-file", label: "New File", shortcut: "Cmd+N", action: () => startNewFile(rootPath) },
      { id: "new-folder", label: "New Folder", shortcut: "Opt+Cmd+N", action: () => startNewFolder(rootPath) },
    ];
  }

  const targetDir = node.isDir ? node.path : parentDir(node.path);
  const scratchTab = node.isDir ? undefined : trackedScratchTabForPath(node.path);
  return [
    { id: "new-file", label: "New File", shortcut: "Cmd+N", action: () => startNewFile(targetDir) },
    { id: "new-folder", label: "New Folder", shortcut: "Opt+Cmd+N", action: () => startNewFolder(targetDir) },
    { kind: "separator", id: "file-actions" },
    { id: "cut", label: "Cut", shortcut: "Cmd+X", action: () => useFilesStore.getState().setClipboard(node.path, "cut") },
    { id: "copy", label: "Copy", shortcut: "Cmd+C", action: () => useFilesStore.getState().setClipboard(node.path, "copy") },
    { id: "duplicate", label: "Duplicate", shortcut: "Cmd+D", action: () => handleDuplicate(node.path) },
    { id: "paste", label: "Paste", shortcut: "Cmd+V", disabled: !hasClipboard && !hasOsFiles, action: () => pasteIntoDir(targetDir) },
    ...(scratchTab
      ? ([{ id: "move-to-scratch", label: "Move to Scratch", action: () => handleMoveToScratch(scratchTab.id) }] as ContextMenuItem[])
      : []),
    { kind: "separator", id: "file-danger" },
    { id: "rename", label: "Rename", shortcut: "Shift+F6", action: () => useFilesStore.getState().setRenamingPath(node.path) },
    { id: "delete", label: "Delete", shortcut: "Del", action: () => handleDelete(node.path) },
  ];
}

function fileGlyphKind(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "sql") return "sql";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "json") return "json";
  if (ext === "md") return "doc";
  return "default";
}

function fileKindForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.endsWith(".dockerfile")) return "dockerfile";
  if (FILE_KIND_MAKEFILE_NAMES.has(lower) || lower.endsWith(".makefile")) return "makefile";
  if (FILE_KIND_GITIGNORE_NAMES.has(lower)) return "gitignore";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "mk":
    case "make":
      return "makefile";
    case "sql":
      return "sql";
    case "json":
      return "json";
    case "yml":
    case "yaml":
      return "yaml";
    case "md":
    case "markdown":
      return "markdown";
    case "py":
      return "python";
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "html":
    case "htm":
      return "html";
    case "xml":
    case "xsl":
    case "xsd":
      return "xml";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "toml":
    case "lock":
      return "toml";
    case "csv":
      return "csv";
    default:
      return "text";
  }
}

function gitStatusColor(status: string | undefined): string | undefined {
  if (!status) return undefined;
  // Deleted content tints red. The deleted file has no tree node of its own, so
  // this surfaces on the ancestor folders that still contain the deletion.
  if (status === "D") return "rgba(255,107,107,0.85)";
  // Untracked (?) and added (A) are both new content; show green, matching Zed.
  if (status === "A" || status === "?") return "rgba(91,227,154,0.85)";
  return "rgba(255,217,96,0.85)";
}

async function handleDelete(path: string): Promise<void> {
  const name = path.split("/").pop() ?? path;
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    await fileTreeViewDeleteEntryIPC(path);
    await useFilesStore.getState().refresh();
    useFilesStore.getState().selectPath(null);
  } catch (error) {
    console.error("Failed to delete", error);
  }
}

async function handleDuplicate(path: string): Promise<void> {
  try {
    const newPath = await fileTreeViewDuplicateEntryIPC(path);
    await useFilesStore.getState().refresh();
    useFilesStore.getState().selectPath(newPath);
  } catch (error) {
    console.error("Failed to duplicate", error);
  }
}

// The console/notebook tab (if any) that a project-root file is bound to. Only
// such files can be moved back to the `.arris` scratch area.
function trackedScratchTabForPath(path: string): EditorTab | undefined {
  return useTabsStore
    .getState()
    .tabs.find(
      (tab) =>
        tab.filePath === path &&
        (tab.tabType === "console" || tab.tabType === "notebook"),
    );
}

async function handleMoveToScratch(tabId: string): Promise<void> {
  try {
    await fileTreeViewMoveTabToScratchIPC(tabId);
    // Drop the file binding so the tab returns to its sidebar scratch section,
    // then re-read the tree (the project file is gone, the sidecar is back).
    useTabsStore.getState().updateTab(tabId, { filePath: undefined });
    await useFilesStore.getState().refresh();
  } catch (error) {
    console.error("Failed to move to scratch", error);
  }
}

async function handlePaste(targetPath: string): Promise<void> {
  const { clipboardPath, clipboardOp } = useFilesStore.getState();
  if (!clipboardPath || !clipboardOp) return;
  const srcName = clipboardPath.split("/").pop() ?? clipboardPath;
  const destDir = targetPath;
  const sep = destDir.includes("/") ? "/" : "\\";
  const destPath = `${destDir}${sep}${srcName}`;
  try {
    if (clipboardOp === "copy") {
      await fileTreeViewCopyEntryIPC(clipboardPath, destPath);
    } else {
      await fileTreeViewMoveEntryIPC(clipboardPath, destPath);
      useFilesStore.getState().clearClipboard();
    }
    useFilesStore.getState().setExpanded(destDir, true);
    await useFilesStore.getState().refresh();
    useFilesStore.getState().selectPath(destPath);
  } catch (error) {
    console.error("Failed to paste", error);
  }
}

/// `.ipynb` files open in the notebook editor rather than the plain text editor.
function isNotebookFile(name: string): boolean {
  return name.toLowerCase().endsWith(".ipynb");
}

/// The single place the "which editor tab for this file" decision lives: media
/// (image/binary) → MediaView, `.ipynb` → NotebookView, everything else → the
/// text editor. Every open path (file tree, picked file, file finder) delegates
/// here so the routing can never drift between them. Callers pass their own text
/// reader (each feature owns its IPC boundary), plus optional `cursorForText`
/// (content-search jump) and `onOpened` (e.g. record a recent) hooks.
async function openFileInTab(opts: {
  filePath: string;
  title: string;
  readText: () => Promise<string>;
  cursorForText?: (text: string) => number;
  onOpened?: () => void;
}): Promise<void> {
  const { filePath, title, readText, cursorForText, onOpened } = opts;
  if (isMediaFileName(title)) {
    useTabsStore.getState().openMediaTab({ filePath, title });
    onOpened?.();
    return;
  }
  const text = await readText();
  if (isNotebookFile(title)) {
    useTabsStore.getState().openNotebookTab({ filePath, title, text });
    onOpened?.();
    return;
  }
  useTabsStore.getState().openFileTab({
    filePath,
    title,
    text,
    kind: fileKindForName(title),
    ...(cursorForText ? { cursor: cursorForText(text) } : {}),
  });
  onOpened?.();
}

async function openFileFromTree(node: FileTreeEntry): Promise<void> {
  if (node.isDir) return;
  try {
    await openFileInTab({
      filePath: node.path,
      title: node.name,
      readText: () => fileTreeViewReadTextFileIPC(node.path),
    });
  } catch (error) {
    console.error("Failed to read file", node.path, error);
  }
}

async function openPickedFile(path: string): Promise<void> {
  const name = basenameOf(path);
  await openFileInTab({
    filePath: path,
    title: name,
    readText: () => fileTreeViewReadTextFileIPC(path),
    onOpened: () =>
      useRecentsStore
        .getState()
        .add({ path, name, kind: "file", openedAt: Date.now() }),
  });
}

function parentDir(path: string): string {
  const sep = path.includes("/") ? "/" : "\\";
  const parts = path.split(sep);
  parts.pop();
  return parts.join(sep) || sep;
}

async function setPickedFolder(path: string): Promise<void> {
  const tree = await fileTreeViewListFolderTreeIPC(
    path,
    useSettingsStore.getState().fileTreeSkipDirs,
  ).catch(() => null);
  if (!tree) return;
  useFilesStore.getState().setTree(path, tree);
  useGitStore.getState().refreshFromRepo(path).catch(() => {});
  const dbtRoot = findProjectRoot(tree, FILE_TREE_DBT_MARKERS);
  if (dbtRoot) await useDbtStore.getState().loadFromPath(dbtRoot);
  const sqlMeshRoot = findProjectRoot(tree, FILE_TREE_SQLMESH_MARKERS);
  if (sqlMeshRoot) await useSqlMeshStore.getState().loadFromPath(sqlMeshRoot);
}

function startNewFile(dirPath: string): void {
  useFilesStore.getState().startCreating(dirPath, "file");
}

function startNewFolder(dirPath: string): void {
  useFilesStore.getState().startCreating(dirPath, "folder");
}

function statusPriority(status: string): number {
  // Deleted outranks everything so a folder containing a git-tracked deletion
  // tints red even when it also holds modified or added files.
  if (status === "D") return 4;
  if (status === "M") return 3;
  // Added (A) and untracked (?) share the lowest non-zero tier so a new file
  // still tints its parent folders green when nothing else outranks it.
  if (status === "A" || status === "?") return 1;
  return 0;
}

const FILE_TREE_DROP_HIGHLIGHT_CLASS = "drag-over";

let highlightedDropRow: HTMLElement | null = null;

/** The directory an external drop lands in: the folder itself, or a file's parent. */
function resolveDropTargetDir(path: string, isDir: boolean): string {
  return isDir ? path : parentDir(path);
}

function fileTreeRowElementAt(clientX: number, clientY: number): HTMLElement | null {
  const el = document.elementFromPoint(clientX, clientY);
  return (el?.closest("[data-tree-row]") as HTMLElement | null) ?? null;
}

/**
 * Resolve the folder an OS drag-drop at the given (logical) point targets:
 * the folder row under the cursor, a file row's parent dir, or (anywhere else
 * inside the file-tree pane) the project root. Returns null when the point is
 * outside the tree (so the caller can fall back to opening a project).
 */
function fileTreeDropTargetDirAt(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const row = el.closest("[data-tree-row]") as HTMLElement | null;
  if (row?.dataset.path) {
    return resolveDropTargetDir(row.dataset.path, row.dataset.isdir === "true");
  }
  if (el.closest(".mdbc-file-tree")) {
    return useFilesStore.getState().rootPath;
  }
  return null;
}

function highlightFileTreeDropTargetAt(clientX: number, clientY: number): void {
  const row = fileTreeRowElementAt(clientX, clientY);
  const target = row && row.dataset.isdir === "true" ? row : null;
  if (highlightedDropRow && highlightedDropRow !== target) {
    highlightedDropRow.classList.remove(FILE_TREE_DROP_HIGHLIGHT_CLASS);
    highlightedDropRow = null;
  }
  if (target) {
    target.classList.add(FILE_TREE_DROP_HIGHLIGHT_CLASS);
    highlightedDropRow = target;
  }
}

function clearFileTreeDropHighlight(): void {
  if (highlightedDropRow) {
    highlightedDropRow.classList.remove(FILE_TREE_DROP_HIGHLIGHT_CLASS);
    highlightedDropRow = null;
  }
}

const FILE_TREE_DRAG_GHOST_CLASS = "mdbc-file-drag-ghost";
/// Cursor offset (px) so the floating label sits beside the pointer, not under it.
const FILE_TREE_DRAG_GHOST_OFFSET_PX = 12;

let dragGhostEl: HTMLElement | null = null;

/** Show a floating label that follows the cursor while dragging an entry. */
function showFileTreeDragGhost(label: string, clientX: number, clientY: number): void {
  if (!dragGhostEl) {
    dragGhostEl = document.createElement("div");
    dragGhostEl.className = FILE_TREE_DRAG_GHOST_CLASS;
    document.body.appendChild(dragGhostEl);
  }
  dragGhostEl.textContent = label;
  moveFileTreeDragGhost(clientX, clientY);
}

function moveFileTreeDragGhost(clientX: number, clientY: number): void {
  if (!dragGhostEl) return;
  dragGhostEl.style.left = `${clientX + FILE_TREE_DRAG_GHOST_OFFSET_PX}px`;
  dragGhostEl.style.top = `${clientY + FILE_TREE_DRAG_GHOST_OFFSET_PX}px`;
}

function clearFileTreeDragGhost(): void {
  if (dragGhostEl) {
    dragGhostEl.remove();
    dragGhostEl = null;
  }
}

function findEntryByPath(node: FileTreeEntry, path: string): FileTreeEntry | null {
  if (node.path === path) return node;
  for (const child of node.children) {
    const found = findEntryByPath(child, path);
    if (found) return found;
  }
  return null;
}

/** The directory a paste targets: the selected folder, or a selected file's parent. */
function pasteTargetDirForSelectedPath(path: string): string {
  const tree = useFilesStore.getState().tree;
  const node = tree ? findEntryByPath(tree, path) : null;
  if (node) return resolveDropTargetDir(node.path, node.isDir);
  return parentDir(path);
}

/**
 * Paste into the tree: prefer files on the OS clipboard (e.g. copied in Finder),
 * copying them into the selected folder; otherwise fall back to the in-app tree
 * clipboard (cut/copy of a tree entry).
 */
async function pasteIntoTree(selectedPath: string): Promise<void> {
  await pasteIntoDir(pasteTargetDirForSelectedPath(selectedPath));
}

/**
 * Paste into an explicit target directory: prefer files on the OS clipboard
 * (e.g. copied in Finder), copying them in; otherwise fall back to the in-app
 * tree clipboard (cut/copy of a tree entry).
 */
async function pasteIntoDir(targetDir: string): Promise<void> {
  const osFiles = await fileTreeViewReadClipboardFilePathsIPC().catch(() => [] as string[]);
  if (osFiles.length > 0) {
    await copyExternalFilesIntoFileTree(osFiles, targetDir);
    return;
  }
  await handlePaste(targetDir);
}

/** Minimum pointer travel (px) before a row press becomes an internal drag. */
const FILE_TREE_DRAG_THRESHOLD_PX = 4;

/// Set on the pointerup that ends a drag so the synthetic click it produces
/// doesn't also select/open the dragged row. Consumed by the row click handler.
let fileTreeRowClickSuppressed = false;

function markFileTreeRowClickSuppressed(): void {
  fileTreeRowClickSuppressed = true;
}

function resetFileTreeRowClickSuppressed(): void {
  fileTreeRowClickSuppressed = false;
}

function consumeFileTreeRowClickSuppressed(): boolean {
  if (!fileTreeRowClickSuppressed) return false;
  fileTreeRowClickSuppressed = false;
  return true;
}

/// A move is a no-op or invalid when the destination is the entry's current
/// parent, the entry itself, or a descendant of the entry (can't move a folder
/// into its own subtree).
function isInvalidMoveTarget(srcPath: string, destDir: string): boolean {
  if (destDir === parentDir(srcPath)) return true;
  if (destDir === srcPath) return true;
  return destDir.startsWith(`${srcPath}/`) || destDir.startsWith(`${srcPath}\\`);
}

/** Move a tree entry into `destDir` (internal drag-drop), then refresh + reveal. */
async function moveEntryIntoTreeDir(srcPath: string, destDir: string): Promise<void> {
  if (isInvalidMoveTarget(srcPath, destDir)) return;
  const name = basenameOf(srcPath);
  const sep = destDir.includes("/") ? "/" : "\\";
  const dest = `${destDir}${sep}${name}`;
  try {
    await fileTreeViewMoveEntryIPC(srcPath, dest);
    useFilesStore.getState().setExpanded(destDir, true);
    await useFilesStore.getState().refresh();
    useFilesStore.getState().selectPath(dest);
  } catch (error) {
    console.error("Failed to move entry", error);
  }
}

/** Copy each OS path into `targetDir`, then refresh and reveal the folder. */
async function copyExternalFilesIntoFileTree(paths: string[], targetDir: string): Promise<void> {
  const sep = targetDir.includes("/") ? "/" : "\\";
  for (const src of paths) {
    const name = src.split(/[\\/]/).filter(Boolean).pop() ?? src;
    const dest = `${targetDir}${sep}${name}`;
    try {
      await fileTreeViewCopyEntryIPC(src, dest);
    } catch (error) {
      console.error("Failed to copy dropped file", src, error);
    }
  }
  useFilesStore.getState().setExpanded(targetDir, true);
  await useFilesStore.getState().refresh();
}

export {
  basenameOf,
  clearFileTreeDragGhost,
  clearFileTreeDropHighlight,
  consumeFileTreeRowClickSuppressed,
  copyExternalFilesIntoFileTree,
  FILE_TREE_DRAG_THRESHOLD_PX,
  fileContextMenuItems,
  fileGlyphKind,
  fileKindForName,
  fileTreeDropTargetDirAt,
  findAllProjectRoots,
  findProjectRoot,
  gitStatusColor,
  handleDelete,
  handleDuplicate,
  handlePaste,
  highlightFileTreeDropTargetAt,
  isInvalidMoveTarget,
  markFileTreeRowClickSuppressed,
  moveEntryIntoTreeDir,
  moveFileTreeDragGhost,
  resetFileTreeRowClickSuppressed,
  showFileTreeDragGhost,
  openFileInTab,
  openFileFromTree,
  openPickedFile,
  parentDir,
  pasteIntoDir,
  pasteIntoTree,
  pasteTargetDirForSelectedPath,
  resolveDropTargetDir,
  setPickedFolder,
  statusPriority,
};
