import { describe, it, expect } from "vitest";
import type { ChartSpec } from "@shared";
import type { QueryResult } from "@domains/results";
import {
  axisTickFormatter,
  cartesianMargin,
  yValueFormatter,
  barSegmentRadius,
  cartesianSeries,
  chartImageFilename,
  yAxisDomainFor,
  reconcileChartSpec,
  toCartesianData,
  toFunnelData,
  toHistogramData,
  toKpiData,
  toRadarData,
  toScatterData,
  toTreemapData,
} from "./utils";

const COLS = [
  { name: "day", type_hint: "text" },
  { name: "count", type_hint: "int" },
  { name: "revenue", type_hint: "float" },
];

const ROWS = [
  [{ kind: "text" as const, value: "Mon" }, { kind: "int" as const, value: 10 }, { kind: "double" as const, value: 100 }],
  [{ kind: "text" as const, value: "Tue" }, { kind: "int" as const, value: 20 }, { kind: "double" as const, value: 200 }],
  [{ kind: "text" as const, value: "Wed" }, { kind: "int" as const, value: 5 }, { kind: "double" as const, value: 50 }],
];

const RESULT: QueryResult = { columns: COLS, rows: ROWS, elapsed: 0.01 };

const SPEC: ChartSpec = {
  kind: "bar",
  xColumn: "day",
  yColumns: ["count"],
  title: "Test",
};

describe("reconcileChartSpec", () => {
  it("keeps a spec whose columns all still exist", () => {
    expect(reconcileChartSpec(SPEC, RESULT)).toEqual(SPEC);
  });

  it("drops y columns missing from the result", () => {
    const stale: ChartSpec = { ...SPEC, yColumns: ["count", "id", "sum"] };
    expect(reconcileChartSpec(stale, RESULT).yColumns).toEqual(["count"]);
  });

  it("re-derives x and clears y when nothing survives", () => {
    const stale: ChartSpec = { ...SPEC, xColumn: "gone", yColumns: ["id", "sum"] };
    const next = reconcileChartSpec(stale, RESULT);
    expect(next.xColumn).toBe("day");
    expect(next.yColumns).toEqual([]);
  });

  it("preserves kind, title and style", () => {
    const styled: ChartSpec = { ...SPEC, kind: "line", yColumns: ["id"], style: { showLegend: true } };
    const next = reconcileChartSpec(styled, RESULT);
    expect(next.kind).toBe("line");
    expect(next.title).toBe("Test");
    expect(next.style).toEqual({ showLegend: true });
  });

  it("returns spec unchanged when result is undefined", () => {
    const stale: ChartSpec = { ...SPEC, yColumns: ["id"] };
    expect(reconcileChartSpec(stale, undefined)).toBe(stale);
  });
});

describe("toCartesianData", () => {
  it("maps x and y columns", () => {
    const data = toCartesianData(SPEC, RESULT);
    expect(data).toHaveLength(3);
    expect(data[0]).toEqual({ day: "Mon", count: 10 });
  });

  it("returns empty for undefined result", () => {
    expect(toCartesianData(SPEC, undefined)).toEqual([]);
  });

  it("sorts ascending", () => {
    const spec = { ...SPEC, style: { sortOrder: "asc" as const } };
    const data = toCartesianData(spec, RESULT);
    expect(data[0].count).toBe(5);
    expect(data[2].count).toBe(20);
  });

  it("sorts descending", () => {
    const spec = { ...SPEC, style: { sortOrder: "desc" as const } };
    const data = toCartesianData(spec, RESULT);
    expect(data[0].count).toBe(20);
    expect(data[2].count).toBe(5);
  });

  it("handles missing x column gracefully", () => {
    const spec = { ...SPEC, xColumn: "nonexistent" };
    const data = toCartesianData(spec, RESULT);
    expect(data).toHaveLength(3);
    expect(data[0].nonexistent).toBeUndefined();
    expect(data[0].count).toBe(10);
  });

  it("non-numeric y values default to 0", () => {
    const result: QueryResult = {
      columns: [
        { name: "day", type_hint: "text" },
        { name: "count", type_hint: "text" },
      ],
      rows: [[{ kind: "text" as const, value: "Mon" }, { kind: "null" as const }]],
      elapsed: 0,
    };
    const data = toCartesianData(SPEC, result);
    expect(data[0].count).toBe(0);
  });

  it("returns empty for empty rows", () => {
    const result: QueryResult = { columns: COLS, rows: [], elapsed: 0 };
    expect(toCartesianData(SPEC, result)).toEqual([]);
  });

  it("single y column produces correct data shape", () => {
    const data = toCartesianData(SPEC, RESULT);
    expect(Object.keys(data[0])).toEqual(["day", "count"]);
  });
});

