import { describe, expect, it } from "vitest";
import type { ChartSpec } from "@shared";

import { buildChartQuery } from "./chartQuery";

describe("buildChartQuery", () => {
  it("groups an aggregating bar chart over the full result", () => {
    const spec: ChartSpec = {
      kind: "bar",
      xColumn: "event_type",
      yColumns: ["amount"],
      aggregation: "count",
    };
    const q = buildChartQuery(spec, "sales");
    expect(q).toEqual({
      sql: 'SELECT "event_type", COUNT("amount") AS "amount" FROM sales GROUP BY "event_type"',
      aggregated: true,
    });
  });

  it("maps each aggregation function to its SQL form", () => {
    const base: ChartSpec = { kind: "bar", xColumn: "x", yColumns: ["y"] };
    expect(buildChartQuery({ ...base, aggregation: "sum" }, "t")?.sql).toContain("SUM(\"y\")");
    expect(buildChartQuery({ ...base, aggregation: "avg" }, "t")?.sql).toContain("AVG(\"y\")");
    expect(buildChartQuery({ ...base, aggregation: "min" }, "t")?.sql).toContain("MIN(\"y\")");
    expect(buildChartQuery({ ...base, aggregation: "max" }, "t")?.sql).toContain("MAX(\"y\")");
  });

  it("groups by x AND the series column when a series split is active", () => {
    const spec: ChartSpec = {
      kind: "bar",
      xColumn: "month",
      yColumns: ["amount"],
      seriesColumn: "region",
      aggregation: "sum",
    };
    const q = buildChartQuery(spec, "sales");
    expect(q?.aggregated).toBe(true);
    expect(q?.sql).toContain('GROUP BY "month", "region"');
    expect(q?.sql).toContain('SUM("amount") AS "amount"');
  });

  it("reads the raw result when aggregation is off", () => {
    const spec: ChartSpec = { kind: "line", xColumn: "ts", yColumns: ["v"], aggregation: "none" };
    expect(buildChartQuery(spec, "t")).toEqual({
      sql: 'SELECT "ts", "v" FROM t',
      aggregated: false,
    });
  });

  it("always reads raw for scatter, even with an aggregation set", () => {
    const spec: ChartSpec = {
      kind: "scatter",
      xColumn: "x",
      yColumns: ["y"],
      zColumn: "z",
      aggregation: "sum",
    };
    const q = buildChartQuery(spec, "t");
    expect(q?.aggregated).toBe(false);
    expect(q?.sql).toBe('SELECT "x", "y", "z" FROM t');
  });

  it("reduces a KPI to a single aggregate value", () => {
    const spec: ChartSpec = { kind: "kpi", xColumn: "", yColumns: ["revenue"], aggregation: "sum" };
    expect(buildChartQuery(spec, "t")).toEqual({
      sql: 'SELECT SUM("revenue") AS "revenue" FROM t',
      aggregated: true,
    });
  });

  it("takes the first row for an ungrouped KPI", () => {
    const spec: ChartSpec = { kind: "kpi", xColumn: "", yColumns: ["revenue"] };
    expect(buildChartQuery(spec, "t")).toEqual({
      sql: 'SELECT "revenue" FROM t LIMIT 1',
      aggregated: false,
    });
  });

  it("returns null when there is nothing to plot", () => {
    expect(buildChartQuery({ kind: "bar", xColumn: "", yColumns: [] }, "t")).toBeNull();
    expect(buildChartQuery({ kind: "kpi", xColumn: "", yColumns: [] }, "t")).toBeNull();
  });

  it("escapes embedded quotes in column identifiers", () => {
    const spec: ChartSpec = { kind: "bar", xColumn: 'a"b', yColumns: ["y"], aggregation: "sum" };
    expect(buildChartQuery(spec, "t")?.sql).toContain('"a""b"');
  });
});
