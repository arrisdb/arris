import { describe, expect, it } from "vitest";
import { NO_ROWS_LABEL } from "./constants";
import { formatRowRange, toVisibleRows } from "./utils";

describe("run result utils", () => {
  it("maps rows to visible rows with original indexes", () => {
    const row = [{ kind: "int" as const, value: 1 }];
    expect(toVisibleRows([row, row]).map((r) => r.originalIndex)).toEqual([
      0, 1,
    ]);
  });

  it("formats a one-based inclusive range", () => {
    expect(formatRowRange(100, 100, 250)).toBe("rows 101 to 200 of 250");
  });

  it("labels an empty page instead of a reversed range", () => {
    expect(formatRowRange(0, 0, 0)).toBe(NO_ROWS_LABEL);
  });
});