const SERIES_COLS = [
  { name: "region", type_hint: "text" },
  { name: "sale_month", type_hint: "text" },
  { name: "units_sold", type_hint: "int" },
];

const SERIES_ROWS = [
  [{ kind: "text" as const, value: "North" }, { kind: "text" as const, value: "Jan" }, { kind: "int" as const, value: 10 }],
  [{ kind: "text" as const, value: "South" }, { kind: "text" as const, value: "Jan" }, { kind: "int" as const, value: 20 }],
  [{ kind: "text" as const, value: "North" }, { kind: "text" as const, value: "Feb" }, { kind: "int" as const, value: 15 }],
  [{ kind: "text" as const, value: "South" }, { kind: "text" as const, value: "Feb" }, { kind: "int" as const, value: 25 }],
];

const SERIES_RESULT: QueryResult = { columns: SERIES_COLS, rows: SERIES_ROWS, elapsed: 0.01 };

const SERIES_SPEC: ChartSpec = {
  kind: "line",
  xColumn: "sale_month",
  yColumns: ["units_sold"],
  seriesColumn: "region",
};

describe("cartesianSeries", () => {
  it("returns distinct category values in encounter order when seriesColumn set", () => {
    expect(cartesianSeries(SERIES_SPEC, SERIES_RESULT)).toEqual(["North", "South"]);
  });

  it("falls back to yColumns when seriesColumn is unset", () => {
    expect(cartesianSeries(SPEC, RESULT)).toEqual(["count"]);
  });

  it("falls back to yColumns when seriesColumn missing from result", () => {
    const spec = { ...SERIES_SPEC, seriesColumn: "gone" };
    expect(cartesianSeries(spec, SERIES_RESULT)).toEqual(["units_sold"]);
  });

  it("falls back to yColumns when result is undefined", () => {
    expect(cartesianSeries(SERIES_SPEC, undefined)).toEqual(["units_sold"]);
  });

  it("falls back to yColumns for combo (series-split unsupported)", () => {
    const spec = { ...SERIES_SPEC, kind: "combo" as const };
    expect(cartesianSeries(spec, SERIES_RESULT)).toEqual(["units_sold"]);
  });
});

describe("toCartesianData (series pivot)", () => {
  it("pivots long rows into one field per category, keyed by x", () => {
    const data = toCartesianData(SERIES_SPEC, SERIES_RESULT);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ sale_month: "Jan", North: 10, South: 20 });
    expect(data[1]).toEqual({ sale_month: "Feb", North: 15, South: 25 });
  });

  it("preserves x encounter order", () => {
    const data = toCartesianData(SERIES_SPEC, SERIES_RESULT);
    expect(data.map((row) => row.sale_month)).toEqual(["Jan", "Feb"]);
  });

  it("last value wins on duplicate (x, category)", () => {
    const rows = [
      ...SERIES_ROWS,
      [{ kind: "text" as const, value: "North" }, { kind: "text" as const, value: "Jan" }, { kind: "int" as const, value: 99 }],
    ];
    const result: QueryResult = { columns: SERIES_COLS, rows, elapsed: 0 };
    const data = toCartesianData(SERIES_SPEC, result);
    expect(data[0].North).toBe(99);
  });

  it("returns empty when measure column missing", () => {
    const spec = { ...SERIES_SPEC, yColumns: [] };
    expect(toCartesianData(spec, SERIES_RESULT)).toEqual([]);
  });

  it("does not pivot for combo even when seriesColumn is set", () => {
    const spec = { ...SERIES_SPEC, kind: "combo" as const };
    const data = toCartesianData(spec, SERIES_RESULT);
    // 4 long rows, not 2 pivoted rows; keyed by measure, not category.
    expect(data).toHaveLength(4);
    expect(data[0]).toEqual({ sale_month: "Jan", units_sold: 10 });
  });
});

