import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

// StarRocks speaks the MySQL wire protocol, so databases act as schema-level
// containers like MySQL. Its object model is OLAP-only: tables, logical views,
// and materialized views. It has no stored routines, events, or triggers.
const schemaGrouping: SchemaGrouping = [
  { label: "Tables", kinds: ["table"] },
  { label: "Views", kinds: ["view", "materializedView"] },
];

export const starrocksDriver: ConnectionDriver = {
  kind: "starrocks",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: true,
  lazySchemaTables: true,
  schemaTermLabel: "Databases",
  tableOpenableKinds: new Set(["table", "view", "materializedView"]),
  editableKinds: new Set(["table"]),
  hideDetailKinds: new Set(["database", "schema", "group", "table", "view", "materializedView"]),
  defaultPort: 9030,
  uriScheme: "mysql",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(true),
  groupSchemaTree: makeGroupSchemaTree(true, schemaGrouping),
};
