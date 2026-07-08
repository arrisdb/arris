import { describe, expect, it } from "vitest";

import type { QueryResult } from "@shared";

import { runResultSummary } from "./utils";

function result(rows: number, cols: number): QueryResult {
  return {
    columns: Array.from({ length: cols }, (_, i) => ({ name: `c${i}`, type_hint: "text" })),
    rows: Array.from({ length: rows }, () => []),
    elapsed: 0,
    statementType: "query",
  } as QueryResult;
}

describe("runResultSummary", () => {
  it("shows plain counts when the page holds the whole result", () => {
    expect(runResultSummary(result(3, 2))).toBe("3 rows · 2 columns");
    expect(runResultSummary(result(3, 2), 3, true)).toBe("3 rows · 2 columns");
  });

  it("uses singular forms for one row and one column", () => {
    expect(runResultSummary(result(1, 1))).toBe("1 row · 1 column");
  });

  it("shows first N of M when the full result is larger than the page", () => {
    expect(runResultSummary(result(500, 4), 12345, true)).toBe(
      "first 500 of 12345 rows · 4 columns",
    );
  });

  it("appends a plus when the ingestion budget truncated the run", () => {
    expect(runResultSummary(result(500, 4), 9000, false)).toBe(
      "first 500 of 9000+ rows · 4 columns",
    );
  });

  it("never reports a total smaller than the visible page", () => {
    expect(runResultSummary(result(100, 1), 0, false)).toBe(
      "first 100 of 100+ rows · 1 column",
    );
  });
});
