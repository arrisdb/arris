import { describe, it, expect } from "vitest";
import { findStatementAt } from "./statementHighlight";
import { findLineAt } from "./statementSplit";

describe("findLineAt", () => {
  it("returns null for blank input", () => {
    expect(findLineAt("", 0)).toBeNull();
    expect(findLineAt("   ", 1)).toBeNull();
  });

  it("returns the trimmed line range containing the cursor", () => {
    const doc = "SELECT 1\nHGETALL cache:stats";
    const pos = doc.indexOf("HGETALL") + 3;
    expect(findLineAt(doc, pos)).toEqual({
      from: doc.indexOf("HGETALL"),
      to: doc.length,
    });
  });

  it("isolates the first line when the cursor sits in it", () => {
    const doc = "SELECT 1\nHGETALL cache:stats";
    expect(findLineAt(doc, 2)).toEqual({ from: 0, to: 8 });
  });

  it("returns null on a blank line", () => {
    const doc = "GET a\n\nGET b";
    expect(findLineAt(doc, 6)).toBeNull();
  });
});

describe("findStatementAt", () => {
  it("returns null for empty input", () => {
    expect(findStatementAt("", 0)).toBeNull();
    expect(findStatementAt("   ", 0)).toBeNull();
  });

  it("detects a single statement without semicolon", () => {
    const doc = "SELECT * FROM users";
    expect(findStatementAt(doc, 0)).toEqual({ from: 0, to: 19 });
    expect(findStatementAt(doc, 10)).toEqual({ from: 0, to: 19 });
    expect(findStatementAt(doc, 19)).toEqual({ from: 0, to: 19 });
  });

  it("detects a single statement with semicolon", () => {
    const doc = "SELECT 1;";
    expect(findStatementAt(doc, 0)).toEqual({ from: 0, to: 9 });
    expect(findStatementAt(doc, 8)).toEqual({ from: 0, to: 9 });
  });

  it("detects correct statement among multiple", () => {
    const doc = "SELECT 1;\nSELECT 2;\nSELECT 3;";
    expect(findStatementAt(doc, 0)).toEqual({ from: 0, to: 9 });
    expect(findStatementAt(doc, 5)).toEqual({ from: 0, to: 9 });
    expect(findStatementAt(doc, 10)).toEqual({ from: 10, to: 19 });
    expect(findStatementAt(doc, 15)).toEqual({ from: 10, to: 19 });
    expect(findStatementAt(doc, 20)).toEqual({ from: 20, to: 29 });
  });

  it("skips semicolons inside single-quoted strings", () => {
    const doc = "SELECT 'a;b' FROM t;";
    expect(findStatementAt(doc, 0)).toEqual({ from: 0, to: 20 });
  });

  it("skips semicolons inside double-quoted identifiers", () => {
    const doc = 'SELECT "col;name" FROM t;';
    expect(findStatementAt(doc, 0)).toEqual({ from: 0, to: 25 });
  });

  it("skips semicolons inside line comments", () => {
    const doc = "SELECT 1 -- ; comment\nFROM t;";
    expect(findStatementAt(doc, 0)).toEqual({ from: 0, to: 29 });
  });

  it("skips semicolons inside block comments", () => {
    const doc = "SELECT 1 /* ; */ FROM t;";
    expect(findStatementAt(doc, 0)).toEqual({ from: 0, to: 24 });
  });

  it("trims whitespace from statement boundaries", () => {
    const doc = "  SELECT 1;  \n  SELECT 2;  ";
    expect(findStatementAt(doc, 0)).toEqual({ from: 2, to: 11 });
    expect(findStatementAt(doc, 14)).toEqual({ from: 16, to: 25 });
  });

  it("handles escaped single quotes", () => {
    const doc = "SELECT 'it''s;fine' FROM t;";
    expect(findStatementAt(doc, 0)).toEqual({ from: 0, to: doc.length });
  });

  it("returns null when cursor is in whitespace-only segment", () => {
    const doc = "SELECT 1;\n\n\n";
    const result = findStatementAt(doc, 11);
    expect(result).toBeNull();
  });

  it("extracts correct statement text for multi-line federation queries", () => {
    const doc = [
      "SELECT",
      "    c.name,",
      "    COUNT(o.id) AS order_count",
      "FROM test_postgres.public.customers c",
      "JOIN test_mysql.appdb.orders o ON c.id = o.customer_id",
      "GROUP BY c.name",
      "ORDER BY order_count DESC;",
      "",
      "SELECT",
      "    c.name,",
      "    COUNT(o.id) AS order_count",
      "FROM test_postgres.public.customers c",
      "JOIN test_mysql.appdb.orders o ON c.id = o.customer_id",
      "GROUP BY c.name",
      "ORDER BY order_count ASC;",
    ].join("\n");

    const secondSelectPos = doc.indexOf("SELECT", doc.indexOf(";") + 1);
    const stmt = findStatementAt(doc, secondSelectPos)!;
    expect(stmt).not.toBeNull();
    const extracted = doc.slice(stmt.from, stmt.to).trim();
    expect(extracted).toContain("ORDER BY order_count ASC;");
    expect(extracted).not.toContain("DESC");
  });

  it("cursor in first statement does not include second statement", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    const stmt = findStatementAt(doc, 3)!;
    const extracted = doc.slice(stmt.from, stmt.to);
    expect(extracted).toBe("SELECT 1;");
  });

  it("cursor in second statement does not include first statement", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    const stmt = findStatementAt(doc, 13)!;
    const extracted = doc.slice(stmt.from, stmt.to);
    expect(extracted).toBe("SELECT 2;");
  });
});

// Field-level behavior: decorations render, and a caret move INSIDE the
// highlighted statement reuses the previous field value (no whole-document
// boundary rescan per arrow key), while crossing into another statement
// recomputes.
describe("statementHighlightField", () => {
  it("decorates the statement under the caret and reuses state within it", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { statementHighlight, statementHighlightField } = await import("./statementHighlight");
    const doc = "SELECT 1;\nSELECT 22;";
    let state = EditorState.create({
      doc,
      selection: { anchor: 2 },
      extensions: statementHighlight(),
    });
    const first = state.field(statementHighlightField);
    expect(first.range).toEqual({ from: 0, to: 9 });

    // Caret move within statement 1: same field value instance (skip path).
    state = state.update({ selection: { anchor: 5 } }).state;
    expect(state.field(statementHighlightField)).toBe(first);

    // Caret move into statement 2: recomputed range.
    state = state.update({ selection: { anchor: doc.indexOf("22") } }).state;
    const second = state.field(statementHighlightField);
    expect(second).not.toBe(first);
    expect(second.range).toEqual({ from: 10, to: doc.length });
  });

  it("recomputes on document edits", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { statementHighlight, statementHighlightField } = await import("./statementHighlight");
    let state = EditorState.create({
      doc: "SELECT 1",
      selection: { anchor: 8 },
      extensions: statementHighlight(),
    });
    const before = state.field(statementHighlightField);
    state = state.update({
      changes: { from: 8, to: 8, insert: "23" },
      selection: { anchor: 10 },
    }).state;
    const after = state.field(statementHighlightField);
    expect(after).not.toBe(before);
    expect(after.range).toEqual({ from: 0, to: 10 });
  });
});
