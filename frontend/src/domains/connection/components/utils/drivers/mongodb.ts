import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Collections", kinds: ["collection", "view"] },
];

export const mongodbDriver: ConnectionDriver = {
  kind: "mongodb",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: true,
  lazySchemaTables: true,
  schemaTermLabel: "Databases",
  tableOpenableKinds: new Set(["collection", "view"]),
  editableKinds: new Set(["collection"]),
  hideDetailKinds: new Set(["database", "schema", "group"]),
  defaultPort: 27017,
  uriScheme: "mongodb",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(true),
  groupSchemaTree: makeGroupSchemaTree(true, schemaGrouping),
};
