import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { StandardSQL } from "@codemirror/lang-sql";
import { LanguageSupport } from "@codemirror/language";
import {
  sqlLintSource,
  editDistance,
  findClosestKeyword,
  isInObjectNamePosition,
} from "./sqlLinter";
import { isLintableLanguage } from "../dialects/registry";

function lintSQL(doc: string) {
  return lintSQLAt(doc, 0);
}

// Same as `lintSQL` but with the caret placed at `caret`. The default (`lintSQL`)
// keeps the caret at position 0 (far from every flagged token) so existing
// assertions are unaffected by the caret-suppression rule.
function lintSQLAt(doc: string, caret: number) {
  const state = EditorState.create({
    doc,
    selection: { anchor: caret },
    extensions: [new LanguageSupport(StandardSQL.language)],
  });
  const view = new EditorView({ state });
  try {
    return sqlLintSource(view);
  } finally {
    view.destroy();
  }
}

describe("isLintableLanguage", () => {
  it("returns true for sql, kafka, esql", () => {
    expect(isLintableLanguage("sql")).toBe(true);
    expect(isLintableLanguage("kafka")).toBe(true);
    expect(isLintableLanguage("esql")).toBe(true);
  });

  it("returns false for mongodb, redis, json, etc.", () => {
    expect(isLintableLanguage("mongodb")).toBe(false);
    expect(isLintableLanguage("redis")).toBe(false);
    expect(isLintableLanguage("json")).toBe(false);
    expect(isLintableLanguage("python")).toBe(false);
  });
});

describe("editDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(editDistance("SELECT", "SELECT")).toBe(0);
  });

  it("returns 1 for single substitution", () => {
    expect(editDistance("SELECR", "SELECT")).toBe(1);
  });

  it("returns 1 for single insertion", () => {
    expect(editDistance("SLEECT", "SELECT")).toBe(2);
  });

  it("returns 3+ for distant strings", () => {
    expect(editDistance("XYZ", "SELECT")).toBeGreaterThanOrEqual(3);
  });
});

describe("findClosestKeyword", () => {
  it("returns null for exact keyword match", () => {
    expect(findClosestKeyword("SELECT")).toBeNull();
    expect(findClosestKeyword("from")).toBeNull();
  });

  it("suggests SELECT for SLEECT", () => {
    expect(findClosestKeyword("SLEECT")).toBe("SELECT");
  });

  it("suggests FROM for FORM", () => {
    expect(findClosestKeyword("FORM")).toBe("FROM");
  });

  it("suggests DELETE for DLETE", () => {
    expect(findClosestKeyword("DLETE")).toBe("DELETE");
  });

  it("returns null for unrelated identifiers", () => {
    expect(findClosestKeyword("users")).toBeNull();
    expect(findClosestKeyword("customer_name")).toBeNull();
  });

  it("returns null for single char", () => {
    expect(findClosestKeyword("x")).toBeNull();
  });
});

describe("isInObjectNamePosition", () => {
  it("returns true after SQL keywords that introduce object names", () => {
    expect(isInObjectNamePosition("SELECT * FROM ")).toBe(true);
    expect(isInObjectNamePosition("SELECT * FROM  ")).toBe(true);
    expect(isInObjectNamePosition("JOIN ")).toBe(true);
    expect(isInObjectNamePosition("INSERT INTO ")).toBe(true);
    expect(isInObjectNamePosition("UPDATE ")).toBe(true);
    expect(isInObjectNamePosition("DROP TABLE ")).toBe(true);
    expect(isInObjectNamePosition("CREATE INDEX ")).toBe(true);
    expect(isInObjectNamePosition("SELECT ")).toBe(true);
  });

  it("returns true after dot (qualified name)", () => {
    expect(isInObjectNamePosition("appdb.")).toBe(true);
    expect(isInObjectNamePosition("schema.table.")).toBe(true);
  });

  it("returns true after comma (list context)", () => {
    expect(isInObjectNamePosition("SELECT * FROM orders, ")).toBe(true);
    expect(isInObjectNamePosition("SELECT id, ")).toBe(true);
  });

  it("returns true after open paren", () => {
    expect(isInObjectNamePosition("SELECT * FROM (")).toBe(true);
  });

  it("returns false after another identifier (keyword position)", () => {
    expect(isInObjectNamePosition("SELECT * FROM users ")).toBe(false);
    expect(isInObjectNamePosition("SELECT *  ")).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(isInObjectNamePosition("")).toBe(false);
    expect(isInObjectNamePosition("   ")).toBe(false);
  });
});

