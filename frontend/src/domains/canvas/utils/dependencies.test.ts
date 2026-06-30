import { describe, expect, it } from "vitest";

import { makeComponent } from "./factory";
import { deriveDataEdges, sanitizeCellTitle } from "./dependencies";

describe("sanitizeCellTitle", () => {
  it("matches the backend identifier rules", () => {
    expect(sanitizeCellTitle("Monthly Sales")).toBe("monthly_sales");
    expect(sanitizeCellTitle("  spaced  ")).toBe("spaced");
    expect(sanitizeCellTitle("2024 totals")).toBe("_2024_totals");
    expect(sanitizeCellTitle("a--b__c")).toBe("a_b_c");
    expect(sanitizeCellTitle("!!!")).toBe("cell");
  });
});

describe("deriveDataEdges", () => {
  it("draws an arrow from a referenced cell to the cell that reads it", () => {
    const abc = makeComponent({ kind: "query", id: "abc", title: "abc", sql: "SELECT 1" });
    const query = makeComponent({
      kind: "query",
      id: "query",
      title: "Query",
      sql: "SELECT * FROM abc",
    });
    const edges = deriveDataEdges([abc, query], []);
    expect(edges).toEqual([
      expect.objectContaining({ source: "abc", target: "query" }),
    ]);
  });

  it("leaves a query-to-table binding edge untouched", () => {
    const q = makeComponent({ kind: "query", id: "q", title: "q", sql: "SELECT 1" });
    const table = makeComponent({ kind: "table", id: "t", sourceQueryId: "q" });
    const binding = { id: "bind", source: "q", target: "t" };
    const edges = deriveDataEdges([q, table], [binding]);
    expect(edges).toContainEqual(binding);
  });

  it("drops a stale query-to-query edge whose reference is gone", () => {
    const a = makeComponent({ kind: "query", id: "a", title: "a", sql: "SELECT 1" });
    // b no longer references a, but a stale arrow a->b still exists.
    const b = makeComponent({ kind: "query", id: "b", title: "b", sql: "SELECT 2" });
    const stale = { id: "old", source: "a", target: "b" };
    const edges = deriveDataEdges([a, b], [stale]);
    expect(edges).toHaveLength(0);
  });

  it("reuses the existing edge id when a dependency persists", () => {
    const a = makeComponent({ kind: "query", id: "a", title: "a", sql: "SELECT 1" });
    const b = makeComponent({ kind: "query", id: "b", title: "b", sql: "SELECT * FROM a" });
    const existing = { id: "keep", source: "a", target: "b" };
    const edges = deriveDataEdges([a, b], [existing]);
    expect(edges).toEqual([existing]);
  });
});
