import { describe, expect, it, vi } from "vitest";

import { makeComponent } from "../../utils";
import {
  buildEdgeMenuItems,
  buildNodeMenuItems,
  COMPONENT_KINDS,
  hasActiveTextSelection,
  isEditableTarget,
  nodeTypes,
  toFlowEdges,
  toFlowNodes,
  viewportCenterPlacement,
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
  it("maps source and target as a floating, arrowheaded edge", () => {
    const [edge] = toFlowEdges([{ id: "e", source: "a", target: "b" }], []);
    expect(edge).toMatchObject({ id: "e", source: "a", target: "b", type: "floating" });
    expect(edge.markerEnd).toBeTruthy();
  });

  it("derives a binding arrow for every bound table/chart", () => {
    const components = [
      makeComponent({ kind: "query", id: "q" }),
      makeComponent({ kind: "table", id: "tbl", sourceQueryId: "q" }),
      makeComponent({ kind: "table", id: "unbound" }),
    ];
    const edges = toFlowEdges([], components);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "q", target: "tbl", type: "floating" });
  });

  it("does not duplicate a binding arrow already persisted", () => {
    const components = [
      makeComponent({ kind: "query", id: "q" }),
      makeComponent({ kind: "table", id: "tbl", sourceQueryId: "q" }),
    ];
    const edges = toFlowEdges([{ id: "e", source: "q", target: "tbl" }], components);
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe("e");
  });
});

describe("buildEdgeMenuItems", () => {
  it("offers a single Delete arrow action wired to the edge id", () => {
    const remove = vi.fn();
    const items = buildEdgeMenuItems("e1", { remove });
    expect(items).toHaveLength(1);
    const item = items[0];
    if (item.kind !== "separator") {
      expect(item.label).toBe("Delete arrow");
      item.action();
    }
    expect(remove).toHaveBeenCalledWith("e1");
  });
});

describe("hasActiveTextSelection", () => {
  it("is false with no selection or a collapsed caret", () => {
    window.getSelection()?.removeAllRanges();
    expect(hasActiveTextSelection()).toBe(false);
  });

  it("is true once real text is selected (so ⌘C copies text, not the node)", () => {
    const p = document.createElement("p");
    p.textContent = "an agent reply";
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(hasActiveTextSelection()).toBe(true);
    sel?.removeAllRanges();
    document.body.removeChild(p);
  });
});

describe("isEditableTarget", () => {
  it("is false for a non-editable element (so bare-key shortcuts fire)", () => {
    const div = document.createElement("div");
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("is true for inputs, textareas, contenteditable, and CodeMirror", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    const ce = document.createElement("div");
    ce.contentEditable = "true";
    // jsdom doesn't compute isContentEditable from the attribute, so assert it directly.
    Object.defineProperty(ce, "isContentEditable", { value: true });
    expect(isEditableTarget(ce)).toBe(true);
    const cm = document.createElement("div");
    cm.className = "cm-editor";
    const inner = document.createElement("span");
    cm.appendChild(inner);
    expect(isEditableTarget(inner)).toBe(true);
  });
});

describe("viewportCenterPlacement", () => {
  it("centers an object in the pane at the default viewport", () => {
    const out = viewportCenterPlacement(
      { width: 800, height: 600 },
      { x: 0, y: 0, zoom: 1 },
      { w: 200, h: 100 },
      0,
    );
    // Pane center (400,300) minus half the object (100,50).
    expect(out).toEqual({ x: 300, y: 250 });
  });

  it("inverts pan and zoom so the object lands where the user is looking", () => {
    const out = viewportCenterPlacement(
      { width: 800, height: 600 },
      { x: -200, y: -100, zoom: 2 },
      { w: 200, h: 100 },
      0,
    );
    // centerFlow = ((400 - -200)/2, (300 - -100)/2) = (300, 200); minus half size.
    expect(out).toEqual({ x: 200, y: 150 });
  });

  it("cascades repeated adds so they don't stack exactly", () => {
    const a = viewportCenterPlacement({ width: 800, height: 600 }, { x: 0, y: 0, zoom: 1 }, { w: 200, h: 100 }, 0);
    const b = viewportCenterPlacement({ width: 800, height: 600 }, { x: 0, y: 0, zoom: 1 }, { w: 200, h: 100 }, 1);
    expect(b.x - a.x).toBe(24);
    expect(b.y - a.y).toBe(24);
  });

  it("falls back to a zero-sized pane when the rect is unavailable", () => {
    const out = viewportCenterPlacement(null, { x: 0, y: 0, zoom: 1 }, { w: 200, h: 100 }, 0);
    expect(out).toEqual({ x: -100, y: -50 });
  });
});
