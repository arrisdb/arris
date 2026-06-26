import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, { Background, Controls, applyNodeChanges } from "reactflow";
import type { Node, NodeChange } from "reactflow";
import "reactflow/dist/style.css";
import "./index.css";
import type { LineageViewProps } from "./types";
import { toReactFlowLineage } from "./utils";

function LineageView({ nodes, edges, direction = "vertical", onSelect, onSelectColumn }: LineageViewProps) {
  const { rfNodes: layoutNodes, rfEdges } = useMemo(
    () => toReactFlowLineage(nodes, edges, direction, onSelectColumn),
    [nodes, edges, direction, onSelectColumn],
  );

  const [rfNodes, setRfNodes] = useState<Node[]>(layoutNodes);
  const structuralKey = useMemo(
    () => `${direction}|${nodes.map((n) => `${n.id}:${n.columns?.length ?? 0}:${n.loading ? 1 : 0}`).sort().join(",")}`,
    [nodes, direction],
  );
  const prevStructuralKeyRef = useRef(structuralKey);
  useEffect(() => {
    if (structuralKey !== prevStructuralKeyRef.current) {
      prevStructuralKeyRef.current = structuralKey;
      setRfNodes(layoutNodes);
      return;
    }
    setRfNodes((prev) => {
      const positions = new Map(prev.map((n) => [n.id, n.position]));
      return layoutNodes.map((n) => ({
        ...n,
        position: positions.get(n.id) ?? n.position,
      }));
    });
  }, [layoutNodes, structuralKey]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setRfNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  return (
    <div className="mdbc-lineage-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ maxZoom: 1.5 }}
        nodesDraggable
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeDoubleClick={(_, node) => onSelect?.(node.id)}
      >
        <Background gap={24} size={1} color="rgb(var(--m-overlay-rgb) / 0.05)" />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export {
  LineageView,
};
