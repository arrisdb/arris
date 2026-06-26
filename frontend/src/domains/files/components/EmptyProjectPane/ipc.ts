import { invoke } from "@tauri-apps/api/core";

function emptyProjectPaneReadTextFileIPC(path: string): Promise<string> {
  return invoke("cmd_read_text_file", { path });
}

export { emptyProjectPaneReadTextFileIPC };
