import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { sql } from "@codemirror/lang-sql";
import { dialectFor } from "../../sqlSchema";
import {
  extractReferencedTables,
  extractReferencedDbtRefs,
  extractReferencedDbtSources,
  currentStatementBlock,
  shadowedBareNames,
} from "../../context/sqlParse";
import { SqlCompletionProvider } from "./provider";
import type { CompletionSourceOpts } from "./types";

const buildDbcCompletionSource = (opts: CompletionSourceOpts) =>
  new SqlCompletionProvider(opts).toSource();

function makeCtx(doc: string, pos?: number, explicit = false): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos ?? doc.length, explicit);
}

// Context backed by a real Lezer SQL syntax tree (the production path). `makeCtx`
// has no `sql()` extension, so it exercises the regex clause-detector fallback;
// the running editor always has the tree, so clause-sensitive behaviour must be
// asserted here too (the CTE GROUP BY bug only manifested on this path).
function makeTreeCtx(doc: string, pos?: number, explicit = false): CompletionContext {
  const state = EditorState.create({
    doc,
    extensions: [sql({ dialect: dialectFor("postgres") })],
  });
  return new CompletionContext(state, pos ?? doc.length, explicit);
}

describe("buildDbcCompletionSource", () => {
  it("returns a function", () => {
    const source = buildDbcCompletionSource({ schema: {} });
    expect(typeof source).toBe("function");
  });

  it("returns SQL keywords when typing at start of document", () => {
    const source = buildDbcCompletionSource({ schema: {} });
    const result = source(makeCtx("SEL"));
    expect(result).not.toBeNull();
    expect(result!.options.length).toBeGreaterThan(0);
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("SELECT");
  });

  it("does not autosuggest columns while the column field is empty", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [
          { name: "id", type: "integer" },
          { name: "email", type: "text" },
        ],
      },
      connectionKind: "postgres",
    });
    const result = source(makeCtx("SELECT "));
    expect(result).toBeNull();
  });

  it("returns columns and functions on explicit completion in column context", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [
          { name: "id", type: "integer" },
          { name: "email", type: "text" },
        ],
      },
      connectionKind: "postgres",
    });
    const state = EditorState.create({ doc: "SELECT " });
    const ctx = new CompletionContext(state, state.doc.length, true);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("id");
    expect(labels).toContain("email");
    expect(labels).toContain("COUNT");
  });

  it("includes SQL data types in column context completions", () => {
    const source = buildDbcCompletionSource({
      schema: { users: [{ name: "id", type: "integer" }] },
    });
    const state = EditorState.create({ doc: "SELECT " });
    const ctx = new CompletionContext(state, state.doc.length, true);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("TEXT");
    expect(labels).toContain("INTEGER");
    expect(labels).toContain("VARCHAR");
    expect(labels).toContain("JSON");
    const textOpt = result!.options.find((o) => o.label === "TEXT");
    expect(textOpt!.type).toBe("type");
  });

  it("includes SQLMesh keywords in keyword context only in SQLMesh files", () => {
    const source = buildDbcCompletionSource({
      schema: { users: [{ name: "id", type: "integer" }] },
      isSqlMeshFile: true,
    });
    const state = EditorState.create({ doc: "GR" });
    const ctx = new CompletionContext(state, state.doc.length, true);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("MODEL");
    expect(labels).toContain("GRAIN");
    expect(labels).toContain("KIND");
    expect(labels).toContain("COLUMNS");
  });

  it("omits SQLMesh keywords in keyword context for plain SQL files", () => {
    const source = buildDbcCompletionSource({
      schema: { users: [{ name: "id", type: "integer" }] },
    });
    const state = EditorState.create({ doc: "GR" });
    const ctx = new CompletionContext(state, state.doc.length, true);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).not.toContain("MODEL");
    expect(labels).not.toContain("GRAIN");
  });

  it("completes columns from sqlmesh model after alias qualifier", () => {
    const source = buildDbcCompletionSource({
      schema: {},
      isSqlMeshFile: true,
      sqlmeshModels: [
        {
          name: "analytics_shop.country_codes",
          columns: [
            { name: "country_code", type: "TEXT" },
            { name: "country_name", type: "TEXT" },
            { name: "region", type: "TEXT" },
          ],
        },
      ],
    });
    const doc = "SELECT cc. FROM analytics_shop.country_codes AS cc";
    const state = EditorState.create({ doc });
    const ctx = new CompletionContext(state, 10, true);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("country_code");
    expect(labels).toContain("country_name");
    expect(labels).toContain("region");
  });

  it("does not autosuggest tables while the table field is empty", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [{ name: "id" }],
        orders: [{ name: "id" }],
      },
    });
    const result = source(makeCtx("SELECT * FROM "));
    expect(result).toBeNull();
  });

  it("returns tables on explicit completion in FROM context", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [{ name: "id" }],
        orders: [{ name: "id" }],
      },
    });
    const state = EditorState.create({ doc: "SELECT * FROM " });
    const ctx = new CompletionContext(state, state.doc.length, true);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("users");
    expect(labels).toContain("orders");
  });

  it("returns null when no word and not explicit", () => {
    const source = buildDbcCompletionSource({ schema: {} });
    const state = EditorState.create({ doc: "" });
    const ctx = new CompletionContext(state, 0, false);
    const result = source(ctx);
    expect(result).toBeNull();
  });

  it("returns results when explicitly triggered on empty doc", () => {
    const source = buildDbcCompletionSource({ schema: {} });
    const state = EditorState.create({ doc: "" });
    const ctx = new CompletionContext(state, 0, true);
    const result = source(ctx);
    expect(result).not.toBeNull();
    expect(result!.options.length).toBeGreaterThan(0);
  });

  // at a clause boundary the completion menu must auto-open (empty field,
  // no word typed yet) so the relevant next suggestions "kick in" without forcing
  // the user to type a character or press the explicit-completion shortcut.
  it("auto-suggests columns immediately after GROUP BY (empty field)", () => {
    const source = buildDbcCompletionSource({
      schema: { sales: [{ name: "sale_date", type: "date" }, { name: "region", type: "text" }] },
      connectionKind: "postgres",
    });
    const result = source(makeCtx("SELECT * FROM sales GROUP BY "));
    expect(result).not.toBeNull();
    const columns = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(columns).toContain("sale_date");
    expect(columns).toContain("region");
  });

  it("auto-suggests columns immediately after ORDER BY (empty field)", () => {
    const source = buildDbcCompletionSource({
      schema: { sales: [{ name: "sale_date", type: "date" }, { name: "region", type: "text" }] },
      connectionKind: "postgres",
    });
    const result = source(makeCtx("SELECT * FROM sales ORDER BY "));
    expect(result).not.toBeNull();
    const columns = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(columns).toContain("sale_date");
    expect(columns).toContain("region");
  });

  it("auto-suggests columns after a trailing comma in GROUP BY (empty field)", () => {
    const source = buildDbcCompletionSource({
      schema: { sales: [{ name: "sale_date", type: "date" }, { name: "region", type: "text" }] },
      connectionKind: "postgres",
    });
    const result = source(makeCtx("SELECT * FROM sales GROUP BY region, "));
    expect(result).not.toBeNull();
    const columns = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(columns).toContain("sale_date");
  });

  it("auto-suggests next-clause keywords after a completed FROM table (empty field)", () => {
    const source = buildDbcCompletionSource({
      schema: { sales: [{ name: "sale_date", type: "date" }] },
      connectionKind: "postgres",
    });
    const result = source(makeCtx("SELECT * FROM sales "));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("GROUP BY");
    expect(labels).toContain("ORDER BY");
    expect(labels).toContain("WHERE");
  });

  it("does not auto-suggest at the start of a fresh statement after a semicolon", () => {
    const source = buildDbcCompletionSource({
      schema: { sales: [{ name: "sale_date", type: "date" }] },
      connectionKind: "postgres",
    });
    const result = source(makeCtx("SELECT 1; "));
    expect(result).toBeNull();
  });

  it("offers GROUP BY / ORDER BY despite a commented-out clause and trailing clauses after the cursor", () => {
    // Reproduces the CTE case: a commented `GROUP BY` and the outer query's
    // `ORDER BY` must not make the engine think those clauses already exist and
    // drop them. Only the clause scope *before* the cursor counts.
    const doc =
      "SELECT region FROM sales GRO\n--      GROUP BY region\nORDER BY region";
    const cursor = doc.indexOf("GRO") + "GRO".length;
    const source = buildDbcCompletionSource({
      schema: { sales: [{ name: "region", type: "text" }] },
      connectionKind: "postgres",
    });
    const result = source(makeCtx(doc, cursor));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("GROUP BY");
    expect(labels).toContain("ORDER BY");
  });

  it("accepts dbt options", () => {
    const source = buildDbcCompletionSource({
      schema: {},
      dbtModels: [{ name: "stg_orders", columns: [{ name: "id", type: "integer" }] }],
      dbtSources: [{ sourceName: "raw", tableName: "orders", columns: [{ name: "amount" }] }],
      isDbtFile: true,
    });
    expect(typeof source).toBe("function");
  });

  it("wires through EditorState.languageData facet", () => {
    const completionFn = buildDbcCompletionSource({ schema: {} });
    const state = EditorState.create({
      doc: "SEL",
      extensions: [
        EditorState.languageData.of(() => [{ autocomplete: completionFn }]),
      ],
    });
    const sources = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", 0);
    expect(sources.length).toBe(1);
    expect(sources[0]).toBe(completionFn);
  });

  it("only shows columns from FROM-referenced tables", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [{ name: "id", type: "integer" }, { name: "email", type: "text" }],
        orders: [{ name: "id", type: "integer" }, { name: "total", type: "numeric" }],
        products: [{ name: "id", type: "integer" }, { name: "name", type: "text" }],
      },
    });
    const result = source(makeCtx("SELECT  FROM users", 7, true));
    expect(result).not.toBeNull();
    const columns = result!.options.filter((o) => o.type === "column");
    const usersColumns = columns.filter((o) => o.detail?.startsWith("users"));
    const ordersColumns = columns.filter((o) => o.detail?.startsWith("orders"));
    const productsColumns = columns.filter((o) => o.detail?.startsWith("products"));
    for (const c of usersColumns) expect(c.boost).toBe(2);
    expect(ordersColumns).toHaveLength(0);
    expect(productsColumns).toHaveLength(0);
  });

  it("collapses duplicate column names across multiple FROM tables", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [{ name: "id" }],
        orders: [{ name: "id" }],
        logs: [{ name: "id" }],
      },
    });
    const result = source(makeCtx("SELECT  FROM users, orders", 7, true));
    expect(result).not.toBeNull();
    const idColumns = result!.options.filter(
      (o) => o.type === "column" && o.label === "id",
    );
    expect(idColumns).toHaveLength(1);
    expect(idColumns[0].boost).toBe(2);
    const logsCol = result!.options.find((o) => o.detail === "logs");
    expect(logsCol).toBeUndefined();
  });

  it("shows columns from JOIN tables, excludes others", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [{ name: "name" }],
        orders: [{ name: "total" }],
        logs: [{ name: "msg" }],
      },
    });
    const result = source(makeCtx(
      "SELECT  FROM users JOIN orders ON users.id = orders.uid",
      7,
      true,
    ));
    expect(result).not.toBeNull();
    const columns = result!.options.filter((o) => o.type === "column");
    const usersCol = columns.find((o) => o.detail === "users");
    const ordersCol = columns.find((o) => o.detail === "orders");
    const logsCol = columns.find((o) => o.detail === "logs");
    expect(usersCol!.boost).toBe(2);
    expect(ordersCol!.boost).toBe(2);
    expect(logsCol).toBeUndefined();
  });

  it("completes columns after a FROM alias qualifier", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [{ name: "id" }, { name: "email" }],
        orders: [{ name: "total" }],
      },
    });
    const doc = "SELECT u. FROM users u";
    const result = source(makeCtx(doc, doc.indexOf("u.") + 2));
    expect(result).not.toBeNull();
    expect(result!.from).toBe(doc.indexOf("u.") + 2);
    const columns = result!.options.filter((o) => o.type === "column");
    expect(columns.map((o) => o.label)).toEqual(["id", "email"]);
    expect(columns.every((o) => o.boost === 4)).toBe(true);
  });

  it("completes columns after JOIN aliases in ON clauses", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [{ name: "id" }, { name: "email" }],
        orders: [{ name: "id" }, { name: "user_id" }, { name: "total" }],
      },
    });
    const doc = "SELECT * FROM users u JOIN orders AS o ON o.";
    const result = source(makeCtx(doc, doc.length));
    expect(result).not.toBeNull();
    const labels = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(labels).toEqual(["id", "user_id", "total"]);
    expect(labels).not.toContain("email");
  });

  it("completes columns for federated dotted table aliases", () => {
    const source = buildDbcCompletionSource({
      schema: {
        "test_mysql.appdb.orders": [{ name: "id" }, { name: "customer_id" }],
        "test_pg.public.customers": [{ name: "id" }, { name: "email" }],
      },
    });
    const doc = "SELECT o. FROM test_mysql.appdb.orders o JOIN test_pg.public.customers c ON o.customer_id = c.id";
    const result = source(makeCtx(doc, doc.indexOf("o.") + 2));
    expect(result).not.toBeNull();
    const labels = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(labels).toEqual(["id", "customer_id"]);
  });

  it("returns null after semicolon (statement end)", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [{ name: "id", type: "integer" }],
      },
    });
    const result = source(makeCtx("SELECT * FROM users;"));
    expect(result).toBeNull();
  });

  it("scopes columns to a dbt source referenced via {{ source() }} in FROM", () => {
    const source = buildDbcCompletionSource({
      isDbtFile: true,
      schema: {
        "public.raw_customers": [{ name: "id" }, { name: "first_name" }, { name: "last_name" }],
        "public.raw_orders": [{ name: "id" }, { name: "amount" }, { name: "status" }],
      },
    });
    const doc = "SELECT  FROM {{ source('public', 'raw_customers') }}";
    const result = source(makeCtx(doc, 7, true));
    expect(result).not.toBeNull();
    const labels = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(labels).toContain("first_name");
    // amount/status live on raw_orders, which is not the referenced source
    expect(labels).not.toContain("amount");
    expect(labels).not.toContain("status");
  });

  it("scopes columns to a dbt model referenced via {{ ref() }} in FROM", () => {
    const source = buildDbcCompletionSource({
      isDbtFile: true,
      schema: {
        stg_orders: [{ name: "order_id" }, { name: "amount" }],
        stg_customers: [{ name: "customer_id" }, { name: "email" }],
      },
    });
    const doc = "SELECT  FROM {{ ref('stg_orders') }}";
    const result = source(makeCtx(doc, 7, true));
    expect(result).not.toBeNull();
    const labels = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(labels).toContain("order_id");
    expect(labels).not.toContain("email");
  });

  it("suggests dbt source columns from the manifest when schema lacks the table", () => {
    const source = buildDbcCompletionSource({
      isDbtFile: true,
      schema: {},
      dbtSources: [
        { sourceName: "public", tableName: "raw_customers", columns: [{ name: "id" }, { name: "first_name" }] },
        { sourceName: "public", tableName: "raw_orders", columns: [{ name: "id" }, { name: "amount" }] },
      ],
    });
    const doc = "SELECT  FROM {{ source('public', 'raw_customers') }}";
    const result = source(makeCtx(doc, 7, true));
    expect(result).not.toBeNull();
    const labels = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(labels).toContain("first_name");
    expect(labels).not.toContain("amount");
  });

  it("does not duplicate a column shared by the warehouse schema and the dbt source", () => {
    const source = buildDbcCompletionSource({
      isDbtFile: true,
      schema: {
        "public.raw_customers": [{ name: "id", type: "integer" }, { name: "first_name", type: "text" }],
      },
      dbtSources: [
        { sourceName: "public", tableName: "raw_customers", columns: [{ name: "id" }, { name: "first_name" }] },
      ],
    });
    const doc = "SELECT  FROM {{ source('public', 'raw_customers') }}";
    const result = source(makeCtx(doc, 7, true));
    expect(result).not.toBeNull();
    const firstNameCols = result!.options.filter(
      (o) => o.type === "column" && o.label === "first_name",
    );
    expect(firstNameCols).toHaveLength(1);
  });
});

