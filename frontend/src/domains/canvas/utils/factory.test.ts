import { describe, expect, it } from "vitest";

import { DEFAULT_SIZE } from "../constants";
import { makeComponent, makeEdge, nextQueryTitle } from "./factory";

describe("makeComponent", () => {
  it("builds a text object with default size at the origin", () => {
    const c = makeComponent({ kind: "text", id: "t1", text: "hello" });
    expect(c).toMatchObject({
      id: "t1",
      kind: "text",
      text: "hello",
      x: 0,
      y: 0,
      z: 0,
      w: DEFAULT_SIZE.text.w,
      h: DEFAULT_SIZE.text.h,
    });
  });

  it("binds a query object's connection and sql", () => {
    const c = makeComponent({
      kind: "query",
      id: "q1",
      sql: "select 1",
      connectionId: "conn",
    });
    expect(c).toMatchObject({ kind: "query", sql: "select 1", connectionId: "conn" });
  });

  it("gives a chart a source query and a fallback spec", () => {
    const c = makeComponent({ kind: "chart", id: "c1", sourceQueryId: "q1" });
    expect(c).toMatchObject({ kind: "chart", sourceQueryId: "q1" });
    if (c.kind === "chart") expect(c.spec).toBeDefined();
  });

  it("leaves a new table unbound (no source query) by default", () => {
    const c = makeComponent({ kind: "table", id: "t1" });
    expect(c).toMatchObject({ kind: "table", sourceQueryId: null });
    if (c.kind === "table") expect(c.previewRows).toBeUndefined();
  });

  it("carries an explicit table source query and preview-row cap", () => {
    const c = makeComponent({ kind: "table", id: "t2", sourceQueryId: "q1", previewRows: 25 });
    expect(c).toMatchObject({ kind: "table", sourceQueryId: "q1", previewRows: 25 });
  });

  it("generates an id when none is supplied", () => {
    const c = makeComponent({ kind: "shape", shape: "ellipse" });
    expect(c.id).toBeTruthy();
    expect(c).toMatchObject({ kind: "shape", shape: "ellipse" });
  });

  it("respects explicit geometry", () => {
    const c = makeComponent({ kind: "text", x: 10, y: 20, w: 30, h: 40, z: 2 });
    expect(c).toMatchObject({ x: 10, y: 20, w: 30, h: 40, z: 2 });
  });
});

describe("makeEdge", () => {
  it("links a source to a target", () => {
    expect(makeEdge("a", "b", "e1")).toEqual({ id: "e1", source: "a", target: "b" });
  });

  it("generates an edge id when none is supplied", () => {
    const e = makeEdge("a", "b");
    expect(e.id).toBeTruthy();
    expect(e).toMatchObject({ source: "a", target: "b" });
  });
});

describe("nextQueryTitle", () => {
  it("starts at Query 1 on an empty board", () => {
    expect(nextQueryTitle([])).toBe("Query 1");
  });

  it("skips titles already taken by query cells", () => {
    const cells = [
      makeComponent({ kind: "query", id: "a", title: "Query 1" }),
      makeComponent({ kind: "query", id: "b", title: "Query 2" }),
    ];
    expect(nextQueryTitle(cells)).toBe("Query 3");
  });

  it("fills a gap left by a deleted cell", () => {
    const cells = [makeComponent({ kind: "query", id: "b", title: "Query 2" })];
    expect(nextQueryTitle(cells)).toBe("Query 1");
  });

  it("ignores non-query objects with the same title", () => {
    const cells = [makeComponent({ kind: "table", id: "t", title: "Query 1" })];
    expect(nextQueryTitle(cells)).toBe("Query 1");
  });
});
