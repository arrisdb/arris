import { describe, it, expect } from "vitest";
import {
  buildFederatedSqlSchema,
  buildSqlSchema,
  buildCompletionData,
  deriveSchemaScoping,
  dialectFor,
} from "./sqlSchema";
import {
  PostgreSQL,
  MySQL,
  SQLite,
  MSSQL,
  PLSQL,
} from "@codemirror/lang-sql";
import type { SchemaNode } from "@shared";

function col(name: string, detail?: string): SchemaNode {
  return { name, kind: "column", path: name, detail, children: [] };
}
function tbl(
  name: string,
  kind: SchemaNode["kind"],
  cols: { name: string; detail?: string }[],
): SchemaNode {
  return {
    name,
    kind,
    path: name,
    children: cols.map((c) => col(c.name, c.detail)),
  };
}

describe("buildSqlSchema", () => {
  it("collects mapping fields from Elasticsearch indices as columns", () => {
    const tree: SchemaNode[] = [
      {
        name: "Elasticsearch",
        kind: "database",
        path: "es",
        children: [
          tbl("customers", "elasticsearchIndex", [
            { name: "country_code", detail: "keyword" },
            { name: "customer_id", detail: "integer" },
            { name: "email", detail: "keyword" },
          ]),
          // Aliases/data streams appear as names too, columnless or otherwise.
          tbl("orders_alias", "elasticsearchAlias", []),
        ],
      },
    ];
    const dict = buildSqlSchema(tree);
    expect(dict.customers).toEqual([
      { name: "country_code", type: "keyword" },
      { name: "customer_id", type: "integer" },
      { name: "email", type: "keyword" },
    ]);
    // Name still surfaced for REST-console index completion.
    expect(dict.orders_alias).toEqual([]);
  });

  it("collects DynamoDB top-level tables with their sampled columns", () => {
    // DynamoDB tables sit at the tree root (no database/schema wrapper). Each
    // table node mixes column children (key + sampled attributes) with index
    // children; only the columns feed autocomplete.
    const tree: SchemaNode[] = [
      {
        name: "orders",
        kind: "table",
        path: "orders",
        children: [
          col("order_id", "partition key, number"),
          col("amount", "number"),
          col("status", "string"),
          { name: "gsi_status", kind: "index", path: "orders.gsi_status", children: [] },
        ],
      },
    ];
    const dict = buildSqlSchema(tree);
    expect(dict.orders).toEqual([
      { name: "order_id", type: "partition key, number" },
      { name: "amount", type: "number" },
      { name: "status", type: "string" },
    ]);
    // Bare table name is the key (no catalog/schema qualification for DynamoDB).
    expect(deriveSchemaScoping(tree)).toEqual({ catalogQualified: false, schemaNames: [] });
  });

  it("surfaces Kafka topics as tables with their Schema Registry columns", () => {
    const tree: SchemaNode[] = [
      // Topic with a Schema Registry: fields are `column` children.
      tbl("orders", "topic", [
        { name: "customer_id", detail: "int" },
        { name: "amount", detail: "double" },
      ]),
      // Topic without a registry: no columns, but the name is still completable.
      tbl("events", "topic", []),
    ];
    const dict = buildSqlSchema(tree);
    expect(dict.orders).toEqual([
      { name: "customer_id", type: "int" },
      { name: "amount", type: "double" },
    ]);
    expect(dict.events).toEqual([]);
  });

  it("collects columns with types from tables/components", () => {
    const tree: SchemaNode[] = [
      {
        name: "public",
        kind: "schema",
        path: "public",
        children: [
          tbl("users", "table", [
            { name: "id", detail: "integer" },
            { name: "email", detail: "text" },
            { name: "name" },
          ]),
          tbl("orders", "view", [
            { name: "id", detail: "bigint" },
            { name: "total", detail: "numeric" },
          ]),
        ],
      },
    ];
    expect(buildSqlSchema(tree)).toEqual({
      users: [
        { name: "id", type: "integer" },
        { name: "email", type: "text" },
        { name: "name", type: undefined },
      ],
      "public.users": [
        { name: "id", type: "integer" },
        { name: "email", type: "text" },
        { name: "name", type: undefined },
      ],
      orders: [
        { name: "id", type: "bigint" },
        { name: "total", type: "numeric" },
      ],
      "public.orders": [
        { name: "id", type: "bigint" },
        { name: "total", type: "numeric" },
      ],
    });
  });

  it("registers redis keys (columnless) bare and qualified by their db node", () => {
    const tree: SchemaNode[] = [
      {
        name: "db0",
        kind: "database",
        path: "db0",
        children: [
          { name: "home:key", kind: "redisStringKey", path: "db0.home:key", children: [] },
        ],
      },
      {
        name: "db1",
        kind: "database",
        path: "db1",
        children: [
          { name: "cache:stats", kind: "redisHashKey", path: "db1.cache:stats", children: [] },
        ],
      },
    ];
    expect(buildSqlSchema(tree)).toEqual({
      "home:key": [],
      "db0.home:key": [],
      "cache:stats": [],
      "db1.cache:stats": [],
    });
  });

  it("treats matview/foreignTable/collection as tables", () => {
    const tree: SchemaNode[] = [
      tbl("daily", "materializedView", [
        { name: "d", detail: "date" },
        { name: "n", detail: "int" },
      ]),
      tbl("ext", "foreignTable", [{ name: "a" }]),
      tbl("logs", "collection", [{ name: "msg" }]),
    ];
    expect(buildSqlSchema(tree)).toEqual({
      daily: [
        { name: "d", type: "date" },
        { name: "n", type: "int" },
      ],
      ext: [{ name: "a", type: undefined }],
      logs: [{ name: "msg", type: undefined }],
    });
  });

  it("includes tables without columns as empty entries", () => {
    const tree: SchemaNode[] = [tbl("empty", "table", [])];
    expect(buildSqlSchema(tree)).toEqual({ empty: [] });
  });

  it("walks deeply nested children", () => {
    const tree: SchemaNode[] = [
      {
        name: "db",
        kind: "database",
        path: "db",
        children: [
          {
            name: "sch",
            kind: "schema",
            path: "db.sch",
            children: [tbl("t1", "table", [{ name: "c1", detail: "text" }])],
          },
        ],
      },
    ];
    expect(buildSqlSchema(tree)).toEqual({
      t1: [{ name: "c1", type: "text" }],
      "sch.t1": [{ name: "c1", type: "text" }],
      "db.sch.t1": [{ name: "c1", type: "text" }],
    });
  });

  it("registers every qualified suffix for catalog->schema->table (Trino)", () => {
    const tree: SchemaNode[] = [
      {
        name: "tpch",
        kind: "database",
        path: "tpch",
        children: [
          {
            name: "sf1",
            kind: "schema",
            path: "tpch.sf1",
            children: [tbl("customer", "table", [{ name: "custkey", detail: "bigint" }])],
          },
        ],
      },
    ];
    const cols = [{ name: "custkey", type: "bigint" }];
    expect(buildSqlSchema(tree)).toEqual({
      customer: cols,
      "sf1.customer": cols,
      "tpch.sf1.customer": cols,
    });
  });

  it("qualifies collections under database nodes (MongoDB)", () => {
    const tree: SchemaNode[] = [
      {
        name: "appdb",
        kind: "database",
        path: "appdb",
        children: [
          tbl("customers", "collection", [
            { name: "_id", detail: "ObjectId" },
            { name: "name", detail: "string" },
          ]),
          tbl("orders", "collection", []),
        ],
      },
    ];
    const result = buildSqlSchema(tree);
    expect(result["customers"]).toEqual([
      { name: "_id", type: "ObjectId" },
      { name: "name", type: "string" },
    ]);
    expect(result["appdb.customers"]).toEqual(result["customers"]);
    expect(result["orders"]).toEqual([]);
    expect(result["appdb.orders"]).toEqual([]);
  });
});

