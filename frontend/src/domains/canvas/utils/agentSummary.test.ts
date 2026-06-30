import { describe, expect, it } from "vitest";

import type { AgentCanvasSpec } from "../types";
import { makeComponent } from "./factory";
import { summarizeAgentChanges } from "./agentSummary";

const spec = (partial: Partial<AgentCanvasSpec>): AgentCanvasSpec => ({
  components: [],
  ...partial,
});

describe("summarizeAgentChanges", () => {
  it("names each added object by kind, a query by title and a chart by its type", () => {
    const out = summarizeAgentChanges(
      spec({
        components: [
          { kind: "query", id: "q1", title: "Monthly sales" },
          { kind: "chart", id: "c1", sourceQueryId: "q1", spec: { kind: "bar" } as never },
          { kind: "text", id: "t1", text: "## Heading" },
        ],
      }),
      [],
    );
    expect(out).toBe('Added query "Monthly sales", bar chart, and text note.');
  });

  it("reads an emitted id already on the board as an update, borrowing its title", () => {
    const before = [
      makeComponent({ kind: "query", id: "q1", sql: "select 1", title: "Sales", connectionId: "c" }),
    ];
    // The agent re-emits q1 with only new sql (no title): it is an update, and the
    // title comes from the existing cell.
    const out = summarizeAgentChanges(
      spec({ components: [{ kind: "query", id: "q1", sql: "select 2" }] }),
      before,
    );
    expect(out).toBe('Updated query "Sales".');
  });

  it("counts removals and combines add + remove in one line", () => {
    const before = [
      makeComponent({ kind: "query", id: "q1", sql: "s", connectionId: "c" }),
      makeComponent({ kind: "text", id: "t1", text: "x" }),
    ];
    const out = summarizeAgentChanges(
      spec({
        components: [{ kind: "sticky", id: "s1", text: "note" }],
        remove: ["q1", "t1"],
      }),
      before,
    );
    expect(out).toBe("Added sticky note · Removed 2 objects.");
  });

  it("ignores removal ids that are not on the board", () => {
    const out = summarizeAgentChanges(spec({ remove: ["ghost"] }), []);
    expect(out).toBe("No board changes.");
  });

  it("falls back to a bare noun when a query has no title and a chart no kind", () => {
    const out = summarizeAgentChanges(
      spec({
        components: [
          { kind: "query", id: "q1" },
          { kind: "chart", id: "c1", sourceQueryId: "q1" },
        ],
      }),
      [],
    );
    expect(out).toBe("Added query and chart.");
  });
});
