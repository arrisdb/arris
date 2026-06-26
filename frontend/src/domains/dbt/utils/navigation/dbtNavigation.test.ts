import { describe, expect, it, vi } from "vitest";
import type { DbtNode, DbtRef } from "../../components/DbtProjectPane/types";
import {
  dbtDocRefForName,
  dbtMacroRefForName,
  dbtModelNodeForRef,
  dbtNodeCanContainRefs,
  dbtNodeForResult,
  dbtSourceNodeForRef,
  openDbtFile,
} from "./dbtNavigation";

describe("dbtModelNodeForRef", () => {
  it("matches model nodes by dbt model name", () => {
    const nodes = [
      { kind: "source", name: "raw.orders", filePath: "/p/models/raw.yml" },
      { kind: "model", name: "stg_orders", filePath: "/p/models/stg_orders.sql" },
    ] as DbtNode[];
    expect(dbtModelNodeForRef(nodes, "stg_orders")?.filePath).toBe("/p/models/stg_orders.sql");
  });
});

describe("dbtSourceNodeForRef", () => {
  it("matches a source node by source.table name", () => {
    const nodes = [
      { kind: "source", name: "raw.orders", filePath: "/p/models/_sources.yml" },
      { kind: "source", name: "raw.customers", filePath: "/p/models/_sources.yml" },
    ] as DbtNode[];
    expect(dbtSourceNodeForRef(nodes, "raw", "customers")?.name).toBe("raw.customers");
    expect(dbtSourceNodeForRef(nodes, "raw", "missing")).toBeNull();
  });
});

describe("dbtMacroRefForName", () => {
  it("matches a macro by name", () => {
    const macros: DbtRef[] = [
      { name: "to_cents", filePath: "/p/macros/utils.sql" },
      { name: "to_dollars", filePath: "/p/macros/utils.sql" },
    ];
    expect(dbtMacroRefForName(macros, "to_dollars")?.filePath).toBe("/p/macros/utils.sql");
    expect(dbtMacroRefForName(macros, "nope")).toBeNull();
  });
});

describe("dbtDocRefForName", () => {
  it("matches a docs block by name", () => {
    const docs: DbtRef[] = [{ name: "order_status", filePath: "/p/models/docs.md" }];
    expect(dbtDocRefForName(docs, "order_status")?.filePath).toBe("/p/models/docs.md");
    expect(dbtDocRefForName(docs, "missing")).toBeNull();
  });
});

describe("dbtNodeForResult", () => {
  const nodes = [
    { kind: "test", name: "not_null_orders_id", uniqueId: "test.shop.not_null_orders_id.aaa", filePath: "/p/models/schema.yml" },
    { kind: "model", name: "dim_customers", uniqueId: "model.shop.dim_customers", filePath: "/p/models/dim_customers.sql" },
  ] as DbtNode[];

  it("matches by exact uniqueId", () => {
    expect(dbtNodeForResult(nodes, "model.shop.dim_customers")?.name).toBe("dim_customers");
  });

  it("falls back to the test name between project and fingerprint", () => {
    const scanned = [
      { kind: "test", name: "not_null_orders_id", uniqueId: "test.shop.not_null_orders_id", filePath: "/p/x.yml" },
    ] as DbtNode[];
    expect(dbtNodeForResult(scanned, "test.shop.not_null_orders_id.zzz")?.filePath).toBe("/p/x.yml");
  });

  it("returns null when nothing matches", () => {
    expect(dbtNodeForResult(nodes, "test.shop.unknown_test.bbb")).toBeNull();
  });
});

describe("dbtNodeCanContainRefs", () => {
  it("allows ref resolution from models, tests, snapshots and analyses", () => {
    for (const kind of ["model", "test", "snapshot", "analysis"] as const) {
      expect(dbtNodeCanContainRefs({ kind } as DbtNode)).toBe(true);
    }
  });

  it("disallows kinds without a ref-bearing SQL body", () => {
    for (const kind of ["source", "seed", "macro", "exposure", "metric"] as const) {
      expect(dbtNodeCanContainRefs({ kind } as DbtNode)).toBe(false);
    }
  });

  it("returns false when there is no active dbt node", () => {
    expect(dbtNodeCanContainRefs(null)).toBe(false);
    expect(dbtNodeCanContainRefs(undefined)).toBe(false);
  });
});

describe("openDbtFile", () => {
  it("reads the file and opens it as a SQL file tab", async () => {
    const readTextFile = vi.fn(async () => "select 1");
    const openFileTab = vi.fn();

    await openDbtFile("/p/models/stg_orders.sql", { readTextFile, openFileTab });

    expect(readTextFile).toHaveBeenCalledWith("/p/models/stg_orders.sql");
    expect(openFileTab).toHaveBeenCalledWith({
      filePath: "/p/models/stg_orders.sql",
      title: "stg_orders.sql",
      text: "select 1",
      kind: "sql",
    });
  });

  it("derives a cursor offset from the file text", async () => {
    const text = "header\n{% macro x() %}{% endmacro %}";
    const readTextFile = vi.fn(async () => text);
    const openFileTab = vi.fn();

    await openDbtFile("/p/macros/utils.sql", { readTextFile, openFileTab }, (t) => t.indexOf("{% macro"));

    expect(openFileTab).toHaveBeenCalledWith(expect.objectContaining({ cursor: text.indexOf("{% macro") }));
  });

  it("opens a .yml source file as a yaml tab so it highlights", async () => {
    const readTextFile = vi.fn(async () => "version: 2\nsources: []\n");
    const openFileTab = vi.fn();

    await openDbtFile("/p/models/_sources.yml", { readTextFile, openFileTab });

    expect(openFileTab).toHaveBeenCalledWith(expect.objectContaining({ kind: "yaml" }));
  });
});