describe("extractReferencedTables", () => {
  it("extracts single FROM table", () => {
    expect(extractReferencedTables("SELECT * FROM users")).toEqual(new Set(["users"]));
  });

  it("extracts comma-separated FROM tables", () => {
    expect(extractReferencedTables("SELECT * FROM users, orders WHERE 1=1")).toEqual(
      new Set(["users", "orders"]),
    );
  });

  it("extracts FROM + JOIN tables", () => {
    expect(extractReferencedTables("SELECT * FROM users JOIN orders ON users.id = orders.uid")).toEqual(
      new Set(["users", "orders"]),
    );
  });

  it("extracts schema-qualified table names", () => {
    expect(extractReferencedTables("SELECT * FROM public.users")).toEqual(new Set(["public.users"]));
  });

  it("handles aliases gracefully", () => {
    expect(extractReferencedTables("SELECT * FROM users u, orders AS o")).toEqual(
      new Set(["users", "orders"]),
    );
  });

  it("handles aliases on joins", () => {
    expect(extractReferencedTables("SELECT * FROM users u JOIN orders AS o ON u.id = o.user_id")).toEqual(
      new Set(["users", "orders"]),
    );
  });

  it("returns empty set for no FROM", () => {
    expect(extractReferencedTables("SELECT 1")).toEqual(new Set());
  });

  it("handles multiple statements", () => {
    expect(extractReferencedTables("SELECT * FROM users; SELECT * FROM orders")).toEqual(
      new Set(["users", "orders"]),
    );
  });

  it("handles LEFT/RIGHT/INNER JOIN", () => {
    expect(
      extractReferencedTables("SELECT * FROM users LEFT JOIN orders ON 1=1 INNER JOIN logs ON 1=1"),
    ).toEqual(new Set(["users", "orders", "logs"]));
  });
});