const AGG_COLS = [
  { name: "day", type_hint: "text" },
  { name: "amount", type_hint: "int" },
];

// Mon appears twice (10, 30), Tue once (20), exercising grouping.
const AGG_ROWS = [
  [{ kind: "text" as const, value: "Mon" }, { kind: "int" as const, value: 10 }],
  [{ kind: "text" as const, value: "Mon" }, { kind: "int" as const, value: 30 }],
  [{ kind: "text" as const, value: "Tue" }, { kind: "int" as const, value: 20 }],
];

const AGG_RESULT: QueryResult = { columns: AGG_COLS, rows: AGG_ROWS, elapsed: 0 };

const AGG_SPEC: ChartSpec = { kind: "bar", xColumn: "day", yColumns: ["amount"] };

describe("toCartesianData (aggregation)", () => {
  it("leaves rows ungrouped when aggregation is none/undefined", () => {
    expect(toCartesianData(AGG_SPEC, AGG_RESULT)).toHaveLength(3);
  });

  it("treats aggregation 'none' as no grouping", () => {
    const data = toCartesianData({ ...AGG_SPEC, aggregation: "none" }, AGG_RESULT);
    expect(data).toHaveLength(3);
  });

  it("sums duplicate x buckets", () => {
    const data = toCartesianData({ ...AGG_SPEC, aggregation: "sum" }, AGG_RESULT);
    expect(data).toEqual([
      { day: "Mon", amount: 40 },
      { day: "Tue", amount: 20 },
    ]);
  });

  it("averages duplicate x buckets", () => {
    const data = toCartesianData({ ...AGG_SPEC, aggregation: "avg" }, AGG_RESULT);
    expect(data[0]).toEqual({ day: "Mon", amount: 20 });
  });

  it("takes the min of a bucket", () => {
    const data = toCartesianData({ ...AGG_SPEC, aggregation: "min" }, AGG_RESULT);
    expect(data[0].amount).toBe(10);
  });

  it("takes the max of a bucket", () => {
    const data = toCartesianData({ ...AGG_SPEC, aggregation: "max" }, AGG_RESULT);
    expect(data[0].amount).toBe(30);
  });

  it("counts rows per bucket", () => {
    const data = toCartesianData({ ...AGG_SPEC, aggregation: "count" }, AGG_RESULT);
    expect(data).toEqual([
      { day: "Mon", amount: 2 },
      { day: "Tue", amount: 1 },
    ]);
  });

  it("preserves x encounter order", () => {
    const data = toCartesianData({ ...AGG_SPEC, aggregation: "sum" }, AGG_RESULT);
    expect(data.map((row) => row.day)).toEqual(["Mon", "Tue"]);
  });

  it("aggregates duplicate (x, category) instead of last-wins in pivot mode", () => {
    const rows = [
      ...SERIES_ROWS,
      [{ kind: "text" as const, value: "North" }, { kind: "text" as const, value: "Jan" }, { kind: "int" as const, value: 5 }],
    ];
    const result: QueryResult = { columns: SERIES_COLS, rows, elapsed: 0 };
    const data = toCartesianData({ ...SERIES_SPEC, aggregation: "sum" }, result);
    // North/Jan: 10 + 5 = 15 (summed, not last-wins=5).
    expect(data[0]).toEqual({ sale_month: "Jan", North: 15, South: 20 });
  });
});

describe("chartImageFilename", () => {
  it("slugifies a title into a .png filename", () => {
    expect(chartImageFilename("Revenue")).toBe("Revenue.png");
  });

  it("falls back to chart.png when title is undefined", () => {
    expect(chartImageFilename(undefined)).toBe("chart.png");
  });

  it("falls back to chart.png for a blank title", () => {
    expect(chartImageFilename("   ")).toBe("chart.png");
  });

  it("replaces unsafe characters and trims separators", () => {
    expect(chartImageFilename("Q1 / 2025 revenue!")).toBe("Q1_2025_revenue.png");
  });
});