describe("buildCompletionData", () => {
  it("produces tables array and columnsByTable tuples", () => {
    const schema = {
      users: [
        { name: "id", type: "integer" as string | undefined },
        { name: "email", type: "text" as string | undefined },
      ],
      orders: [{ name: "total", type: undefined }],
    };
    const { tables, columnsByTable } = buildCompletionData(schema);
    expect(tables).toEqual(["users", "orders"]);
    expect(columnsByTable).toEqual([
      ["users", [["id", "integer"], ["email", "text"]]],
      ["orders", [["total", undefined]]],
    ]);
  });

  it("returns empty for empty schema", () => {
    const { tables, columnsByTable } = buildCompletionData({});
    expect(tables).toEqual([]);
    expect(columnsByTable).toEqual([]);
  });
});

describe("buildFederatedSqlSchema", () => {
  // The federation engine only parses `conn.table` / `conn.schema.table` (max 3
  // parts), so each table must map to exactly one canonical, parseable key
  // (`connection` + immediate container + table), never the progressive-suffix
  // fan-out `buildSqlSchema` uses for native single-source completion.

  it("collapses an MSSQL database.schema.table tree to conn.schema.table only", () => {
    // The grandparent database (`appdb`) must be dropped: `prod_mssql.appdb.dbo.orders`
    // is a 4-part reference the federation parser rejects, breaking the query.
    const tree: SchemaNode[] = [
      {
        name: "appdb",
        kind: "database",
        path: "appdb",
        children: [
          {
            name: "dbo",
            kind: "schema",
            path: "appdb.dbo",
            children: [tbl("orders", "table", [{ name: "id" }, { name: "amount" }])],
          },
        ],
      },
    ];

    expect(buildFederatedSqlSchema([{ name: "prod_mssql", schema: tree }])).toEqual({
      "prod_mssql.dbo.orders": [
        { name: "id", type: undefined },
        { name: "amount", type: undefined },
      ],
    });
  });

  it("keeps the schema for a Postgres schema.table tree", () => {
    const tree: SchemaNode[] = [
      {
        name: "public",
        kind: "schema",
        path: "public",
        children: [tbl("customers", "table", [{ name: "customer_id" }])],
      },
    ];

    expect(buildFederatedSqlSchema([{ name: "prod_postgres", schema: tree }])).toEqual({
      "prod_postgres.public.customers": [{ name: "customer_id", type: undefined }],
    });
  });

  it("uses the database as the qualifier when there is no schema (MySQL)", () => {
    const tree: SchemaNode[] = [
      {
        name: "mydb",
        kind: "database",
        path: "mydb",
        children: [tbl("orders", "table", [{ name: "id" }])],
      },
    ];

    expect(buildFederatedSqlSchema([{ name: "prod_mysql", schema: tree }])).toEqual({
      "prod_mysql.mydb.orders": [{ name: "id", type: undefined }],
    });
  });

  it("emits a 2-part conn.name for container-less Redis keys / Kafka topics", () => {
    const redis: SchemaNode[] = [
      {
        name: "db0",
        kind: "database",
        path: "db0",
        children: [
          { name: "home:key", kind: "redisStringKey", path: "db0.home:key", children: [] },
        ],
      },
    ];
    const kafka: SchemaNode[] = [
      tbl("events", "topic", [{ name: "amount", detail: "double" }]),
    ];

    expect(
      buildFederatedSqlSchema([
        { name: "cache", schema: redis },
        { name: "stream", schema: kafka },
      ]),
    ).toEqual({
      // Redis keeps the db node as its immediate container; keys are columnless.
      "cache.db0.home:key": [],
      // A top-level Kafka topic has no container, so the reference is 2-part.
      "stream.events": [{ name: "amount", type: "double" }],
    });
  });

  it("qualifies every table across multiple federated sources independently", () => {
    const pg: SchemaNode[] = [
      {
        name: "public",
        kind: "schema",
        path: "public",
        children: [tbl("customers", "table", [{ name: "id" }])],
      },
    ];
    const mssql: SchemaNode[] = [
      {
        name: "appdb",
        kind: "database",
        path: "appdb",
        children: [
          {
            name: "dbo",
            kind: "schema",
            path: "appdb.dbo",
            children: [
              tbl("orders", "table", [{ name: "amount" }]),
              tbl("order_items", "table", [{ name: "qty" }]),
            ],
          },
        ],
      },
    ];

    expect(
      buildFederatedSqlSchema([
        { name: "prod_postgres", schema: pg },
        { name: "prod_mssql", schema: mssql },
      ]),
    ).toEqual({
      "prod_postgres.public.customers": [{ name: "id", type: undefined }],
      "prod_mssql.dbo.orders": [{ name: "amount", type: undefined }],
      "prod_mssql.dbo.order_items": [{ name: "qty", type: undefined }],
    });
  });

  it("skips sources with missing name or uncached schema", () => {
    const tree: SchemaNode[] = [tbl("events", "topic", [])];
    expect(
      buildFederatedSqlSchema([
        { name: "", schema: tree },
        { name: "stream", schema: undefined },
        { name: "ok", schema: tree },
      ]),
    ).toEqual({ "ok.events": [] });
  });
});

