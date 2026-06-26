import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useContextMenu } from "@shared/ui/ContextMenu";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useGitStore } from "@domains/git/hooks";
import { useFilesStore } from "../../hooks";
import type {
  FileTreeEntry,
  FileTreeInlineCreateViewModel,
  FileTreeInlineRenameViewModel,
  FileTreeRowViewModel,
  FileTreeViewModel,
} from "./types";
import {
  clearFileTreeDragGhost,
  clearFileTreeDropHighlight,
  consumeFileTreeRowClickSuppressed,
  FILE_TREE_DRAG_THRESHOLD_PX,
  fileContextMenuItems,
  fileTreeDropTargetDirAt,
  handleDelete,
  handleDuplicate,
  highlightFileTreeDropTargetAt,
  markFileTreeRowClickSuppressed,
  moveEntryIntoTreeDir,
  moveFileTreeDragGhost,
  openFileFromTree,
  openPickedFile,
  parentDir,
  pasteIntoTree,
  resetFileTreeRowClickSuppressed,
  setPickedFolder,
  showFileTreeDragGhost,
  statusPriority,
} from "./utils";
import {
  fileTreeViewCreateFileIPC,
  fileTreeViewCreateFolderIPC,
  fileTreeViewReadClipboardFilePathsIPC,
  fileTreeViewRenameEntryIPC,
} from "./ipc";

function useFileStatusMap(): Map<string, string> {
  const fileStatuses = useGitStore((state) => state.fileStatuses);
  return useMemo(() => {
    if (!fileStatuses.length) return new Map();
    const map = new Map<string, string>();
    for (const fileStatus of fileStatuses) {
      map.set(fileStatus.path, fileStatus.status);
      let dir = fileStatus.path;
      while (true) {
        const idx = dir.lastIndexOf("/");
        if (idx <= 0) break;
        dir = dir.substring(0, idx);
        const existing = map.get(dir);
        if (!existing || statusPriority(fileStatus.status) > statusPriority(existing)) {
          map.set(dir, fileStatus.status);
        } else {
          break;
        }
      }
    }
    return map;
  }, [fileStatuses]);
}

function useFileTreeView(): FileTreeViewModel {
  const tree = useFilesStore((state) => state.tree);
  const rootPath = useFilesStore((state) => state.rootPath);
  const isLoading = useFilesStore((state) => state.isLoading);
  const loadError = useFilesStore((state) => state.loadError);
  const clipboardPath = useFilesStore((state) => state.clipboardPath);
  const ctxMenu = useContextMenu<FileTreeEntry | null>();
  const statusMap = useFileStatusMap();
  // Whether the OS clipboard holds files (e.g. copied in Finder), re-probed each
  // time the context menu opens so Paste can enable for an external copy.
  const [hasOsFiles, setHasOsFiles] = useState(false);

  const openContextMenu = useCallback((event: ReactMouseEvent, node: FileTreeEntry | null) => {
    ctxMenu.open(event, node);
    fileTreeViewReadClipboardFilePathsIPC()
      .then((paths) => setHasOsFiles(paths.length > 0))
      .catch(() => setHasOsFiles(false));
  }, [ctxMenu]);

  const onClickOpenFile = useCallback(() => {
    pickFile().catch(() => {});
  }, []);

  const onClickOpenFolder = useCallback(() => {
    pickFolder().catch(() => {});
  }, []);

  const onContextMenuEmpty = useCallback((event: ReactMouseEvent) => {
    openContextMenu(event, null);
  }, [openContextMenu]);

  const onContextMenuRow = useCallback((event: ReactMouseEvent, node: FileTreeEntry) => {
    openContextMenu(event, node);
  }, [openContextMenu]);

  const onContextMenuTree = useCallback((event: ReactMouseEvent) => {
    openContextMenu(event, null);
  }, [openContextMenu]);

  const onKeyDownTree = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const meta = event.metaKey || event.ctrlKey;
    const selected = useFilesStore.getState().selectedPath;
    if (!selected) return;
    if (meta && event.key === "x") {
      event.preventDefault();
      useFilesStore.getState().setClipboard(selected, "cut");
    } else if (meta && event.key === "c") {
      event.preventDefault();
      useFilesStore.getState().setClipboard(selected, "copy");
    } else if (meta && event.key === "d") {
      event.preventDefault();
      handleDuplicate(selected);
    } else if (meta && event.key === "v") {
      event.preventDefault();
      pasteIntoTree(selected).catch(() => {});
    } else if (event.key === "F2" || (event.shiftKey && event.key === "F6")) {
      event.preventDefault();
      useFilesStore.getState().setRenamingPath(selected);
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      handleDelete(selected);
    }
  }, []);

  return {
    contextMenuItems: fileContextMenuItems({
      node: ctxMenu.state?.context ?? null,
      rootPath,
      hasClipboard: Boolean(clipboardPath),
      hasOsFiles,
      hasTree: Boolean(tree),
      onOpenFile: onClickOpenFile,
      onOpenFolder: onClickOpenFolder,
    }),
    ctxMenu,
    isLoading,
    loadError,
    onClickOpenFile,
    onClickOpenFolder,
    onContextMenuEmpty,
    onContextMenuRow,
    onContextMenuTree,
    onKeyDownTree,
    statusMap,
    tree,
  };
}

