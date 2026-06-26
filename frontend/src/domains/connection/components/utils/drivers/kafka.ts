import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Topics", kinds: ["topic"] },
  { label: "Consumer Groups", kinds: ["consumerGroup"] },
];

export const kafkaDriver: ConnectionDriver = {
  kind: "kafka",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: false,
  schemaTermLabel: "Schemas",
  tableOpenableKinds: new Set(["topic"]),
  editableKinds: new Set([]),
  hideDetailKinds: new Set(["database", "schema", "group", "topic"]),
  defaultPort: 9092,
  uriScheme: "kafka",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(false),
  groupSchemaTree: makeGroupSchemaTree(false, schemaGrouping),
};
