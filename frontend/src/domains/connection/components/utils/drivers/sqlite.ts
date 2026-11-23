import type { SchemaNode, TableRef } from "../../CombinedConnectionsTree/types";
import type { SchemaGrouping } from "./types";
import { makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Tables", kinds: ["table"] },
  { label: "Views", kinds: ["view"] },
  { label: "Indexes", kinds: ["index"] },
  { label: "Triggers", kinds: ["trigger"] },
];

// The tree's database level is the file name, but SQLite only knows it as `main`.
function sqliteTableRefFromNode(node: SchemaNode): TableRef {
  return { name: node.name };
}

export const sqliteDriver: ConnectionDriver = {
  kind: "sqlite",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: true,
  schemaTermLabel: "Databases",
  tableOpenableKinds: new Set(["table", "view"]),
  editableKinds: new Set(["table"]),
  hideDetailKinds: new Set(["database", "schema", "group", "table", "view"]),
  defaultPort: undefined,
  uriScheme: "sqlite",
  tableRefFromNode: sqliteTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(true),
  groupSchemaTree: makeGroupSchemaTree(true, schemaGrouping),
};
