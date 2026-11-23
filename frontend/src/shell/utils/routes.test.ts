import { describe, expect, it } from "vitest";
import { analyticsPath, routeForPath } from "./routes";

describe("routeForPath", () => {
  it("maps each path", () => {
    expect(routeForPath("/")).toEqual({ kind: "shell" });
    expect(routeForPath("/runs/r1")).toEqual({ kind: "run", runId: "r1" });
    expect(routeForPath("/connections")).toEqual({ kind: "shell" });
    expect(routeForPath("/connections/new")).toEqual({ kind: "connectionRequest" });
    expect(routeForPath("/nope")).toEqual({ kind: "shell" });
  });

  it("decodes the run id and accepts a single segment only", () => {
    expect(routeForPath("/runs/a%20b")).toEqual({ kind: "run", runId: "a b" });
    expect(routeForPath("/runs/a%2Fb")).toEqual({ kind: "run", runId: "a/b" });
    expect(routeForPath("/runs/a/b")).toEqual({ kind: "shell" });
    expect(routeForPath("/runs/")).toEqual({ kind: "shell" });
    expect(routeForPath("/runs/%E0%A4%A")).toEqual({ kind: "shell" });
  });

  it("maps canvases paths", () => {
    expect(routeForPath("/canvases")).toEqual({ kind: "shell" });
    expect(routeForPath("/canvases/c1")).toEqual({ kind: "canvas", canvasId: "c1" });
    expect(routeForPath("/canvases/c1/x")).toEqual({ kind: "shell" });
  });

  it("routeForPath maps dbt and sqlmesh paths", () => {
    expect(routeForPath("/dbt")).toEqual({ kind: "models", tool: "dbt" });
    expect(routeForPath("/dbt/models")).toEqual({ kind: "models", tool: "dbt" });
    expect(routeForPath("/dbt/models/orders")).toEqual({ kind: "model", tool: "dbt", name: "orders" });
    expect(routeForPath("/dbt/lineage")).toEqual({ kind: "lineage", tool: "dbt", name: null });
    expect(routeForPath("/sqlmesh/lineage/db.orders")).toEqual({
      kind: "lineage",
      tool: "sqlmesh",
      name: "db.orders",
    });
    expect(routeForPath("/sqlmesh/runs")).toEqual({ kind: "toolRuns", tool: "sqlmesh" });
    expect(routeForPath("/dbt/runs/r1")).toEqual({ kind: "toolRun", tool: "dbt", runId: "r1" });
    expect(routeForPath("/dbt/models/a/b")).toEqual({ kind: "shell" });
    expect(routeForPath("/dbt/nope")).toEqual({ kind: "shell" });
    expect(routeForPath("/dbt/models/%E0%A4%A")).toEqual({ kind: "shell" });
    expect(routeForPath("/spark/models")).toEqual({ kind: "shell" });
  });

  it("analyticsPath round-trips through routeForPath", () => {
    expect(routeForPath(analyticsPath("sqlmesh", "models", "a/b c"))).toEqual({
      kind: "model",
      tool: "sqlmesh",
      name: "a/b c",
    });
    expect(analyticsPath("dbt", "runs")).toBe("/dbt/runs");
  });
});
