import { invoke } from "@tauri-apps/api/core";
import type {
  DbtCommandResult,
  DbtCompileResult,
  DbtDocs,
  DiffHunk,
  PlanResult,
  QueryLanguage,
  QueryResult,
  QueryValue,
  SchemaNode,
  SqlMeshCommandResult,
  SqlMeshRenderResult,
} from "@shared";

function cancelQueryIPC(queryId: string): Promise<void> {
  return invoke("cmd_cancel_query", { queryId });
}

function connectConnectionIPC(connectionId: string): Promise<void> {
  return invoke("cmd_connect", { connectionId });
}

function dbtBuildIPC(
  root: string,
  select: string,
  args: string[] = [],
  dbtBinary?: string,
): Promise<DbtCommandResult> {
  return invoke("cmd_dbt_build", { root, select, args, dbtBinary });
}

function dbtCompileIPC(
  root: string,
  select: string,
  projectName: string,
  dbtBinary?: string,
): Promise<DbtCompileResult> {
  return invoke("cmd_dbt_compile", { root, select, projectName, dbtBinary });
}

function dbtDocsGenerateIPC(
  root: string,
  args: string[] = [],
  dbtBinary?: string,
): Promise<DbtCommandResult> {
  return invoke("cmd_dbt_docs_generate", { root, args, dbtBinary });
}

function dbtDocsLoadIPC(root: string): Promise<DbtDocs> {
  return invoke("cmd_dbt_docs_load", { root });
}

function dbtRunIPC(
  root: string,
  select: string,
  args: string[] = [],
  dbtBinary?: string,
): Promise<DbtCommandResult> {
  return invoke("cmd_dbt_run", { root, select, args, dbtBinary });
}

function dbtTestIPC(
  root: string,
  select: string,
  args: string[] = [],
  dbtBinary?: string,
): Promise<DbtCommandResult> {
  return invoke("cmd_dbt_test", { root, select, args, dbtBinary });
}

function explainQueryIPC(
  connectionId: string,
  sql: string,
  mode: "dryRun" | "analyze",
  params: QueryValue[] = [],
  language?: QueryLanguage,
): Promise<PlanResult> {
  return invoke("cmd_explain_query", { connectionId, sql, params, language, mode });
}

function gitFileDiffHunksIPC(repo: string, filePath: string): Promise<DiffHunk[]> {
  return invoke("cmd_git_file_diff_hunks", { repo, filePath });
}

function gitStageHunkIPC(repo: string, filePath: string, hunkIndex: number): Promise<void> {
  return invoke("cmd_git_stage_hunk", { repo, filePath, hunkIndex });
}

function gitRestoreChangeIPC(
  repo: string,
  filePath: string,
  startLine: number,
  endLine: number,
): Promise<void> {
  return invoke("cmd_git_restore_change", { repo, filePath, startLine, endLine });
}

function listSchemasIPC(connectionId: string): Promise<SchemaNode[]> {
  return invoke("cmd_list_schemas", { connectionId });
}

function readTextFileIPC(path: string): Promise<string> {
  return invoke("cmd_read_text_file", { path });
}

function runFederationQueryIPC(sql: string, queryId?: string): Promise<QueryResult> {
  return invoke("cmd_run_federation_query", { sql, queryId });
}

function runQueryIPC(
  connectionId: string,
  sql: string,
  params: QueryValue[] = [],
  language?: QueryLanguage,
  pageSize?: number,
  page?: number,
  queryId?: string,
): Promise<QueryResult> {
  return invoke("cmd_run_query", { connectionId, sql, params, language, pageSize, page, queryId });
}

function setTransactionConfigIPC(
  connectionId: string,
  mode: "auto" | "manual",
  isolation: "default" | "readCommitted" | "repeatableRead" | "serializable",
): Promise<void> {
  return invoke("cmd_set_transaction_config", { connectionId, mode, isolation });
}

function commitTransactionIPC(connectionId: string): Promise<void> {
  return invoke("cmd_commit_transaction", { connectionId });
}

function rollbackTransactionIPC(connectionId: string): Promise<void> {
  return invoke("cmd_rollback_transaction", { connectionId });
}

function sqlmeshPlanIPC(
  root: string,
  select: string,
  environment?: string | null,
  args: string[] = [],
  sqlmeshBinary?: string,
): Promise<SqlMeshCommandResult> {
  return invoke("cmd_sqlmesh_plan", {
    root,
    select,
    environment: environment ?? null,
    args,
    sqlmeshBinary,
  });
}

function sqlmeshRenderIPC(
  root: string,
  modelName: string,
  sqlmeshBinary?: string,
): Promise<SqlMeshRenderResult> {
  return invoke("cmd_sqlmesh_render", { root, modelName, sqlmeshBinary });
}

function sqlmeshTestIPC(
  root: string,
  select: string,
  args: string[] = [],
  sqlmeshBinary?: string,
): Promise<SqlMeshCommandResult> {
  return invoke("cmd_sqlmesh_test", { root, select, args, sqlmeshBinary });
}

function sqlmeshTestTargetIPC(
  root: string,
  target: string,
  args: string[] = [],
  sqlmeshBinary?: string,
): Promise<SqlMeshCommandResult> {
  return invoke("cmd_sqlmesh_test_target", { root, target, args, sqlmeshBinary });
}

function sqlmeshRunIPC(
  root: string,
  args: string[] = [],
  sqlmeshBinary?: string,
): Promise<SqlMeshCommandResult> {
  return invoke("cmd_sqlmesh_run", { root, args, sqlmeshBinary });
}

function sqlmeshLintIPC(
  root: string,
  select: string,
  args: string[] = [],
  sqlmeshBinary?: string,
): Promise<SqlMeshCommandResult> {
  return invoke("cmd_sqlmesh_lint", { root, select, args, sqlmeshBinary });
}

function sqlmeshAuditIPC(
  root: string,
  select: string,
  args: string[] = [],
  sqlmeshBinary?: string,
): Promise<SqlMeshCommandResult> {
  return invoke("cmd_sqlmesh_audit", { root, select, args, sqlmeshBinary });
}

function writeTextFileIPC(path: string, content: string): Promise<void> {
  return invoke("cmd_write_text_file", { path, content });
}

export {
  cancelQueryIPC,
  connectConnectionIPC,
  dbtBuildIPC,
  dbtCompileIPC,
  dbtDocsGenerateIPC,
  dbtDocsLoadIPC,
  dbtRunIPC,
  dbtTestIPC,
  explainQueryIPC,
  gitFileDiffHunksIPC,
  gitRestoreChangeIPC,
  gitStageHunkIPC,
  listSchemasIPC,
  readTextFileIPC,
  runFederationQueryIPC,
  runQueryIPC,
  setTransactionConfigIPC,
  commitTransactionIPC,
  rollbackTransactionIPC,
  sqlmeshAuditIPC,
  sqlmeshLintIPC,
  sqlmeshPlanIPC,
  sqlmeshRenderIPC,
  sqlmeshRunIPC,
  sqlmeshTestIPC,
  sqlmeshTestTargetIPC,
  writeTextFileIPC,
};
