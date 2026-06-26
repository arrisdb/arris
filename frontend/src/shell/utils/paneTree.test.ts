import { describe, it, expect } from "vitest";
import {
  findLeaf,
  findLeafWithTab,
  firstLeaf,
  leavesOf,
  makeLeaf,
  mapLeaves,
  planTabDrop,
  pruneEmpty,
  setSplitSizes,
  splitLeaf,
} from "./paneTree";
import type { PaneGroup, PaneNode, PaneSplit } from "../types";

function leaf(id: string, tabIds: string[]): PaneGroup {
  return { kind: "leaf", id, tabIds, selectedTabId: tabIds[tabIds.length - 1] ?? null };
}
function split(orientation: "row" | "column", children: PaneNode[]): PaneSplit {
  return { kind: "split", id: `s-${orientation}`, orientation, children };
}

describe("paneTree", () => {
  it("leavesOf returns leaves depth-first in render order", () => {
    const tree = split("row", [leaf("a", ["1"]), split("column", [leaf("b", ["2"]), leaf("c", ["3"])])]);
    expect(leavesOf(tree).map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(leavesOf(null)).toEqual([]);
    expect(firstLeaf(tree)?.id).toBe("a");
  });

  it("findLeaf / findLeafWithTab locate by id and tab", () => {
    const tree = split("row", [leaf("a", ["1", "2"]), leaf("b", ["3"])]);
    expect(findLeaf(tree, "b")?.id).toBe("b");
    expect(findLeaf(tree, "missing")).toBeNull();
    expect(findLeafWithTab(tree, "2")?.id).toBe("a");
    expect(findLeafWithTab(tree, "3")?.id).toBe("b");
  });

  it("mapLeaves transforms every leaf without touching splits", () => {
    const tree = split("row", [leaf("a", ["1"]), leaf("b", ["2"])]);
    const next = mapLeaves(tree, (l) => (l.id === "a" ? { ...l, tabIds: [...l.tabIds, "x"] } : l));
    expect(findLeaf(next, "a")?.tabIds).toEqual(["1", "x"]);
    expect(findLeaf(next, "b")?.tabIds).toEqual(["2"]);
  });

  it("splitLeaf right/left wraps a lone leaf in a row split", () => {
    const root = leaf("a", ["1"]);
    const nb = makeLeaf(["2"]);
    const right = splitLeaf(root, "a", "right", nb) as PaneSplit;
    expect(right.kind).toBe("split");
    expect(right.orientation).toBe("row");
    expect(right.children.map((c) => (c as PaneGroup).id)).toEqual(["a", nb.id]);

    const left = splitLeaf(root, "a", "left", nb) as PaneSplit;
    expect(left.orientation).toBe("row");
    expect(left.children.map((c) => (c as PaneGroup).id)).toEqual([nb.id, "a"]);
  });

  it("splitLeaf up/down wraps a lone leaf in a column split", () => {
    const root = leaf("a", ["1"]);
    const nb = makeLeaf(["2"]);
    const down = splitLeaf(root, "a", "down", nb) as PaneSplit;
    expect(down.orientation).toBe("column");
    expect(down.children.map((c) => (c as PaneGroup).id)).toEqual(["a", nb.id]);

    const up = splitLeaf(root, "a", "up", nb) as PaneSplit;
    expect(up.orientation).toBe("column");
    expect(up.children.map((c) => (c as PaneGroup).id)).toEqual([nb.id, "a"]);
  });

  it("splitLeaf inserts as a sibling when the parent shares the axis", () => {
    const root = split("row", [leaf("a", ["1"]), leaf("b", ["2"])]);
    const nb = makeLeaf(["3"]);
    const next = splitLeaf(root, "a", "right", nb) as PaneSplit;
    // Stays a single row split (no nesting), new leaf inserted after `a`.
    expect(next.children).toHaveLength(3);
    expect(next.children.map((c) => (c as PaneGroup).id)).toEqual(["a", nb.id, "b"]);
  });

  it("splitLeaf nests a new split when the parent axis differs", () => {
    const root = split("row", [leaf("a", ["1"]), leaf("b", ["2"])]);
    const nb = makeLeaf(["3"]);
    const next = splitLeaf(root, "a", "down", nb) as PaneSplit;
    expect(next.orientation).toBe("row");
    expect(next.children).toHaveLength(2);
    const wrapped = next.children[0] as PaneSplit;
    expect(wrapped.kind).toBe("split");
    expect(wrapped.orientation).toBe("column");
    expect(wrapped.children.map((c) => (c as PaneGroup).id)).toEqual(["a", nb.id]);
  });

  it("pruneEmpty drops empty leaves and collapses single-child splits", () => {
    const tree = split("row", [leaf("a", []), leaf("b", ["2"])]);
    const pruned = pruneEmpty(tree);
    // `a` removed → split collapses to the lone surviving leaf.
    expect(pruned).not.toBeNull();
    expect(pruned!.kind).toBe("leaf");
    expect((pruned as PaneGroup).id).toBe("b");
  });

  it("pruneEmpty returns null when every leaf is empty", () => {
    const tree = split("column", [leaf("a", []), leaf("b", [])]);
    expect(pruneEmpty(tree)).toBeNull();
  });

  it("setSplitSizes sets sizes on the matching split only", () => {
    const inner = split("column", [leaf("b", ["2"]), leaf("c", ["3"])]);
    const tree = split("row", [leaf("a", ["1"]), inner]);
    const next = setSplitSizes(tree, inner.id, [0.3, 0.7]) as PaneSplit;
    expect(next.sizes).toBeUndefined(); // outer untouched
    expect((next.children[1] as PaneSplit).sizes).toEqual([0.3, 0.7]);
  });

  it("setSplitSizes is a no-op when the split id is absent", () => {
    const tree = split("row", [leaf("a", ["1"]), leaf("b", ["2"])]);
    const next = setSplitSizes(tree, "missing", [0.2, 0.8]) as PaneSplit;
    expect(next.sizes).toBeUndefined();
  });

  it("pruneEmpty drops sizes when a child is removed", () => {
    const tree: PaneSplit = {
      kind: "split",
      id: "s",
      orientation: "row",
      children: [leaf("a", []), leaf("b", ["2"]), leaf("c", ["3"])],
      sizes: [0.2, 0.3, 0.5],
    };
    const pruned = pruneEmpty(tree) as PaneSplit;
    // `a` removed → 3 sizes no longer line up with 2 children, so reset.
    expect(pruned.children).toHaveLength(2);
    expect(pruned.sizes).toBeUndefined();
  });

  it("pruneEmpty keeps sizes when the child count is unchanged", () => {
    const tree: PaneSplit = {
      kind: "split",
      id: "s",
      orientation: "row",
      children: [leaf("a", ["1"]), leaf("b", ["2"])],
      sizes: [0.25, 0.75],
    };
    const pruned = pruneEmpty(tree) as PaneSplit;
    expect(pruned.sizes).toEqual([0.25, 0.75]);
  });

  it("splitLeaf clears sizes when inserting a same-axis sibling", () => {
    const root: PaneSplit = {
      kind: "split",
      id: "s",
      orientation: "row",
      children: [leaf("a", ["1"]), leaf("b", ["2"])],
      sizes: [0.4, 0.6],
    };
    const next = splitLeaf(root, "a", "right", makeLeaf(["3"])) as PaneSplit;
    expect(next.children).toHaveLength(3);
    expect(next.sizes).toBeUndefined();
  });

  it("planTabDrop reorders left→right honouring the drop side", () => {
    const tree = split("row", [leaf("a", ["t1", "t2", "t3"]), leaf("b", ["t4"])]);
    // Dropping t1 on the right half of t3 lands it after t3 (at the end).
    expect(planTabDrop(tree, "t1", { tabId: "t3" }, "after")).toEqual({
      type: "reorder",
      groupId: "a",
      from: 0,
      to: 2,
    });
    // Dropping t1 on the left half of t3 lands it just before t3.
    expect(planTabDrop(tree, "t1", { tabId: "t3" }, "before")).toEqual({
      type: "reorder",
      groupId: "a",
      from: 0,
      to: 1,
    });
  });

  it("planTabDrop reorders right→left honouring the drop side", () => {
    const tree = split("row", [leaf("a", ["t1", "t2", "t3"]), leaf("b", ["t4"])]);
    // Dropping t3 on the left half of t1 lands it before t1 (at the start).
    expect(planTabDrop(tree, "t3", { tabId: "t1" }, "before")).toEqual({
      type: "reorder",
      groupId: "a",
      from: 2,
      to: 0,
    });
    // Dropping t3 on the right half of t1 lands it just after t1.
    expect(planTabDrop(tree, "t3", { tabId: "t1" }, "after")).toEqual({
      type: "reorder",
      groupId: "a",
      from: 2,
      to: 1,
    });
  });

  it("planTabDrop is a no-op when the side resolves to the tab's current slot", () => {
    const tree = split("row", [leaf("a", ["t1", "t2", "t3"]), leaf("b", ["t4"])]);
    // t1 dropped before t2 is already where it sits → no move.
    expect(planTabDrop(tree, "t1", { tabId: "t2" }, "before")).toBeNull();
  });

  it("planTabDrop moves across groups carrying the drop side", () => {
    const tree = split("row", [leaf("a", ["t1", "t2"]), leaf("b", ["t3"])]);
    expect(planTabDrop(tree, "t1", { tabId: "t3" }, "after")).toEqual({
      type: "move",
      targetGroupId: "b",
      toTabId: "t3",
      side: "after",
    });
  });

  it("planTabDrop moves onto a whole pane group with no target tab", () => {
    const tree = split("row", [leaf("a", ["t1", "t2"]), leaf("b", ["t3"])]);
    expect(planTabDrop(tree, "t1", { groupId: "b" })).toEqual({
      type: "move",
      targetGroupId: "b",
      toTabId: null,
      side: "before",
    });
  });

  it("planTabDrop is a no-op for the same group with no/own target tab", () => {
    const tree = split("row", [leaf("a", ["t1", "t2"]), leaf("b", ["t3"])]);
    expect(planTabDrop(tree, "t1", { groupId: "a" })).toBeNull();
    expect(planTabDrop(tree, "t1", { tabId: "t1" })).toBeNull();
  });

  it("planTabDrop returns null for unknown tabs", () => {
    const tree = split("row", [leaf("a", ["t1"]), leaf("b", ["t2"])]);
    expect(planTabDrop(tree, "missing", { tabId: "t1" })).toBeNull();
    expect(planTabDrop(tree, "t1", { tabId: "missing" })).toBeNull();
  });
});
