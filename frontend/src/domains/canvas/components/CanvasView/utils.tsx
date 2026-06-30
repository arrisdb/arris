import type { ComponentType } from "react";
import { Handle, MarkerType, Position } from "reactflow";
import type { Edge, EdgeTypes, Node, NodeProps, NodeTypes } from "reactflow";
import type { ContextMenuItem } from "@shared/ui/ContextMenu";

import type {
  CanvasComponent,
  CanvasEdge,
  ComponentKind,
  ReorderOp,
} from "../../types";
import { ChartNode } from "./components/ChartNode";
import { FloatingEdge } from "./components/FloatingEdge";
import { NodeBoundary } from "./components/NodeBoundary";
import { QueryNode } from "./components/QueryNode";
import { ShapeNode } from "./components/ShapeNode";
import { StickyNode } from "./components/StickyNode";
import { TableNode } from "./components/TableNode";
import { TextNode } from "./components/TextNode";
import type { CanvasNodeData } from "./types";

/// The relationship-arrow colour (matches the accent), used for both the line and
/// its arrowhead marker. A concrete colour so the SVG marker resolves it.
const ARROW_COLOR = "rgb(124 140 255)";

/// Wrap a node renderer in the per-object error boundary so a render error in one
/// object (e.g. a chart fed a malformed spec) is contained to that object instead
/// of crashing the whole board. Two hidden, non-interactive handles give every
/// object an endpoint a relationship arrow can attach to; the floating edge then
/// routes the visible line to the object's border, not to these handles.
function withNodeBoundary(
  NodeComponent: ComponentType<NodeProps<CanvasNodeData>>,
): ComponentType<NodeProps<CanvasNodeData>> {
  function BoundedNode(props: NodeProps<CanvasNodeData>) {
    return (
      <>
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={false}
          className="mdbc-canvas-node-handle"
        />
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={false}
          className="mdbc-canvas-node-handle"
        />
        <NodeBoundary>
          <NodeComponent {...props} />
        </NodeBoundary>
      </>
    );
  }
  return BoundedNode;
}

/// Every object kind, in render order. The single list the registry-completeness
/// guard checks against; adding a kind means adding it here and to `nodeTypes`.
const COMPONENT_KINDS: ComponentKind[] = ["text", "sticky", "query", "chart", "table", "shape"];

/// The ReactFlow node-renderer registry: one custom node component per object
/// kind. This is the extension seam (mirrors the chart RendererRegistry): a new
/// kind is wired by adding one entry here.
const nodeTypes: NodeTypes = {
  text: withNodeBoundary(TextNode),
  sticky: withNodeBoundary(StickyNode),
  query: withNodeBoundary(QueryNode),
  chart: withNodeBoundary(ChartNode),
  table: withNodeBoundary(TableNode),
  shape: withNodeBoundary(ShapeNode),
};

/// Map board objects to ReactFlow nodes. Position/size/z come from the object;
/// the node reads its live content from the store by id, so `data` only carries
/// the owning tab.
function toFlowNodes(
  components: CanvasComponent[],
  tabId: string,
  connectingId?: string | null,
): Node<CanvasNodeData>[] {
  return components.map((c) => ({
    id: c.id,
    type: c.kind,
    position: { x: c.x, y: c.y },
    data: { tabId },
    // A locked object can't be dragged (the resizer self-hides too).
    draggable: !c.locked,
    // The pending source object is highlighted while choosing an arrow's target.
    className: c.id === connectingId ? "mdbc-connect-source" : undefined,
    style: { width: c.w, height: c.h, zIndex: c.z },
  }));
}

/// Map board arrows to ReactFlow edges: a floating edge that anchors to each
/// object's border, with an arrowhead at the target end.
function toFlowEdges(edges: CanvasEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "floating",
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: ARROW_COLOR },
    style: { stroke: ARROW_COLOR, strokeWidth: 1.5 },
  }));
}

/// The ReactFlow edge-renderer registry: relationship arrows render as floating
/// edges (border-anchored, orthogonal, arrowheaded).
const edgeTypes: EdgeTypes = {
  floating: FloatingEdge,
};

/// The object-actions a node context menu invokes, bound to the owning tab.
interface NodeMenuActions {
  copy: (id: string) => void;
  paste: () => void;
  reorder: (id: string, op: ReorderOp) => void;
  toggleLock: (id: string) => void;
  remove: (id: string) => void;
}

/// Build the right-click menu for one object: copy/paste, the four restacking
/// steps, a lock toggle (label reflects the object's current state), and delete.
function buildNodeMenuItems(
  component: CanvasComponent,
  actions: NodeMenuActions,
): ContextMenuItem[] {
  const id = component.id;
  return [
    { id: "copy", label: "Copy", shortcut: "⌘C", testId: "canvas-menu-copy", action: () => actions.copy(id) },
    { id: "paste", label: "Paste", shortcut: "⌘V", testId: "canvas-menu-paste", action: () => actions.paste() },
    { kind: "separator", id: "sep-stack" },
    { id: "front", label: "Bring to front", shortcut: "]", testId: "canvas-menu-front", action: () => actions.reorder(id, "front") },
    { id: "forward", label: "Bring forward", action: () => actions.reorder(id, "forward") },
    { id: "backward", label: "Send backward", action: () => actions.reorder(id, "backward") },
    { id: "back", label: "Send to back", shortcut: "[", testId: "canvas-menu-back", action: () => actions.reorder(id, "back") },
    { kind: "separator", id: "sep-lock" },
    { id: "lock", label: component.locked ? "Unlock" : "Lock", testId: "canvas-menu-lock", action: () => actions.toggleLock(id) },
    { kind: "separator", id: "sep-delete" },
    { id: "delete", label: "Delete", shortcut: "⌫", testId: "canvas-menu-delete", action: () => actions.remove(id) },
  ];
}

/// The actions an arrow's right-click menu invokes.
interface EdgeMenuActions {
  remove: (id: string) => void;
}

/// Build the right-click menu for a relationship arrow: a single Delete.
function buildEdgeMenuItems(
  edgeId: string,
  actions: EdgeMenuActions,
): ContextMenuItem[] {
  return [
    {
      id: "delete",
      label: "Delete arrow",
      shortcut: "⌫",
      testId: "canvas-edge-menu-delete",
      action: () => actions.remove(edgeId),
    },
  ];
}

/// True when the user has a real (non-collapsed, non-empty) text selection in
/// the document. The board's ⌘C shortcut clones the selected object, but when
/// the user has actually selected text (e.g. an agent reply in the side chat),
/// ⌘C must fall through to the browser's native copy instead.
function hasActiveTextSelection(): boolean {
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
}

export {
  buildEdgeMenuItems,
  buildNodeMenuItems,
  COMPONENT_KINDS,
  edgeTypes,
  hasActiveTextSelection,
  nodeTypes,
  toFlowEdges,
  toFlowNodes,
};
export type { EdgeMenuActions, NodeMenuActions };
