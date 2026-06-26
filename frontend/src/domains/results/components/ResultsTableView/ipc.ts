import { invoke } from "@tauri-apps/api/core";
import type {
  MutationResult,
  QueryLanguage,
  QueryResult,
  QueryValue,
  SchemaNode,
  TableMutationBatch,
  TableRef,
} from "./types";

function runQueryIPC(
  connectionId: string,
  sql: string,
  params: QueryValue[] = [],
  language?: QueryLanguage,
  pageSize?: number,
  page?: number,
  queryId?: string,
): Promise<QueryResult> {
  return invoke("cmd_run_query", {
    connectionId,
    sql,
    params,
    language,
    pageSize,
    page,
    queryId,
  });
}

function runFederationQueryIPC(sql: string, queryId?: string): Promise<QueryResult> {
  return invoke("cmd_run_federation_query", { sql, queryId });
}

function applyMutationsIPC(
  connectionId: string,
  table: TableRef,
  batch: TableMutationBatch,
): Promise<MutationResult> {
  return invoke("cmd_apply_mutations", { connectionId, table, batch });
}

function listSchemasIPC(connectionId: string): Promise<SchemaNode[]> {
  return invoke("cmd_list_schemas", { connectionId });
}

function primaryKeyIPC(
  connectionId: string,
  table: TableRef,
): Promise<string[] | null> {
  return invoke("cmd_primary_key", { connectionId, table });
}

export {
  applyMutationsIPC,
  listSchemasIPC,
  primaryKeyIPC,
  runFederationQueryIPC,
  runQueryIPC,
};