describe("extractReferencedDbtRefs", () => {
  it("extracts single ref", () => {
    expect(extractReferencedDbtRefs("SELECT * FROM {{ ref('stg_orders') }}")).toEqual(
      new Set(["stg_orders"]),
    );
  });

  it("extracts multiple refs", () => {
    const text = "SELECT * FROM {{ ref('stg_orders') }} JOIN {{ ref('stg_customers') }} ON 1=1";
    expect(extractReferencedDbtRefs(text)).toEqual(new Set(["stg_orders", "stg_customers"]));
  });

  it("handles double quotes", () => {
    expect(extractReferencedDbtRefs('SELECT * FROM {{ ref("stg_orders") }}')).toEqual(
      new Set(["stg_orders"]),
    );
  });

  it("handles whitespace variations", () => {
    expect(extractReferencedDbtRefs("SELECT * FROM {{  ref(  'stg_orders'  )  }}")).toEqual(
      new Set(["stg_orders"]),
    );
  });

  it("returns empty set when no refs", () => {
    expect(extractReferencedDbtRefs("SELECT * FROM users")).toEqual(new Set());
  });
});

describe("extractReferencedDbtSources", () => {
  it("extracts single source", () => {
    expect(extractReferencedDbtSources("SELECT * FROM {{ source('raw', 'orders') }}")).toEqual(
      new Set(["raw.orders"]),
    );
  });

  it("extracts multiple sources", () => {
    const text = "SELECT * FROM {{ source('raw', 'orders') }} JOIN {{ source('raw', 'customers') }} ON 1=1";
    expect(extractReferencedDbtSources(text)).toEqual(new Set(["raw.orders", "raw.customers"]));
  });

  it("handles double quotes", () => {
    expect(extractReferencedDbtSources('SELECT * FROM {{ source("raw", "orders") }}')).toEqual(
      new Set(["raw.orders"]),
    );
  });

  it("handles whitespace variations", () => {
    expect(extractReferencedDbtSources("SELECT * FROM {{  source(  'raw'  ,  'orders'  )  }}")).toEqual(
      new Set(["raw.orders"]),
    );
  });

  it("returns empty set when no sources", () => {
    expect(extractReferencedDbtSources("SELECT * FROM users")).toEqual(new Set());
  });
});

