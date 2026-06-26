import { invoke } from "@tauri-apps/api/core";

function terminalListShellsIPC(): Promise<string[]> {
  return invoke("cmd_terminal_list_shells");
}

export {
  terminalListShellsIPC,
};
