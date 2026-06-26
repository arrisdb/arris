import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Events", kinds: ["mixpanelEvent"] },
  { label: "Event Properties", kinds: ["mixpanelEventProperty"] },
];

export const mixpanelDriver: ConnectionDriver = {
  kind: "mixpanel",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: true,
  schemaTermLabel: "Databases",
  tableOpenableKinds: new Set([]),
  editableKinds: new Set([]),
  hideDetailKinds: new Set(["database", "schema", "group"]),
  defaultPort: undefined,
  uriScheme: "mixpanel",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(true),
  groupSchemaTree: makeGroupSchemaTree(true, schemaGrouping),
};
