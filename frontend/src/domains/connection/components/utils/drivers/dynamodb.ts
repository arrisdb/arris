import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

// DynamoDB tables are flat within a region: no database/schema container, key
// attributes shown as columns and global secondary indexes as indexes.
const schemaGrouping: SchemaGrouping = [
  { label: "Tables", kinds: ["table"] },
];

export const dynamodbDriver: ConnectionDriver = {
  kind: "dynamodb",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: false,
  schemaTermLabel: "Schemas",
  tableOpenableKinds: new Set(["table"]),
  editableKinds: new Set(["table"]),
  hideDetailKinds: new Set(["database", "schema", "group"]),
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(false),
  groupSchemaTree: makeGroupSchemaTree(false, schemaGrouping),
};
