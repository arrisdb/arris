import { describe, it, expect } from "vitest";
import { driverForKind, pickerKinds, allDrivers } from "./registry";
import type { DatabaseKind, SchemaNode } from "../../CombinedConnectionsTree/types";

const ALL_KINDS: DatabaseKind[] = [
  "postgres", "mysql", "mariadb", "mssql", "oracle", "sqlite", "duckdb",
  "mongodb", "kafka", "mixpanel", "redis", "elasticsearch",
  "bigquery", "redshift", "snowflake", "clickhouse", "trino", "dynamodb",
  "starrocks",
];

function node(kind: string, name: string, path: string, children: SchemaNode[] = []): SchemaNode {
  return { kind: kind as any, name, path, children };
}

describe("driver registry", () => {
  it("returns a driver for every DatabaseKind", () => {
    for (const kind of ALL_KINDS) {
      const driver = driverForKind(kind);
      expect(driver).toBeDefined();
      expect(driver.kind).toBe(kind);
    }
  });

  it("allDrivers returns 19 drivers", () => {
    expect(allDrivers()).toHaveLength(19);
  });

  it("pickerKinds returns all 19 visible kinds", () => {
    const kinds = pickerKinds();
    expect(kinds).toHaveLength(19);
    expect(kinds).toContain("bigquery");
    expect(kinds).toContain("redshift");
    expect(kinds).toContain("snowflake");
    expect(kinds).toContain("trino");
    expect(kinds).toContain("clickhouse");
  });

  it("trino defaults match expected values", () => {
    const d = driverForKind("trino");
    expect(d.defaultPort).toBe(8080);
    expect(d.uriScheme).toBe("trino");
    expect(d.databaseActsAsSchema).toBe(false);
    expect(d.tableOpenableKinds.has("table")).toBe(true);
    expect(d.tableOpenableKinds.has("view")).toBe(true);
  });

  it("every driver has required properties", () => {
    for (const driver of allDrivers()) {
      expect(driver.schemaGrouping).toBeDefined();
      expect(Array.isArray(driver.schemaGrouping)).toBe(true);
      expect(Array.isArray(driver.defaultSchemas)).toBe(true);
      expect(typeof driver.databaseActsAsSchema).toBe("boolean");
      expect(typeof driver.tableRefFromNode).toBe("function");
      expect(driver.tableOpenableKinds).toBeInstanceOf(Set);
      expect(driver.hideDetailKinds).toBeInstanceOf(Set);
      expect(typeof driver.extractSchemaNames).toBe("function");
      expect(typeof driver.groupSchemaTree).toBe("function");
      expect(typeof driver.schemaTermLabel).toBe("string");
      expect(driver.schemaTermLabel.length).toBeGreaterThan(0);
    }
  });

  it("schemaTermLabel says Databases when the database acts as the schema, else Schemas (Trino picks Catalogs)", () => {
    for (const driver of allDrivers()) {
      // Trino is catalog -> schema -> table and its dropdown picks catalogs, so
      // it overrides the generic Databases/Schemas wording.
      if (driver.kind === "trino") {
        expect(driver.schemaTermLabel).toBe("Catalogs");
        continue;
      }
      expect(driver.schemaTermLabel).toBe(
        driver.databaseActsAsSchema ? "Databases" : "Schemas",
      );
    }
  });

  it("every driver hideDetailKinds includes structural kinds", () => {
    for (const driver of allDrivers()) {
      expect(driver.hideDetailKinds.has("database")).toBe(true);
      expect(driver.hideDetailKinds.has("schema")).toBe(true);
      expect(driver.hideDetailKinds.has("group")).toBe(true);
    }
  });

  it("postgres defaults match expected values", () => {
    const d = driverForKind("postgres");
    expect(d.defaultPort).toBe(5432);
    expect(d.defaultSchemas).toEqual(["public"]);
    expect(d.databaseActsAsSchema).toBe(false);
    expect(d.uriScheme).toBe("postgres");
    expect(d.tableOpenableKinds.has("table")).toBe(true);
    expect(d.tableOpenableKinds.has("materializedView")).toBe(true);
    expect(d.tableOpenableKinds.has("topic")).toBe(false);
  });

  it("mysql databaseActsAsSchema is true", () => {
    expect(driverForKind("mysql").databaseActsAsSchema).toBe(true);
  });

  it("mssql defaults to dbo schema", () => {
    expect(driverForKind("mssql").defaultSchemas).toEqual(["dbo"]);
  });

  it("redis tableOpenableKinds includes all key types", () => {
    const d = driverForKind("redis");
    expect(d.tableOpenableKinds.has("key")).toBe(true);
    expect(d.tableOpenableKinds.has("redisHashKey")).toBe(true);
    expect(d.tableOpenableKinds.has("redisStreamKey")).toBe(true);
  });

  it("kafka tableOpenableKinds has topic", () => {
    const d = driverForKind("kafka");
    expect(d.tableOpenableKinds.has("topic")).toBe(true);
    expect(d.tableOpenableKinds.size).toBe(1);
  });

  it("elasticsearch tableOpenableKinds has index and alias", () => {
    const d = driverForKind("elasticsearch");
    expect(d.tableOpenableKinds.has("elasticsearchIndex")).toBe(true);
    expect(d.tableOpenableKinds.has("elasticsearchAlias")).toBe(true);
    expect(d.tableOpenableKinds.has("elasticsearchDataStream")).toBe(true);
  });

  it("mixpanel has no openable kinds", () => {
    expect(driverForKind("mixpanel").tableOpenableKinds.size).toBe(0);
  });

  it("redshift shares postgres defaults", () => {
    const d = driverForKind("redshift");
    expect(d.defaultSchemas).toEqual(["public"]);
    expect(d.defaultPort).toBe(5439);
  });

  it("multi-schema SQL sources lazily load tables; flat/embedded sources load eagerly", () => {
    // BigQuery plus every multi-schema SQL source fetch schema/database
    // containers on connect and load a schema's tables only when selected.
    const lazyKinds = [
      "bigquery",
      "postgres",
      "redshift",
      "mysql",
      "mariadb",
      "mssql",
      "snowflake",
      "oracle",
      "clickhouse",
      "trino",
      "mongodb",
      "starrocks",
    ] as const;
    for (const kind of lazyKinds) {
      expect(driverForKind(kind).lazySchemaTables).toBe(true);
    }
    // Datasets-only on connect means starting with nothing selected.
    expect(driverForKind("bigquery").defaultSchemas).toEqual([]);
    // Flat/embedded sources load their whole (cheap) tree up front.
    const eagerKinds = [
      "sqlite",
      "duckdb",
      "redis",
      "kafka",
      "dynamodb",
      "elasticsearch",
      "mixpanel",
    ] as const;
    for (const kind of eagerKinds) {
      expect(driverForKind(kind).lazySchemaTables ?? false).toBe(false);
    }
  });

  it("file-based drivers have no default port", () => {
    expect(driverForKind("sqlite").defaultPort).toBeUndefined();
    expect(driverForKind("duckdb").defaultPort).toBeUndefined();
    expect(driverForKind("mixpanel").defaultPort).toBeUndefined();
  });
});

