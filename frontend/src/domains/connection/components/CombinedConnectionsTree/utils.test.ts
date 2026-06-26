import { describe, it, expect } from "vitest";
import {
  findSchemaNodeByPath,
  isDefinitionSupportedKind,
  isSchemaNodeLoaded,
  objectRefFromNode,
} from "./utils";
import type { SchemaNode } from "./types";

function node(partial: Partial<SchemaNode> & Pick<SchemaNode, "name" | "kind" | "path">): SchemaNode {
  return { children: [], ...partial };
}

describe("isDefinitionSupportedKind", () => {
  it("accepts the kinds the backend can resolve a DDL for", () => {
    for (const kind of [
      "schema",
      "database",
      "table",
      "view",
      "materializedView",
      "foreignTable",
      "sequence",
      "index",
      "function",
      "procedure",
      "trigger",
      "event",
    ] as const) {
      expect(isDefinitionSupportedKind(kind)).toBe(true);
    }
  });

  it("rejects unsupported kinds", () => {
    for (const kind of ["group", "column", "collection", "topic"] as const) {
      expect(isDefinitionSupportedKind(kind)).toBe(false);
    }
  });
});

describe("objectRefFromNode (container nodes)", () => {
  it("builds a schema ref from a database.schema path using name as the schema", () => {
    const n = node({ name: "reporting", kind: "schema", path: "mydb.reporting" });
    expect(objectRefFromNode(n, false)).toEqual({
      kind: "schema",
      database: "mydb",
      name: "reporting",
    });
  });

  it("builds a schema ref from a bare schema path with no database", () => {
    const n = node({ name: "public", kind: "schema", path: "public" });
    expect(objectRefFromNode(n, false)).toEqual({
      kind: "schema",
      database: undefined,
      name: "public",
    });
  });

  it("builds a database ref that doubles as its own database (MySQL)", () => {
    const n = node({ name: "appdb", kind: "database", path: "appdb" });
    expect(objectRefFromNode(n, true)).toEqual({
      kind: "database",
      database: "appdb",
      name: "appdb",
    });
  });

  it("builds a database ref regardless of databaseActsAsSchema", () => {
    const n = node({ name: "WAREHOUSE", kind: "database", path: "WAREHOUSE" });
    expect(objectRefFromNode(n, false)).toEqual({
      kind: "database",
      database: "WAREHOUSE",
      name: "WAREHOUSE",
    });
  });
});

describe("objectRefFromNode (schema-based engines)", () => {
  it("maps a database.schema.name path to a fully-qualified ObjectRef", () => {
    const n = node({ name: "users", kind: "table", path: "mydb.public.users" });
    expect(objectRefFromNode(n, false)).toEqual({
      kind: "table",
      database: "mydb",
      schema: "public",
      name: "users",
    });
  });

  it("maps a schema.name path to a schema-qualified ObjectRef", () => {
    const n = node({ name: "v_orders", kind: "view", path: "public.v_orders" });
    expect(objectRefFromNode(n, false)).toEqual({
      kind: "view",
      schema: "public",
      name: "v_orders",
    });
  });

  it("maps a bare name path to a name-only ObjectRef", () => {
    const n = node({ name: "seq", kind: "sequence", path: "seq" });
    expect(objectRefFromNode(n, false)).toEqual({ kind: "sequence", name: "seq" });
  });

  it("carries the node kind so same-named objects differ", () => {
    const idx = node({ name: "users", kind: "index", path: "public.users" });
    expect(objectRefFromNode(idx, false).kind).toBe("index");
  });
});

describe("objectRefFromNode (database-acts-as-schema engines)", () => {
  it("maps a database.name table path to a database-qualified ObjectRef", () => {
    const n = node({ name: "customers", kind: "table", path: "appdb.customers" });
    expect(objectRefFromNode(n, true)).toEqual({
      kind: "table",
      database: "appdb",
      name: "customers",
    });
  });

  it("drops the group-folder segment for routines/events/triggers", () => {
    const fn = node({
      name: "customer_display_name",
      kind: "function",
      path: "appdb.routines.customer_display_name",
    });
    expect(objectRefFromNode(fn, true)).toEqual({
      kind: "function",
      database: "appdb",
      name: "customer_display_name",
    });

    const ev = node({ name: "daily_sales_audit", kind: "event", path: "appdb.events.daily_sales_audit" });
    expect(objectRefFromNode(ev, true)).toEqual({
      kind: "event",
      database: "appdb",
      name: "daily_sales_audit",
    });

    const trg = node({ name: "customers_before_insert", kind: "trigger", path: "appdb.triggers.customers_before_insert" });
    expect(objectRefFromNode(trg, true)).toEqual({
      kind: "trigger",
      database: "appdb",
      name: "customers_before_insert",
    });
  });
});

describe("isSchemaNodeLoaded", () => {
  // BigQuery-style datasets-only tree: a project database node whose dataset
  // schema children have no tables yet.
  const tree: SchemaNode[] = [
    node({
      name: "my-project",
      kind: "database",
      path: "my-project",
      children: [
        node({ name: "empty_ds", kind: "schema", path: "my-project.empty_ds" }),
        node({
          name: "loaded_ds",
          kind: "schema",
          path: "my-project.loaded_ds",
          children: [
            node({ name: "users", kind: "table", path: "my-project.loaded_ds.users" }),
          ],
        }),
      ],
    }),
  ];

  it("is false for a dataset whose tables are not fetched yet", () => {
    expect(isSchemaNodeLoaded(tree, "empty_ds")).toBe(false);
  });

  it("is true for a dataset that already has table children", () => {
    expect(isSchemaNodeLoaded(tree, "loaded_ds")).toBe(true);
  });

  it("is false for a name that is not a schema/database in the tree", () => {
    expect(isSchemaNodeLoaded(tree, "users")).toBe(false);
    expect(isSchemaNodeLoaded(tree, "missing")).toBe(false);
  });
});

describe("findSchemaNodeByPath", () => {
  const tree: SchemaNode[] = [
    node({
      name: "public",
      kind: "schema",
      path: "public",
      children: [
        node({
          name: "Tables (1)",
          kind: "group",
          path: "public.__group__Tables",
          children: [node({ name: "users", kind: "table", path: "public.users" })],
        }),
      ],
    }),
  ];

  it("finds a leaf nested under a group folder", () => {
    const found = findSchemaNodeByPath(tree, "public.users");
    expect(found?.name).toBe("users");
    expect(found?.kind).toBe("table");
  });

  it("finds a container node by its path", () => {
    expect(findSchemaNodeByPath(tree, "public")?.kind).toBe("schema");
  });

  it("returns null when no node matches", () => {
    expect(findSchemaNodeByPath(tree, "public.missing")).toBeNull();
  });
});
