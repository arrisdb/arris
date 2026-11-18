import { invoke } from "@tauri-apps/api/core";
import { apiCall, isWebShell } from "@shared/api";
import type {
  ContentMatch,
  FileMatch,
} from "./types";

function fileSearchPopoverReadTextFileIPC(path: string): Promise<string> {
  if (isWebShell()) return apiCall("file_read", { path });
  return invoke("cmd_read_text_file", { path });
}

function fileSearchPopoverSearchContentIPC(query: string, limit: number): Promise<ContentMatch[]> {
  if (isWebShell()) return apiCall("content_search", { query, limit });
  return invoke("cmd_search_content", { query, limit });
}

function fileSearchPopoverSearchFilesIPC(query: string, limit: number): Promise<FileMatch[]> {
  if (isWebShell()) return apiCall("file_search", { query, limit });
  return invoke("cmd_search_files", { query, limit });
}

export {
  fileSearchPopoverReadTextFileIPC,
  fileSearchPopoverSearchContentIPC,
  fileSearchPopoverSearchFilesIPC,
};