describe("tableRefFromNode", () => {
  it("default: parses 3-part path into database.schema.name", () => {
    const ref = driverForKind("postgres").tableRefFromNode(
      node("table", "users", "mydb.public.users"),
    );
    expect(ref).toEqual({ database: "mydb", schema: "public", name: "users" });
  });

  it("default: parses 2-part path into schema.name", () => {
    const ref = driverForKind("mysql").tableRefFromNode(
      node("table", "orders", "mydb.orders"),
    );
    expect(ref).toEqual({ schema: "mydb", name: "orders" });
  });

  it("default: single-part path returns name only", () => {
    const ref = driverForKind("redis").tableRefFromNode(
      node("key", "mykey", "mykey"),
    );
    expect(ref).toEqual({ name: "mykey" });
  });

  it("elasticsearch: always returns name only", () => {
    const ref = driverForKind("elasticsearch").tableRefFromNode(
      node("elasticsearchIndex", "logs-2024", "cluster.logs-2024"),
    );
    expect(ref).toEqual({ name: "logs-2024" });
  });
});

describe("extractSchemaNames", () => {
  it("postgres extracts schema names from database children", () => {
    const schema: SchemaNode[] = [
      node("database", "mydb", "mydb", [
        node("schema", "public", "mydb.public"),
        node("schema", "app", "mydb.app"),
      ]),
    ];
    expect(driverForKind("postgres").extractSchemaNames(schema)).toEqual(["public", "app"]);
  });

  it("mysql extracts database names as schemas (actAsSchema=true)", () => {
    const schema: SchemaNode[] = [
      node("database", "app_db", "app_db", [
        node("table", "users", "app_db.users"),
      ]),
      node("database", "logs_db", "logs_db", [
        node("table", "events", "logs_db.events"),
      ]),
    ];
    expect(driverForKind("mysql").extractSchemaNames(schema)).toEqual(["app_db", "logs_db"]);
  });

  it("returns empty for non-database nodes", () => {
    const schema: SchemaNode[] = [
      node("table", "users", "users"),
    ];
    expect(driverForKind("postgres").extractSchemaNames(schema)).toEqual([]);
  });
});