describe("dbt column completions", () => {
  it("boosts columns from ref'd model", () => {
    const source = buildDbcCompletionSource({
      schema: {},
      dbtModels: [
        { name: "stg_orders", columns: [{ name: "order_id", type: "integer" }, { name: "amount", type: "numeric" }] },
        { name: "stg_customers", columns: [{ name: "customer_id" }] },
      ],
      isDbtFile: true,
    });
    const result = source(makeCtx("SELECT  FROM {{ ref('stg_orders') }}", 7, true));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    const orderCol = cols.find((o) => o.label === "order_id");
    const amountCol = cols.find((o) => o.label === "amount");
    const custCol = cols.find((o) => o.label === "customer_id");
    expect(orderCol).toBeDefined();
    expect(orderCol!.boost).toBe(3);
    expect(orderCol!.detail).toBe("ref:stg_orders · integer");
    expect(amountCol).toBeDefined();
    expect(amountCol!.boost).toBe(3);
    expect(custCol).toBeUndefined();
  });

  it("boosts columns from source'd table", () => {
    const source = buildDbcCompletionSource({
      schema: {},
      dbtSources: [
        { sourceName: "jaffle_shop", tableName: "raw_customers", columns: [{ name: "id" }, { name: "first_name", type: "varchar" }] },
        { sourceName: "jaffle_shop", tableName: "raw_orders", columns: [{ name: "order_id" }] },
      ],
      isDbtFile: true,
    });
    const result = source(makeCtx(
      "SELECT  FROM {{ source('jaffle_shop', 'raw_customers') }}",
      7,
      true,
    ));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    const idCol = cols.find((o) => o.label === "id");
    const nameCol = cols.find((o) => o.label === "first_name");
    const orderCol = cols.find((o) => o.label === "order_id");
    expect(idCol).toBeDefined();
    expect(idCol!.boost).toBe(3);
    expect(idCol!.detail).toBe("src:raw_customers");
    expect(nameCol).toBeDefined();
    expect(nameCol!.detail).toBe("src:raw_customers · varchar");
    expect(orderCol).toBeUndefined();
  });

  it("resolves a dbt source to its warehouse table without duplicating shared columns", () => {
    const source = buildDbcCompletionSource({
      schema: {
        raw_customers: [{ name: "id", type: "integer" }],
      },
      dbtSources: [
        { sourceName: "jaffle_shop", tableName: "raw_customers", columns: [{ name: "id" }, { name: "first_name" }] },
      ],
      isDbtFile: true,
    });
    const result = source(makeCtx(
      "SELECT  FROM {{ source('jaffle_shop', 'raw_customers') }}",
      7,
      true,
    ));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    // `id` exists in both the warehouse schema and the manifest; collapse to one,
    // scoped to the resolved warehouse table.
    const idCols = cols.filter((o) => o.label === "id");
    expect(idCols).toHaveLength(1);
    expect(idCols[0].boost).toBe(2);
    expect(idCols[0].detail).toBe("raw_customers · integer");
    // a manifest-only column still surfaces
    const nameCol = cols.find((o) => o.label === "first_name");
    expect(nameCol).toBeDefined();
    expect(nameCol!.boost).toBe(3);
  });

  it("handles both ref and source in same query", () => {
    const source = buildDbcCompletionSource({
      schema: {},
      dbtModels: [
        { name: "stg_orders", columns: [{ name: "order_id" }] },
      ],
      dbtSources: [
        { sourceName: "raw", tableName: "customers", columns: [{ name: "cust_id" }] },
      ],
      isDbtFile: true,
    });
    const result = source(makeCtx(
      "SELECT  FROM {{ ref('stg_orders') }} JOIN {{ source('raw', 'customers') }} ON 1=1",
      7,
      true,
    ));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.find((o) => o.label === "order_id")).toBeDefined();
    expect(cols.find((o) => o.label === "cust_id")).toBeDefined();
  });

  it("does not add dbt columns when not a dbt file", () => {
    const source = buildDbcCompletionSource({
      schema: {},
      dbtModels: [
        { name: "stg_orders", columns: [{ name: "order_id" }] },
      ],
      isDbtFile: false,
    });
    const result = source(makeCtx("SELECT  FROM {{ ref('stg_orders') }}", 7, true));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.find((o) => o.label === "order_id")).toBeUndefined();
  });

  it("scopes dbt columns to current CTE block", () => {
    const doc =
      "WITH customers AS (\n" +
      "    SELECT  FROM {{ ref('stg_customers') }}\n" +
      "),\n" +
      "orders AS (\n" +
      "    SELECT * FROM {{ ref('stg_orders') }}\n" +
      ")\n" +
      "SELECT * FROM customers";
    const cursorPos = doc.indexOf("SELECT  FROM") + 7;
    const source = buildDbcCompletionSource({
      schema: {},
      dbtModels: [
        { name: "stg_customers", columns: [{ name: "customer_id" }, { name: "first_name" }] },
        { name: "stg_orders", columns: [{ name: "order_id" }, { name: "amount" }] },
      ],
      isDbtFile: true,
    });
    const result = source(makeCtx(doc, cursorPos, true));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.find((o) => o.label === "customer_id")).toBeDefined();
    expect(cols.find((o) => o.label === "first_name")).toBeDefined();
    expect(cols.find((o) => o.label === "order_id")).toBeUndefined();
    expect(cols.find((o) => o.label === "amount")).toBeUndefined();
  });
});

describe("shadowedBareNames", () => {
  it("identifies bare names shadowed by qualified counterparts", () => {
    const schema = {
      users: [{ name: "id" }],
      "public.users": [{ name: "id" }],
      orders: [{ name: "id" }],
    };
    expect(shadowedBareNames(schema)).toEqual(new Set(["users"]));
  });

  it("returns empty set when no shadowing", () => {
    const schema = {
      users: [{ name: "id" }],
      orders: [{ name: "id" }],
    };
    expect(shadowedBareNames(schema)).toEqual(new Set());
  });

  it("handles federated schemas", () => {
    const schema = {
      orders: [{ name: "id" }],
      "appdb.orders": [{ name: "id" }],
      "test_mysql.appdb.orders": [{ name: "id" }],
    };
    expect(shadowedBareNames(schema)).toEqual(new Set(["orders", "appdb.orders"]));
  });
});

describe("column deduplication", () => {
  it("deduplicates columns from bare and qualified table names", () => {
    const cols = [{ name: "id", type: "integer" }, { name: "category", type: "text" }];
    const source = buildDbcCompletionSource({
      schema: {
        sales_transactions: cols,
        "public.sales_transactions": cols,
      },
    });
    const result = source(makeCtx("SELECT  FROM sales_transactions", 7, true));
    expect(result).not.toBeNull();
    const columns = result!.options.filter((o) => o.type === "column");
    const categoryColumns = columns.filter((o) => o.label === "category");
    expect(categoryColumns).toHaveLength(1);
    expect(categoryColumns[0].detail).toContain("public.sales_transactions");
  });

  it("suggests bare table names in FROM on a scoped (single-database) connection", () => {
    const cols = [{ name: "id" }];
    const source = buildDbcCompletionSource({
      schema: {
        users: cols,
        "public.users": cols,
      },
    });
    const state = EditorState.create({ doc: "SELECT * FROM " });
    const ctx = new CompletionContext(state, state.doc.length, true);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.filter((o) => o.type === "table").map((o) => o.label);
    // Scoped default: the redundant `public.` prefix is dropped at the top level.
    expect(labels).toContain("users");
    expect(labels).not.toContain("public.users");
  });

  it("suggests container names first (not the full table list) at the top of FROM when catalogQualified", () => {
    const cols = [{ name: "id" }];
    const source = buildDbcCompletionSource({
      // Federation: every key is `connection.table`; Redis surfaces many keys.
      schema: {
        "prod_elasticsearch.orders": cols,
        "prod_mysql.orders": cols,
        "prod_redis.orders:100": cols,
        "prod_redis.orders:101": cols,
        "prod_redis.orders:102": cols,
      },
      catalogQualified: true,
    });
    const state = EditorState.create({ doc: "SELECT * FROM " });
    const ctx = new CompletionContext(state, state.doc.length, true);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const schemaLabels = result!.options.filter((o) => o.type === "schema").map((o) => o.label);
    // Connection names surfaced once each, not the long cross-source table list.
    expect(schemaLabels).toEqual(
      expect.arrayContaining(["prod_elasticsearch", "prod_mysql", "prod_redis"]),
    );
    // No bare-table or fully-qualified table rows at the top level.
    expect(result!.options.some((o) => o.type === "table")).toBe(false);
    expect(schemaLabels).not.toContain("prod_redis.orders:100");
  });

  it("drills into a container's tables once a connection prefix is typed (catalogQualified)", () => {
    const cols = [{ name: "id" }];
    const source = buildDbcCompletionSource({
      schema: {
        "prod_elasticsearch.orders": cols,
        "prod_mysql.orders": cols,
        "prod_redis.orders:100": cols,
      },
      catalogQualified: true,
    });
    const doc = "SELECT * FROM prod_redis.";
    const result = source(makeCtx(doc, doc.length, true));
    expect(result).not.toBeNull();
    const labels = result!.options.filter((o) => o.type === "table").map((o) => o.label);
    // Fully-qualified tables are offered; CodeMirror's filter narrows to the prefix.
    expect(labels).toContain("prod_redis.orders:100");
    expect(labels).toContain("prod_elasticsearch.orders");
  });

  it("offers schema names to drill into at the top of FROM on a scoped connection", () => {
    const source = buildDbcCompletionSource({
      schema: {
        country_codes: [{ name: "id" }],
        "analytics.country_codes": [{ name: "id" }],
      },
      schemaNames: ["analytics"],
    });
    const state = EditorState.create({ doc: "SELECT * FROM " });
    const ctx = new CompletionContext(state, state.doc.length, true);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const tableLabels = result!.options.filter((o) => o.type === "table").map((o) => o.label);
    const schemaLabels = result!.options.filter((o) => o.type === "schema").map((o) => o.label);
    expect(tableLabels).toContain("country_codes");
    expect(tableLabels).not.toContain("analytics.country_codes");
    expect(schemaLabels).toContain("analytics");
  });

  it("suggests schema-qualified tables once a schema prefix is typed in FROM", () => {
    const source = buildDbcCompletionSource({
      schema: {
        country_codes: [{ name: "id" }],
        "analytics.country_codes": [{ name: "id" }],
        "analytics.customers": [{ name: "id" }],
      },
      schemaNames: ["analytics"],
    });
    const doc = "SELECT * FROM analytics.";
    const result = source(makeCtx(doc, doc.length, true));
    expect(result).not.toBeNull();
    const labels = result!.options.filter((o) => o.type === "table").map((o) => o.label);
    expect(labels).toContain("analytics.country_codes");
    expect(labels).toContain("analytics.customers");
  });

  it("resolves bare FROM reference to qualified schema entry", () => {
    const cols = [{ name: "id" }, { name: "email" }];
    const source = buildDbcCompletionSource({
      schema: {
        users: cols,
        "public.users": cols,
        orders: [{ name: "total" }],
        "public.orders": [{ name: "total" }],
      },
    });
    const result = source(makeCtx("SELECT  FROM users", 7, true));
    expect(result).not.toBeNull();
    const columns = result!.options.filter((o) => o.type === "column");
    expect(columns.map((o) => o.label)).toContain("id");
    expect(columns.map((o) => o.label)).toContain("email");
    const orderCols = columns.filter((o) => o.detail?.includes("orders"));
    expect(orderCols).toHaveLength(0);
  });
});

