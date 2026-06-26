import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Tables", kinds: ["table"] },
  { label: "Views", kinds: ["view"] },
  { label: "Indexes", kinds: ["index"] },
  { label: "Triggers", kinds: ["trigger"] },
];

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
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(true),
  groupSchemaTree: makeGroupSchemaTree(true, schemaGrouping),
};
