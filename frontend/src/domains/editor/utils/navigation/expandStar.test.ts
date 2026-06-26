import { describe, expect, it } from "vitest";
import { expandStarAtCursor, buildStarExpansionSchema } from "./expandStar";

const schema = {
  users: [{ name: "id" }, { name: "name" }],
  "public.orders": [{ name: "order_id" }, { name: "total" }],
  orders: [{ name: "order_id" }, { name: "total" }],
};

describe("expandStarAtCursor", () => {
  it("expands an unqualified select star from the referenced table", () => {
    const text = "SELECT * FROM users";
    expect(expandStarAtCursor(text, text.indexOf("*"), schema)).toEqual({
      from: 7,
      to: 8,
      replacement: "id, name",
      tableName: "users",
    });
  });

  it("expands a schema-qualified table star", () => {
    const text = "SELECT * FROM public.orders";
    expect(expandStarAtCursor(text, text.indexOf("*") + 1, schema)?.replacement).toBe(
      "order_id, total",
    );
  });

  it("expands a qualified alias star with qualified replacement columns", () => {
    const text = "SELECT u.* FROM users u";
    expect(expandStarAtCursor(text, text.indexOf("*"), schema)?.replacement).toBe(
      "u.id, u.name",
    );
  });

  it("does not expand non-star cursor locations or ambiguous multi-table stars", () => {
    expect(expandStarAtCursor("SELECT * FROM users", 0, schema)).toBeNull();
    expect(expandStarAtCursor("SELECT * FROM users JOIN orders ON true", 7, schema)).toBeNull();
    expect(expandStarAtCursor("SELECT * FROM users, orders", 7, schema)).toBeNull();
  });

  it("expands when the cursor is adjacent to the star across whitespace", () => {
    const text = "SELECT  *  FROM users";
    const starIdx = text.indexOf("*");
    // Cursor in the whitespace just before the star (between the two spaces).
    expect(expandStarAtCursor(text, starIdx - 1, schema)?.replacement).toBe("id, name");
    // Cursor in the whitespace just after the star.
    expect(expandStarAtCursor(text, starIdx + 2, schema)?.replacement).toBe("id, name");
  });

  it("does not jump across a newline to find a star", () => {
    const text = "SELECT *\nFROM users";
    // Cursor at the start of the second line; the star is on the previous line.
    expect(expandStarAtCursor(text, text.indexOf("\n") + 1, schema)).toBeNull();
  });

  it("does not treat a non-whitespace token next to the star as adjacent", () => {
    // Cursor sits on the `T` of SELECT; only spaces should bridge to the star.
    expect(expandStarAtCursor("SELECT * FROM users", 5, schema)).toBeNull();
  });
});

const dbtSchema = {
  stg_customers: [{ name: "customer_id" }, { name: "email" }],
  stg_orders: [{ name: "order_id" }, { name: "amount" }],
};

describe("expandStarAtCursor with dbt/SQLMesh templating", () => {
  it("expands a star over a `{{ ref('model') }}` reference", () => {
    const text = "SELECT * FROM {{ ref('stg_customers') }}";
    expect(expandStarAtCursor(text, text.indexOf("*"), dbtSchema)?.replacement).toBe(
      "customer_id, email",
    );
  });

  it("uses the last argument of a packaged `ref('pkg', 'model')`", () => {
    const text = "SELECT * FROM {{ ref('my_pkg', 'stg_orders') }}";
    expect(expandStarAtCursor(text, text.indexOf("*"), dbtSchema)?.replacement).toBe(
      "order_id, amount",
    );
  });

  it("expands a star over a `{{ source('src', 'tbl') }}` reference", () => {
    const text = "SELECT * FROM {{ source('raw', 'stg_customers') }}";
    expect(expandStarAtCursor(text, text.indexOf("*"), dbtSchema)?.replacement).toBe(
      "customer_id, email",
    );
  });

  it("resolves an alias on a jinja reference for qualified expansion", () => {
    const text = "SELECT co.* FROM {{ ref('stg_orders') }} co";
    expect(expandStarAtCursor(text, text.indexOf("*"), dbtSchema)?.replacement).toBe(
      "co.order_id, co.amount",
    );
  });

  it("handles double-quoted ref arguments", () => {
    const text = 'SELECT * FROM {{ ref("stg_customers") }}';
    expect(expandStarAtCursor(text, text.indexOf("*"), dbtSchema)?.replacement).toBe(
      "customer_id, email",
    );
  });

  it("scopes the star to its own CTE in a multi-CTE model with no semicolons", () => {
    const text = [
      "{{ config(materialized='table') }}",
      "",
      "WITH customers AS (",
      "    SELECT * FROM {{ ref('stg_customers') }}",
      "),",
      "",
      "orders AS (",
      "    SELECT * FROM {{ ref('stg_orders') }}",
      ")",
      "",
      "SELECT * FROM customers",
    ].join("\n");
    const ordersStar = text.indexOf("*", text.indexOf("orders AS"));
    expect(expandStarAtCursor(text, ordersStar, dbtSchema)?.replacement).toBe(
      "order_id, amount",
    );
    const customersStar = text.indexOf("*");
    expect(expandStarAtCursor(text, customersStar, dbtSchema)?.replacement).toBe(
      "customer_id, email",
    );
  });
});