describe("context-aware column filtering", () => {
  it("shows all columns when no FROM clause exists", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [{ name: "id" }],
        orders: [{ name: "total" }],
      },
    });
    const result = source(makeCtx("SELECT i", undefined, false));
    expect(result).not.toBeNull();
    const columns = result!.options.filter((o) => o.type === "column");
    expect(columns.find((o) => o.label === "id")).toBeDefined();
    expect(columns.find((o) => o.label === "total")).toBeDefined();
  });

  it("filters to referenced tables in WHERE clause", () => {
    const source = buildDbcCompletionSource({
      schema: {
        customers: [{ name: "name" }, { name: "email" }],
        orders: [{ name: "total" }],
        products: [{ name: "sku" }],
      },
    });
    const result = source(makeCtx("SELECT * FROM customers WHERE n", undefined, false));
    expect(result).not.toBeNull();
    const columns = result!.options.filter((o) => o.type === "column");
    expect(columns.find((o) => o.label === "name")).toBeDefined();
    expect(columns.find((o) => o.label === "email")).toBeDefined();
    expect(columns.find((o) => o.label === "total")).toBeUndefined();
    expect(columns.find((o) => o.label === "sku")).toBeUndefined();
  });
});

describe("currentStatementBlock", () => {
  it("returns full text for simple statement", () => {
    const text = "SELECT * FROM users";
    expect(currentStatementBlock(text, 7)).toBe(text);
  });

  it("scopes to CTE body inside parens", () => {
    const text = "WITH cte AS (\n  SELECT * FROM users\n)\nSELECT * FROM cte";
    const innerPos = text.indexOf("SELECT * FROM users") + 5;
    const block = currentStatementBlock(text, innerPos);
    expect(block).toContain("SELECT * FROM users");
    expect(block).not.toContain("WITH cte");
    expect(block).not.toContain("SELECT * FROM cte");
  });

  it("scopes to correct CTE in multi-CTE query", () => {
    const text =
      "WITH a AS (\n  SELECT 1 FROM x\n),\nb AS (\n  SELECT 2 FROM y\n)\nSELECT * FROM a";
    const posInB = text.indexOf("SELECT 2") + 3;
    const block = currentStatementBlock(text, posInB);
    expect(block).toContain("SELECT 2 FROM y");
    expect(block).not.toContain("SELECT 1");
  });

  it("splits on semicolons", () => {
    const text = "SELECT 1 FROM a; SELECT 2 FROM b";
    const posInSecond = text.indexOf("SELECT 2") + 3;
    const block = currentStatementBlock(text, posInSecond);
    expect(block).toContain("SELECT 2 FROM b");
    expect(block).not.toContain("SELECT 1");
  });
});

