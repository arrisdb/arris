import { describe, it, expect } from "vitest";
import {
  copyTextForSelectedCell,
  extractIpcError,
  findVisibleMatches,
  resultToCsv,
  resultToJson,
  typeChipMeta,
} from "./utils";
import type { ColumnSpec, QueryValue, VisibleResultRow } from "./types";

const columns: ColumnSpec[] = [
  { name: "id", type_hint: "int" },
  { name: "name", type_hint: "text" },
];

const rows: QueryValue[][] = [
  [
    { kind: "int", value: 1 },
    { kind: "text", value: "alice" },
  ],
  [
    { kind: "int", value: 2 },
    { kind: "null" },
  ],
];

describe("findVisibleMatches", () => {
  const visibleRows: VisibleResultRow[] = [
    { originalIndex: 0, row: [{ kind: "int", value: 100 }, { kind: "text", value: "Alice" }] },
    { originalIndex: 1, row: [{ kind: "int", value: 101 }, { kind: "text", value: "alice corp" }] },
    { originalIndex: 2, row: [{ kind: "int", value: 102 }, { kind: "text", value: "Bob" }] },
  ];

  it("matches cells case-insensitively in reading order", () => {
    expect(findVisibleMatches(visibleRows, "alice")).toEqual([
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ]);
  });

  it("matches across columns including numbers", () => {
    // "10" appears in 100, 101, 102.
    expect(findVisibleMatches(visibleRows, "10")).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 2, col: 0 },
    ]);
  });

  it("returns nothing for an empty/whitespace query", () => {
    expect(findVisibleMatches(visibleRows, "")).toEqual([]);
    expect(findVisibleMatches(visibleRows, "   ")).toEqual([]);
  });

  it("returns nothing when there is no match", () => {
    expect(findVisibleMatches(visibleRows, "zzz")).toEqual([]);
  });
});

