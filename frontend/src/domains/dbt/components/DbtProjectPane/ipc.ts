import { invoke } from "@tauri-apps/api/core";
import type { DbtRunResults } from "@shared";
import type {
  DbtCommandResult,
  DbtProfileInfo,
  DbtScannedProject,
  TableRef,
} from "./types";

function dbtProjectPaneCheckCliIPC(rootPath: string, dbtBinary: string): Promise<string> {
  return invoke("cmd_dbt_check_cli", { root: rootPath, dbtBinary });
}

function dbtProjectPaneListProfilesIPC(rootPath: string): Promise<DbtProfileInfo[]> {
  return invoke("cmd_dbt_list_profiles", { root: rootPath });
}

function dbtProjectPaneScanProjectIPC(rootPath: string): Promise<DbtScannedProject> {
  return invoke("cmd_scan_dbt_project", { root: rootPath });
}

function dbtProjectPaneRunIPC(root: string, select: string, args: string[], dbtBinary?: string): Promise<DbtCommandResult> {
  return invoke("cmd_dbt_run", { root, select, args, dbtBinary });
}

function dbtProjectPaneTestIPC(root: string, select: string, args: string[], dbtBinary?: string): Promise<DbtCommandResult> {
  return invoke("cmd_dbt_test", { root, select, args, dbtBinary });
}

function dbtProjectPaneBuildIPC(root: string, select: string, args: string[], dbtBinary?: string): Promise<DbtCommandResult> {
  return invoke("cmd_dbt_build", { root, select, args, dbtBinary });
}

// `dbt debug` validates the project's profile/connection config; it is
// project-wide and takes no `--select`, so the selector arg is ignored.
function dbtProjectPaneDebugIPC(root: string, _select: string, args: string[], dbtBinary?: string): Promise<DbtCommandResult> {
  return invoke("cmd_dbt_debug", { root, args, dbtBinary });
}

function dbtProjectPaneReadTextFileIPC(path: string): Promise<string> {
  return invoke("cmd_read_text_file", { path });
}

function dbtProjectPaneReadRunResultsIPC(root: string): Promise<DbtRunResults> {
  return invoke("cmd_dbt_read_run_results", { root });
}

function dbtProjectPaneTableBrowseQueryIPC(connectionId: string, table: TableRef): Promise<string> {
  return invoke("cmd_table_browse_query", { connectionId, table });
}

export {
  dbtProjectPaneBuildIPC,
  dbtProjectPaneDebugIPC,
  dbtProjectPaneCheckCliIPC,
  dbtProjectPaneListProfilesIPC,
  dbtProjectPaneReadRunResultsIPC,
  dbtProjectPaneReadTextFileIPC,
  dbtProjectPaneRunIPC,
  dbtProjectPaneScanProjectIPC,
  dbtProjectPaneTableBrowseQueryIPC,
  dbtProjectPaneTestIPC,
};
