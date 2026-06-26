import { invoke } from "@tauri-apps/api/core";
import type { FileTreeEntry } from "./types";

function fileTreeViewCopyEntryIPC(source: string, destination: string): Promise<void> {
  return invoke("cmd_copy_entry", { from: source, to: destination });
}

function fileTreeViewCreateFileIPC(path: string): Promise<void> {
  return invoke("cmd_create_file", { path });
}

function fileTreeViewCreateFolderIPC(path: string): Promise<void> {
  return invoke("cmd_create_folder", { path });
}

function fileTreeViewDeleteEntryIPC(path: string): Promise<void> {
  return invoke("cmd_delete_entry", { path });
}

function fileTreeViewDuplicateEntryIPC(path: string): Promise<string> {
  return invoke("cmd_duplicate_entry", { path });
}

function fileTreeViewListFolderTreeIPC(root: string, skipDirs: string[]): Promise<FileTreeEntry> {
  return invoke("cmd_list_folder_tree", { root, skipDirs });
}

// Move a project-root console/notebook file back into `.arris/files/` so it
// becomes an internal scratch tab again. Inverse of "Move to Project".
function fileTreeViewMoveTabToScratchIPC(id: string): Promise<void> {
  return invoke("cmd_move_tab_to_scratch", { id });
}

function fileTreeViewMoveEntryIPC(source: string, destination: string): Promise<void> {
  return invoke("cmd_move_entry", { from: source, to: destination });
}

function fileTreeViewReadTextFileIPC(path: string): Promise<string> {
  return invoke("cmd_read_text_file", { path });
}

function fileTreeViewRenameEntryIPC(oldPath: string, newPath: string): Promise<void> {
  return invoke("cmd_rename_entry", { from: oldPath, to: newPath });
}

function fileTreeViewReadClipboardFilePathsIPC(): Promise<string[]> {
  return invoke("cmd_read_clipboard_file_paths");
}

export {
  fileTreeViewCopyEntryIPC,
  fileTreeViewCreateFileIPC,
  fileTreeViewCreateFolderIPC,
  fileTreeViewDeleteEntryIPC,
  fileTreeViewDuplicateEntryIPC,
  fileTreeViewListFolderTreeIPC,
  fileTreeViewMoveEntryIPC,
  fileTreeViewMoveTabToScratchIPC,
  fileTreeViewReadClipboardFilePathsIPC,
  fileTreeViewReadTextFileIPC,
  fileTreeViewRenameEntryIPC,
};
