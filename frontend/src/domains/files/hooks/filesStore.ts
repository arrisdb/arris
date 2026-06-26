
import { create } from "zustand";
import { ipcErrorMessage } from "@shared";
import { useRecentsStore } from "@shell/hooks/recentsStore";
import { useGitStore } from "@domains/git/hooks";
import { useSettingsStore } from "@shared/settings";
import { FILE_TREE_DEFAULT_EXPANDED_DIRS } from "@domains/files/components/FileTreeView/constants";
import { fileTreeViewListFolderTreeIPC } from "@domains/files/components/FileTreeView/ipc";
import type {
  ClipboardOp,
  CreatingType,
  FileTreeEntry,
} from "@domains/files/components/FileTreeView/types";

interface FilesState {
  rootPath: string | null;
  tree: FileTreeEntry | null;
  isLoading: boolean;
  loadError: string | null;
  expanded: Set<string>;
  selectedPath: string | null;
  clipboardPath: string | null;
  clipboardOp: ClipboardOp;
  renamingPath: string | null;
  creatingInDir: string | null;
  creatingType: CreatingType;
  setTree: (root: string, tree: FileTreeEntry) => void;
  loadFromPath: (root: string) => Promise<void>;
  refresh: () => Promise<void>;
  toggleExpanded: (path: string) => void;
  setExpanded: (path: string, open: boolean) => void;
  selectPath: (path: string | null) => void;
  setClipboard: (path: string, op: "cut" | "copy") => void;
  clearClipboard: () => void;
  setRenamingPath: (path: string | null) => void;
  startCreating: (dirPath: string, type: "file" | "folder") => void;
  cancelCreating: () => void;
  clear: () => void;
}

function basenameOf(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function defaultExpanded(tree: FileTreeEntry): Set<string> {
  const out = new Set<string>([tree.path]);
  const wellKnown = new Set(FILE_TREE_DEFAULT_EXPANDED_DIRS);
  for (const child of tree.children) {
    if (child.isDir && wellKnown.has(child.name.toLowerCase())) {
      out.add(child.path);
    }
  }
  return out;
}

const useFilesStore = create<FilesState>((set, get) => ({
  rootPath: null,
  tree: null,
  isLoading: false,
  loadError: null,
  expanded: new Set<string>(),
  selectedPath: null,
  clipboardPath: null,
  clipboardOp: null,
  renamingPath: null,
  creatingInDir: null,
  creatingType: null,
  setTree: (root, tree) => {
    set({
      rootPath: root,
      tree,
      isLoading: false,
      loadError: null,
      expanded: defaultExpanded(tree),
    });
    useRecentsStore.getState().add({
      path: root,
      name: basenameOf(root),
      kind: "folder",
      openedAt: Date.now(),
      branch: useGitStore.getState().currentBranch,
    });
  },
  loadFromPath: async (root) => {
    set({ isLoading: true, loadError: null });
    try {
      const tree = await fileTreeViewListFolderTreeIPC(
        root,
        useSettingsStore.getState().fileTreeSkipDirs,
      );
      set({
        rootPath: root,
        tree,
        isLoading: false,
        loadError: null,
        expanded: defaultExpanded(tree),
      });
      useGitStore.getState().refreshFromRepo(root).catch(() => {});
      useRecentsStore.getState().add({
        path: root,
        name: basenameOf(root),
        kind: "folder",
        openedAt: Date.now(),
        branch: useGitStore.getState().currentBranch,
      });
    } catch (e) {
      set({ isLoading: false, loadError: ipcErrorMessage(e) });
    }
  },
  refresh: async () => {
    const { rootPath, expanded } = get();
    if (!rootPath) return;
    try {
      const tree = await fileTreeViewListFolderTreeIPC(
        rootPath,
        useSettingsStore.getState().fileTreeSkipDirs,
      );
      set({ tree, expanded: new Set([...expanded, ...defaultExpanded(tree)]) });
      useGitStore.getState().refreshFileStatuses().catch(() => {});
    } catch (_) {}
  },
  toggleExpanded: (path) => {
    const next = new Set(get().expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    set({ expanded: next });
  },
  setExpanded: (path, open) => {
    const next = new Set(get().expanded);
    if (open) next.add(path);
    else next.delete(path);
    set({ expanded: next });
  },
  selectPath: (selectedPath) => set({ selectedPath }),
  setClipboard: (path, op) => set({ clipboardPath: path, clipboardOp: op }),
  clearClipboard: () => set({ clipboardPath: null, clipboardOp: null }),
  setRenamingPath: (renamingPath) => set({ renamingPath }),
  startCreating: (dirPath, type) => {
    set({ creatingInDir: dirPath, creatingType: type });
    const next = new Set(get().expanded);
    next.add(dirPath);
    set({ expanded: next });
  },
  cancelCreating: () => set({ creatingInDir: null, creatingType: null }),
  clear: () =>
    set({
      rootPath: null,
      tree: null,
      isLoading: false,
      loadError: null,
      expanded: new Set<string>(),
      selectedPath: null,
      clipboardPath: null,
      clipboardOp: null,
      renamingPath: null,
      creatingInDir: null,
      creatingType: null,
    }),
}));

export {
  useFilesStore,
};
