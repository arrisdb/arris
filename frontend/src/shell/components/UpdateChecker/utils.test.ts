import { describe, expect, it } from "vitest";
import { formatProgress, updateAvailableLabel } from "./utils";

describe("formatProgress", () => {
  it("returns 0 when total is unknown", () => {
    expect(formatProgress(500, null)).toBe(0);
    expect(formatProgress(500, 0)).toBe(0);
  });

  it("computes integer percent of total", () => {
    expect(formatProgress(0, 1000)).toBe(0);
    expect(formatProgress(250, 1000)).toBe(25);
    expect(formatProgress(1000, 1000)).toBe(100);
  });

  it("rounds to nearest percent", () => {
    expect(formatProgress(333, 1000)).toBe(33);
    expect(formatProgress(336, 1000)).toBe(34);
  });

  it("clamps overshoot to 100", () => {
    expect(formatProgress(1500, 1000)).toBe(100);
  });
});

describe("updateAvailableLabel", () => {
  it("renders an update-to-version label", () => {
    expect(updateAvailableLabel("0.2.0")).toBe("Update to v0.2.0");
  });
});
