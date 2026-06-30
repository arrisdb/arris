import { describe, expect, it } from "vitest";

import type { AgentCanvasSpec } from "../types";
import { parseAgentCanvas, specToBoard } from "./agentSpec";

const wrap = (json: unknown) =>
  "Here is your canvas:\n```arris-canvas\n" + JSON.stringify(json) + "\n```\nDone.";

describe("parseAgentCanvas", () => {
  it("extracts the arris-canvas block", () => {
    const spec = parseAgentCanvas(
      wrap({ components: [{ kind: "query", id: "q1", sql: "select 1" }], edges: [] }),
    );
    expect(spec?.components).toHaveLength(1);
    expect(spec?.components[0]).toMatchObject({ kind: "query", id: "q1", sql: "select 1" });
  });

  it("returns null for prose with no block", () => {
    expect(parseAgentCanvas("no canvas block here")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseAgentCanvas("```arris-canvas\n{not json\n```")).toBeNull();
  });

  it("drops unknown kinds, null when none remain", () => {
    expect(parseAgentCanvas(wrap({ components: [{ kind: "bogus", id: "x" }] }))).toBeNull();
  });

  it("keeps only well-formed components", () => {
    const spec = parseAgentCanvas(
      wrap({ components: [{ kind: "text", id: "t", text: "hi" }, { kind: "chart" }] }),
    );
    expect(spec?.components).toHaveLength(1);
  });
});

describe("specToBoard", () => {
  const spec: AgentCanvasSpec = {
    components: [
      { kind: "query", id: "q1", sql: "select category, sum(total) t from orders group by 1" },
      {
        kind: "chart",
        id: "c1",
        sourceQueryId: "q1",
        spec: { kind: "bar", xColumn: "category", yColumns: ["t"] },
      },
      { kind: "text", id: "t1", text: "## Sales" },
    ],
    edges: [],
  };

  it("creates objects, binds the query connection, and links chart to query", () => {
    const { components, edges } = specToBoard(spec, [], "conn-1");
    expect(components).toHaveLength(3);
    const q = components.find((c) => c.id === "q1");
    expect(q).toMatchObject({ kind: "query", connectionId: "conn-1" });
    expect(edges).toEqual([{ id: expect.any(String), source: "q1", target: "c1" }]);
  });

  it("does not duplicate an explicit edge", () => {
    const withEdge: AgentCanvasSpec = {
      components: spec.components,
      edges: [{ id: "e1", source: "q1", target: "c1" }],
    };
    expect(specToBoard(withEdge, [], null).edges).toHaveLength(1);
  });

  it("auto-lays-out below existing content", () => {
    const existing = specToBoard(spec, [], null).components;
    const more = specToBoard(
      { components: [{ kind: "text", id: "t2", text: "more" }], edges: [] },
      existing,
      null,
    ).components;
    const lowestExisting = Math.max(...existing.map((c) => c.y + c.h));
    expect(more[0].y).toBeGreaterThan(lowestExisting);
  });
});