describe("buildStarExpansionSchema", () => {
  it("returns the base dict unchanged when there are no models", () => {
    const base = { users: [{ name: "id" }] };
    expect(buildStarExpansionSchema(base, [], [])).toBe(base);
  });

  it("folds dbt model columns in under the model name", () => {
    const dict = buildStarExpansionSchema(
      {},
      [{ name: "stg_customers", kind: "model", columns: [{ name: "customer_id" }, { name: "email" }] }],
      [],
    );
    expect(dict.stg_customers).toEqual([{ name: "customer_id" }, { name: "email" }]);
  });

  it("keys dbt sources by their bare table name", () => {
    const dict = buildStarExpansionSchema(
      {},
      [{ name: "raw.orders", kind: "source", columns: [{ name: "order_id" }] }],
      [],
    );
    expect(dict.orders).toEqual([{ name: "order_id" }]);
    expect(dict["raw.orders"]).toBeUndefined();
  });

  it("folds SQLMesh model columns in under the model name", () => {
    const dict = buildStarExpansionSchema(
      {},
      [],
      [{ name: "mart.revenue", columns: [{ name: "amount", type: "DECIMAL" }] }],
    );
    expect(dict["mart.revenue"]).toEqual([{ name: "amount", type: "DECIMAL" }]);
  });

  it("lets a SELECT * over a dbt ref expand once the model columns are folded in", () => {
    const dict = buildStarExpansionSchema(
      { users: [{ name: "id" }] },
      [{ name: "stg_customers", kind: "model", columns: [{ name: "customer_id" }, { name: "email" }] }],
      [],
    );
    const text = "SELECT * FROM {{ ref('stg_customers') }}";
    expect(expandStarAtCursor(text, text.indexOf("*"), dict)?.replacement).toBe(
      "customer_id, email",
    );
  });

  it("skips models with no columns", () => {
    const dict = buildStarExpansionSchema(
      {},
      [{ name: "empty", kind: "model", columns: [] }],
      [],
    );
    expect(dict.empty).toBeUndefined();
  });
});