describe("groupSchemaTree", () => {
  it("groups schema children into folders", () => {
    const schema: SchemaNode[] = [
      node("database", "mydb", "mydb", [
        node("schema", "public", "mydb.public", [
          node("table", "users", "mydb.public.users"),
          node("view", "active_users", "mydb.public.active_users"),
        ]),
      ]),
    ];
    const result = driverForKind("postgres").groupSchemaTree(schema, []);
    const publicSchema = result[0].children[0];
    expect(publicSchema.children.some((c) => c.kind === "group")).toBe(true);
  });

  it("filters by selected schemas", () => {
    const schema: SchemaNode[] = [
      node("database", "mydb", "mydb", [
        node("schema", "public", "mydb.public", [
          node("table", "users", "mydb.public.users"),
        ]),
        node("schema", "private", "mydb.private", [
          node("table", "secrets", "mydb.private.secrets"),
        ]),
      ]),
    ];
    const result = driverForKind("postgres").groupSchemaTree(schema, ["public"]);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].name).toBe("public");
  });

  it("mysql groups database children directly (actAsSchema)", () => {
    const schema: SchemaNode[] = [
      node("database", "app_db", "app_db", [
        node("table", "users", "app_db.users"),
        node("view", "v_users", "app_db.v_users"),
      ]),
    ];
    const result = driverForKind("mysql").groupSchemaTree(schema, []);
    expect(result[0].children.some((c) => c.kind === "group")).toBe(true);
  });

  it("every driver exposes an editableKinds set", () => {
    for (const kind of ALL_KINDS) {
      expect(driverForKind(kind).editableKinds).toBeInstanceOf(Set);
    }
  });

  it("no driver marks views, materialized views or foreign tables as editable", () => {
    for (const kind of ALL_KINDS) {
      const editable = driverForKind(kind).editableKinds;
      expect(editable.has("view")).toBe(false);
      expect(editable.has("materializedView")).toBe(false);
      expect(editable.has("foreignTable")).toBe(false);
    }
  });

  it("relational drivers mark base tables editable", () => {
    const relational: DatabaseKind[] = [
      "postgres", "mysql", "mariadb", "mssql", "oracle", "sqlite", "duckdb",
      "bigquery", "redshift", "snowflake", "clickhouse", "trino", "starrocks",
    ];
    for (const kind of relational) {
      expect(driverForKind(kind).editableKinds.has("table")).toBe(true);
    }
  });

  it("mongodb marks collections editable but not views", () => {
    const editable = driverForKind("mongodb").editableKinds;
    expect(editable.has("collection")).toBe(true);
    expect(editable.has("view")).toBe(false);
  });

  it("streaming / read-only sources expose no editable kinds", () => {
    for (const kind of ["kafka", "redis", "elasticsearch", "mixpanel"] as DatabaseKind[]) {
      expect(driverForKind(kind).editableKinds.size).toBe(0);
    }
  });

  it("editableKinds is always a subset of tableOpenableKinds", () => {
    for (const kind of ALL_KINDS) {
      const d = driverForKind(kind);
      for (const k of d.editableKinds) {
        expect(d.tableOpenableKinds.has(k)).toBe(true);
      }
    }
  });
});
