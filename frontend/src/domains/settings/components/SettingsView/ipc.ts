import { invoke } from "@tauri-apps/api/core";

function settingsListEditorFontsIPC(): Promise<string[]> {
  return invoke("cmd_list_editor_fonts");
}

function settingsTerminalListShellsIPC(): Promise<string[]> {
  return invoke("cmd_terminal_list_shells");
}

export {
  settingsListEditorFontsIPC,
  settingsTerminalListShellsIPC,
};