function useFileTreeInlineCreateRow(dirPath: string): FileTreeInlineCreateViewModel {
  const creatingInDir = useFilesStore((state) => state.creatingInDir);
  const creatingType = useFilesStore((state) => state.creatingType);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creatingInDir === dirPath && inputRef.current) {
      inputRef.current.focus();
    }
  }, [creatingInDir, dirPath]);

  const isFolder = creatingType === "folder";

  const commitCreate = useCallback((name: string) => {
    createEntry(dirPath, name, isFolder).catch(() => {});
  }, [dirPath, isFolder]);

  return {
    inputRef,
    isFolder,
    onBlurCreate: (event) => commitCreate(event.currentTarget.value.trim()),
    onClickCreateInput: (event) => event.stopPropagation(),
    onKeyDownCreate: (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        commitCreate(event.currentTarget.value.trim());
      } else if (event.key === "Escape") {
        useFilesStore.getState().cancelCreating();
      }
    },
    placeholder: isFolder ? "folder name" : "file name",
    visible: creatingInDir === dirPath && Boolean(creatingType),
  };
}

function useFileTreeInlineRename(
  path: string,
  currentName: string,
): FileTreeInlineRenameViewModel {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      const dotIdx = currentName.lastIndexOf(".");
      inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : currentName.length);
    }
  }, [currentName]);

  const commitRename = useCallback((newName: string) => {
    renameEntry(path, currentName, newName).catch(() => {});
  }, [currentName, path]);

  return {
    inputRef,
    onBlurRename: (event) => commitRename(event.currentTarget.value.trim()),
    onClickRenameInput: (event) => event.stopPropagation(),
    onKeyDownRename: (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        commitRename(event.currentTarget.value.trim());
      } else if (event.key === "Escape") {
        useFilesStore.getState().setRenamingPath(null);
      }
    },
  };
}

