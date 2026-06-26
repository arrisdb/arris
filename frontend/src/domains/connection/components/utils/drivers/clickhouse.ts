import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

// ClickHouse databases are the schema level: the backend returns one database
// node per ClickHouse database with its tables/views directly beneath.
const schemaGrouping: SchemaGrouping = [
  { label: "Tables", kinds: ["table"] },
  { label: "Views", kinds: ["view"] },
  { label: "Materialized Views", kinds: ["materializedView"] },
];

export const clickhouseDriver: ConnectionDriver = {
  kind: "clickhouse",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: true,
  lazySchemaTables: true,
  schemaTermLabel: "Databases",
  tableOpenableKinds: new Set(["table", "view", "materializedView"]),
  editableKinds: new Set(["table"]),
  hideDetailKinds: new Set(["database", "schema", "group", "table", "view", "materializedView"]),
  defaultPort: 8123,
  uriScheme: "clickhouse",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(true),
  groupSchemaTree: makeGroupSchemaTree(true, schemaGrouping),
};
