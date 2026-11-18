import { describe, expect, it } from "vitest";
import {
  filterRuns,
  firstSqlLine,
  formatDuration,
  formatRelativeTime,
} from "./utils";
import type { RunRecord } from "./types";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("history utils", () => {
  it("formats duration and relative time", () => {
    expect(formatDuration(undefined)).toBe("-");
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(119_600)).toBe("2m 0s");
    expect(formatDuration(999.6)).toBe("1.0 s");
    expect(formatDuration(59_960)).toBe("1m 0s");
    expect(formatRelativeTime(ago(10_000), NOW)).toBe("just now");
    expect(formatRelativeTime(ago(5 * 60_000), NOW)).toBe("5m ago");
    expect(formatRelativeTime(ago(3 * 3_600_000), NOW)).toBe("3h ago");
    expect(formatRelativeTime(ago(2 * 86_400_000), NOW)).toBe("2d ago");
  });

  it("takes the first non-empty sql line", () => {
    expect(firstSqlLine("\n  select 1\nfrom t")).toBe("select 1");
  });

  it("filters by sql and connection name, case-insensitively", () => {
    const run = (id: string, sql: string, connectionId: string) =>
      ({ id, sql, connectionId }) as RunRecord;
    const runs = [run("a", "select 1", "c1"), run("b", "delete from t", "c2")];
    const name = (id: string) => (id === "c1" ? "Warehouse" : "other");
    expect(filterRuns(runs, "", name)).toHaveLength(2);
    expect(filterRuns(runs, "DELETE", name).map((r) => r.id)).toEqual(["b"]);
    expect(filterRuns(runs, "warehouse", name).map((r) => r.id)).toEqual(["a"]);
  });
});
