import { invoke } from "@tauri-apps/api/core";
import { apiCall, isWebShell } from "@shared/api";

function mediaViewReadFileBase64IPC(path: string): Promise<string> {
  if (isWebShell()) return apiCall("file_read_base64", { path });
  return invoke("cmd_read_file_base64", { path });
}

function mediaViewOpenInDefaultAppIPC(path: string): Promise<void> {
  if (isWebShell()) return apiCall("file_open_default", { path });
  return invoke("cmd_open_in_default_app", { path });
}

export { mediaViewReadFileBase64IPC, mediaViewOpenInDefaultAppIPC };
