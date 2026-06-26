import { describe, it, expect } from "vitest";
import { Language } from "@codemirror/language";

import {
  editorCompletionExtensions,
  editorLanguageExtensions,
  hasStatementHighlight,
  isLintableLanguage,
  isSqlLikeLanguage,
  resolveDialect,
} from "./registry";
import { markdownFencedLanguage } from "./files/staticLanguages";

describe("resolveDialect", () => {
  it("routes a sql buffer to its connection-kind dialect", () => {
    expect(resolveDialect({ languageId: "sql", connectionKind: "postgres" }).id).toBe("postgres");
    expect(resolveDialect({ languageId: "sql", connectionKind: "mysql" }).id).toBe("mysql");
    expect(resolveDialect({ languageId: "sql", connectionKind: "snowflake" }).id).toBe("snowflake");
    expect(resolveDialect({ languageId: "sql", connectionKind: "duckdb" }).id).toBe("duckdb");
  });

  it("falls back to the generic sql dialect when no connection kind owns the buffer", () => {
    expect(resolveDialect({ languageId: "sql" }).id).toBe("sql");
  });

  it("routes connection-specific language ids to their own dialect", () => {
    expect(resolveDialect({ languageId: "kafka" }).id).toBe("kafka");
    expect(resolveDialect({ languageId: "elasticsearch" }).id).toBe("elasticsearch");
    expect(resolveDialect({ languageId: "esql" }).id).toBe("esql");
    expect(resolveDialect({ languageId: "esrest" }).id).toBe("esrest");
    expect(resolveDialect({ languageId: "redis" }).id).toBe("redis");
    expect(resolveDialect({ languageId: "rediscli" }).id).toBe("rediscli");
    expect(resolveDialect({ languageId: "mongodb" }).id).toBe("mongodb");
    expect(resolveDialect({ languageId: "mongoshell" }).id).toBe("mongoshell");
  });

  it("routes file languages and falls back to plain text", () => {
    expect(resolveDialect({ languageId: "json" }).id).toBe("json");
    expect(resolveDialect({ languageId: "yaml" }).id).toBe("yaml");
    expect(resolveDialect({ languageId: "markdown" }).id).toBe("markdown");
    expect(resolveDialect({ languageId: "brainfuck" }).id).toBe("plaintext");
  });
});

describe("editorLanguageExtensions", () => {
  it("produces a grammar for known languages", () => {
    for (const languageId of ["sql", "json", "yaml", "markdown", "python", "mongoshell", "esrest", "rediscli"]) {
      expect(editorLanguageExtensions({ languageId }).length).toBeGreaterThan(0);
    }
  });

  it("produces no grammar for esql or unknown languages", () => {
    expect(editorLanguageExtensions({ languageId: "esql" })).toHaveLength(0);
    expect(editorLanguageExtensions({ languageId: "brainfuck" })).toHaveLength(0);
  });
});

describe("editorCompletionExtensions", () => {
  it("suppresses completion in read-only buffers", () => {
    expect(editorCompletionExtensions({ languageId: "sql", readOnly: true })).toHaveLength(0);
  });

  it("contributes completion for sql buffers", () => {
    expect(editorCompletionExtensions({ languageId: "sql" }).length).toBeGreaterThan(0);
  });
});

describe("sqlLike / statementHighlight", () => {
  it("marks sql-family languages as sql-like", () => {
    for (const languageId of ["sql", "kafka", "elasticsearch", "redis", "mongodb"]) {
      expect(isSqlLikeLanguage(languageId)).toBe(true);
      expect(hasStatementHighlight(languageId)).toBe(true);
    }
  });

  it("does not mark native or file languages as sql-like", () => {
    for (const languageId of ["rediscli", "esrest", "mongoshell", "json", "esql"]) {
      expect(isSqlLikeLanguage(languageId)).toBe(false);
      expect(hasStatementHighlight(languageId)).toBe(false);
    }
  });
});

describe("isLintableLanguage", () => {
  it("lints sql-engine languages and nothing else", () => {
    expect(isLintableLanguage("sql")).toBe(true);
    expect(isLintableLanguage("kafka")).toBe(true);
    expect(isLintableLanguage("esql")).toBe(true);
    expect(isLintableLanguage("redis")).toBe(false);
    expect(isLintableLanguage("mongodb")).toBe(false);
    expect(isLintableLanguage("json")).toBe(false);
  });
});

describe("markdownFencedLanguage", () => {
  it("resolves known fence info strings to a Language", () => {
    for (const info of ["sql", "json", "yaml", "python", "javascript", "typescript", "html", "xml", "bash", "dockerfile", "toml"]) {
      expect(markdownFencedLanguage(info)).toBeInstanceOf(Language);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(markdownFencedLanguage("  Python ")).toBeInstanceOf(Language);
    expect(markdownFencedLanguage("SQL")).toBeInstanceOf(Language);
  });

  it("returns null for unknown fences", () => {
    expect(markdownFencedLanguage("brainfuck")).toBeNull();
    expect(markdownFencedLanguage("")).toBeNull();
  });
});
