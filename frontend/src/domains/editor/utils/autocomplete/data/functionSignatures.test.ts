import { describe, it, expect } from "vitest";
import { findFunctionCallContext, signaturesForKind } from "./functionSignatures";

describe("findFunctionCallContext", () => {
  it("detects function name and first param", () => {
    const doc = "SELECT COUNT(";
    expect(findFunctionCallContext(doc, doc.length)).toEqual({
      funcName: "COUNT",
      paramIndex: 0,
      parenPos: 12,
    });
  });

  it("tracks parameter index via commas", () => {
    const doc = "SELECT COALESCE(a, ";
    expect(findFunctionCallContext(doc, doc.length)).toEqual({
      funcName: "COALESCE",
      paramIndex: 1,
      parenPos: 15,
    });
  });

  it("handles third parameter", () => {
    const doc = "SELECT SUBSTRING(str, 1, ";
    expect(findFunctionCallContext(doc, doc.length)).toEqual({
      funcName: "SUBSTRING",
      paramIndex: 2,
      parenPos: 16,
    });
  });

  it("returns null when not inside parens", () => {
    expect(findFunctionCallContext("SELECT ", 7)).toBeNull();
  });

  it("returns null when paren has no function name", () => {
    expect(findFunctionCallContext("(a, b", 5)).toBeNull();
  });

  it("handles nested parens", () => {
    const doc = "SELECT COALESCE(TRIM(x), ";
    expect(findFunctionCallContext(doc, doc.length)).toEqual({
      funcName: "COALESCE",
      paramIndex: 1,
      parenPos: 15,
    });
  });

  it("stops at semicolons", () => {
    expect(findFunctionCallContext("SELECT 1; COUNT(", 17)).toEqual({
      funcName: "COUNT",
      paramIndex: 0,
      parenPos: 15,
    });
  });
});

describe("signaturesForKind", () => {
  it("includes generic functions", () => {
    const sigs = signaturesForKind(undefined);
    expect(sigs.has("COUNT")).toBe(true);
    expect(sigs.has("COALESCE")).toBe(true);
  });

  it("includes postgres functions for postgres kind", () => {
    const sigs = signaturesForKind("postgres");
    expect(sigs.has("ARRAY_AGG")).toBe(true);
    expect(sigs.has("STRING_AGG")).toBe(true);
  });

  it("excludes postgres functions for other kinds", () => {
    const sigs = signaturesForKind("mysql");
    expect(sigs.has("ARRAY_AGG")).toBe(false);
  });
});
