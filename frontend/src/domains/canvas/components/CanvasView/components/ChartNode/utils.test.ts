import { describe, expect, it } from "vitest";

import { chartStatusSummary, formatRefreshedAt } from "./utils";

describe("chartStatusSummary", () => {
  it("states just the sample cap when nothing is plotted yet", () => {
    expect(chartStatusSummary(undefined, 1000, undefined)).toBe("up to 1,000 rows sampled");
  });

  it("includes the plotted count and the refresh timestamp", () => {
    const summary = chartStatusSummary(50, 1000, 1_700_000_000_000);
    expect(summary).toContain("50 data points · up to 1,000 rows sampled · ");
    expect(summary).toMatch(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  });
});

describe("formatRefreshedAt", () => {
  it("is empty until the source settles", () => {
    expect(formatRefreshedAt(undefined)).toBe("");
  });

  it("formats an epoch as YYYY-MM-DD HH:MM:SS", () => {
    expect(formatRefreshedAt(1_700_000_000_000)).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  });
});
