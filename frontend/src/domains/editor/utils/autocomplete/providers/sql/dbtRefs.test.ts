import { describe, it, expect } from "vitest";
import {
  detectDbtContext,
  buildRefCompletions,
  buildSourceCompletions,
  buildTemplateCompletions,
  buildFromJoinCompletions,
} from "./dbtRefs";

const MODELS = [
  { name: "orders" },
  { name: "customers" },
  { name: "stg_orders" },
  { name: "stg_customers" },
];
const SOURCES = [
  { sourceName: "raw", tableName: "events" },
  { sourceName: "raw", tableName: "users" },
  { sourceName: "stripe", tableName: "payments" },
];

describe("detectDbtContext", () => {
  it("detects ref context", () => {
    const text = "SELECT * FROM {{ ref('";
    const ctx = detectDbtContext(text, text.length);
    expect(ctx).not.toBeNull();
    expect(ctx!.type).toBe("ref");
  });

  it("detects source first-arg context", () => {
    const text = "{{ source('";
    const ctx = detectDbtContext(text, text.length);
    expect(ctx).not.toBeNull();
    expect(ctx!.type).toBe("source-name");
  });

  it("detects source second-arg context", () => {
    const text = "{{ source('raw', '";
    const ctx = detectDbtContext(text, text.length);
    expect(ctx).not.toBeNull();
    expect(ctx!.type).toBe("source-table");
    expect(ctx!.sourceName).toBe("raw");
  });

  it("detects FROM keyword context", () => {
    const text = "SELECT * FROM ";
    const ctx = detectDbtContext(text, text.length);
    expect(ctx).not.toBeNull();
    expect(ctx!.type).toBe("from-join");
  });

  it("detects JOIN keyword context", () => {
    const text = "SELECT * FROM a JOIN ";
    const ctx = detectDbtContext(text, text.length);
    expect(ctx).not.toBeNull();
    expect(ctx!.type).toBe("from-join");
  });

  it("detects an expression-block template context for a bare identifier", () => {
    const text = "SELECT {{ cents_to";
    const ctx = detectDbtContext(text, text.length);
    expect(ctx).not.toBeNull();
    expect(ctx!.type).toBe("template");
    expect(ctx!.block).toBe("expression");
    expect(ctx!.prefix).toBe("cents_to");
  });

  it("detects a statement-block template context inside {% %}", () => {
    const text = "{% if is_incr";
    const ctx = detectDbtContext(text, text.length);
    expect(ctx).not.toBeNull();
    expect(ctx!.type).toBe("template");
    expect(ctx!.block).toBe("statement");
    expect(ctx!.prefix).toBe("is_incr");
  });

  it("detects a statement-block context for a closing keyword", () => {
    const text = "{% endi";
    const ctx = detectDbtContext(text, text.length);
    expect(ctx!.type).toBe("template");
    expect(ctx!.block).toBe("statement");
    expect(ctx!.prefix).toBe("endi");
  });

  it("does not treat a closed template block as a template context", () => {
    const text = "{% if is_incremental() %}\nSELECT ye";
    const ctx = detectDbtContext(text, text.length);
    expect(ctx?.type).not.toBe("template");
  });

  it("does not treat a completed source() call as a template context", () => {
    const text = "{{ source('raw', '";
    const ctx = detectDbtContext(text, text.length);
    expect(ctx!.type).toBe("source-table");
  });

  it("returns null outside any context", () => {
    const text = "SELECT 1";
    const ctx = detectDbtContext(text, text.length);
    expect(ctx).toBeNull();
  });
});

describe("buildTemplateCompletions", () => {
  it("returns user macros matching the prefix as functions", () => {
    const macros = [{ name: "cents_to_dollars" }, { name: "dollars_to_cents" }, { name: "grand_total" }];
    const completions = buildTemplateCompletions(macros, "cents", "expression");
    expect(completions.map((c) => c.label)).toContain("cents_to_dollars");
    expect(completions.find((c) => c.label === "cents_to_dollars")!.type).toBe("function");
  });

  it("offers built-in dbt variables matching the prefix", () => {
    const thisVar = buildTemplateCompletions([], "th", "expression").find((c) => c.label === "this");
    expect(thisVar).toBeDefined();
    expect(thisVar!.type).toBe("variable");
    expect(buildTemplateCompletions([], "tar", "expression").map((c) => c.label)).toContain("target");
  });

  it("offers built-in dbt functions in both expression and statement blocks", () => {
    expect(buildTemplateCompletions([], "is_", "expression").map((c) => c.label)).toContain("is_incremental");
    expect(buildTemplateCompletions([], "is_", "statement").map((c) => c.label)).toContain("is_incremental");
  });

  it("offers Jinja control keywords only in statement blocks", () => {
    expect(buildTemplateCompletions([], "endi", "statement").map((c) => c.label)).toContain("endif");
    expect(buildTemplateCompletions([], "fo", "statement").map((c) => c.label)).toContain("for");
    expect(buildTemplateCompletions([], "endi", "expression").map((c) => c.label)).not.toContain("endif");
  });

  it("includes both user macros and built-ins, user macro listed once", () => {
    const completions = buildTemplateCompletions([{ name: "config_helper" }], "config", "expression");
    const labels = completions.map((c) => c.label);
    expect(labels).toContain("config_helper");
    expect(labels).toContain("config");
    expect(labels.filter((l) => l === "config_helper")).toHaveLength(1);
  });
});

describe("buildRefCompletions", () => {
  it("returns models matching prefix", () => {
    const completions = buildRefCompletions(MODELS, "ord");
    expect(completions.length).toBeGreaterThanOrEqual(1);
    expect(completions[0].label).toBe("orders");
  });
});

describe("buildSourceCompletions", () => {
  it("source-name returns unique source names", () => {
    const completions = buildSourceCompletions(SOURCES, "source-name", undefined, "");
    const labels = completions.map((c) => c.label);
    expect(labels).toContain("raw");
    expect(labels).toContain("stripe");
  });

  it("source-table for 'raw' returns events and users but not payments", () => {
    const completions = buildSourceCompletions(SOURCES, "source-table", "raw", "");
    const labels = completions.map((c) => c.label);
    expect(labels).toContain("events");
    expect(labels).toContain("users");
    expect(labels).not.toContain("payments");
  });
});

describe("buildFromJoinCompletions", () => {
  it("models are wrapped in ref()", () => {
    const completions = buildFromJoinCompletions(MODELS, SOURCES, "");
    const ordersItem = completions.find((c) => c.label === "orders");
    expect(ordersItem).toBeDefined();
    expect(ordersItem!.apply).toContain("{{ ref('orders') }}");
  });

  it("sources are wrapped in source()", () => {
    const completions = buildFromJoinCompletions(MODELS, SOURCES, "");
    const rawEventsItem = completions.find((c) => c.label === "raw.events");
    expect(rawEventsItem).toBeDefined();
    expect(rawEventsItem!.apply).toContain("{{ source('raw', 'events') }}");
  });
});
