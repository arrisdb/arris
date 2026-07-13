import { describe, expect, it } from "vitest";

import { formatTimestamp, nextSortClauses, pageCountFor, tableStatusSummary } from "./utils";

describe("formatTimestamp", () => {
  it("formats an epoch as local YYYY-MM-DD HH:MM:SS", () => {
    const epoch = new Date(2026, 6, 12, 23, 17, 34).getTime();
    expect(formatTimestamp(epoch)).toBe("2026-07-12 23:17:34");
  });

  it("returns empty for an unsettled source", () => {
    expect(formatTimestamp(undefined)).toBe("");
  });
});

describe("pageCountFor", () => {
  it("counts pages, never below one", () => {
    expect(pageCountFor(5, 2)).toBe(3);
    expect(pageCountFor(200, 200)).toBe(1);
    expect(pageCountFor(0, 200)).toBe(1);
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
  it("joins rows, columns, page and timestamp", () => {
    const endedAt = new Date(2026, 6, 12, 23, 17, 34).getTime();
    expect(
      tableStatusSummary({ totalRows: 5000, columnCount: 1, pageIndex: 0, pageCount: 25, endedAt }),
    ).toBe("5,000 rows · 1 column · Page 1/25 · 2026-07-12 23:17:34");
  });

  it("drops the timestamp until the source settles and uses singular forms", () => {
    expect(
      tableStatusSummary({ totalRows: 1, columnCount: 1, pageIndex: 0, pageCount: 1, endedAt: undefined }),
    ).toBe("1 row · 1 column · Page 1/1");
  });
});
