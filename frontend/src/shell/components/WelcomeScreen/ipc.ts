import { invoke } from "@tauri-apps/api/core";
import type { FileTreeEntry } from "@shared";

function welcomeCreateFolderIPC(path: string): Promise<void> {
  return invoke("cmd_create_folder", { path });
}

function welcomeGitCloneIPC(url: string, dest: string): Promise<string> {
  return invoke("cmd_git_clone", { url, dest });
}

function welcomeListFolderTreeIPC(root: string, skipDirs: string[]): Promise<FileTreeEntry> {
  return invoke("cmd_list_folder_tree", { root, skipDirs });
}

function welcomeWriteTextFileIPC(path: string, content: string): Promise<void> {
  return invoke("cmd_write_text_file", { path, content });
}

// Runs a statement against an already-saved connection. The driver opens (and
// for file-based kinds, creates) the database on first use, so this both
// materializes sample.duckdb and seeds it. Result is ignored.
function welcomeRunQueryIPC(connectionId: string, sql: string): Promise<unknown> {
  return invoke("cmd_run_query", { connectionId, sql, params: [] });
}

export {
  welcomeCreateFolderIPC,
  welcomeGitCloneIPC,
  welcomeListFolderTreeIPC,
  welcomeRunQueryIPC,
  welcomeWriteTextFileIPC,
};