function useFileTreeRow(
  node: FileTreeEntry,
  statusMap: Map<string, string>,
): FileTreeRowViewModel {
  const expanded = useFilesStore((state) => state.expanded.has(node.path));
  const isActiveFile = useTabsStore((state) => {
    const active = state.tabs.find((tab) => tab.id === state.activeId);
    return active?.filePath === node.path;
  });
  const toggleExpanded = useFilesStore((state) => state.toggleExpanded);
  const selectPath = useFilesStore((state) => state.selectPath);
  const renamingPath = useFilesStore((state) => state.renamingPath);
  const gitStatus = statusMap.get(node.path);

  const onClickRow = useCallback(() => {
    // Swallow the synthetic click produced by the pointerup that ended a drag.
    if (consumeFileTreeRowClickSuppressed()) return;
    selectPath(node.path);
    if (node.isDir) {
      toggleExpanded(node.path);
    } else {
      openFileFromTree(node).catch(() => {});
    }
  }, [node, selectPath, toggleExpanded]);

  // Pointer-based drag to move an entry into a folder. Native HTML5 drag-drop is
  // suppressed by Tauri's webview file-drop handler, so we track pointer events
  // ourselves. Pointer capture is required: without it WKWebView doesn't reliably
  // deliver pointermove while a button is held. A small threshold keeps plain
  // clicks (select/open) working.
  const onPointerDownRow = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    resetFileTreeRowClickSuppressed();
    const el = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    const onMove = (move: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(move.clientX - startX, move.clientY - startY) < FILE_TREE_DRAG_THRESHOLD_PX) {
          return;
        }
        dragging = true;
        showFileTreeDragGhost(node.name, move.clientX, move.clientY);
      }
      moveFileTreeDragGhost(move.clientX, move.clientY);
      highlightFileTreeDropTargetAt(move.clientX, move.clientY);
    };

    const finish = (up: PointerEvent | null) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        // capture may already be released
      }
      if (!dragging) return;
      markFileTreeRowClickSuppressed();
      clearFileTreeDragGhost();
      clearFileTreeDropHighlight();
      const destDir = up ? fileTreeDropTargetDirAt(up.clientX, up.clientY) : null;
      if (destDir) moveEntryIntoTreeDir(node.path, destDir).catch(() => {});
    };
    const onPointerUp = (up: PointerEvent) => finish(up);
    const onPointerCancel = () => finish(null);

    try {
      el.setPointerCapture(pointerId);
    } catch {
      // setPointerCapture unsupported (e.g. jsdom); listeners below still run.
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
  }, [node.path]);

  return {
    expanded,
    gitStatus,
    isActiveFile,
    isRenaming: renamingPath === node.path,
    onClickRow,
    onPointerDownRow,
    rowClassName: `mdbc-file-row ${isActiveFile ? "selected" : ""} mdbc-file-tree-row-indent mdbc-file-tree-row-opacity`,
    rowStyle: { "--mdbc-file-tree-row-opacity": node.gitIgnored ? 0.45 : undefined } as CSSProperties,
  };
}

async function createEntry(dirPath: string, name: string, isFolder: boolean): Promise<void> {
  useFilesStore.getState().cancelCreating();
  if (!name) return;
  const sep = dirPath.includes("/") ? "/" : "\\";
  const path = `${dirPath}${sep}${name}`;
  try {
    if (isFolder) await fileTreeViewCreateFolderIPC(path);
    else await fileTreeViewCreateFileIPC(path);
    await useFilesStore.getState().refresh();
    useFilesStore.getState().selectPath(path);
  } catch (error) {
    console.error("Failed to create", error);
  }
}

async function pickFile(): Promise<void> {
  try {
    const picked = await openDialog({ directory: false, multiple: false });
    if (typeof picked !== "string") return;
    await openPickedFile(picked);
  } catch (error) {
    console.error("file picker failed", error);
  }
}

async function pickFolder(): Promise<void> {
  try {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    await setPickedFolder(picked);
  } catch (error) {
    console.error("folder picker failed", error);
  }
}

async function renameEntry(path: string, currentName: string, newName: string): Promise<void> {
  useFilesStore.getState().setRenamingPath(null);
  if (!newName || newName === currentName) return;
  const dir = parentDir(path);
  const sep = dir.includes("/") ? "/" : "\\";
  const newPath = `${dir}${sep}${newName}`;
  try {
    await fileTreeViewRenameEntryIPC(path, newPath);
    await useFilesStore.getState().refresh();
    useFilesStore.getState().selectPath(newPath);
  } catch (error) {
    console.error("Rename failed", error);
  }
}

export {
  useFileStatusMap,
  useFileTreeInlineCreateRow,
  useFileTreeInlineRename,
  useFileTreeRow,
  useFileTreeView,
};