describe("buildStarExpansionSchema live SQL parsing", () => {
  it("derives columns from the model's live SELECT, reflecting un-run edits", () => {
    // Repro: `hello` was just added to the SELECT and not yet documented/run.
    const sql =
      "SELECT customer_id, first_name, last_name, email, 'abc' AS hello FROM {{ ref('raw_customers') }}";
    const dict = buildStarExpansionSchema(
      {},
      [
        {
          name: "stg_customers",
          kind: "model",
          columns: [{ name: "customer_id" }, { name: "first_name" }],
          sql,
        },
      ],
      [],
    );
    expect(dict.stg_customers.map((c) => c.name)).toEqual([
      "customer_id",
      "first_name",
      "last_name",
      "email",
      "hello",
    ]);
  });

  it("live SQL columns win over both warehouse and scanned metadata", () => {
    const dict = buildStarExpansionSchema(
      { stg_customers: [{ name: "old_id" }, { name: "old_name" }] },
      [
        {
          name: "stg_customers",
          kind: "model",
          columns: [{ name: "doc_only" }],
          sql: "SELECT id, name, 1 AS fresh FROM {{ ref('raw') }}",
        },
      ],
      [],
    );
    expect(dict.stg_customers.map((c) => c.name)).toEqual(["id", "name", "fresh"]);
  });

  it("extracts qualified columns, AS aliases, and quoted aliases", () => {
    const dict = buildStarExpansionSchema(
      {},
      [
        {
          name: "m",
          kind: "model",
          sql: 'SELECT t.id, lower(name) AS lname, sum(x) AS "Total Spend" FROM {{ ref(\'r\') }} t',
        },
      ],
      [],
    );
    expect(dict.m.map((c) => c.name)).toEqual(["id", "lname", "Total Spend"]);
  });

  it("keeps commas inside function calls as one column", () => {
    const dict = buildStarExpansionSchema(
      {},
      [{ name: "m", kind: "model", sql: "SELECT coalesce(a, b, c) AS first_set, id FROM {{ ref('r') }}" }],
      [],
    );
    expect(dict.m.map((c) => c.name)).toEqual(["first_set", "id"]);
  });

  it("ignores comments and a leading config block when parsing", () => {
    const sql = [
      "{{ config(materialized='view') }}",
      "SELECT",
      "  id, -- primary key",
      "  /* dropped: legacy_flag, */ amount",
      "FROM {{ ref('r') }}",
    ].join("\n");
    const dict = buildStarExpansionSchema({}, [{ name: "m", kind: "model", sql }], []);
    expect(dict.m.map((c) => c.name)).toEqual(["id", "amount"]);
  });

  describe.each([
    ["SELECT *", "SELECT * FROM {{ ref('r') }}"],
    ["a qualified star", "SELECT t.* FROM {{ ref('r') }} t"],
    ["a JOIN", "SELECT a.id, b.name FROM {{ ref('a') }} a JOIN {{ ref('b') }} b ON a.id = b.id"],
    ["a CTE", "WITH c AS (SELECT id FROM {{ ref('r') }}) SELECT id FROM c"],
    ["a set operation", "SELECT id FROM {{ ref('a') }} UNION SELECT id FROM {{ ref('b') }}"],
    ["an un-aliased expression", "SELECT id, amount * 2 FROM {{ ref('r') }}"],
  ])("falls through to the warehouse schema for %s", (_label, sql) => {
    it("keeps the warehouse columns", () => {
      const dict = buildStarExpansionSchema(
        { stg: [{ name: "wh_a" }, { name: "wh_b" }] },
        [{ name: "stg", kind: "model", columns: [{ name: "doc_only" }], sql }],
        [],
      );
      expect(dict.stg.map((c) => c.name)).toEqual(["wh_a", "wh_b"]);
    });
  });

  it("warehouse columns win over scanned metadata when SQL can't be parsed", () => {
    const dict = buildStarExpansionSchema(
      { stg: [{ name: "wh_a" }, { name: "wh_b" }, { name: "wh_c" }] },
      [{ name: "stg", kind: "model", columns: [{ name: "wh_a" }], sql: "SELECT * FROM {{ ref('r') }}" }],
      [],
    );
    expect(dict.stg.map((c) => c.name)).toEqual(["wh_a", "wh_b", "wh_c"]);
  });

  it("uses scanned metadata only when neither live SQL nor warehouse is available", () => {
    const dict = buildStarExpansionSchema(
      {},
      [{ name: "stg", kind: "model", columns: [{ name: "doc_a" }], sql: "SELECT * FROM {{ ref('r') }}" }],
      [],
    );
    expect(dict.stg.map((c) => c.name)).toEqual(["doc_a"]);
  });

  it("parses live SQL for SQLMesh models too", () => {
    const dict = buildStarExpansionSchema(
      {},
      [],
      [{ name: "mart.revenue", sql: "SELECT day, sum(amt) AS total FROM {{ ref('raw') }}" }],
    );
    expect(dict["mart.revenue"].map((c) => c.name)).toEqual(["day", "total"]);
  });

  it("end-to-end: a star over an edited ref expands to the live columns", () => {
    const dict = buildStarExpansionSchema(
      { stg_customers: [{ name: "customer_id" }, { name: "email" }] },
      [
        {
          name: "stg_customers",
          kind: "model",
          sql: "SELECT customer_id, email, 'abc' AS hello FROM {{ ref('raw') }}",
        },
      ],
      [],
    );
    const text = "SELECT * FROM {{ ref('stg_customers') }}";
    expect(expandStarAtCursor(text, text.indexOf("*"), dict)?.replacement).toBe(
      "customer_id, email, hello",
    );
  });
});
