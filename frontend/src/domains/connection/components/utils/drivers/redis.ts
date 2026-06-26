import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Strings", kinds: ["redisStringKey"] },
  { label: "Lists", kinds: ["redisListKey"] },
  { label: "Sets", kinds: ["redisSetKey"] },
  { label: "Hashes", kinds: ["redisHashKey"] },
  { label: "Sorted Sets", kinds: ["redisZsetKey"] },
  { label: "Streams", kinds: ["redisStreamKey"] },
  { label: "Keys", kinds: ["key"] },
];

export const redisDriver: ConnectionDriver = {
  kind: "redis",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: true,
  schemaTermLabel: "Databases",
  tableOpenableKinds: new Set([
    "key", "redisStringKey", "redisListKey", "redisSetKey",
    "redisHashKey", "redisZsetKey", "redisStreamKey",
  ]),
  editableKinds: new Set([]),
  hideDetailKinds: new Set(["database", "schema", "group"]),
  defaultPort: 6379,
  uriScheme: "redis",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(true),
  groupSchemaTree: makeGroupSchemaTree(true, schemaGrouping),
};
