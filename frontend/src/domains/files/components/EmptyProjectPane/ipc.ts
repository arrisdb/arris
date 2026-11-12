import { invoke } from "@tauri-apps/api/core";
import { apiCall, isWebShell } from "@shared/api";

function emptyProjectPaneReadTextFileIPC(path: string): Promise<string> {
  if (isWebShell()) return apiCall("file_read", { path });
  return invoke("cmd_read_text_file", { path });
}

export { emptyProjectPaneReadTextFileIPC };
