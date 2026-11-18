import { describe, expect, it } from "vitest";
import { analyticsPath, canvasPath, routeForPath, runPath } from "./routes";

describe("routeForPath", () => {
  it("maps each path", () => {
    expect(routeForPath("/")).toEqual({ kind: "history" });
    expect(routeForPath("/history")).toEqual({ kind: "history" });
    expect(routeForPath("/runs/r1")).toEqual({ kind: "run", runId: "r1" });
    expect(routeForPath("/pinned")).toEqual({ kind: "pinned" });
    expect(routeForPath("/connections")).toEqual({ kind: "connections" });
    expect(routeForPath("/connections/new")).toEqual({ kind: "connectionRequest" });
    expect(routeForPath("/nope")).toEqual({ kind: "history" });
  });

  it("decodes the run id and accepts a single segment only", () => {
    expect(routeForPath("/runs/a%20b")).toEqual({ kind: "run", runId: "a b" });
    expect(routeForPath("/runs/a%2Fb")).toEqual({ kind: "run", runId: "a/b" });
    expect(routeForPath("/runs/a/b")).toEqual({ kind: "history" });
    expect(routeForPath("/runs/")).toEqual({ kind: "history" });
    expect(routeForPath("/runs/%E0%A4%A")).toEqual({ kind: "history" });
  });

  it("maps canvases paths", () => {
    expect(routeForPath("/canvases")).toEqual({ kind: "canvases" });
    expect(routeForPath("/canvases/c1")).toEqual({ kind: "canvas", canvasId: "c1" });
    expect(routeForPath("/canvases/c1/x")).toEqual({ kind: "history" });
    expect(routeForPath(canvasPath("a b"))).toEqual({ kind: "canvas", canvasId: "a b" });
  });

  it("runPath round-trips through routeForPath", () => {
    expect(routeForPath(runPath("a/b c"))).toEqual({ kind: "run", runId: "a/b c" });
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
    expect(routeForPath("/dbt/models/a/b")).toEqual({ kind: "history" });
    expect(routeForPath("/dbt/nope")).toEqual({ kind: "history" });
    expect(routeForPath("/dbt/models/%E0%A4%A")).toEqual({ kind: "history" });
    expect(routeForPath("/spark/models")).toEqual({ kind: "history" });
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
