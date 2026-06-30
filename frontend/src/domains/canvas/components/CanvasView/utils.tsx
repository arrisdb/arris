import type { Edge, Node, NodeTypes } from "reactflow";
import type { ContextMenuItem } from "@shared/ui/ContextMenu";

import type {
  CanvasComponent,
  CanvasEdge,
  ComponentKind,
  ReorderOp,
} from "../../types";
import { ChartNode } from "./components/ChartNode";
import { QueryNode } from "./components/QueryNode";
import { ShapeNode } from "./components/ShapeNode";
import { StickyNode } from "./components/StickyNode";
import { TextNode } from "./components/TextNode";
import type { CanvasNodeData } from "./types";

/// Every object kind, in render order. The single list the registry-completeness
/// guard checks against; adding a kind means adding it here and to `nodeTypes`.
const COMPONENT_KINDS: ComponentKind[] = ["text", "sticky", "query", "chart", "shape"];

/// The ReactFlow node-renderer registry: one custom node component per object
/// kind. This is the extension seam (mirrors the chart RendererRegistry): a new
/// kind is wired by adding one entry here.
const nodeTypes: NodeTypes = {
  text: TextNode,
  sticky: StickyNode,
  query: QueryNode,
  chart: ChartNode,
  shape: ShapeNode,
};

/// Map board objects to ReactFlow nodes. Position/size/z come from the object;
/// the node reads its live content from the store by id, so `data` only carries
/// the owning tab.
function toFlowNodes(
  components: CanvasComponent[],
  tabId: string,
): Node<CanvasNodeData>[] {
  return components.map((c) => ({
    id: c.id,
    type: c.kind,
    position: { x: c.x, y: c.y },
    data: { tabId },
    // A locked object can't be dragged (the resizer self-hides too).
    draggable: !c.locked,
    style: { width: c.w, height: c.h, zIndex: c.z },
  }));
}

function toFlowEdges(edges: CanvasEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));
}

/// The object-actions a node context menu invokes, bound to the owning tab.
interface NodeMenuActions {
  duplicate: (id: string) => void;
  reorder: (id: string, op: ReorderOp) => void;
  toggleLock: (id: string) => void;
}

/// Build the right-click menu for one object: copy, the four restacking steps,
/// and a lock toggle (label reflects the object's current state).
function buildNodeMenuItems(
  component: CanvasComponent,
  actions: NodeMenuActions,
): ContextMenuItem[] {
  const id = component.id;
  return [
    { id: "copy", label: "Copy", shortcut: "⌘C", testId: "canvas-menu-copy", action: () => actions.duplicate(id) },
    { kind: "separator", id: "sep-stack" },
    { id: "front", label: "Bring to front", shortcut: "]", testId: "canvas-menu-front", action: () => actions.reorder(id, "front") },
    { id: "forward", label: "Bring forward", action: () => actions.reorder(id, "forward") },
    { id: "backward", label: "Send backward", action: () => actions.reorder(id, "backward") },
    { id: "back", label: "Send to back", shortcut: "[", testId: "canvas-menu-back", action: () => actions.reorder(id, "back") },
    { kind: "separator", id: "sep-lock" },
    { id: "lock", label: component.locked ? "Unlock" : "Lock", testId: "canvas-menu-lock", action: () => actions.toggleLock(id) },
  ];
}

export {
  buildNodeMenuItems,
  COMPONENT_KINDS,
  nodeTypes,
  toFlowEdges,
  toFlowNodes,
};
export type { NodeMenuActions };
