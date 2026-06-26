import { describe, expect, it } from "vitest";
import type { ColumnLineageEdge, ColumnLineageGraph } from "./types";
import { collectNeighborhood, mergeColumnLineage, traceColumnPath } from "./utils";

describe("collectNeighborhood", () => {
  const nodes = [
    { id: "source.raw_orders", dependsOn: [] },
    { id: "model.stg_orders", dependsOn: ["source.raw_orders"] },
    { id: "model.fct_orders", dependsOn: ["model.stg_orders", "model.stg_customers"] },
    { id: "model.stg_customers", dependsOn: ["source.raw_customers"] },
    { id: "source.raw_customers", dependsOn: [] },
    { id: "model.dim_customers", dependsOn: ["model.fct_orders"] },
  ];

  it("returns focus + 1 upstream + 1 downstream for depth=1", () => {
    const result = collectNeighborhood("model.stg_orders", nodes, 1);
    expect(result).toEqual(
      new Set(["model.stg_orders", "source.raw_orders", "model.fct_orders"]),
    );
  });

  it("returns only focus for depth=0", () => {
    const result = collectNeighborhood("model.stg_orders", nodes, 0);
    expect(result).toEqual(new Set(["model.stg_orders"]));
  });

  it("includes all reachable at depth=2", () => {
    const result = collectNeighborhood("model.fct_orders", nodes, 2);
    expect(result.has("model.fct_orders")).toBe(true);
    expect(result.has("model.stg_orders")).toBe(true);
    expect(result.has("model.stg_customers")).toBe(true);
    expect(result.has("source.raw_orders")).toBe(true);
    expect(result.has("source.raw_customers")).toBe(true);
    expect(result.has("model.dim_customers")).toBe(true);
  });

  it("handles leaf node with no deps", () => {
    const result = collectNeighborhood("source.raw_orders", nodes, 1);
    expect(result).toEqual(
      new Set(["source.raw_orders", "model.stg_orders"]),
    );
  });

  it("handles terminal node with no downstream", () => {
    const result = collectNeighborhood("model.dim_customers", nodes, 1);
    expect(result).toEqual(
      new Set(["model.dim_customers", "model.fct_orders"]),
    );
  });
});

describe("traceColumnPath", () => {
  const edges: ColumnLineageEdge[] = [
    { fromModel: "source.raw", fromColumn: "id", toModel: "stg.orders", toColumn: "order_id" },
    { fromModel: "stg.orders", fromColumn: "order_id", toModel: "fct.orders", toColumn: "order_id" },
    { fromModel: "source.raw", fromColumn: "amount", toModel: "stg.orders", toColumn: "total" },
  ];

  it("traces upstream and downstream from a middle node", () => {
    const result = traceColumnPath(edges, "stg.orders", "order_id");
    expect(result).toEqual(new Set([
      "source.raw::id",
      "stg.orders::order_id",
      "fct.orders::order_id",
    ]));
  });

  it("traces from a leaf with no upstream", () => {
    const result = traceColumnPath(edges, "source.raw", "id");
    expect(result).toEqual(new Set([
      "source.raw::id",
      "stg.orders::order_id",
      "fct.orders::order_id",
    ]));
  });

  it("traces from a terminal with no downstream", () => {
    const result = traceColumnPath(edges, "fct.orders", "order_id");
    expect(result).toEqual(new Set([
      "source.raw::id",
      "stg.orders::order_id",
      "fct.orders::order_id",
    ]));
  });

  it("returns only the selected column when it has no edges", () => {
    const result = traceColumnPath(edges, "fct.orders", "nonexistent");
    expect(result).toEqual(new Set(["fct.orders::nonexistent"]));
  });

  it("handles cycles without infinite recursion", () => {
    const cyclicEdges: ColumnLineageEdge[] = [
      { fromModel: "a", fromColumn: "x", toModel: "b", toColumn: "y" },
      { fromModel: "b", fromColumn: "y", toModel: "a", toColumn: "x" },
    ];
    const result = traceColumnPath(cyclicEdges, "a", "x");
    expect(result).toEqual(new Set(["a::x", "b::y"]));
  });
});

