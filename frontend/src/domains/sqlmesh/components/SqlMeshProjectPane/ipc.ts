import { invoke } from "@tauri-apps/api/core";
import type {
  SqlMeshCommandResult,
  SqlMeshEnvironmentInfo,
  SqlMeshGatewayInfo,
  SqlMeshScannedProject,
} from "./types";

function scanSqlMeshProjectIPC(root: string): Promise<SqlMeshScannedProject> {
  return invoke("cmd_scan_sqlmesh_project", { root });
}

function sqlmeshCheckCliIPC(
  root: string,
  sqlmeshBinary?: string,
): Promise<string> {
  return invoke("cmd_sqlmesh_check_cli", { root, sqlmeshBinary });
}

function sqlmeshListGatewaysIPC(root: string): Promise<SqlMeshGatewayInfo[]> {
  return invoke("cmd_sqlmesh_list_gateways", { root });
}

function sqlmeshListEnvironmentsIPC(
  root: string,
  sqlmeshBinary?: string,
): Promise<SqlMeshEnvironmentInfo[]> {
  return invoke("cmd_sqlmesh_list_environments", { root, sqlmeshBinary });
}

function sqlmeshPromoteIPC(
  root: string,
  target: string,
  args: string[] = [],
  sqlmeshBinary?: string,
): Promise<SqlMeshCommandResult> {
  return invoke("cmd_sqlmesh_promote", { root, target, args, sqlmeshBinary });
}

function sqlmeshPlanIPC(
  root: string,
  select: string,
  args: string[] = [],
  sqlmeshBinary?: string,
): Promise<SqlMeshCommandResult> {
  return invoke("cmd_sqlmesh_plan", { root, select, args, sqlmeshBinary });
}

function sqlmeshTestIPC(
  root: string,
  select: string,
  args: string[] = [],
  sqlmeshBinary?: string,
): Promise<SqlMeshCommandResult> {
  return invoke("cmd_sqlmesh_test", { root, select, args, sqlmeshBinary });
}

function sqlmeshRunIPC(
  root: string,
  args: string[] = [],
  sqlmeshBinary?: string,
): Promise<SqlMeshCommandResult> {
  return invoke("cmd_sqlmesh_run", { root, args, sqlmeshBinary });
}

function sqlmeshReadTextFileIPC(path: string): Promise<string> {
  return invoke("cmd_read_text_file", { path });
}

export {
  scanSqlMeshProjectIPC,
  sqlmeshCheckCliIPC,
  sqlmeshListEnvironmentsIPC,
  sqlmeshListGatewaysIPC,
  sqlmeshPlanIPC,
  sqlmeshPromoteIPC,
  sqlmeshReadTextFileIPC,
  sqlmeshRunIPC,
  sqlmeshTestIPC,
};