describe("CTE column completions", () => {
  it("completes columns from CTE via qualified access", () => {
    const source = buildDbcCompletionSource({
      schema: { users: [{ name: "id" }, { name: "email" }] },
    });
    const doc = "WITH foo AS (SELECT id, email FROM users) SELECT foo.";
    const result = source(makeCtx(doc, doc.length));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.map((o) => o.label)).toEqual(["id", "email"]);
    expect(cols.every((o) => o.boost === 4)).toBe(true);
  });

  it("completes CTE columns in SELECT list when CTE is in FROM", () => {
    const source = buildDbcCompletionSource({
      schema: { users: [{ name: "id" }, { name: "email" }] },
    });
    const doc = "WITH foo AS (SELECT id, email FROM users) SELECT  FROM foo";
    const cursorPos = doc.indexOf("SELECT  FROM") + 7;
    const result = source(makeCtx(doc, cursorPos, true));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    const cteCols = cols.filter((o) => o.detail === "foo");
    expect(cteCols.map((o) => o.label)).toContain("id");
    expect(cteCols.map((o) => o.label)).toContain("email");
  });

  it("completes columns from CTE SELECT * via schema resolution", () => {
    const source = buildDbcCompletionSource({
      schema: { users: [{ name: "id" }, { name: "email" }] },
    });
    const doc = "WITH foo AS (SELECT * FROM users) SELECT f. FROM foo f";
    const pos = doc.indexOf("f.") + 2;
    const result = source(makeCtx(doc, pos));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.map((o) => o.label)).toEqual(["id", "email"]);
  });

  it("completes columns from CTE SELECT * via dbt model resolution", () => {
    const source = buildDbcCompletionSource({
      schema: {},
      isDbtFile: true,
      dbtModels: [
        { name: "stg_customers", columns: [{ name: "customer_id" }, { name: "first_name" }, { name: "email" }] },
      ],
    });
    const doc = "WITH customers AS (SELECT * FROM {{ ref('stg_customers') }}) SELECT c. FROM customers c";
    const pos = doc.indexOf("c.") + 2;
    const result = source(makeCtx(doc, pos));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.map((o) => o.label)).toEqual(["customer_id", "first_name", "email"]);
  });

  it("completes columns from CTE SELECT * via dbt source resolution", () => {
    const source = buildDbcCompletionSource({
      schema: {},
      isDbtFile: true,
      dbtSources: [
        { sourceName: "raw", tableName: "orders", columns: [{ name: "order_id" }, { name: "amount" }] },
      ],
    });
    const doc = "WITH o AS (SELECT * FROM {{ source('raw', 'orders') }}) SELECT o. FROM o";
    const pos = doc.indexOf("o.") + 2;
    const result = source(makeCtx(doc, pos));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.map((o) => o.label)).toEqual(["order_id", "amount"]);
  });

  it("completes columns from aliased CTE with inter-CTE star resolution", () => {
    const source = buildDbcCompletionSource({
      schema: { users: [{ name: "id" }, { name: "name" }] },
    });
    const doc = "WITH base AS (SELECT id, name FROM users), wrapper AS (SELECT * FROM base) SELECT w. FROM wrapper w";
    const pos = doc.indexOf("w.") + 2;
    const result = source(makeCtx(doc, pos));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.map((o) => o.label)).toEqual(["id", "name"]);
  });

  it("completes subquery alias columns via qualified access", () => {
    const source = buildDbcCompletionSource({ schema: {} });
    const doc = "SELECT sub. FROM (SELECT a, b FROM t) sub";
    const pos = doc.indexOf("sub.") + 4;
    const result = source(makeCtx(doc, pos));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.map((o) => o.label)).toEqual(["a", "b"]);
  });

  it("completes columns for INSERT INTO with schema", () => {
    const source = buildDbcCompletionSource({
      schema: {
        users: [{ name: "id", type: "integer" }, { name: "email", type: "text" }],
      },
    });
    const doc = "INSERT INTO users (";
    const result = source(makeCtx(doc, doc.length, true));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.map((o) => o.label)).toEqual(["id", "email"]);
  });

  // Regression: in a multi-statement script the column list must resolve the
  // NEAREST INSERT target, not the first one in the document (the first-match
  // bug surfaced the wrong table's columns, or none, for the active INSERT).
  it("completes columns for the nearest INSERT target in a multi-statement script", () => {
    const source = buildDbcCompletionSource({
      schema: {
        staging: [{ name: "sid", type: "integer" }],
        test_tmp: [{ name: "id", type: "integer" }, { name: "name", type: "text" }],
      },
    });
    const doc = "INSERT INTO staging (sid) VALUES (1);\nINSERT INTO test_tmp(";
    const result = source(makeTreeCtx(doc, doc.length, true));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.map((o) => o.label)).toEqual(["id", "name"]);
    expect(cols.map((o) => o.label)).not.toContain("sid");
  });

  it("suggests object kinds including TABLE right after CREATE", () => {
    const source = buildDbcCompletionSource({ schema: {} });
    const result = source(makeCtx("CREATE ", undefined, true));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("TABLE");
    expect(labels).toContain("VIEW");
  });

  it("suggests column constraints including ENFORCED inside a CREATE TABLE column list", () => {
    const source = buildDbcCompletionSource({ schema: {} });
    const doc = "CREATE TABLE t (\n  id INT PRIMARY KEY NOT ";
    const result = source(makeCtx(doc, doc.length, true));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("ENFORCED");
    expect(labels).toContain("PRIMARY KEY");
  });

  // Right after a type the clause reads as `column` (e.g. `id INT PRIM…`), but the
  // constraint keywords must still surface so PRIMARY KEY completes from "PRI".
  it("suggests PRIMARY KEY from the first constraint word after a column type", () => {
    const source = buildDbcCompletionSource({ schema: { t: [{ name: "id" }] } });
    const doc = "CREATE TABLE t (\n  id INT PRIM";
    const result = source(makeTreeCtx(doc, doc.length, true));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("PRIMARY KEY");
  });

  // A multi-word constraint applied over its already-typed leading word must insert
  // only the remainder (`NOT NULL` over a typed `NOT ` => `NULL`, not `NOT NOT NULL`).
  it("applies only the remaining words of a partially-typed multi-word constraint", () => {
    const source = buildDbcCompletionSource({ schema: {} });
    const doc = "CREATE TABLE t (\n  first_name STRING NOT NUL";
    const result = source(makeTreeCtx(doc, doc.length, true));
    expect(result).not.toBeNull();
    const notNull = result!.options.find((o) => o.label === "NOT NULL");
    expect(notNull?.apply).toBe("NULL");
    // A constraint whose lead word is not typed keeps its full text.
    const primary = result!.options.find((o) => o.label === "PRIMARY KEY");
    expect(primary?.apply ?? primary?.label).toBe("PRIMARY KEY");
  });

  it("returns keyword suggestions at statement start", () => {
    const source = buildDbcCompletionSource({ schema: {} });
    const result = source(makeCtx("SEL"));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("SELECT");
  });

  it("returns VALUES context completions", () => {
    const source = buildDbcCompletionSource({
      schema: { users: [{ name: "id" }] },
    });
    const doc = "INSERT INTO users (id) VALUES (";
    const result = source(makeCtx(doc, doc.length, true));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("DEFAULT");
    expect(labels).toContain("NULL");
    expect(labels).not.toContain("id");
  });

  it("suggests INTO right after INSERT", () => {
    const source = buildDbcCompletionSource({ schema: {} });
    const result = source(makeCtx("INSERT ", undefined, true));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("INTO");
  });

  it("suggests VALUES once the INSERT target is typed", () => {
    const source = buildDbcCompletionSource({ schema: { users: [{ name: "id" }] } });
    const result = source(makeCtx("INSERT INTO users ", undefined, true));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("VALUES");
  });

  it("suggests VALUES after an INSERT column list", () => {
    const source = buildDbcCompletionSource({ schema: { users: [{ name: "id" }] } });
    const result = source(makeCtx("INSERT INTO users (id) ", undefined, true));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("VALUES");
  });

  it("suggests SET after UPDATE target", () => {
    const source = buildDbcCompletionSource({ schema: { users: [{ name: "id" }] } });
    const result = source(makeCtx("UPDATE users ", undefined, true));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("SET");
  });

  it("suggests FROM after DELETE", () => {
    const source = buildDbcCompletionSource({ schema: {} });
    const result = source(makeCtx("DELETE ", undefined, true));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("FROM");
  });
});

// The production editor always carries a Lezer syntax tree; the CTE GROUP BY bug
// only reproduced on that path, not the regex fallback. These
// assert the real scenario from the user's screenshot end-to-end.
describe("buildDbcCompletionSource — real syntax tree", () => {
  const CTE_DOC = `WITH monthly_region AS (
    SELECT
        region,
        date_trunc('month', sale_date)::DATE AS sale_month,
        SUM(amount) AS revenue
    FROM sales_transactions
    GROUP BY reg
--      GROUP BY region, date_trunc('month', sale_date)
)
SELECT region, sale_month FROM monthly_region
ORDER BY region, sale_month;`;

  function cteSource() {
    return buildDbcCompletionSource({
      schema: {
        sales_transactions: [
          { name: "region", type: "text" },
          { name: "sale_date", type: "date" },
          { name: "amount", type: "numeric" },
        ],
      },
      connectionKind: "postgres",
    });
  }

  it("suggests the FROM table's columns after GROUP BY inside a CTE", () => {
    const cursor = CTE_DOC.indexOf("GROUP BY reg") + "GROUP BY reg".length;
    const result = cteSource()(makeTreeCtx(CTE_DOC, cursor));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("region");
    expect(labels).toContain("sale_date");
    // region must outrank the noise so it lands at the top of the menu.
    expect(labels[0]).toBe("region");
  });

  it("suggests columns at an empty GROUP BY inside a CTE (no word typed)", () => {
    const emptyDoc = CTE_DOC.replace("GROUP BY reg", "GROUP BY ");
    const cursor = emptyDoc.indexOf("GROUP BY ") + "GROUP BY ".length;
    const result = cteSource()(makeTreeCtx(emptyDoc, cursor));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("region");
  });

  it("does not leak SQLMesh DSL keywords into a non-SQLMesh column list", () => {
    const cursor = CTE_DOC.indexOf("GROUP BY reg") + "GROUP BY reg".length;
    const result = cteSource()(makeTreeCtx(CTE_DOC, cursor));
    const labels = result!.options.map((o) => o.label);
    expect(labels).not.toContain("INCREMENTAL_BY_TIME_RANGE");
    expect(labels).not.toContain("SCD_TYPE_2");
  });

  // A Postgres connection registers a table under three progressively-qualified
  // keys (`t`, `public.t`, `db.public.t`). Only the deepest survives shadowing, so
  // resolving a bare `FROM t` must land on that deepest key; otherwise every
  // column is filtered out and the menu shows functions only (regression
  // reported from a real connection: `colsForFirstRef:[…15…]` but `columnOptions:[]`).
  function threeKeySource() {
    const cols = [
      { name: "id", type: "int" },
      { name: "region", type: "text" },
      { name: "sale_date", type: "date" },
    ];
    return buildDbcCompletionSource({
      schema: {
        sales_transactions: cols,
        "public.sales_transactions": cols,
        "postgres.public.sales_transactions": cols,
      },
      connectionKind: "postgres",
    });
  }

  it("suggests columns for a bare FROM table that has 3 qualified schema keys", () => {
    const doc = "SELECT re FROM sales_transactions";
    const cursor = "SELECT re".length;
    const result = threeKeySource()(makeTreeCtx(doc, cursor));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("region");
    expect(labels).toContain("sale_date");
  });

  it("suggests columns inside a CTE whose FROM table has 3 qualified schema keys", () => {
    const doc = `WITH m AS (
    SELECT re
    FROM sales_transactions
    GROUP BY region
)
SELECT * FROM m;`;
    const cursor = doc.indexOf("SELECT re") + "SELECT re".length;
    const result = threeKeySource()(makeTreeCtx(doc, cursor));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("region");
    expect(labels).toContain("sale_date");
  });
});

