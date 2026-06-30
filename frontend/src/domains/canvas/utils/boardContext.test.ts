import { describe, expect, it } from "vitest";

import { makeComponent } from "./factory";
import { describeBoard } from "./boardContext";

describe("describeBoard", () => {
  it("is empty for an empty board", () => {
    expect(describeBoard([])).toBe("");
  });

  it("lists each object id-first so the agent can reference it", () => {
    const out = describeBoard([
      makeComponent({ kind: "query", id: "q1", title: "Monthly sales", sql: "select 1", z: 0 }),
      makeComponent({
        kind: "chart",
        id: "c1",
        sourceQueryId: "q1",
        spec: { kind: "line", xColumn: "month", yColumns: ["total"], seriesColumn: "cat" },
        z: 1,
      }),
      makeComponent({ kind: "sticky", id: "s1", text: "note", color: "green", z: 2 }),
    ]);
    expect(out).toContain("query id=q1");
    expect(out).toContain('title="Monthly sales"');
    expect(out).toContain("chart id=c1 source=q1 kind=line x=month y=[total] series=cat");
    expect(out).toContain("sticky id=s1 color=green");
  });

  it("orders objects by z and collapses long sql to one clipped line", () => {
    const longSql = "select " + "x,".repeat(80) + "1";
    const out = describeBoard([
      makeComponent({ kind: "text", id: "t1", text: "top", z: 5 }),
      makeComponent({ kind: "query", id: "q1", sql: longSql, z: 1 }),
    ]);
    const lines = out.split("\n");
    // z-order: q1 (z=1) before t1 (z=5); the long sql is clipped onto one line.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("query id=q1");
    expect(lines[0]).toContain("…");
    expect(lines[1]).toContain("text id=t1");
  });
});
