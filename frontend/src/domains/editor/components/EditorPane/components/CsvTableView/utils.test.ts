import { describe, it, expect } from "vitest";
import { parseCsv, unparseCsv, updateCell, addRow, deleteRow, updateHeader } from "./utils";

describe("parseCsv", () => {
  it("parses basic CSV", () => {
    const result = parseCsv("name,age\nAlice,30\nBob,25\n");
    expect(result.headers).toEqual(["name", "age"]);
    expect(result.rows).toEqual([["Alice", "30"], ["Bob", "25"]]);
    expect(result.lineEnding).toBe("\n");
    expect(result.trailingNewline).toBe(true);
  });

  it("parses quoted fields with commas", () => {
    const result = parseCsv('name,address\nAlice,"123 Main St, Apt 4"\n');
    expect(result.rows[0]).toEqual(["Alice", "123 Main St, Apt 4"]);
  });

  it("parses escaped quotes", () => {
    const result = parseCsv('name,quote\nAlice,"say ""hello"""\n');
    expect(result.rows[0]).toEqual(["Alice", 'say "hello"']);
  });

  it("parses quoted fields with newlines", () => {
    const result = parseCsv('name,bio\nAlice,"line1\nline2"\n');
    expect(result.rows[0]).toEqual(["Alice", "line1\nline2"]);
  });

  it("handles empty file", () => {
    const result = parseCsv("");
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("handles header-only file", () => {
    const result = parseCsv("name,age\n");
    expect(result.headers).toEqual(["name", "age"]);
    expect(result.rows).toEqual([]);
  });

  it("handles no trailing newline", () => {
    const result = parseCsv("name,age\nAlice,30");
    expect(result.trailingNewline).toBe(false);
    expect(result.rows).toEqual([["Alice", "30"]]);
  });

  it("detects CRLF line endings", () => {
    const result = parseCsv("name,age\r\nAlice,30\r\n");
    expect(result.lineEnding).toBe("\r\n");
    expect(result.rows).toEqual([["Alice", "30"]]);
  });

  it("handles empty fields", () => {
    const result = parseCsv("a,b,c\n1,,3\n");
    expect(result.rows[0]).toEqual(["1", "", "3"]);
  });
});

describe("unparseCsv", () => {
  it("round-trips basic CSV", () => {
    const input = "name,age\nAlice,30\nBob,25\n";
    const data = parseCsv(input);
    expect(unparseCsv(data)).toBe(input);
  });

  it("auto-quotes fields with commas", () => {
    const data = {
      headers: ["name", "address"],
      rows: [["Alice", "123 Main, Apt 4"]],
      lineEnding: "\n" as const,
      trailingNewline: true,
    };
    const csv = unparseCsv(data);
    expect(csv).toBe('name,address\nAlice,"123 Main, Apt 4"\n');
  });

  it("auto-quotes fields with quotes", () => {
    const data = {
      headers: ["name", "quote"],
      rows: [["Alice", 'say "hello"']],
      lineEnding: "\n" as const,
      trailingNewline: true,
    };
    const csv = unparseCsv(data);
    expect(csv).toBe('name,quote\nAlice,"say ""hello"""\n');
  });

  it("preserves CRLF line endings", () => {
    const input = "name,age\r\nAlice,30\r\n";
    const data = parseCsv(input);
    expect(unparseCsv(data)).toBe(input);
  });

  it("preserves no trailing newline", () => {
    const input = "name,age\nAlice,30";
    const data = parseCsv(input);
    expect(unparseCsv(data)).toBe(input);
  });

  it("handles empty data", () => {
    const data = {
      headers: [],
      rows: [],
      lineEnding: "\n" as const,
      trailingNewline: false,
    };
    expect(unparseCsv(data)).toBe("");
  });
});

describe("updateCell", () => {
  it("updates a single cell", () => {
    const data = parseCsv("name,age\nAlice,30\nBob,25\n");
    const updated = updateCell(data, 0, 1, "31");
    expect(updated.rows[0]).toEqual(["Alice", "31"]);
    expect(updated.rows[1]).toEqual(["Bob", "25"]);
  });

  it("produces correct CSV after cell update", () => {
    const data = parseCsv("name,age\nAlice,30\n");
    const updated = updateCell(data, 0, 0, "Carol");
    expect(unparseCsv(updated)).toBe("name,age\nCarol,30\n");
  });
});

describe("addRow", () => {
  it("appends an empty row", () => {
    const data = parseCsv("name,age\nAlice,30\n");
    const updated = addRow(data);
    expect(updated.rows).toEqual([["Alice", "30"], ["", ""]]);
  });
});

describe("deleteRow", () => {
  it("removes a row by index", () => {
    const data = parseCsv("name,age\nAlice,30\nBob,25\n");
    const updated = deleteRow(data, 0);
    expect(updated.rows).toEqual([["Bob", "25"]]);
  });
});

describe("updateHeader", () => {
  it("renames a header", () => {
    const data = parseCsv("name,age\nAlice,30\n");
    const updated = updateHeader(data, 1, "years");
    expect(updated.headers).toEqual(["name", "years"]);
    expect(unparseCsv(updated)).toBe("name,years\nAlice,30\n");
  });
});
