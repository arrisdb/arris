import { describe, it, expect } from "vitest";
import {
  detectSqlMeshFromJoin,
  buildSqlMeshFromJoinCompletions,
  type SqlMeshModelEntry,
} from "./sqlmeshRefs";

describe("detectSqlMeshFromJoin", () => {
  it("detects FROM context", () => {
    const text = "SELECT * FROM app";
    const ctx = detectSqlMeshFromJoin(text, text.length);
    expect(ctx).toEqual({ prefix: "app", from: 14 });
  });

  it("detects JOIN context", () => {
    const text = "SELECT * FROM a JOIN b";
    const ctx = detectSqlMeshFromJoin(text, text.length);
    expect(ctx).toEqual({ prefix: "b", from: 21 });
  });

  it("detects case-insensitive from", () => {
    const text = "select * from ord";
    const ctx = detectSqlMeshFromJoin(text, text.length);
    expect(ctx).toEqual({ prefix: "ord", from: 14 });
  });

  it("returns null for no context", () => {
    const text = "SELECT col1, col2";
    expect(detectSqlMeshFromJoin(text, text.length)).toBeNull();
  });

  it("detects empty prefix after FROM", () => {
    const text = "SELECT * FROM ";
    const ctx = detectSqlMeshFromJoin(text, text.length);
    expect(ctx).toEqual({ prefix: "", from: 14 });
  });
});

describe("buildSqlMeshFromJoinCompletions", () => {
  const models: SqlMeshModelEntry[] = [
    { name: "app.orders" },
    { name: "app.users" },
    { name: "raw.events" },
  ];

  it("returns matching models", () => {
    const completions = buildSqlMeshFromJoinCompletions(models, "app");
    expect(completions).toHaveLength(2);
    expect(completions[0].label).toBe("app.orders");
    expect(completions[1].label).toBe("app.users");
  });

  it("returns all models for empty prefix", () => {
    const completions = buildSqlMeshFromJoinCompletions(models, "");
    expect(completions).toHaveLength(3);
  });

  it("returns empty for no matches", () => {
    const completions = buildSqlMeshFromJoinCompletions(models, "xyz");
    expect(completions).toHaveLength(0);
  });

  it("matching is case-insensitive", () => {
    const completions = buildSqlMeshFromJoinCompletions(models, "APP");
    expect(completions).toHaveLength(2);
  });
});