// typing the opening paren of an INSERT column list must auto-open the
// menu with the target table's columns, even on the production syntax-tree path
// and without an explicit trigger (empty field, no word typed yet).
describe("buildDbcCompletionSource — INSERT column list", () => {
  function insertSource() {
    return buildDbcCompletionSource({
      schema: {
        dummy: [
          { name: "id", type: "integer" },
          { name: "name", type: "text" },
        ],
      },
      connectionKind: "postgres",
    });
  }

  it("auto-suggests target columns inside an empty INSERT column list (tree, non-explicit)", () => {
    const doc = "INSERT INTO dummy()";
    const cursor = doc.indexOf("(") + 1;
    const result = insertSource()(makeTreeCtx(doc, cursor));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
  });

  it("filters target columns by the typed prefix inside the column list", () => {
    const doc = "INSERT INTO dummy(na)";
    const cursor = doc.indexOf("(na") + "(na".length;
    const result = insertSource()(makeTreeCtx(doc, cursor));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(cols).toContain("name");
  });

  it("auto-suggests remaining columns after a comma in the column list", () => {
    const doc = "INSERT INTO dummy(id, )";
    const cursor = doc.indexOf(", ") + ", ".length;
    const result = insertSource()(makeTreeCtx(doc, cursor));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(cols).toContain("name");
  });
});

