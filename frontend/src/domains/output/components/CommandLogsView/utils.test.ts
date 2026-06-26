import { describe, expect, it } from "vitest";
import {
  durationLabel,
  filterEntries,
  formatDuration,
  parseAnsi,
  stripAnsi,
} from "./utils";
import type { CommandLogEntry } from "../../types";

const ESC = "";

function entry(overrides: Partial<CommandLogEntry>): CommandLogEntry {
  return {
    id: "e1",
    kind: "dbt",
    command: "dbt run --select stg_customers",
    status: "success",
    startedAt: 1000,
    rawOutput: "",
    nodes: [],
    ...overrides,
  };
}

describe("formatDuration", () => {
  it("renders sub-second durations in milliseconds", () => {
    expect(formatDuration(800)).toBe("800 ms");
  });
  it("renders durations over a second with one decimal", () => {
    expect(formatDuration(1200)).toBe("1.2s");
  });
});

describe("durationLabel", () => {
  it("is empty while running", () => {
    expect(durationLabel(entry({ status: "running" }))).toBe("");
  });
  it("prefers the runner-reported durationMs", () => {
    expect(durationLabel(entry({ durationMs: 2400, endedAt: 9999 }))).toBe("2.4s");
  });
  it("falls back to endedAt - startedAt when durationMs is absent", () => {
    expect(durationLabel(entry({ startedAt: 1000, endedAt: 1900 }))).toBe("900 ms");
  });
});

describe("filterEntries", () => {
  const entries = [
    entry({ id: "a", command: "dbt run --select orders", status: "success" }),
    entry({ id: "b", command: "sqlmesh plan dev", status: "error", kind: "sqlmesh" }),
    entry({ id: "c", command: "select 1", status: "running", kind: "sql", rawOutput: "5 rows" }),
  ];

  it("returns all entries with no filter", () => {
    expect(filterEntries(entries, "", "all")).toHaveLength(3);
  });
  it("filters by status", () => {
    expect(filterEntries(entries, "", "error").map((e) => e.id)).toEqual(["b"]);
  });
  it("matches the command text case-insensitively", () => {
    expect(filterEntries(entries, "PLAN", "all").map((e) => e.id)).toEqual(["b"]);
  });
  it("matches against raw output too", () => {
    expect(filterEntries(entries, "rows", "all").map((e) => e.id)).toEqual(["c"]);
  });
  it("combines status and text filters", () => {
    expect(filterEntries(entries, "select", "running").map((e) => e.id)).toEqual(["c"]);
  });
});

describe("ansi helpers", () => {
  it("strips SGR escape codes", () => {
    expect(stripAnsi(`${ESC}[32mok${ESC}[0m`)).toBe("ok");
  });
  it("splits colored segments", () => {
    const segments = parseAnsi(`${ESC}[31merr${ESC}[0m done`);
    expect(segments[0]).toMatchObject({ text: "err" });
    expect(segments.map((s) => s.text).join("")).toBe("err done");
  });
});
