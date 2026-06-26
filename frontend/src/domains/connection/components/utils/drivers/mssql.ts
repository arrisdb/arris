import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Tables", kinds: ["table"] },
  { label: "Views", kinds: ["view"] },
  { label: "Routines", kinds: ["function", "procedure"] },
  { label: "Sequences", kinds: ["sequence"] },
  { label: "Types", kinds: ["type"] },
  { label: "Triggers", kinds: ["trigger"] },
  { label: "Indexes", kinds: ["index"] },
];

export const mssqlDriver: ConnectionDriver = {
  kind: "mssql",
  schemaGrouping,
  defaultSchemas: ["dbo"],
  databaseActsAsSchema: false,
  lazySchemaTables: true,
  schemaTermLabel: "Schemas",
  tableOpenableKinds: new Set(["table", "view"]),
  editableKinds: new Set(["table"]),
  hideDetailKinds: new Set(["database", "schema", "group", "table", "view"]),
  defaultPort: 1433,
  uriScheme: "mssql",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(false),
  groupSchemaTree: makeGroupSchemaTree(false, schemaGrouping),
};
