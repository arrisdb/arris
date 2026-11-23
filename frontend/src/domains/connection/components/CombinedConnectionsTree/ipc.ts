import { invoke } from "@tauri-apps/api/core";
import { apiCall, isWebShell } from "@shared/api";
import type {
  ConnectionConfig,
  ConnectionScope,
  SchemaNode,
  SchemaNodeKind,
  ScopedConnection,
  TableRef,
} from "./types";

/// Identity of a database object whose DDL the backend resolves. Owned locally
/// by this IPC boundary; serialized as camelCase to match the Rust `ObjectRef`.
interface ObjectRef {
  kind: SchemaNodeKind;
  database?: string;
  schema?: string;
  name: string;
}

// The arris server connects on demand when schemas are listed.
function connectConnectionIPC(connectionId: string): Promise<void> {
  if (isWebShell()) return Promise.resolve();
  return invoke("cmd_connect", { connectionId });
}

function objectDefinitionIPC(
  connectionId: string,
  object: ObjectRef,
): Promise<string> {
  if (isWebShell()) return apiCall("object_definition", { connection: connectionId, object });
  return invoke("cmd_object_definition", { connectionId, object });
}

function deleteConnectionIPC(id: string): Promise<void> {
  if (isWebShell()) return apiCall("connection_remove", { connection: id });
  return invoke("cmd_delete_connection", { id });
}

// The arris server keeps drivers for its lifetime; there is nothing to disconnect.
function disconnectConnectionIPC(connectionId: string): Promise<void> {
  if (isWebShell()) return Promise.resolve();
  return invoke("cmd_disconnect", { connectionId });
}

function importConnectionToLocalIPC(id: string): Promise<ScopedConnection[]> {
  return invoke("cmd_import_connection", { id });
}

function listConnectionsIPC(): Promise<ScopedConnection[]> {
  if (isWebShell()) return apiCall("connection_list");
  return invoke("cmd_list_connections");
}

function listSchemasIPC(connectionId: string): Promise<SchemaNode[]> {
  if (isWebShell()) return apiCall("schema_list", { connection: connectionId });
  return invoke("cmd_list_schemas", { connectionId });
}

function listSchemaIPC(connectionId: string, schema: string): Promise<SchemaNode[]> {
  if (isWebShell()) return apiCall("schema_list", { connection: connectionId, schema });
  return invoke("cmd_list_schema", { connectionId, schema });
}

function promoteConnectionIPC(id: string): Promise<ScopedConnection[]> {
  return invoke("cmd_promote_connection", { id });
}

function saveConnectionIPC(
  config: ConnectionConfig,
  scope: ConnectionScope = "local",
): Promise<ScopedConnection[]> {
  return invoke("cmd_save_connection", { config, scope });
}

function reorderConnectionsIPC(ids: string[]): Promise<ScopedConnection[]> {
  return invoke("cmd_reorder_connections", { ids });
}

function tableBrowseQueryIPC(
  connectionId: string,
  table: TableRef,
  limit?: number,
): Promise<string> {
  if (isWebShell()) return apiCall("table_browse_query", { connection: connectionId, table, limit });
  return invoke("cmd_table_browse_query", { connectionId, table, limit });
}

export {
  connectConnectionIPC,
  deleteConnectionIPC,
  disconnectConnectionIPC,
  importConnectionToLocalIPC,
  listConnectionsIPC,
  listSchemaIPC,
  listSchemasIPC,
  objectDefinitionIPC,
  promoteConnectionIPC,
  reorderConnectionsIPC,
  saveConnectionIPC,
  tableBrowseQueryIPC,
};

export type { ObjectRef };
