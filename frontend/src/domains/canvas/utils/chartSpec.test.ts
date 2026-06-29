import { describe, expect, it } from "vitest";
import type { ChartSpec } from "@shared";

import { sanitizeChartSpec } from "./chartSpec";

describe("sanitizeChartSpec", () => {
  it("guarantees array/string axes for a malformed spec", () => {
    const out = sanitizeChartSpec({ xColumn: 5, yColumns: "nope", kind: "line" });
    expect(Array.isArray(out.yColumns)).toBe(true);
    expect(out.yColumns).toEqual([]);
    expect(typeof out.xColumn).toBe("string");
    expect(out.kind).toBe("line");
  });

  it("returns an empty-but-valid spec for non-object input", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      const out = sanitizeChartSpec(bad);
      expect(out.yColumns).toEqual([]);
      expect(out.xColumn).toBe("");
    }
  });

  it("keeps the base columns when a partial edit omits them", () => {
    const base: ChartSpec = { kind: "bar", xColumn: "month", yColumns: ["total"] };
    // The agent only adjusts the axis bounds in `style`; columns must survive.
    const out = sanitizeChartSpec({ style: { yMin: 0, yMax: 100 } }, base);
    expect(out.yColumns).toEqual(["total"]);
    expect(out.xColumn).toBe("month");
    expect(out.style).toMatchObject({ yMin: 0, yMax: 100 });
  });

  it("overrides columns only when the edit carries them, filtering non-strings", () => {
    const base: ChartSpec = { kind: "bar", xColumn: "month", yColumns: ["total"] };
    const out = sanitizeChartSpec({ yColumns: ["a", 2, "b", null] }, base);
    expect(out.yColumns).toEqual(["a", "b"]);
  });

  it("merges style onto the base style", () => {
    const base: ChartSpec = {
      kind: "bar",
      xColumn: "month",
      yColumns: ["total"],
      style: { stackMode: "stacked" } as ChartSpec["style"],
    };
    const out = sanitizeChartSpec({ style: { yMax: 9 } }, base);
    expect(out.style).toMatchObject({ stackMode: "stacked", yMax: 9 });
  });
});
