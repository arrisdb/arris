import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

// Mixpanel exposes a single `events` table; its event properties are the columns.
const schemaGrouping: SchemaGrouping = [{ label: "Tables", kinds: ["table"] }];

export const mixpanelDriver: ConnectionDriver = {
  kind: "mixpanel",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: false,
  schemaTermLabel: "Schemas",
  tableOpenableKinds: new Set(["table"]),
  editableKinds: new Set([]),
  hideDetailKinds: new Set(["database", "schema", "group"]),
  defaultPort: undefined,
  uriScheme: "mixpanel",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(false),
  groupSchemaTree: makeGroupSchemaTree(false, schemaGrouping),
};
