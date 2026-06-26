// Pure, immutable helpers operating on the pane layout tree (`PaneNode`).
// The tree is the single source of truth for how editor panes are arranged in
// 2D: a `PaneGroup` leaf owns tabs, a `PaneSplit` stacks children along one
// axis. The store (`tabs.ts`) drives all mutations through these helpers so the
// arrangement logic lives in one tested place.

import type { PaneGroup, PaneNode, SplitDirection, SplitOrientation } from "../types";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function orientationFor(direction: SplitDirection): SplitOrientation {
  return direction === "left" || direction === "right" ? "row" : "column";
}

function insertBefore(direction: SplitDirection): boolean {
  return direction === "left" || direction === "up";
}

function makeLeaf(tabIds: string[], selectedTabId?: string | null): PaneGroup {
  return {
    kind: "leaf",
    id: newId(),
    tabIds,
    selectedTabId:
      selectedTabId !== undefined
        ? selectedTabId
        : (tabIds[tabIds.length - 1] ?? null),
  };
}

/// All leaves in render order (depth-first, left→right within each split).
function leavesOf(node: PaneNode | null): PaneGroup[] {
  if (!node) return [];
  if (node.kind === "leaf") return [node];
  return node.children.flatMap(leavesOf);
}

function findLeaf(node: PaneNode | null, leafId: string): PaneGroup | null {
  return leavesOf(node).find((l) => l.id === leafId) ?? null;
}

function findLeafWithTab(node: PaneNode | null, tabId: string): PaneGroup | null {
  return leavesOf(node).find((l) => l.tabIds.includes(tabId)) ?? null;
}

function firstLeaf(node: PaneNode | null): PaneGroup | null {
  return leavesOf(node)[0] ?? null;
}

/// Return a new tree with every leaf replaced by `fn(leaf)`.
function mapLeaves(node: PaneNode, fn: (leaf: PaneGroup) => PaneGroup): PaneNode {
  if (node.kind === "leaf") return fn(node);
  return { ...node, children: node.children.map((c) => mapLeaves(c, fn)) };
}

/// Drop empty leaves and collapse splits left with a single child. Returns
/// `null` when nothing remains.
function pruneEmpty(node: PaneNode | null): PaneNode | null {
  if (!node) return null;
  if (node.kind === "leaf") return node.tabIds.length > 0 ? node : null;
  const children = node.children
    .map(pruneEmpty)
    .filter((c): c is PaneNode => c !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  // Drop drag-set sizes when the child count changed; they no longer line up.
  const sizes = children.length === node.children.length ? node.sizes : undefined;
  return { ...node, children, sizes };
}

/// Where a tab was dropped: onto a whole pane group, or onto a specific tab
/// within some group.
type TabDropTarget = { groupId: string } | { tabId: string };

/// Which side of the target tab the cursor was over, decides whether the
/// dragged tab lands before or after it. Irrelevant for whole-pane drops.
type DropSide = "before" | "after";

/// What a drop should do, resolved purely from the tree. `null` when the drop
/// is a no-op (same slot, unknown ids).
type TabDropPlan =
  | { type: "reorder"; groupId: string; from: number; to: number }
  | { type: "move"; targetGroupId: string; toTabId: string | null; side: DropSide };

/// Resolve dragging tab `tabId` onto `target`. Within the same group it is a
/// reorder; across groups it is a move (placed before/after `toTabId`). `side`
/// is which half of the target tab the cursor was over; without it a drop on
/// the right half of a tab would still land on its left.
function planTabDrop(
  root: PaneNode | null,
  tabId: string,
  target: TabDropTarget,
  side: DropSide = "before",
): TabDropPlan | null {
  const src = findLeafWithTab(root, tabId);
  if (!src) return null;
  let targetGroupId: string;
  let overTabId: string | null = null;
  if ("groupId" in target) {
    targetGroupId = target.groupId;
  } else {
    const tgt = findLeafWithTab(root, target.tabId);
    if (!tgt) return null;
    targetGroupId = tgt.id;
    overTabId = target.tabId;
  }
  if (targetGroupId === src.id) {
    if (!overTabId || overTabId === tabId) return null;
    const from = src.tabIds.indexOf(tabId);
    const overIndex = src.tabIds.indexOf(overTabId);
    if (from < 0 || overIndex < 0) return null;
    // `gap` is the slot in the original array where the tab should land (before
    // or after the target). Removing the dragged tab shifts every later slot
    // down by one, so when the tab sits left of the gap the destination is
    // `gap - 1`. This is what makes a right-half drop land to the right.
    const gap = side === "after" ? overIndex + 1 : overIndex;
    const to = from < gap ? gap - 1 : gap;
    if (to === from) return null;
    return { type: "reorder", groupId: src.id, from, to };
  }
  return { type: "move", targetGroupId, toTabId: overTabId, side };
}

/// Set the flex fractions on the split `splitId`. No-op if it isn't found.
function setSplitSizes(
  node: PaneNode,
  splitId: string,
  sizes: number[],
): PaneNode {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return { ...node, sizes };
  return {
    ...node,
    children: node.children.map((c) => setSplitSizes(c, splitId, sizes)),
  };
}

/// Insert `newLeaf` adjacent to the leaf `leafId` in the given direction. If the
/// leaf's parent already splits along the matching axis, `newLeaf` becomes a
/// sibling; otherwise the leaf is wrapped in a fresh split of that orientation.
function splitLeaf(
  root: PaneNode,
  leafId: string,
  direction: SplitDirection,
  newLeaf: PaneGroup,
): PaneNode {
  const orientation = orientationFor(direction);
  const before = insertBefore(direction);
  const wrap = (target: PaneNode): PaneNode => ({
    kind: "split",
    id: newId(),
    orientation,
    children: before ? [newLeaf, target] : [target, newLeaf],
  });
  const rec = (node: PaneNode): PaneNode => {
    if (node.kind === "leaf") {
      return node.id === leafId ? wrap(node) : node;
    }
    // Same-axis parent: insert as a sibling instead of nesting a new split.
    if (node.orientation === orientation) {
      const idx = node.children.findIndex(
        (c) => c.kind === "leaf" && c.id === leafId,
      );
      if (idx >= 0) {
        const children = node.children.slice();
        children.splice(before ? idx : idx + 1, 0, newLeaf);
        // New sibling → old sizes no longer match; reset to equal.
        return { ...node, children, sizes: undefined };
      }
    }
    return { ...node, children: node.children.map(rec) };
  };
  return rec(root);
}

export {
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
};
export type { DropSide, TabDropPlan, TabDropTarget };
