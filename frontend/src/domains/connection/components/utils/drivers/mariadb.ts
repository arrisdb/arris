import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Tables", kinds: ["table"] },
  { label: "Views", kinds: ["view"] },
  { label: "Routines", kinds: ["function", "procedure"] },
  { label: "Events", kinds: ["event"] },
  { label: "Triggers", kinds: ["trigger"] },
  { label: "Sequences", kinds: ["sequence"] },
];

export const mariadbDriver: ConnectionDriver = {
  kind: "mariadb",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: true,
  lazySchemaTables: true,
  schemaTermLabel: "Databases",
  tableOpenableKinds: new Set(["table", "view"]),
  editableKinds: new Set(["table"]),
  hideDetailKinds: new Set(["database", "schema", "group", "table", "view"]),
  defaultPort: 3307,
  uriScheme: "mariadb",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(true),
  groupSchemaTree: makeGroupSchemaTree(true, schemaGrouping),
};
