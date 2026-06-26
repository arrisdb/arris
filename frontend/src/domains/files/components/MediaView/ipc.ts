import { invoke } from "@tauri-apps/api/core";

function mediaViewReadFileBase64IPC(path: string): Promise<string> {
  return invoke("cmd_read_file_base64", { path });
}

function mediaViewOpenInDefaultAppIPC(path: string): Promise<void> {
  return invoke("cmd_open_in_default_app", { path });
}

export { mediaViewReadFileBase64IPC, mediaViewOpenInDefaultAppIPC };
