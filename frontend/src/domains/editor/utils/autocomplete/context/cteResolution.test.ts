import { describe, it, expect } from "vitest";
import {
  extractCteDefinitions,
  extractSubqueryAliases,
  extractSelectStarSources,
  inferColumnsFromSelect,
} from "./cteResolution";

describe("extractCteDefinitions", () => {
  it("extracts single CTE with explicit columns", () => {
    const text = "WITH foo (a, b) AS (SELECT 1, 2) SELECT * FROM foo";
    const ctes = extractCteDefinitions(text);
    expect(ctes).toEqual([{ name: "foo", columns: ["a", "b"] }]);
  });

  it("extracts single CTE with inferred columns", () => {
    const text = "WITH foo AS (SELECT id, name FROM users) SELECT * FROM foo";
    const ctes = extractCteDefinitions(text);
    expect(ctes).toEqual([{ name: "foo", columns: ["id", "name"] }]);
  });

  it("extracts multiple CTEs", () => {
    const text =
      "WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT * FROM a JOIN b";
    const ctes = extractCteDefinitions(text);
    expect(ctes).toHaveLength(2);
    expect(ctes[0]).toEqual({ name: "a", columns: ["id"] });
    expect(ctes[1]).toEqual({ name: "b", columns: ["total"] });
  });

  it("handles RECURSIVE keyword", () => {
    const text = "WITH RECURSIVE tree AS (SELECT id, parent_id FROM nodes) SELECT * FROM tree";
    const ctes = extractCteDefinitions(text);
    expect(ctes).toEqual([{ name: "tree", columns: ["id", "parent_id"] }]);
  });

  it("infers aliased columns", () => {
    const text = "WITH foo AS (SELECT u.id AS user_id, u.name FROM users u) SELECT * FROM foo";
    const ctes = extractCteDefinitions(text);
    expect(ctes[0].columns).toEqual(["user_id", "name"]);
  });

  it("records star sources when SELECT * has no inferable columns", () => {
    const text = "WITH foo AS (SELECT * FROM users) SELECT * FROM foo";
    const ctes = extractCteDefinitions(text);
    expect(ctes[0].columns).toEqual([]);
    expect(ctes[0].starSources).toEqual(["users"]);
  });

  it("resolves SELECT * from another CTE", () => {
    const text =
      "WITH base AS (SELECT id, name FROM users), wrapped AS (SELECT * FROM base) SELECT * FROM wrapped";
    const ctes = extractCteDefinitions(text);
    expect(ctes[1].columns).toEqual(["id", "name"]);
  });

  it("resolves chained CTE star references", () => {
    const text =
      "WITH a AS (SELECT x FROM t), b AS (SELECT * FROM a), c AS (SELECT * FROM b) SELECT * FROM c";
    const ctes = extractCteDefinitions(text);
    expect(ctes[2].columns).toEqual(["x"]);
  });

  it("extracts dbt ref as star source", () => {
    const text = "WITH foo AS (SELECT * FROM {{ ref('stg_customers') }}) SELECT * FROM foo";
    const ctes = extractCteDefinitions(text);
    expect(ctes[0].columns).toEqual([]);
    expect(ctes[0].starSources).toEqual(["stg_customers"]);
  });

  it("extracts dbt source as star source", () => {
    const text = "WITH foo AS (SELECT * FROM {{ source('raw', 'orders') }}) SELECT * FROM foo";
    const ctes = extractCteDefinitions(text);
    expect(ctes[0].columns).toEqual([]);
    expect(ctes[0].starSources).toEqual(["raw.orders"]);
  });

  it("handles nested parens in CTE body", () => {
    const text = "WITH foo AS (SELECT COUNT(*) AS cnt FROM (SELECT 1) t) SELECT * FROM foo";
    const ctes = extractCteDefinitions(text);
    expect(ctes[0].columns).toEqual(["cnt"]);
  });

  it("returns empty array for no CTEs", () => {
    expect(extractCteDefinitions("SELECT * FROM users")).toEqual([]);
  });

  it("handles qualified column references", () => {
    const text = "WITH foo AS (SELECT t.id, t.email FROM t) SELECT * FROM foo";
    const ctes = extractCteDefinitions(text);
    expect(ctes[0].columns).toEqual(["id", "email"]);
  });
});

