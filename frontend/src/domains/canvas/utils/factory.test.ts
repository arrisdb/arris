import { describe, expect, it } from "vitest";

import { DEFAULT_SIZE } from "../constants";
import { makeComponent, makeEdge } from "./factory";

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