describe("resultToCsv", () => {
  it("produces header + data rows", () => {
    const csv = resultToCsv(columns, rows);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,name");
    expect(lines[1]).toBe("1,alice");
    expect(lines[2]).toBe("2,");
  });

  it("escapes commas in values", () => {
    const csv = resultToCsv(columns, [
      [
        { kind: "int", value: 1 },
        { kind: "text", value: "a,b" },
      ],
    ]);
    expect(csv.split("\n")[1]).toBe('1,"a,b"');
  });

  it("escapes double quotes in values", () => {
    const csv = resultToCsv(columns, [
      [
        { kind: "int", value: 1 },
        { kind: "text", value: 'say "hello"' },
      ],
    ]);
    expect(csv.split("\n")[1]).toBe('1,"say ""hello"""');
  });

  it("escapes newlines in values", () => {
    const csv = resultToCsv(columns, [
      [
        { kind: "int", value: 1 },
        { kind: "text", value: "line1\nline2" },
      ],
    ]);
    expect(csv.split("\n")[1]).toBe('1,"line1');
  });

  it("handles empty rows", () => {
    const csv = resultToCsv(columns, []);
    expect(csv).toBe("id,name");
  });

  it("handles boolean values", () => {
    const boolCols: ColumnSpec[] = [{ name: "active", type_hint: "bool" }];
    const csv = resultToCsv(boolCols, [
      [{ kind: "bool", value: true }],
      [{ kind: "bool", value: false }],
    ]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("true");
    expect(lines[2]).toBe("false");
  });

  it("escapes column names containing commas", () => {
    const cols: ColumnSpec[] = [{ name: "a,b", type_hint: "text" }];
    const csv = resultToCsv(cols, []);
    expect(csv).toBe('"a,b"');
  });
});

describe("resultToJson", () => {
  it("produces array of objects with column names as keys", () => {
    const json = resultToJson(columns, rows);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([
      { id: 1, name: "alice" },
      { id: 2, name: null },
    ]);
  });

  it("returns empty array for no rows", () => {
    const json = resultToJson(columns, []);
    expect(JSON.parse(json)).toEqual([]);
  });

  it("preserves boolean values", () => {
    const boolCols: ColumnSpec[] = [{ name: "flag", type_hint: "bool" }];
    const json = resultToJson(boolCols, [[{ kind: "bool", value: true }]]);
    expect(JSON.parse(json)).toEqual([{ flag: true }]);
  });

  it("handles undefined cell value as null", () => {
    const json = resultToJson(columns, [[{ kind: "int", value: 1 }, { kind: "text" }]]);
    const parsed = JSON.parse(json);
    expect(parsed[0].name).toBeNull();
  });
});

describe("typeChipMeta", () => {
  it("uppercases the engine-native label and preserves params", () => {
    expect(typeChipMeta("int4").label).toBe("INT4");
    expect(typeChipMeta("varchar").label).toBe("VARCHAR");
    expect(typeChipMeta("numeric(12,2)").label).toBe("NUMERIC(12,2)");
    expect(typeChipMeta("varchar(255)").label).toBe("VARCHAR(255)");
  });

  it("classifies integer families (incl. DuckDB native + unsigned names)", () => {
    for (const t of [
      "int2", "int4", "int8", "int", "bigint", "smallint", "tinyint", "serial",
      "integer", "hugeint", "ubigint", "uinteger", "usmallint", "utinyint",
    ]) {
      expect(typeChipMeta(t).family).toBe("int");
    }
  });

  it("classifies string families (incl. char/text substrings)", () => {
    for (const t of ["varchar", "varchar(255)", "text", "char", "bpchar", "citext", "name"]) {
      expect(typeChipMeta(t).family).toBe("string");
    }
  });

  it("classifies numeric/decimal families", () => {
    for (const t of ["numeric", "numeric(12,2)", "decimal", "float4", "float8", "double", "real", "money"]) {
      expect(typeChipMeta(t).family).toBe("numeric");
    }
  });

  it("classifies boolean", () => {
    expect(typeChipMeta("bool").family).toBe("bool");
    expect(typeChipMeta("boolean").family).toBe("bool");
  });

  it("classifies json", () => {
    expect(typeChipMeta("json").family).toBe("json");
    expect(typeChipMeta("jsonb").family).toBe("json");
  });

  it("classifies temporal families (incl. 'with time zone' suffix)", () => {
    for (const t of ["timestamp", "timestamptz", "timestamp with time zone", "date", "time", "datetime", "interval"]) {
      expect(typeChipMeta(t).family).toBe("temporal");
    }
  });

  it("classifies binary and uuid", () => {
    expect(typeChipMeta("bytea").family).toBe("binary");
    expect(typeChipMeta("blob").family).toBe("binary");
    expect(typeChipMeta("uuid").family).toBe("uuid");
  });

  it("falls back to 'other' for unknown types", () => {
    expect(typeChipMeta("geography").family).toBe("other");
    expect(typeChipMeta("").family).toBe("other");
  });
});

describe("extractIpcError", () => {
  it("reads code + message from a structured IPC error", () => {
    const err = extractIpcError({ code: "serialization", message: "bad value" });
    expect(err.code).toBe("serialization");
    expect(err.message).toBe("bad value");
  });

  it("reads message from an Error instance", () => {
    expect(extractIpcError(new Error("boom")).message).toBe("boom");
  });

  it("never returns '[object Object]' for an opaque object", () => {
    const err = extractIpcError({ detail: "permission denied", status: 403 });
    expect(err.message).not.toBe("[object Object]");
    expect(err.message).toContain("permission denied");
  });

  it("passes a string through unchanged", () => {
    expect(extractIpcError("plain failure").message).toBe("plain failure");
  });
});

describe("copyTextForSelectedCell", () => {
  const cols: ColumnSpec[] = [
    { name: "id", type_hint: "int" },
    { name: "name", type_hint: "text" },
    { name: "active", type_hint: "bool" },
  ];
  const visibleRows: VisibleResultRow[] = [
    {
      originalIndex: 7,
      row: [
        { kind: "int", value: 1 },
        { kind: "text", value: "alice" },
        { kind: "bool", value: true },
      ],
    },
    {
      originalIndex: 8,
      row: [
        { kind: "int", value: 2 },
        { kind: "null" },
        { kind: "bool", value: false },
      ],
    },
  ];
  const noEdits: Record<string, { next: QueryValue }> = {};
  const noStaged = new Set<string>();

  it("returns the selected cell's text", () => {
    expect(
      copyTextForSelectedCell(visibleRows, cols, { row: 0, col: 1 }, noEdits, noStaged, "t1"),
    ).toBe("alice");
  });

  it("renders bool and null the same way CSV export does", () => {
    expect(
      copyTextForSelectedCell(visibleRows, cols, { row: 0, col: 2 }, noEdits, noStaged, "t1"),
    ).toBe("true");
    // NULL copies as empty string, matching cellToString / CSV.
    expect(
      copyTextForSelectedCell(visibleRows, cols, { row: 1, col: 1 }, noEdits, noStaged, "t1"),
    ).toBe("");
  });

  it("prefers a staged edit over the original value", () => {
    const stagedKey = "t1:7:name";
    const edits = { [stagedKey]: { next: { kind: "text", value: "ALICE" } as QueryValue } };
    const staged = new Set([stagedKey]);
    expect(
      copyTextForSelectedCell(visibleRows, cols, { row: 0, col: 1 }, edits, staged, "t1"),
    ).toBe("ALICE");
  });

  it("returns null when nothing is selected or the cell is out of range", () => {
    expect(copyTextForSelectedCell(visibleRows, cols, null, noEdits, noStaged, "t1")).toBeNull();
    expect(
      copyTextForSelectedCell(visibleRows, cols, { row: 9, col: 0 }, noEdits, noStaged, "t1"),
    ).toBeNull();
    expect(
      copyTextForSelectedCell(visibleRows, cols, { row: 0, col: 9 }, noEdits, noStaged, "t1"),
    ).toBeNull();
  });
});