describe("inferColumnsFromSelect", () => {
  it("extracts simple column names", () => {
    expect(inferColumnsFromSelect("SELECT id, name FROM users")).toEqual(["id", "name"]);
  });

  it("extracts AS aliases", () => {
    expect(inferColumnsFromSelect("SELECT id AS user_id FROM users")).toEqual(["user_id"]);
  });

  it("extracts implicit aliases", () => {
    expect(inferColumnsFromSelect("SELECT COUNT(*) cnt FROM users")).toEqual(["cnt"]);
  });

  it("strips qualifiers", () => {
    expect(inferColumnsFromSelect("SELECT u.id, u.name FROM users u")).toEqual(["id", "name"]);
  });

  it("skips star", () => {
    expect(inferColumnsFromSelect("SELECT * FROM users")).toEqual([]);
  });

  it("handles DISTINCT", () => {
    expect(inferColumnsFromSelect("SELECT DISTINCT id, name FROM users")).toEqual(["id", "name"]);
  });

  it("handles function with alias", () => {
    expect(inferColumnsFromSelect("SELECT COALESCE(a, b) AS result FROM t")).toEqual(["result"]);
  });
});

describe("extractSubqueryAliases", () => {
  it("extracts subquery in FROM clause", () => {
    const text = "SELECT * FROM (SELECT a, b FROM t) sub WHERE sub.a > 1";
    const subs = extractSubqueryAliases(text);
    expect(subs).toEqual([{ name: "sub", columns: ["a", "b"] }]);
  });

  it("extracts subquery in JOIN", () => {
    const text = "SELECT * FROM t1 JOIN (SELECT id FROM t2) j ON t1.id = j.id";
    const subs = extractSubqueryAliases(text);
    expect(subs).toEqual([{ name: "j", columns: ["id"] }]);
  });

  it("extracts subquery with AS keyword", () => {
    const text = "SELECT * FROM (SELECT x FROM t) AS sub";
    const subs = extractSubqueryAliases(text);
    expect(subs).toEqual([{ name: "sub", columns: ["x"] }]);
  });

  it("returns empty for no subqueries", () => {
    expect(extractSubqueryAliases("SELECT * FROM users")).toEqual([]);
  });
});

describe("extractSelectStarSources", () => {
  it("extracts plain table name", () => {
    expect(extractSelectStarSources("SELECT * FROM users")).toEqual(["users"]);
  });

  it("extracts qualified table name", () => {
    expect(extractSelectStarSources("SELECT * FROM public.users")).toEqual(["public.users"]);
  });

  it("extracts dbt ref", () => {
    expect(extractSelectStarSources("SELECT * FROM {{ ref('stg_customers') }}")).toEqual(["stg_customers"]);
  });

  it("extracts dbt ref with double quotes", () => {
    expect(extractSelectStarSources('SELECT * FROM {{ ref("stg_orders") }}')).toEqual(["stg_orders"]);
  });

  it("extracts dbt source", () => {
    expect(extractSelectStarSources("SELECT * FROM {{ source('raw', 'orders') }}")).toEqual(["raw.orders"]);
  });

  it("handles DISTINCT", () => {
    expect(extractSelectStarSources("SELECT DISTINCT * FROM users")).toEqual(["users"]);
  });

  it("returns empty for non-star select", () => {
    expect(extractSelectStarSources("SELECT id, name FROM users")).toEqual([]);
  });

  it("returns empty for empty body", () => {
    expect(extractSelectStarSources("")).toEqual([]);
  });
});
