import type { SchemaNode, SchemaNodeKind, TableRef } from "../../CombinedConnectionsTree/types";
import type { SchemaGroupDef, SchemaGrouping } from "./types";

export function defaultTableRefFromNode(node: SchemaNode): TableRef {
  const parts = node.path.split(".");
  if (parts.length >= 3) {
    return { database: parts[0], schema: parts[1], name: node.name };
  }
  if (parts.length >= 2) {
    return { schema: parts[0], name: node.name };
  }
  return { name: node.name };
}

export function groupSchemaChildren(
  nodes: SchemaNode[],
  grouping: SchemaGrouping,
  parentPath = "",
): SchemaNode[] {
  const kindSet = new Map<SchemaNodeKind, SchemaGroupDef>();
  for (const g of grouping) {
    for (const k of g.kinds) kindSet.set(k, g);
  }

  const buckets = new Map<string, SchemaNode[]>();
  for (const g of grouping) buckets.set(g.label, []);

  for (const node of nodes) {
    const g = kindSet.get(node.kind);
    if (g) buckets.get(g.label)!.push(node);
  }

  const result: SchemaNode[] = [];
  for (const g of grouping) {
    const children = buckets.get(g.label)!;
    if (children.length === 0) continue;
    // Namespace the group node path with its parent so same-named group
    // folders under different databases/schemas (e.g. "Collections") get
    // distinct paths; selection and React keys are keyed by path.
    const prefix = parentPath ? `${parentPath}.` : "";
    result.push({
      name: `${g.label} (${children.length})`,
      kind: "group",
      path: `${prefix}__group__${g.label}`,
      children,
    });
  }
  return result;
}

function dbActsAsSchema(actAsSchema: boolean, db: SchemaNode): boolean {
  return actAsSchema && db.kind === "database" && !db.children.some((c) => c.kind === "schema");
}

function groupDatabaseChildren(
  db: SchemaNode,
  actAsSchema: boolean,
  grouping: SchemaGrouping,
): SchemaNode {
  if (db.kind !== "database") return db;
  if (dbActsAsSchema(actAsSchema, db)) {
    return { ...db, children: groupSchemaChildren(db.children, grouping, db.path) };
  }
  return {
    ...db,
    children: db.children.map((s) => {
      if (s.kind !== "schema") return s;
      return { ...s, children: groupSchemaChildren(s.children, grouping, s.path) };
    }),
  };
}

export function makeExtractSchemaNames(actAsSchema: boolean) {
  return (nodes: SchemaNode[]): string[] => {
    const names: string[] = [];
    for (const db of nodes) {
      if (db.kind !== "database") continue;
      if (dbActsAsSchema(actAsSchema, db)) {
        names.push(db.name);
      } else {
        for (const child of db.children) {
          if (child.kind === "schema") names.push(child.name);
        }
      }
    }
    return names;
  };
}

export function makeGroupSchemaTree(actAsSchema: boolean, grouping: SchemaGrouping) {
  return (nodes: SchemaNode[], selectedSchemas: string[]): SchemaNode[] => {
    if (selectedSchemas.length > 0) {
      const selected = new Set(selectedSchemas);
      return nodes.flatMap((db) => {
        if (db.kind !== "database") return db;
        if (dbActsAsSchema(actAsSchema, db)) {
          if (!selected.has(db.name)) return [];
          return groupDatabaseChildren(db, actAsSchema, grouping);
        }
        return {
          ...db,
          children: db.children
            .filter((s) => s.kind !== "schema" || selected.has(s.name))
            .map((s) => {
              if (s.kind !== "schema") return s;
              return { ...s, children: groupSchemaChildren(s.children, grouping, s.path) };
            }),
        };
      });
    }
    const hasDatabaseNodes = nodes.some((n) => n.kind === "database");
    if (hasDatabaseNodes) {
      return nodes.map((db) => groupDatabaseChildren(db, actAsSchema, grouping));
    }
    return groupSchemaChildren(nodes, grouping);
  };
}
