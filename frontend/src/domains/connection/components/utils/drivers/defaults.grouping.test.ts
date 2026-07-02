import { describe, expect, it } from "vitest";
import type { SchemaNode } from "../../CombinedConnectionsTree/types";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { groupSchemaChildren } from "./defaults";
import { driverForKind } from "./registry";

function node(name: string, kind: SchemaNode["kind"], children: SchemaNode[] = []): SchemaNode {
  return { name, kind, path: `test.${name}`, children };
}

describe("driver schema grouping", () => {
  it("does not keep a shared schema grouping module", () => {
    const driverDir = dirname(fileURLToPath(import.meta.url));
    expect(existsSync(resolve(driverDir, "../../../../schemaStates/grouping.ts"))).toBe(false);
  });

  it("returns postgres grouping for postgres", () => {
    const g = driverForKind("postgres").schemaGrouping;
    expect(g[0].label).toBe("Tables");
    expect(g[0].kinds).toContain("table");
    expect(g[0].kinds).toContain("foreignTable");
  });

  it("returns mongo grouping for mongodb", () => {
    const g = driverForKind("mongodb").schemaGrouping;
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe("Collections");
    expect(g[0].kinds).toEqual(["collection", "view"]);
  });
});

describe("groupSchemaChildren", () => {
  const grouping = driverForKind("postgres").schemaGrouping;

  it("groups nodes by kind into group folders", () => {
    const nodes = [
      node("users", "table"),
      node("orders", "table"),
      node("active_users", "view"),
      node("users_id_seq", "sequence"),
    ];
    const grouped = groupSchemaChildren(nodes, grouping);
    expect(grouped).toHaveLength(3);
    expect(grouped[0].name).toBe("Tables (2)");
    expect(grouped[0].kind).toBe("group");
    expect(grouped[0].children).toHaveLength(2);
    expect(grouped[1].name).toBe("Views (1)");
    expect(grouped[2].name).toBe("Sequences (1)");
  });

  it("omits empty groups", () => {
    const nodes = [node("users", "table")];
    const grouped = groupSchemaChildren(nodes, grouping);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].name).toBe("Tables (1)");
  });

  it("returns empty array for no nodes", () => {
    expect(groupSchemaChildren([], grouping)).toHaveLength(0);
  });

  it("namespaces group folder paths with the parent path", () => {
    const a = groupSchemaChildren([node("users", "table")], grouping, "lextest");
    const b = groupSchemaChildren([node("users", "table")], grouping, "sample_mflix");
    expect(a[0].path).toBe("lextest.__group__Tables");
    expect(b[0].path).toBe("sample_mflix.__group__Tables");
    // Same-named group folders under different databases stay distinct.
    expect(a[0].path).not.toBe(b[0].path);
  });

  it("uses an unprefixed group path when no parent is given", () => {
    const g = groupSchemaChildren([node("users", "table")], grouping);
    expect(g[0].path).toBe("__group__Tables");
  });

  it("preserves column children on table nodes", () => {
    const col: SchemaNode = { name: "id", kind: "column", path: "test.users.id", detail: "int4", children: [] };
    const nodes = [node("users", "table", [col])];
    const grouped = groupSchemaChildren(nodes, grouping);
    expect(grouped[0].children[0].children).toHaveLength(1);
    expect(grouped[0].children[0].children[0].name).toBe("id");
  });

  it("groups foreign tables with tables", () => {
    const nodes = [node("ext_data", "foreignTable"), node("users", "table")];
    const grouped = groupSchemaChildren(nodes, grouping);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].name).toBe("Tables (2)");
  });

  it("groups materialized components with components", () => {
    const nodes = [node("mv_report", "materializedView"), node("v_active", "view")];
    const grouped = groupSchemaChildren(nodes, grouping);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].name).toBe("Views (2)");
  });

  it("groups functions and procedures into routines", () => {
    const nodes = [node("calc", "function"), node("update_stats", "procedure")];
    const grouped = groupSchemaChildren(nodes, grouping);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].name).toBe("Routines (2)");
  });

  it("groups MySQL metadata object types", () => {
    const nodes = [
      node("users", "table"),
      node("active_users", "view"),
      node("normalize_email", "function"),
      node("refresh_rollups", "procedure"),
      node("nightly_rollup", "event"),
      node("users_ai", "trigger"),
    ];
    const grouped = groupSchemaChildren(nodes, driverForKind("mysql").schemaGrouping);
    expect(grouped.map((g) => g.name)).toEqual([
      "Tables (1)",
      "Views (1)",
      "Routines (2)",
      "Events (1)",
      "Triggers (1)",
    ]);
  });

  it("groups Kafka topics and consumer groups", () => {
    const nodes = [
      node("orders", "topic"),
      node("events", "topic"),
      node("my-group", "consumerGroup"),
    ];
    const grouped = groupSchemaChildren(nodes, driverForKind("kafka").schemaGrouping);
    expect(grouped.map((g) => g.name)).toEqual([
      "Topics (2)",
      "Consumer Groups (1)",
    ]);
  });

  it("groups MariaDB sequences with metadata object types", () => {
    const nodes = [
      node("orders", "table"),
      node("order_seq", "sequence"),
      node("nightly_rollup", "event"),
    ];
    const grouped = groupSchemaChildren(nodes, driverForKind("mariadb").schemaGrouping);
    expect(grouped.map((g) => g.name)).toEqual([
      "Tables (1)",
      "Events (1)",
      "Sequences (1)",
    ]);
  });

  it("groups SQLite metadata object types", () => {
    const nodes = [
      node("users", "table"),
      node("active_users", "view"),
      node("users_name_idx", "index"),
      node("users_ai", "trigger"),
    ];
    const grouped = groupSchemaChildren(nodes, driverForKind("sqlite").schemaGrouping);
    expect(grouped.map((g) => g.name)).toEqual([
      "Tables (1)",
      "Views (1)",
      "Indexes (1)",
      "Triggers (1)",
    ]);
  });

  it("groups MSSQL metadata object types", () => {
    const nodes = [
      node("users", "table"),
      node("active_users", "view"),
      node("normalize_email", "function"),
      node("refresh_rollups", "procedure"),
      node("order_seq", "sequence"),
      node("email_address", "type"),
      node("users_ai", "trigger"),
      node("users_name_idx", "index"),
    ];
    const grouped = groupSchemaChildren(nodes, driverForKind("mssql").schemaGrouping);
    expect(grouped.map((g) => g.name)).toEqual([
      "Tables (1)",
      "Views (1)",
      "Routines (2)",
      "Sequences (1)",
      "Types (1)",
      "Triggers (1)",
      "Indexes (1)",
    ]);
  });

  it("groups Mixpanel into a single events table", () => {
    const nodes = [node("events", "table")];
    const grouped = groupSchemaChildren(nodes, driverForKind("mixpanel").schemaGrouping);
    expect(grouped.map((g) => g.name)).toEqual(["Tables (1)"]);
  });

  it("groups Oracle metadata object types", () => {
    const nodes = [
      node("EMPLOYEES", "table"),
      node("V_ACTIVE_EMPLOYEES", "view"),
      node("MV_SALES_SUMMARY", "materializedView"),
      node("GET_SALARY", "function"),
      node("PROCESS_ORDERS", "procedure"),
      node("SEQ_EMPLOYEES", "sequence"),
      node("T_ADDRESS", "type"),
      node("TRG_EMPLOYEES_BI", "trigger"),
      node("IDX_EMPLOYEES_NAME", "index"),
    ];
    const grouped = groupSchemaChildren(nodes, driverForKind("oracle").schemaGrouping);
    expect(grouped.map((g) => g.name)).toEqual([
      "Tables (1)",
      "Views (2)",
      "Routines (2)",
      "Sequences (1)",
      "Types (1)",
      "Triggers (1)",
      "Indexes (1)",
    ]);
  });

  it("groups Redis keys by key type", () => {
    const nodes = [
      node("session:1", "redisStringKey"),
      node("queue:jobs", "redisListKey"),
      node("tags", "redisSetKey"),
      node("user:1", "redisHashKey"),
      node("leaderboard", "redisZsetKey"),
      node("events", "redisStreamKey"),
      node("module:key", "key"),
    ];
    const grouped = groupSchemaChildren(nodes, driverForKind("redis").schemaGrouping);
    expect(grouped.map((g) => g.name)).toEqual([
      "Strings (1)",
      "Lists (1)",
      "Sets (1)",
      "Hashes (1)",
      "Sorted Sets (1)",
      "Streams (1)",
      "Keys (1)",
    ]);
  });
});

describe("driver defaultSchemas", () => {
  it("returns public for postgres", () => {
    expect(driverForKind("postgres").defaultSchemas).toEqual(["public"]);
  });

  it("returns public for redshift", () => {
    expect(driverForKind("redshift").defaultSchemas).toEqual(["public"]);
  });

  it("returns dbo for mssql", () => {
    expect(driverForKind("mssql").defaultSchemas).toEqual(["dbo"]);
  });

  it("returns empty for mongodb", () => {
    expect(driverForKind("mongodb").defaultSchemas).toEqual([]);
  });

  it("returns empty for oracle", () => {
    expect(driverForKind("oracle").defaultSchemas).toEqual([]);
  });
});