describe("identifier case follows the formatter setting", () => {
  const upperSchema = { TPCH_SF1: [{ name: "C_NAME", type: "text" }] };

  it("lowercases table suggestions when identifierCase is lower", () => {
    const source = buildDbcCompletionSource({ schema: upperSchema, identifierCase: "lower" });
    const result = source(makeCtx("SELECT * FROM tp"));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("tpch_sf1");
    expect(labels).not.toContain("TPCH_SF1");
  });

  it("uppercases table suggestions when identifierCase is upper", () => {
    const source = buildDbcCompletionSource({
      schema: { tpch_sf1: [{ name: "c_name", type: "text" }] },
      identifierCase: "upper",
    });
    const result = source(makeCtx("SELECT * FROM tp"));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("TPCH_SF1");
    expect(labels).not.toContain("tpch_sf1");
  });

  it("preserves raw schema case when identifierCase is preserve", () => {
    const source = buildDbcCompletionSource({ schema: upperSchema, identifierCase: "preserve" });
    const result = source(makeCtx("SELECT * FROM tp"));
    expect(result!.options.map((o) => o.label)).toContain("TPCH_SF1");
  });

  it("preserves raw schema case when identifierCase is omitted", () => {
    const source = buildDbcCompletionSource({ schema: upperSchema });
    const result = source(makeCtx("SELECT * FROM tp"));
    expect(result!.options.map((o) => o.label)).toContain("TPCH_SF1");
  });

  it("cases column suggestions but leaves keywords and functions untouched", () => {
    const source = buildDbcCompletionSource({
      schema: upperSchema,
      identifierCase: "lower",
      connectionKind: "postgres",
    });
    const state = EditorState.create({ doc: "SELECT  FROM TPCH_SF1" });
    const ctx = new CompletionContext(state, "SELECT ".length, true);
    const result = source(ctx);
    expect(result).not.toBeNull();
    const columns = result!.options.filter((o) => o.type === "column").map((o) => o.label);
    expect(columns).toContain("c_name");
    const labels = result!.options.map((o) => o.label);
    // Functions and keywords carry their own case settings and stay as-is.
    expect(labels).toContain("COUNT");
    expect(labels).toContain("SELECT");
  });

  it("cases the schema-drill prefix label and inserted text", () => {
    const source = buildDbcCompletionSource({
      schema: { "PUBLIC.users": [{ name: "id", type: "int" }] },
      schemaNames: ["PUBLIC"],
      identifierCase: "lower",
    });
    const result = source(makeCtx("SELECT * FROM pu"));
    expect(result).not.toBeNull();
    const schemaOpt = result!.options.find((o) => o.type === "schema");
    expect(schemaOpt).toBeDefined();
    expect(schemaOpt!.label).toBe("public");
    let inserted = "";
    const fakeView = {
      // `startCompletion` (fired after the insert) reads this and bails when undefined.
      state: { field: () => undefined },
      dispatch: (tr: { changes?: { insert?: string } }) => {
        if (tr.changes?.insert) inserted = tr.changes.insert;
      },
    };
    (schemaOpt!.apply as (v: unknown, c: unknown, f: number, t: number) => void)(
      fakeView, schemaOpt, result!.from, result!.from + 2,
    );
    expect(inserted).toBe("public.");
  });

  it("resolves a JOIN ... ON qualifier to its own table when another source shares the table name", () => {
    // Federation: both sources expose an `orders` table. The join condition
    // `ord.` must list the MSSQL orders columns (ord aliases prod_mssql.dbo.orders),
    // not the Postgres orders. The ON predicate's dangling `ord.` makes the clause
    // detector read `keyword`, so without the qualified short-circuit the column
    // list was dropped / mis-sourced.
    const source = buildDbcCompletionSource({
      catalogQualified: true,
      schema: {
        "prod_postgres.public.customers": [{ name: "customer_id", type: "integer" }],
        "prod_postgres.public.orders": [
          { name: "amount", type: "numeric" },
          { name: "status", type: "varchar" },
        ],
        "prod_mssql.dbo.orders": [
          { name: "order_pk", type: "int" },
          { name: "fk_customer", type: "int" },
          { name: "qty", type: "int" },
        ],
      },
    });
    const doc =
      "SELECT cus.customer_id\n" +
      "FROM prod_postgres.public.customers AS cus\n" +
      "JOIN prod_mssql.dbo.orders AS ord\n" +
      "ON cus.customer_id = ord.";
    const result = source(makeCtx(doc));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.map((c) => c.label).sort()).toEqual(["fk_customer", "order_pk", "qty"]);
    // Every column is sourced from the MSSQL table, never the Postgres orders.
    for (const c of cols) expect(c.detail).toContain("prod_mssql.dbo.orders");
  });

  it("resolves the JOIN ON qualifier with a real syntax tree, cursor mid-document", () => {
    // The exact failing layout: cursor on the ON line, with a trailing GROUP BY and
    // a whole second statement after it. Exercised through the Lezer tree (the
    // production path): the dangling `ord.` hides the ON keyword so the tree
    // detector reports `keyword`; the qualified short-circuit must still win.
    const source = buildDbcCompletionSource({
      catalogQualified: true,
      schema: {
        "prod_postgres.public.customers": [{ name: "customer_id", type: "integer" }],
        "prod_postgres.public.orders": [
          { name: "amount", type: "numeric" },
          { name: "customer_id", type: "integer" },
          { name: "status", type: "varchar" },
        ],
        "prod_mssql.dbo.orders": [
          { name: "order_pk", type: "int" },
          { name: "fk_customer", type: "int" },
          { name: "qty", type: "int" },
        ],
      },
    });
    const head =
      "SELECT\n  cus.customer_id,\n  SUM(ord.amount) AS total_amount\n" +
      "FROM prod_postgres.public.customers AS cus\n" +
      "JOIN prod_mssql.dbo.orders AS ord\n" +
      "  ON cus.customer_id = ord.";
    const tail = "\nGROUP BY\n  cus.customer_id;\n\nSELECT *\nFROM tpch_sf1.customer\nLIMIT 100;\n";
    const result = source(makeTreeCtx(head + tail, head.length, true));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.map((c) => c.label).sort()).toEqual(["fk_customer", "order_pk", "qty"]);
    for (const c of cols) expect(c.detail).toContain("prod_mssql.dbo.orders");
  });

  it("offers in-scope table aliases as drill-in completions in an ON/expression position", () => {
    // In `ON cus.customer_id = or` the aliases `cus` / `ord` must be completable;
    // accepting one inserts `alias.` and reopens completion. Previously only columns
    // surfaced, so a partially typed alias could never be completed.
    const source = buildDbcCompletionSource({
      catalogQualified: true,
      schema: {
        "prod_postgres.public.customers": [{ name: "customer_id", type: "integer" }],
        "prod_mssql.dbo.orders": [
          { name: "order_id", type: "int" },
          { name: "order_date", type: "date" },
        ],
      },
    });
    const doc =
      "SELECT cus.customer_id\n" +
      "FROM prod_postgres.public.customers AS cus\n" +
      "JOIN prod_mssql.dbo.orders AS ord\n" +
      "  ON cus.customer_id = or";
    const result = source(makeTreeCtx(doc, doc.length, true));
    expect(result).not.toBeNull();
    const aliases = result!.options.filter((o) => o.type === "variable");
    expect(aliases.map((a) => a.label).sort()).toEqual(["cus", "ord"]);
    // The alias carries its resolved table so the picker shows where it points.
    expect(aliases.find((a) => a.label === "ord")!.detail).toBe("prod_mssql.dbo.orders");
    expect(aliases.find((a) => a.label === "cus")!.detail).toBe("prod_postgres.public.customers");
  });

  it("offers aliases inside a SELECT function call where FROM is outside the parens", () => {
    // `SUM(ord|)`: the cursor is inside the function's parens, so the paren-scoped
    // block has no FROM; the aliases must still come from the statement's FROM/JOIN.
    const source = buildDbcCompletionSource({
      catalogQualified: true,
      schema: {
        "prod_postgres.public.customers": [{ name: "customer_id", type: "integer" }],
        "prod_mssql.dbo.orders": [{ name: "amount", type: "numeric" }],
      },
    });
    const head = "SELECT\n  cus.customer_id,\n  SUM(ord";
    const tail =
      ") AS total\nFROM prod_postgres.public.customers AS cus\nJOIN prod_mssql.dbo.orders AS ord;";
    const result = source(makeTreeCtx(head + tail, head.length, true));
    expect(result).not.toBeNull();
    const aliases = result!.options.filter((o) => o.type === "variable");
    expect(aliases.map((a) => a.label).sort()).toEqual(["cus", "ord"]);
    expect(aliases.find((a) => a.label === "ord")!.detail).toBe("prod_mssql.dbo.orders");
  });

  it("resolves a qualified column inside a SELECT function call (SUM(ord.))", () => {
    // `SUM(ord.|)`: the qualifier sits inside the function parens with the FROM
    // outside; the column list must still resolve `ord` to its table.
    const source = buildDbcCompletionSource({
      catalogQualified: true,
      schema: {
        "prod_postgres.public.customers": [{ name: "customer_id", type: "integer" }],
        "prod_mssql.dbo.orders": [
          { name: "amount", type: "numeric" },
          { name: "order_id", type: "int" },
        ],
      },
    });
    const head = "SELECT\n  cus.customer_id,\n  SUM(ord.";
    const tail =
      ") AS total\nFROM prod_postgres.public.customers AS cus\nJOIN prod_mssql.dbo.orders AS ord;";
    const result = source(makeTreeCtx(head + tail, head.length, true));
    expect(result).not.toBeNull();
    const cols = result!.options.filter((o) => o.type === "column");
    expect(cols.map((c) => c.label).sort()).toEqual(["amount", "order_id"]);
    for (const c of cols) expect(c.detail).toContain("prod_mssql.dbo.orders");
  });
});

describe("SELECT-list alias completions", () => {
  const SCHEMA = {
    "appdb.order_items": [
      { name: "product_id", type: "bigint" },
      { name: "quantity", type: "int" },
    ],
    order_items: [
      { name: "product_id", type: "bigint" },
      { name: "quantity", type: "int" },
    ],
  };
  const head = "SELECT product_id, SUM(quantity) AS qty\nFROM appdb.order_items\nGROUP BY product_id\n";

  it("suggests a SELECT alias in HAVING", () => {
    const source = buildDbcCompletionSource({ schema: SCHEMA, connectionKind: "starrocks" });
    const doc = `${head}HAVING qt`;
    const result = source(makeTreeCtx(doc, doc.length, false));
    expect(result).not.toBeNull();
    const opt = result!.options.find((o) => o.label === "qty");
    expect(opt).toBeDefined();
    expect(opt!.type).toBe("column");
  });

  it("suggests a SELECT alias in ORDER BY", () => {
    const source = buildDbcCompletionSource({ schema: SCHEMA, connectionKind: "starrocks" });
    const doc = `${head}ORDER BY qt`;
    const result = source(makeTreeCtx(doc, doc.length, false));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("qty");
  });

  it("does not duplicate an alias that shadows a real column name", () => {
    const source = buildDbcCompletionSource({
      schema: { order_items: [{ name: "total", type: "int" }] },
      connectionKind: "starrocks",
    });
    const doc = "SELECT SUM(quantity) AS total\nFROM order_items\nHAVING tot";
    const result = source(makeTreeCtx(doc, doc.length, false));
    expect(result).not.toBeNull();
    const totals = result!.options.filter((o) => o.label === "total");
    expect(totals).toHaveLength(1);
  });

  it("does not leak an alias from a previous statement", () => {
    const source = buildDbcCompletionSource({ schema: SCHEMA, connectionKind: "starrocks" });
    const doc =
      "SELECT SUM(quantity) AS qty FROM order_items;\nSELECT product_id FROM order_items HAVING pr";
    const result = source(makeTreeCtx(doc, doc.length, false));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).not.toContain("qty");
  });
});
