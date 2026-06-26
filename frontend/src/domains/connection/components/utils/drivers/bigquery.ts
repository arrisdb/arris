import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Tables", kinds: ["table", "foreignTable"] },
  { label: "Views", kinds: ["view", "materializedView"] },
  { label: "Routines", kinds: ["function", "procedure"] },
];

export const bigqueryDriver: ConnectionDriver = {
  kind: "bigquery",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: false,
  schemaTermLabel: "Schemas",
  // BigQuery projects can hold a large number of datasets/tables, so the tree
  // loads datasets only and fetches a dataset's tables when the user selects it.
  lazySchemaTables: true,
  tableOpenableKinds: new Set(["table", "view", "materializedView", "foreignTable"]),
  editableKinds: new Set(["table"]),
  hideDetailKinds: new Set(["database", "schema", "group", "table", "view", "materializedView", "foreignTable"]),
  defaultPort: 443,
  uriScheme: "bigquery",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(false),
  groupSchemaTree: makeGroupSchemaTree(false, schemaGrouping),
};
