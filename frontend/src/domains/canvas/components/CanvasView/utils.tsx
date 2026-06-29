import type { Edge, Node, NodeTypes } from "reactflow";

import type {
  CanvasComponent,
  CanvasEdge,
  ComponentKind,
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

export { COMPONENT_KINDS, nodeTypes, toFlowEdges, toFlowNodes };
