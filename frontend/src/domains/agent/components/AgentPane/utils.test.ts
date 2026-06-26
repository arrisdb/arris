import { describe, expect, it } from "vitest";
import { serializeQueryResult } from "./utils";
import type { SharedQueryResult } from "./types";

const result = (rows: SharedQueryResult["rows"]): SharedQueryResult => ({
  columns: [
    { name: "id", type_hint: "int" },
    { name: "name", type_hint: "text" },
  ],
  rows,
});

describe("serializeQueryResult", () => {
  it("renders a markdown table with typed headers and counts rows/cols", () => {
    const out = serializeQueryResult(
      result([
        [
          { kind: "int", value: 1 },
          { kind: "text", value: "Alice" },
        ],
        [
          { kind: "int", value: 2 },
          { kind: "text", value: "Bob" },
        ],
      ]),
    );
    expect(out.rowCount).toBe(2);
    expect(out.colCount).toBe(2);
    expect(out.table).toBe(
      "| id (int) | name (text) |\n| --- | --- |\n| 1 | Alice |\n| 2 | Bob |",
    );
  });

  it("renders nulls as NULL", () => {
    const out = serializeQueryResult(
      result([[{ kind: "null" }, { kind: "text", value: "x" }]]),
    );
    expect(out.table).toContain("| NULL | x |");
  });

  it("truncates oversized cells and escapes pipes/newlines", () => {
    const long = "a".repeat(500);
    const out = serializeQueryResult(
      result([[{ kind: "int", value: 1 }, { kind: "text", value: `${long}|b\nc` }]]),
    );
    // 200-char cap plus an ellipsis; pipes escaped, newlines collapsed to spaces.
    expect(out.table).toContain(`${"a".repeat(200)}…`);
    expect(out.table).not.toContain(`${long}|`);
  });
});
