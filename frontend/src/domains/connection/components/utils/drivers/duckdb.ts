import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Tables", kinds: ["table", "foreignTable"] },
  { label: "Views", kinds: ["view", "materializedView"] },
  { label: "Routines", kinds: ["function", "procedure"] },
  { label: "Sequences", kinds: ["sequence"] },
  { label: "Indexes", kinds: ["index"] },
];

export const duckdbDriver: ConnectionDriver = {
  kind: "duckdb",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: false,
  schemaTermLabel: "Schemas",
  tableOpenableKinds: new Set(["table", "view", "materializedView", "foreignTable"]),
  editableKinds: new Set(["table"]),
  hideDetailKinds: new Set(["database", "schema", "group", "table", "view", "materializedView", "foreignTable"]),
  defaultPort: undefined,
  uriScheme: "duckdb",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(false),
  groupSchemaTree: makeGroupSchemaTree(false, schemaGrouping),
};
