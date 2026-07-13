import { describe, expect, it } from "vitest";

import { formatTimestamp, nextSortClauses, tableStatusSummary } from "./utils";

describe("formatTimestamp", () => {
  it("formats an epoch as local YYYY-MM-DD HH:MM:SS", () => {
    const epoch = new Date(2026, 6, 12, 23, 17, 34).getTime();
    expect(formatTimestamp(epoch)).toBe("2026-07-12 23:17:34");
  });

  it("returns empty for an unsettled source", () => {
    expect(formatTimestamp(undefined)).toBe("");
  });
});

describe("nextSortClauses", () => {
  it("cycles a header through asc, desc, unsorted", () => {
    expect(nextSortClauses([], "total")).toEqual([{ column: "total", direction: "asc" }]);
    expect(nextSortClauses([{ column: "total", direction: "asc" }], "total")).toEqual([
      { column: "total", direction: "desc" },
    ]);
    expect(nextSortClauses([{ column: "total", direction: "desc" }], "total")).toEqual([]);
  });

  it("switches to a new column at ascending", () => {
    expect(nextSortClauses([{ column: "total", direction: "desc" }], "month")).toEqual([
      { column: "month", direction: "asc" },
    ]);
  });
});

describe("tableStatusSummary", () => {
  it("leads with the page and row range, then columns and timestamp", () => {
    const endedAt = new Date(2026, 6, 12, 23, 17, 34).getTime();
    expect(
      tableStatusSummary({ totalRows: 5000, columnCount: 1, pageIndex: 4, rangeEnd: 2500, endedAt }),
    ).toBe("Page 5 · 2,500 of 5,000 rows · 1 column · 2026-07-12 23:17:34");
  });

  it("drops the timestamp until the source settles and uses singular forms", () => {
    expect(
      tableStatusSummary({ totalRows: 1, columnCount: 1, pageIndex: 0, rangeEnd: 1, endedAt: undefined }),
    ).toBe("Page 1 · 1 of 1 row · 1 column");
  });
});
