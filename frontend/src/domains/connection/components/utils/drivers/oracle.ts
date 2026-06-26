import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Tables", kinds: ["table"] },
  { label: "Views", kinds: ["view", "materializedView"] },
  { label: "Routines", kinds: ["function", "procedure"] },
  { label: "Sequences", kinds: ["sequence"] },
  { label: "Types", kinds: ["type"] },
  { label: "Triggers", kinds: ["trigger"] },
  { label: "Indexes", kinds: ["index"] },
];

export const oracleDriver: ConnectionDriver = {
  kind: "oracle",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: false,
  lazySchemaTables: true,
  schemaTermLabel: "Schemas",
  tableOpenableKinds: new Set(["table", "view", "materializedView"]),
  editableKinds: new Set(["table"]),
  hideDetailKinds: new Set(["database", "schema", "group", "table", "view", "materializedView"]),
  defaultPort: 1521,
  uriScheme: "oracle",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(false),
  groupSchemaTree: makeGroupSchemaTree(false, schemaGrouping),
};