describe("dialectFor", () => {
  it("maps each kind to the right dialect", () => {
    expect(dialectFor("postgres")).toBe(PostgreSQL);
    expect(dialectFor("redshift")).toBe(PostgreSQL);
    expect(dialectFor("mysql")).toBe(MySQL);
    expect(dialectFor("mariadb")).toBe(MySQL);
    expect(dialectFor("sqlite")).toBe(SQLite);
    expect(dialectFor("duckdb")).toBe(SQLite);
    expect(dialectFor("mssql")).toBe(MSSQL);
    expect(dialectFor("oracle")).toBe(PLSQL);
  });

  it("returns a consistent EnhancedSQL dialect for unmapped kinds", () => {
    const snowflake = dialectFor("snowflake");
    const undef = dialectFor(undefined);
    expect(snowflake).toBe(undef);
  });

  it("BigQuery gets its own dialect separate from EnhancedSQL", () => {
    const bq = dialectFor("bigquery");
    const snowflake = dialectFor("snowflake");
    expect(bq).not.toBe(snowflake);
  });

  it("BigQuery dialect highlights BigQuery-specific keywords like ENFORCED", () => {
    const words: Record<string, number> = (dialectFor("bigquery") as any).dialect.words;
    const kwToken = words["select"];
    for (const kw of ["enforced", "options", "cluster", "unnest", "qualify"]) {
      expect(words[kw]).toBe(kwToken);
    }
  });

  it("EnhancedSQL includes common keywords missing from StandardSQL", () => {
    const enhanced = dialectFor("snowflake");
    const words: Record<string, number> = (enhanced as any).dialect.words;
    const kwToken = words["select"];
    for (const kw of ["sum", "avg", "min", "max", "show", "explain", "qualify", "ilike"]) {
      expect(words[kw]).toBe(kwToken);
    }
  });

  it("EnhancedSQL includes SQLMesh model block keywords", () => {
    const enhanced = dialectFor("snowflake");
    const words: Record<string, number> = (enhanced as any).dialect.words;
    const kwToken = words["select"];
    for (const kw of [
      "model", "name", "kind", "grain", "tags", "description", "audits",
      "audit", "seed", "columns", "cron", "owner", "path", "unique_key",
    ]) {
      expect(words[kw]).toBe(kwToken);
    }
  });

  it("every named SQL dialect includes SQLMesh model block keywords", () => {
    // SQLMesh model files are SQL parsed under the connection's gateway dialect, so
    // the model DSL keywords must highlight no matter which named dialect applies.
    const kinds = ["postgres", "mysql", "sqlite", "mssql", "oracle"] as const;
    for (const kind of kinds) {
      const words: Record<string, number> = (dialectFor(kind) as any).dialect.words;
      const kwToken = words["select"];
      for (const kw of ["model", "kind", "grain", "tags", "description", "audits", "unique_key"]) {
        expect(words[kw]).toBe(kwToken);
      }
    }
  });

  it("EnhancedSQL includes common types missing from StandardSQL", () => {
    const enhanced = dialectFor("snowflake");
    const words: Record<string, number> = (enhanced as any).dialect.words;
    const typeToken = words["integer"];
    for (const t of ["text", "json", "jsonb", "uuid", "bytea", "serial"]) {
      expect(words[t]).toBe(typeToken);
    }
  });

  it("EnhancedSQL still includes base SQL keywords", () => {
    const enhanced = dialectFor("snowflake");
    const words: Record<string, number> = (enhanced as any).dialect.words;
    const kwToken = words["select"];
    for (const kw of ["from", "where", "insert", "update", "delete", "create", "drop"]) {
      expect(words[kw]).toBe(kwToken);
    }
  });

  it("BigQuery dialect includes BQ-specific types", () => {
    const bq = dialectFor("bigquery");
    const words: Record<string, number> = (bq as any).dialect.words;
    const typeToken = words["integer"];
    for (const t of ["int64", "float64", "string", "bool", "struct", "json"]) {
      expect(words[t]).toBe(typeToken);
    }
  });

  it("BigQuery dialect includes extra keywords", () => {
    const bq = dialectFor("bigquery");
    const words: Record<string, number> = (bq as any).dialect.words;
    const kwToken = words["select"];
    for (const kw of ["sum", "show", "explain", "qualify"]) {
      expect(words[kw]).toBe(kwToken);
    }
  });
});

