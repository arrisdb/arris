import type { ObjectRef } from "./ipc";
import type { SchemaNode, SchemaNodeKind } from "./types";

/// Object kinds the backend `cmd_object_definition` can resolve a DDL for. Any
/// other kind errors from the backend, so "Show Definition" is only offered on
/// these.
const DEFINITION_SUPPORTED_KINDS: ReadonlySet<SchemaNodeKind> = new Set([
  "schema",
  "database",
  "table",
  "view",
  "materializedView",
  "foreignTable",
  "sequence",
  "index",
  "function",
  "procedure",
  "trigger",
  "event",
]);

function filterSchemaTree(nodes: SchemaNode[], query: string): SchemaNode[] {
  const out: SchemaNode[] = [];
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(query)) {
      out.push(node);
      continue;
    }
    const children = filterSchemaTree(node.children, query);
    if (children.length > 0) out.push({ ...node, children });
  }
  return out;
}

function ipcErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/// True when a node's kind has a resolvable DDL via `cmd_object_definition`.
function isDefinitionSupportedKind(kind: SchemaNodeKind): boolean {
  return DEFINITION_SUPPORTED_KINDS.has(kind);
}

/// Build the backend `ObjectRef` from a schema-tree leaf. The node `path` is the
/// dot-joined identity; the trailing segment is the object name (always equal to
/// `node.name`), the leading one the database.
///
/// `databaseActsAsSchema` selects how to read the middle segments:
///  * `false` (Postgres/MSSQL/Oracle): there is a real schema level, so a
///    3-segment path is `database.schema.name` and a 2-segment one `schema.name`.
///  * `true` (MySQL/MariaDB): there is NO schema level; the database doubles as
///    the schema. Any middle segments are group-folder slugs embedded for path
///    uniqueness (e.g. `appdb.routines.foo`, `appdb.triggers.bar`) and must be
///    dropped, yielding `{ database, name }`.
///
/// Container nodes are special: their own identity is the `name`, not a `schema`
/// qualifier. A `schema` node's path is `database.schema` (or bare `schema`), so
/// the leading segment, when present, is its database catalog. A `database` node
/// is the bare database name and doubles as its own database.
function objectRefFromNode(node: SchemaNode, databaseActsAsSchema: boolean): ObjectRef {
  const parts = node.path.split(".");
  if (node.kind === "schema") {
    const database = parts.length >= 2 ? parts[0] : undefined;
    return { kind: node.kind, database, name: node.name };
  }
  if (node.kind === "database") {
    return { kind: node.kind, database: node.name, name: node.name };
  }
  if (databaseActsAsSchema) {
    return { kind: node.kind, database: parts[0], name: node.name };
  }
  if (parts.length >= 3) {
    return { kind: node.kind, database: parts[0], schema: parts[1], name: node.name };
  }
  if (parts.length >= 2) {
    return { kind: node.kind, schema: parts[0], name: node.name };
  }
  return { kind: node.kind, name: node.name };
}

/// Depth-first lookup of the node with `path` across a connection's cached
/// schema trees. Returns `null` when no node matches (e.g. the selection is a
/// schema/database/group container rather than a real object).
function findSchemaNodeByPath(nodes: SchemaNode[], path: string): SchemaNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = findSchemaNodeByPath(node.children, path);
    if (found) return found;
  }
  return null;
}

/// True when the schema/database container named `name` already has its tables
/// loaded (any children). Used by lazy-schema sources (e.g. BigQuery) to decide
/// whether selecting a dataset needs a `cmd_list_schema` fetch or it is already
/// populated in the cached tree.
function isSchemaNodeLoaded(nodes: SchemaNode[], name: string): boolean {
  for (const node of nodes) {
    if (
      (node.kind === "schema" || node.kind === "database") &&
      node.name === name
    ) {
      return node.children.length > 0;
    }
    if (isSchemaNodeLoaded(node.children, name)) return true;
  }
  return false;
}

export {
  filterSchemaTree,
  findSchemaNodeByPath,
  ipcErrorMessage,
  isDefinitionSupportedKind,
  isSchemaNodeLoaded,
  objectRefFromNode,
};