describe("toScatterData", () => {
  it("maps x and y as numbers", () => {
    const spec = { ...SPEC, xColumn: "count", yColumns: ["revenue"] };
    const data = toScatterData(spec, RESULT);
    expect(data).toHaveLength(3);
    expect(data[0]).toEqual({ x: 10, y: 100 });
  });

  it("includes z when zColumn set", () => {
    const spec = { ...SPEC, xColumn: "count", yColumns: ["revenue"], zColumn: "count" };
    const data = toScatterData(spec, RESULT);
    expect(data[0].z).toBe(10);
  });
});

describe("toHistogramData", () => {
  it("produces correct bins", () => {
    const numResult: QueryResult = {
      columns: [{ name: "val", type_hint: "int" }],
      rows: Array.from({ length: 100 }, (_, i) => [{ kind: "int" as const, value: i }]),
      elapsed: 0.01,
    };
    const spec = { ...SPEC, xColumn: "val", yColumns: [] };
    const bins = toHistogramData(spec, numResult, 10);
    expect(bins).toHaveLength(10);
    const totalCount = bins.reduce((s, b) => s + b.count, 0);
    expect(totalCount).toBe(100);
  });

  it("filters NaN values from non-numeric x-axis", () => {
    const result: QueryResult = {
      columns: [{ name: "val", type_hint: "text" }],
      rows: [
        [{ kind: "text" as const, value: "hello" }],
        [{ kind: "int" as const, value: 10 }],
        [{ kind: "text" as const, value: "world" }],
        [{ kind: "int" as const, value: 20 }],
      ],
      elapsed: 0.01,
    };
    const spec = { ...SPEC, xColumn: "val", yColumns: [] };
    const bins = toHistogramData(spec, result, 2);
    expect(bins).toHaveLength(2);
    const totalCount = bins.reduce((s, b) => s + b.count, 0);
    expect(totalCount).toBe(2);
  });

  it("returns empty when all values are NaN", () => {
    const result: QueryResult = {
      columns: [{ name: "val", type_hint: "text" }],
      rows: [
        [{ kind: "text" as const, value: "hello" }],
        [{ kind: "text" as const, value: "world" }],
      ],
      elapsed: 0.01,
    };
    const spec = { ...SPEC, xColumn: "val", yColumns: [] };
    const bins = toHistogramData(spec, result);
    expect(bins).toEqual([]);
  });

  it("handles single value", () => {
    const result: QueryResult = {
      columns: [{ name: "val", type_hint: "int" }],
      rows: [[{ kind: "int" as const, value: 5 }], [{ kind: "int" as const, value: 5 }]],
      elapsed: 0.01,
    };
    const spec = { ...SPEC, xColumn: "val", yColumns: [] };
    const bins = toHistogramData(spec, result);
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(2);
  });
});

describe("toRadarData", () => {
  it("reshapes to subject + dimensions", () => {
    const spec = { ...SPEC, yColumns: ["count", "revenue"] };
    const data = toRadarData(spec, RESULT);
    expect(data[0]).toEqual({ subject: "Mon", count: 10, revenue: 100 });
  });
});

describe("toTreemapData", () => {
  it("maps to name/value", () => {
    const data = toTreemapData(SPEC, RESULT);
    expect(data[0]).toEqual({ name: "Mon", value: 10 });
  });
});

describe("toFunnelData", () => {
  it("maps to name/value/fill", () => {
    const data = toFunnelData(SPEC, RESULT);
    expect(data[0].name).toBe("Mon");
    expect(data[0].value).toBe(10);
    expect(data[0].fill).toBeTruthy();
  });
});

describe("toKpiData", () => {
  it("extracts first numeric value", () => {
    const kpi = toKpiData(SPEC, RESULT);
    expect(kpi.value).toBe(10);
    expect(kpi.label).toBe("Mon");
  });

  it("returns 0 for empty result", () => {
    const result: QueryResult = { columns: COLS, rows: [], elapsed: 0.01 };
    const kpi = toKpiData(SPEC, result);
    expect(kpi.value).toBe(0);
  });
});

