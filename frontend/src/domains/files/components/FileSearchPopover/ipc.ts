import { invoke } from "@tauri-apps/api/core";
import type {
  ContentMatch,
  FileMatch,
} from "./types";

function fileSearchPopoverReadTextFileIPC(path: string): Promise<string> {
  return invoke("cmd_read_text_file", { path });
}

function fileSearchPopoverSearchContentIPC(query: string, limit: number): Promise<ContentMatch[]> {
  return invoke("cmd_search_content", { query, limit });
}

function fileSearchPopoverSearchFilesIPC(query: string, limit: number): Promise<FileMatch[]> {
  return invoke("cmd_search_files", { query, limit });
}

export {
  fileSearchPopoverReadTextFileIPC,
  fileSearchPopoverSearchContentIPC,
  fileSearchPopoverSearchFilesIPC,
};