describe("sample project end-to-end: dim_customers.first_name trace", () => {
  const SRC = "source.sample_dbt_project.jaffle_shop.raw_customers";
  const STG = "model.sample_dbt_project.stg_customers";
  const DIM = "model.sample_dbt_project.dim_customers";

  const columnGraph: ColumnLineageGraph = {
    nodes: [
      { modelId: SRC, columns: ["id", "first_name", "last_name"] },
      { modelId: STG, columns: ["customer_id", "first_name", "last_name", "email"] },
      { modelId: DIM, columns: ["customer_id", "first_name", "last_name", "email", "order_count", "total_amount"] },
    ],
    edges: [
      { fromModel: SRC, fromColumn: "id", toModel: STG, toColumn: "customer_id" },
      { fromModel: SRC, fromColumn: "first_name", toModel: STG, toColumn: "first_name" },
      { fromModel: SRC, fromColumn: "last_name", toModel: STG, toColumn: "last_name" },
      { fromModel: STG, fromColumn: "customer_id", toModel: DIM, toColumn: "customer_id" },
      { fromModel: STG, fromColumn: "first_name", toModel: DIM, toColumn: "first_name" },
      { fromModel: STG, fromColumn: "last_name", toModel: DIM, toColumn: "last_name" },
      { fromModel: STG, fromColumn: "email", toModel: DIM, toColumn: "email" },
    ],
  };

  const lineageNodes = [
    { id: SRC, label: "jaffle_shop.raw_customers", kind: "source" },
    { id: STG, label: "stg_customers", kind: "model" },
    { id: DIM, label: "dim_customers", kind: "model" },
  ];

  it("clicking dim_customers.first_name highlights upstream first_name columns", () => {
    const highlighted = traceColumnPath(columnGraph.edges, DIM, "first_name");
    expect(highlighted).toContain(`${DIM}::first_name`);
    expect(highlighted).toContain(`${STG}::first_name`);
    expect(highlighted).toContain(`${SRC}::first_name`);
  });

  it("mergeColumnLineage applies highlighting to all nodes", () => {
    const highlighted = traceColumnPath(columnGraph.edges, DIM, "first_name");
    const result = mergeColumnLineage(lineageNodes, columnGraph, highlighted);

    const srcNode = result.find((n) => n.id === SRC)!;
    const stgNode = result.find((n) => n.id === STG)!;
    const dimNode = result.find((n) => n.id === DIM)!;

    expect(dimNode.columns!.find((c) => c.name === "first_name")!.highlighted).toBe(true);
    expect(stgNode.columns!.find((c) => c.name === "first_name")!.highlighted).toBe(true);
    expect(srcNode.columns!.find((c) => c.name === "first_name")!.highlighted).toBe(true);

    expect(stgNode.columns!.find((c) => c.name === "email")!.highlighted).toBe(false);
    expect(srcNode.columns!.find((c) => c.name === "id")!.highlighted).toBe(false);
  });
});

describe("sqlmesh project end-to-end: dim_customers.first_name trace", () => {
  // SQLmesh model ids are dotted schema.model names with no source/model prefix.
  const RAW = "analytics_shop.raw_customers";
  const STG = "analytics_shop.stg_customers";
  const DIM = "analytics_shop.dim_customers";

  const columnGraph: ColumnLineageGraph = {
    nodes: [
      { modelId: RAW, columns: ["customer_id", "first_name", "last_name"] },
      { modelId: STG, columns: ["customer_id", "first_name", "last_name"] },
      { modelId: DIM, columns: ["customer_id", "first_name", "order_count"] },
    ],
    edges: [
      { fromModel: RAW, fromColumn: "first_name", toModel: STG, toColumn: "first_name" },
      { fromModel: STG, fromColumn: "first_name", toModel: DIM, toColumn: "first_name" },
    ],
  };

  const lineageNodes = [
    { id: RAW, label: "raw_customers", kind: "seed" },
    { id: STG, label: "stg_customers", kind: "incremental" },
    { id: DIM, label: "dim_customers", kind: "full" },
  ];

  it("traces first_name upstream through sqlmesh model ids", () => {
    const highlighted = traceColumnPath(columnGraph.edges, DIM, "first_name");
    expect(highlighted).toEqual(new Set([
      `${RAW}::first_name`,
      `${STG}::first_name`,
      `${DIM}::first_name`,
    ]));
  });

  it("mergeColumnLineage highlights the traced sqlmesh columns", () => {
    const highlighted = traceColumnPath(columnGraph.edges, DIM, "first_name");
    const result = mergeColumnLineage(lineageNodes, columnGraph, highlighted);

    const stgNode = result.find((n) => n.id === STG)!;
    expect(stgNode.columns!.find((c) => c.name === "first_name")!.highlighted).toBe(true);
    expect(stgNode.columns!.find((c) => c.name === "customer_id")!.highlighted).toBe(false);
  });
});

describe("mergeColumnLineage", () => {
  const nodes = [
    { id: "model.a", label: "A", kind: "model" },
    { id: "model.b", label: "B", kind: "model" },
    { id: "model.c", label: "C", kind: "model" },
  ];

  const columnGraph: ColumnLineageGraph = {
    nodes: [
      { modelId: "model.a", columns: ["id", "name"] },
      { modelId: "model.b", columns: ["order_id"] },
    ],
    edges: [],
  };

  it("attaches columns to matching nodes", () => {
    const result = mergeColumnLineage(nodes, columnGraph, null);
    expect(result[0].columns).toEqual([
      { name: "id", highlighted: undefined },
      { name: "name", highlighted: undefined },
    ]);
    expect(result[1].columns).toEqual([
      { name: "order_id", highlighted: undefined },
    ]);
  });

  it("leaves nodes without column data unchanged", () => {
    const result = mergeColumnLineage(nodes, columnGraph, null);
    expect(result[2].columns).toBeUndefined();
    expect(result[2]).toBe(nodes[2]);
  });

  it("applies highlight set to columns", () => {
    const highlighted = new Set(["model.a::id", "model.b::order_id"]);
    const result = mergeColumnLineage(nodes, columnGraph, highlighted);
    expect(result[0].columns).toEqual([
      { name: "id", highlighted: true },
      { name: "name", highlighted: false },
    ]);
    expect(result[1].columns).toEqual([
      { name: "order_id", highlighted: true },
    ]);
  });
});
