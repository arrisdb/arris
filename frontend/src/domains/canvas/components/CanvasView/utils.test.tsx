import { describe, expect, it, vi } from "vitest";

import { makeComponent } from "../../utils";
import {
  buildNodeMenuItems,
  COMPONENT_KINDS,
  nodeTypes,
  toFlowEdges,
  toFlowNodes,
} from "./utils";

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
      draggable: true,
      style: { width: 30, height: 40, zIndex: 2 },
    });
  });

  it("marks a locked object as not draggable", () => {
    const c = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const [node] = toFlowNodes([{ ...c, locked: true }], "tab-1");
    expect(node.draggable).toBe(false);
  });
});

describe("buildNodeMenuItems", () => {
  const actions = {
    copy: vi.fn(),
    paste: vi.fn(),
    reorder: vi.fn(),
    toggleLock: vi.fn(),
    remove: vi.fn(),
  };

  it("offers copy/paste, the four restacking steps, a lock toggle, and delete", () => {
    const c = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const labels = buildNodeMenuItems(c, actions).flatMap((i) =>
      i.kind === "separator" ? [] : [i.label],
    );
    expect(labels).toEqual([
      "Copy",
      "Paste",
      "Bring to front",
      "Bring forward",
      "Send backward",
      "Send to back",
      "Lock",
      "Delete",
    ]);
  });

  it("labels the lock item 'Unlock' for a locked object", () => {
    const c = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const item = buildNodeMenuItems({ ...c, locked: true }, actions).find(
      (i) => i.kind !== "separator" && i.id === "lock",
    );
    expect(item && item.kind !== "separator" ? item.label : "").toBe("Unlock");
  });

  it("wires each action to the object id", () => {
    const c = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const items = buildNodeMenuItems(c, actions);
    const run = (id: string) => {
      const item = items.find((i) => i.kind !== "separator" && i.id === id);
      if (item && item.kind !== "separator") item.action();
    };
    run("copy");
    run("paste");
    run("front");
    run("lock");
    run("delete");
    expect(actions.copy).toHaveBeenCalledWith("s");
    expect(actions.paste).toHaveBeenCalled();
    expect(actions.reorder).toHaveBeenCalledWith("s", "front");
    expect(actions.toggleLock).toHaveBeenCalledWith("s");
    expect(actions.remove).toHaveBeenCalledWith("s");
  });
});

describe("toFlowEdges", () => {
  it("maps source and target", () => {
    expect(toFlowEdges([{ id: "e", source: "a", target: "b" }])).toEqual([
      { id: "e", source: "a", target: "b" },
    ]);
  });
});
