import { describe, expect, it } from "vitest";

import { makeComponent } from "../../utils";
import { COMPONENT_KINDS, nodeTypes, toFlowEdges, toFlowNodes } from "./utils";

describe("nodeTypes registry", () => {
  it("has exactly one renderer per component kind (expansion guard)", () => {
    expect(Object.keys(nodeTypes).sort()).toEqual([...COMPONENT_KINDS].sort());
  });

  it("every renderer is a defined component", () => {
    for (const kind of COMPONENT_KINDS) expect(nodeTypes[kind]).toBeTruthy();
  });
});

describe("toFlowNodes", () => {
  it("maps geometry, kind, and the owning tab", () => {
    const c = makeComponent({ kind: "text", id: "t", x: 10, y: 20, w: 30, h: 40, z: 2 });
    const [node] = toFlowNodes([c], "tab-1");
    expect(node).toMatchObject({
      id: "t",
      type: "text",
      position: { x: 10, y: 20 },
      data: { tabId: "tab-1" },
      style: { width: 30, height: 40, zIndex: 2 },
    });
  });
});

describe("toFlowEdges", () => {
  it("maps source and target", () => {
    expect(toFlowEdges([{ id: "e", source: "a", target: "b" }])).toEqual([
      { id: "e", source: "a", target: "b" },
    ]);
  });
});
