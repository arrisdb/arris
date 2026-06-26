import { invoke } from "@tauri-apps/api/core";
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

function connectConnectionIPC(connectionId: string): Promise<void> {
  return invoke("cmd_connect", { connectionId });
}

function objectDefinitionIPC(
  connectionId: string,
  object: ObjectRef,
): Promise<string> {
  return invoke("cmd_object_definition", { connectionId, object });
}

function deleteConnectionIPC(id: string): Promise<void> {
  return invoke("cmd_delete_connection", { id });
}

function disconnectConnectionIPC(connectionId: string): Promise<void> {
  return invoke("cmd_disconnect", { connectionId });
}

function importConnectionToLocalIPC(id: string): Promise<ScopedConnection[]> {
  return invoke("cmd_import_connection", { id });
}

function listSchemasIPC(connectionId: string): Promise<SchemaNode[]> {
  return invoke("cmd_list_schemas", { connectionId });
}

function listSchemaIPC(connectionId: string, schema: string): Promise<SchemaNode[]> {
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
  return invoke("cmd_table_browse_query", { connectionId, table, limit });
}

export {
  connectConnectionIPC,
  deleteConnectionIPC,
  disconnectConnectionIPC,
  importConnectionToLocalIPC,
  listSchemaIPC,
  listSchemasIPC,
  objectDefinitionIPC,
  promoteConnectionIPC,
  reorderConnectionsIPC,
  saveConnectionIPC,
  tableBrowseQueryIPC,
};

export type { ObjectRef };
