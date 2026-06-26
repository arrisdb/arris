import type { SchemaNode } from "../../CombinedConnectionsTree/types";
import type { SchemaGrouping } from "./types";
import { defaultTableRefFromNode, groupSchemaChildren } from "./defaults";
import type { ConnectionDriver } from "./types";

const schemaGrouping: SchemaGrouping = [
  { label: "Tables", kinds: ["table", "foreignTable"] },
  { label: "Views", kinds: ["view", "materializedView"] },
];

// Trino is catalog -> schema -> table. Unlike a plain SQL source (whose dropdown
// picks schemas), the Trino dropdown picks CATALOGS: each top-level Database
// node is a catalog. Selecting a catalog lazily loads its schemas and their
// tables, so the picker scopes by catalog first, schema second.
function extractCatalogNames(nodes: SchemaNode[]): string[] {
  return nodes.filter((node) => node.kind === "database").map((node) => node.name);
}

function groupTrinoSchemaTree(
  nodes: SchemaNode[],
  selectedCatalogs: string[],
): SchemaNode[] {
  if (selectedCatalogs.length === 0) return [];
  const selected = new Set(selectedCatalogs);
  return nodes
    .filter((db) => db.kind === "database" && selected.has(db.name))
    .map((db) => ({
      ...db,
      children: db.children.map((schema) =>
        schema.kind === "schema"
          ? {
              ...schema,
              children: groupSchemaChildren(schema.children, schemaGrouping, schema.path),
            }
          : schema,
      ),
    }));
}

export const trinoDriver: ConnectionDriver = {
  kind: "trino",
  schemaGrouping,
  defaultSchemas: [],
  databaseActsAsSchema: false,
  lazySchemaTables: true,
  schemaTermLabel: "Catalogs",
  tableOpenableKinds: new Set(["table", "view", "materializedView", "foreignTable"]),
  editableKinds: new Set(["table"]),
  hideDetailKinds: new Set(["database", "schema", "group", "table", "view", "materializedView", "foreignTable"]),
  defaultPort: 8080,
  uriScheme: "trino",
  tableRefFromNode: defaultTableRefFromNode,
  extractSchemaNames: extractCatalogNames,
  groupSchemaTree: groupTrinoSchemaTree,
  // Trino loads per catalog, so "Refresh Schema" on any node reloads its catalog
  // (the first path segment), matching how the catalog was loaded.
  lazyLoadKeyFromNode: (node) => node.path.split(".")[0],
};
