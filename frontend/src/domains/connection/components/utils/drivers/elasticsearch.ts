import type { SchemaNode, TableRef } from "../../CombinedConnectionsTree/types";
import type { SchemaGrouping } from "./types";
import { makeExtractSchemaNames, makeGroupSchemaTree } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Indices", kinds: ["elasticsearchIndex"] },
  { label: "Aliases", kinds: ["elasticsearchAlias"] },
  { label: "Index Templates", kinds: ["elasticsearchIndexTemplate"] },
  { label: "Data Streams", kinds: ["elasticsearchDataStream"] },
];

function elasticsearchTableRefFromNode(node: SchemaNode): TableRef {
  return { name: node.name };
}

export const elasticsearchDriver: ConnectionDriver = {
  kind: "elasticsearch",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: true,
  schemaTermLabel: "Databases",
  tableOpenableKinds: new Set(["elasticsearchIndex", "elasticsearchAlias", "elasticsearchDataStream"]),
  editableKinds: new Set([]),
  hideDetailKinds: new Set(["database", "schema", "group"]),
  defaultPort: 9200,
  uriScheme: "https",
  tableRefFromNode: elasticsearchTableRefFromNode,
  extractSchemaNames: makeExtractSchemaNames(true),
  groupSchemaTree: makeGroupSchemaTree(true, schemaGrouping),
};
