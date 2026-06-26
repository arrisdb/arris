import type { DatabaseKind, SchemaNode, SchemaNodeKind, TableRef } from "../../CombinedConnectionsTree/types";

export interface SchemaGroupDef {
  label: string;
  kinds: SchemaNodeKind[];
}

export type SchemaGrouping = SchemaGroupDef[];

export interface ConnectionDriver {
  kind: DatabaseKind;
  schemaGrouping: SchemaGrouping;
  defaultSchemas: string[];
  databaseActsAsSchema: boolean;
  /** Plural display word for the schema-selector dropdown, e.g. "Schemas" or "Databases". */
  schemaTermLabel: string;
  /**
   * When true, `list_schemas` returns schema/dataset containers only (no
   * tables) and a schema's tables are fetched lazily via `cmd_list_schema` when
   * the user selects it in the dropdown. Used by sources where eagerly loading
   * every table is expensive (e.g. BigQuery). When false/absent, the full tree
   * is loaded up front and the dropdown is a pure client-side filter.
   */
  lazySchemaTables?: boolean;
  tableOpenableKinds: ReadonlySet<SchemaNodeKind>;
  /** Object kinds whose rows can be edited (insert/update/delete) in the results grid. */
  editableKinds: ReadonlySet<SchemaNodeKind>;
  hideDetailKinds: ReadonlySet<SchemaNodeKind>;
  defaultPort?: number;
  uriScheme?: string;
  tableRefFromNode(node: SchemaNode): TableRef;
  extractSchemaNames(nodes: SchemaNode[]): string[];
  groupSchemaTree(nodes: SchemaNode[], selectedSchemas: string[]): SchemaNode[];
  /**
   * The name to pass to `cmd_list_schema` to (re)load the lazy subtree that
   * contains `node`, i.e. the same unit the dropdown selects. Defaults to
   * `node.name` (the schema). Trino loads per CATALOG, so it returns the
   * catalog (the node's first path segment) instead, keeping "Refresh Schema"
   * aligned with how the catalog was loaded.
   */
  lazyLoadKeyFromNode?(node: SchemaNode): string;
}