describe("deriveSchemaScoping", () => {
  it("treats a single top-level database (Postgres-like) as scoped", () => {
    const tree: SchemaNode[] = [
      {
        name: "appdb",
        kind: "database",
        path: "appdb",
        children: [
          tbl("public", "schema", []),
          tbl("analytics", "schema", []),
        ],
      },
    ];
    // Schemas are the children of the single database node.
    tree[0].children[0].children = [tbl("users", "table", [{ name: "id" }])];
    const { catalogQualified, schemaNames } = deriveSchemaScoping(tree);
    expect(catalogQualified).toBe(false);
    expect(schemaNames.sort()).toEqual(["analytics", "public"]);
  });

  it("treats multiple top-level databases (Trino/MySQL-like) as catalog-qualified", () => {
    const tree: SchemaNode[] = [
      {
        name: "tpch",
        kind: "database",
        path: "tpch",
        children: [tbl("sf1", "schema", [])],
      },
      {
        name: "hive",
        kind: "database",
        path: "hive",
        children: [tbl("default", "schema", [])],
      },
    ];
    const { catalogQualified, schemaNames } = deriveSchemaScoping(tree);
    expect(catalogQualified).toBe(true);
    expect(schemaNames).toEqual([]);
  });

  it("treats a schema-less single database (SQLite-like) as scoped with no schema names", () => {
    const tree: SchemaNode[] = [
      {
        name: "main",
        kind: "database",
        path: "main",
        children: [tbl("users", "table", [{ name: "id" }])],
      },
    ];
    const { catalogQualified, schemaNames } = deriveSchemaScoping(tree);
    expect(catalogQualified).toBe(false);
    expect(schemaNames).toEqual([]);
  });
});