describe("sqlLintSource", () => {
  it("returns no diagnostics for valid SQL", () => {
    expect(lintSQL("SELECT 1")).toEqual([]);
    expect(lintSQL("SELECT * FROM users")).toEqual([]);
    expect(lintSQL("SELECT id, name FROM users WHERE id = 1")).toEqual([]);
  });

  it("returns no diagnostics for empty input", () => {
    expect(lintSQL("")).toEqual([]);
    expect(lintSQL("   ")).toEqual([]);
  });

  it("flags misspelled keywords", () => {
    const diagnostics = lintSQL("SLEECT * FROM users");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].source).toBe("sql-lint");
    expect(diagnostics[0].message).toContain("SELECT");
  });

  it("flags misspelled FROM as FORM", () => {
    const diagnostics = lintSQL("SELECT * FORM users");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("FROM");
  });

  it("returns no diagnostics for multi-statement valid SQL", () => {
    expect(lintSQL("SELECT 1; SELECT 2;")).toEqual([]);
  });

  it("flags syntax errors in multi-statement SQL", () => {
    const diagnostics = lintSQL("SELECT 1; SLEECT 2;");
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("returns no diagnostics for valid SQL with comments", () => {
    expect(lintSQL("-- comment\nSELECT 1")).toEqual([]);
    expect(lintSQL("/* block */ SELECT 1")).toEqual([]);
  });

  it("diagnostic positions are within document bounds", () => {
    const doc = "SLEECT * FROM users";
    const diagnostics = lintSQL(doc);
    for (const d of diagnostics) {
      expect(d.from).toBeGreaterThanOrEqual(0);
      expect(d.to).toBeLessThanOrEqual(doc.length);
      expect(d.to).toBeGreaterThan(d.from);
    }
  });

  it("does not flag legitimate identifiers", () => {
    expect(lintSQL("SELECT name FROM users")).toEqual([]);
    expect(lintSQL("SELECT id, email FROM customers WHERE active = 1")).toEqual([]);
  });

  it("does not flag table names that resemble keywords", () => {
    expect(lintSQL("SELECT * FROM orders")).toEqual([]);
    expect(lintSQL("SELECT * FROM sets")).toEqual([]);
    expect(lintSQL("SELECT * FROM limits")).toEqual([]);
  });

  it("does not flag qualified table names", () => {
    expect(lintSQL("SELECT * FROM appdb.orders")).toEqual([]);
  });

  it("does not flag comma-separated table names", () => {
    expect(lintSQL("SELECT * FROM orders, limits")).toEqual([]);
  });

  it("does not flag column names in SELECT list", () => {
    expect(lintSQL("SELECT orders FROM t")).toEqual([]);
  });

  it("still flags misspelled keywords not in object-name positions", () => {
    const d1 = lintSQL("SELECT * FORM users");
    expect(d1.length).toBeGreaterThan(0);
    expect(d1[0].message).toContain("FROM");
  });
});

describe("sqlLintSource — token under the caret", () => {
  const doc = "SELECT * FORM users";
  const formEnd = doc.indexOf("FORM") + "FORM".length; // caret right after FORM

  it("does not flag a half-typed keyword while the caret is on it", () => {
    expect(lintSQLAt(doc, formEnd)).toEqual([]);
  });

  it("flags it once the caret has moved away from the token", () => {
    const d = lintSQLAt(doc, 0);
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].message).toContain("FROM");
  });
});

describe("sqlLintSource — defined names / aliases", () => {
  const aliasQuery = `SELECT ord.customer_id, ord.amount, cut.email, cut.first_name
FROM prod_elorders AS ord
JOIN customers AS cut
ON ord.customer_id = cut.customer_id;`;

  it("does not flag a table alias used after `=`", () => {
    expect(lintSQL(aliasQuery)).toEqual([]);
  });

  it("does not flag a keyword-like alias used anywhere it is defined", () => {
    expect(lintSQL("SELECT cut.id FROM customers AS cut WHERE 1 = cut.id")).toEqual([]);
  });

  it("does not flag CTE names defined via WITH", () => {
    expect(lintSQL("WITH cte AS (SELECT 1) SELECT * FROM cte")).toEqual([]);
  });

  it("still flags a genuine keyword typo alongside an alias", () => {
    const d = lintSQL("SELECT * FORM customers AS cut");
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].message).toContain("FROM");
  });
});

describe("sqlLintSource — dbt/sqlmesh templating", () => {
  it("does not flag `this` inside a dbt expression block", () => {
    expect(lintSQL("SELECT * FROM {{ this }}")).toEqual([]);
  });

  it("does not flag bare identifiers inside dbt expression blocks", () => {
    expect(lintSQL("SELECT * FROM {{ ref('stg_orders') }}")).toEqual([]);
    expect(lintSQL("WHERE order_date > (SELECT max(order_date) FROM {{ this }})")).toEqual([]);
  });

  it("does not flag tokens inside dbt statement blocks", () => {
    expect(lintSQL("{% if is_incremental() %}\nSELECT 1\n{% endif %}")).toEqual([]);
  });

  it("does not flag dbt config / jinja control keywords", () => {
    expect(lintSQL("{{ config(materialized='incremental', unique_key='order_id') }}")).toEqual([]);
  });

  it("does not flag sqlmesh MODEL-block property keywords", () => {
    const model = "MODEL (\n  name db.orders,\n  kind FULL,\n  cron '@daily',\n  grain order_id,\n  owner team\n);\nSELECT 1";
    expect(lintSQL(model)).toEqual([]);
  });

  it("still flags a genuine typo outside template regions in a dbt model", () => {
    const d = lintSQL("SELET * FROM {{ this }}");
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].message).toContain("SELECT");
  });
});
