import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { sql, StandardSQL } from "@codemirror/lang-sql";
import {
  detectClause,
  detectClauseFromTree,
  detectClauseRegex,
} from "./clauseDetection";
import { dialectFor } from "../sqlSchema";

function stateWith(doc: string) {
  return EditorState.create({ doc, extensions: [sql({ dialect: StandardSQL })] });
}

// Postgres dialect has SQLMESH model words (e.g. `name`) injected for highlighting,
// so a column named `name` tokenizes as a Keyword, reproducing the soft-keyword case.
function statePostgres(doc: string) {
  return EditorState.create({ doc, extensions: [sql({ dialect: dialectFor("postgres") })] });
}

function statePlain(doc: string) {
  return EditorState.create({ doc });
}

describe("detectClauseFromTree", () => {
  it("returns 'from' after FROM keyword", () => {
    const s = stateWith("SELECT * FROM ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("from");
  });

  it("returns 'from' after JOIN keyword", () => {
    const s = stateWith("SELECT * FROM users JOIN ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("from");
  });

  it("returns 'keyword' after a completed FROM table reference", () => {
    const s = stateWith("SELECT * FROM users ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("keyword");
  });

  it("returns 'keyword' when typing GROUP BY after a FROM table on a new line", () => {
    const doc = "SELECT sale_date, SUM(quantity)\nFROM public.sales_transactions\nGROU";
    const s = stateWith(doc);
    // detectClause is called at CodeMirror's word.from, the start of "GROU".
    const pos = doc.length - "GROU".length;
    expect(detectClauseFromTree(s, pos)).toBe("keyword");
  });

  it("returns 'keyword' after a completed JOIN table reference", () => {
    const s = stateWith("SELECT * FROM users JOIN orders ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("keyword");
  });

  it("stays in 'from' after a trailing comma in a FROM table list", () => {
    const s = stateWith("SELECT * FROM a, ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("from");
  });

  it("returns 'column' after SELECT keyword", () => {
    const s = stateWith("SELECT ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("column");
  });

  it("stays in 'column' when a prior column is named after an injected soft keyword", () => {
    // `name` is a SQLMESH model word injected into the Postgres dialect, so it
    // tokenizes as a Keyword; it must not be mistaken for a clause boundary.
    const s = statePostgres("SELECT name, creat");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("column");
  });

  it("still detects FROM after a soft-keyword column", () => {
    const s = statePostgres("SELECT name FROM ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("from");
  });

  it("returns 'column' after WHERE keyword", () => {
    const s = stateWith("SELECT * FROM users WHERE ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("column");
  });

  it("returns 'column' after AND keyword", () => {
    const s = stateWith("SELECT * FROM t WHERE a = 1 AND ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("column");
  });

  it("returns 'column' after GROUP BY", () => {
    const s = stateWith("SELECT * FROM t GROUP BY ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("column");
  });

  it("returns 'column' after ORDER BY", () => {
    const s = stateWith("SELECT * FROM t ORDER BY ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("column");
  });

  it("returns 'keyword' at start of empty document", () => {
    const s = stateWith("");
    expect(detectClauseFromTree(s, 0)).toBe("keyword");
  });

  it("returns 'keyword' after semicolon", () => {
    const s = stateWith("SELECT 1; ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("keyword");
  });

  it("returns 'insert-columns' inside INSERT INTO table parens", () => {
    const s = stateWith("INSERT INTO users (");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("insert-columns");
  });

  it("returns 'insert-columns' after comma in INSERT column list", () => {
    const s = stateWith("INSERT INTO users (id, ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("insert-columns");
  });

  it("returns 'values' inside VALUES parens", () => {
    const s = stateWith("INSERT INTO users (id) VALUES (");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("values");
  });

  it("returns 'values' after comma in VALUES list", () => {
    const s = stateWith("INSERT INTO users (id, name) VALUES (1, ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("values");
  });

  it("handles CTE body — returns 'from' after FROM inside WITH AS parens", () => {
    const s = stateWith("WITH cte AS (SELECT id FROM ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("from");
  });

  it("handles CTE body — returns 'column' after SELECT inside WITH AS parens", () => {
    const s = stateWith("WITH cte AS (SELECT ");
    expect(detectClauseFromTree(s, s.doc.length)).toBe("column");
  });

  it("returns null for state without language extension", () => {
    const s = statePlain("SELECT * FROM ");
    expect(detectClauseFromTree(s, s.doc.length)).toBeNull();
  });

  it("handles Jinja template in FROM clause", () => {
    const doc = 'SELECT id FROM {{ ref("stg_orders") }} WHERE ';
    const s = stateWith(doc);
    expect(detectClauseFromTree(s, s.doc.length)).toBe("column");
  });

  it("returns 'from' after FROM with Jinja coming next", () => {
    const doc = "SELECT * FROM ";
    const s = stateWith(doc);
    expect(detectClauseFromTree(s, s.doc.length)).toBe("from");
  });
});

describe("detectClauseRegex", () => {
  it("returns 'from' after FROM", () => {
    expect(detectClauseRegex("SELECT * FROM ", 14)).toBe("from");
  });

  it("returns 'from' after JOIN", () => {
    expect(detectClauseRegex("SELECT * FROM users JOIN ", 25)).toBe("from");
  });

  it("returns 'column' after SELECT", () => {
    expect(detectClauseRegex("SELECT ", 7)).toBe("column");
  });

  it("returns 'column' after WHERE", () => {
    expect(detectClauseRegex("SELECT * FROM t WHERE ", 22)).toBe("column");
  });

  it("returns 'column' after GROUP BY", () => {
    expect(detectClauseRegex("SELECT * FROM t GROUP BY ", 25)).toBe("column");
  });

  it("returns 'column' after comma", () => {
    expect(detectClauseRegex("SELECT a, ", 10)).toBe("column");
  });

  it("returns 'keyword' at empty text", () => {
    expect(detectClauseRegex("", 0)).toBe("keyword");
  });

  it("returns 'keyword' after semicolon", () => {
    expect(detectClauseRegex("SELECT 1; ", 10)).toBe("keyword");
  });

  it("returns 'insert-columns' inside INSERT INTO parens", () => {
    expect(detectClauseRegex("INSERT INTO users (", 19)).toBe("insert-columns");
  });

  it("returns 'insert-columns' after comma in INSERT column list", () => {
    expect(detectClauseRegex("INSERT INTO users (id, ", 23)).toBe("insert-columns");
  });

  it("returns 'values' inside VALUES parens", () => {
    expect(detectClauseRegex("INSERT INTO users (id) VALUES (", 31)).toBe("values");
  });

  it("returns 'values' after comma in VALUES list", () => {
    expect(detectClauseRegex("INSERT INTO users (id) VALUES (1, ", 34)).toBe("values");
  });

  it("returns 'keyword' for unknown context", () => {
    expect(detectClauseRegex("EXPLAIN ", 8)).toBe("keyword");
  });
});

describe("detectClause (integrated)", () => {
  it("uses tree when available, regex as fallback", () => {
    const withLang = stateWith("SELECT * FROM ");
    expect(detectClause(withLang, withLang.doc.length)).toBe("from");

    const withoutLang = statePlain("SELECT * FROM ");
    expect(detectClause(withoutLang, withoutLang.doc.length)).toBe("from");
  });

  it("handles INSERT INTO column list with both paths", () => {
    const withLang = stateWith("INSERT INTO users (id, ");
    expect(detectClause(withLang, withLang.doc.length)).toBe("insert-columns");

    const withoutLang = statePlain("INSERT INTO users (id, ");
    expect(detectClause(withoutLang, withoutLang.doc.length)).toBe("insert-columns");
  });

  it("returns 'keyword' at statement start with both paths", () => {
    const withLang = stateWith("SELECT 1; ");
    expect(detectClause(withLang, withLang.doc.length)).toBe("keyword");

    const withoutLang = statePlain("SELECT 1; ");
    expect(detectClause(withoutLang, withoutLang.doc.length)).toBe("keyword");
  });
});

describe("detectClause with dbt Jinja templating", () => {
  // The Lezer SQL parser cannot understand {{ ... }} macros, so the syntax-tree
  // detector misreports `keyword` mid column list. detectClause must fall back
  // to the regex detector so column completions still fire in dbt models.
  const dbtDoc =
    "{{ config(materialized='view') }}\n\nSELECT\n    id AS order_id,\n    status\nFROM {{ source('public', 'raw_orders') }}";

  it("detects 'column' at the start of a new column line (after a comma)", () => {
    const s = stateWith(dbtDoc);
    // detectClause is called at the START of the word being typed (CodeMirror's
    // word.from), i.e. just after the previous line's trailing comma.
    const pos = dbtDoc.indexOf("    status") + 4;
    expect(detectClause(s, pos)).toBe("column");
  });

  it("detects 'column' for the first column right after SELECT", () => {
    const s = stateWith(dbtDoc);
    const pos = dbtDoc.indexOf("    id AS") + 4;
    expect(detectClause(s, pos)).toBe("column");
  });

  it("detects 'from' immediately after a bare FROM keyword", () => {
    const doc = "{{ config(materialized='view') }}\n\nSELECT id\nFROM ";
    const s = stateWith(doc);
    expect(detectClause(s, doc.length)).toBe("from");
  });
});