describe("barSegmentRadius", () => {
  it("rounds all corners of a non-stacked bar", () => {
    expect(barSegmentRadius(0, 3, false, false)).toBe(4);
  });

  it("rounds all corners of a single-series stack", () => {
    expect(barSegmentRadius(0, 1, true, false)).toBe(4);
  });

  it("rounds only the outer edges of a vertical stack, leaving inner segments square", () => {
    // bottom segment rounds its bottom, top segment rounds its top, middle is flush.
    expect(barSegmentRadius(0, 3, true, false)).toEqual([0, 0, 4, 4]);
    expect(barSegmentRadius(1, 3, true, false)).toBe(0);
    expect(barSegmentRadius(2, 3, true, false)).toEqual([4, 4, 0, 0]);
  });

  it("rounds the left/right ends of a horizontal stack", () => {
    expect(barSegmentRadius(0, 2, true, true)).toEqual([4, 0, 0, 4]);
    expect(barSegmentRadius(1, 2, true, true)).toEqual([0, 4, 4, 0]);
  });
});

describe("yAxisDomainFor", () => {
  it("fits a line chart to its data instead of forcing a 0 baseline", () => {
    expect(yAxisDomainFor({ kind: "line", xColumn: "x", yColumns: ["y"] })).toEqual(["auto", "auto"]);
    expect(yAxisDomainFor({ kind: "area", xColumn: "x", yColumns: ["y"] })).toEqual(["auto", "auto"]);
  });

  it("keeps a bar/combo chart 0-based (undefined domain) so bar length stays proportional", () => {
    expect(yAxisDomainFor({ kind: "bar", xColumn: "x", yColumns: ["y"] })).toBeUndefined();
    expect(yAxisDomainFor({ kind: "combo", xColumn: "x", yColumns: ["y"] })).toBeUndefined();
  });

  it("honours an explicit yMin/yMax on any kind", () => {
    expect(
      yAxisDomainFor({ kind: "line", xColumn: "x", yColumns: ["y"], style: { yMin: 0, yMax: 100 } }),
    ).toEqual([0, 100]);
    expect(
      yAxisDomainFor({ kind: "bar", xColumn: "x", yColumns: ["y"], style: { yMin: 10 } }),
    ).toEqual([10, "auto"]);
  });
});

describe("axisTickFormatter", () => {
  it("returns undefined for the default (Recharts' own formatting)", () => {
    expect(axisTickFormatter(undefined)).toBeUndefined();
    expect(axisTickFormatter("default")).toBeUndefined();
  });

  it("abbreviates large magnitudes in compact mode", () => {
    const fmt = axisTickFormatter("compact");
    expect(fmt).toBeDefined();
    expect(fmt?.(10_000_000_000)).toBe("10B");
    expect(fmt?.(1_500_000)).toBe("1.5M");
  });

  it("uses scientific notation when selected", () => {
    const fmt = axisTickFormatter("scientific");
    expect(fmt?.(10_000_000_000)).toBe("1E10");
  });
});

describe("cartesianMargin", () => {
  it("uses the wider default horizontal padding so labels are not clipped", () => {
    expect(cartesianMargin(undefined)).toEqual({ top: 5, right: 16, bottom: 5, left: 16 });
  });

  it("applies an explicit horizontal padding to both sides", () => {
    expect(cartesianMargin({ plotPaddingX: 48 })).toEqual({ top: 5, right: 48, bottom: 5, left: 48 });
  });
});

describe("yValueFormatter", () => {
  it("returns undefined when no Y formatting is configured", () => {
    expect(yValueFormatter(undefined)).toBeUndefined();
    expect(yValueFormatter({ yNumberFormat: "default" })).toBeUndefined();
  });

  it("combines compact notation with a prefix and suffix", () => {
    const fmt = yValueFormatter({ yNumberFormat: "compact", yPrefix: "$", ySuffix: "/mo" });
    expect(fmt?.(10_000_000_000)).toBe("$10B/mo");
  });

  it("applies fixed decimals even without a notation change", () => {
    const fmt = yValueFormatter({ yDecimals: 2, yPrefix: "$" });
    expect(fmt?.(1234)).toBe("$1,234.00");
  });

  it("passes non-numeric values through untouched", () => {
    const fmt = yValueFormatter({ ySuffix: "%" });
    expect(fmt?.("n/a" as unknown as number)).toBe("n/a");
  });
});
