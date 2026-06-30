import { memo, useCallback } from "react";
import { BaseEdge, getSmoothStepPath, useStore } from "reactflow";
import type { EdgeProps, Node, ReactFlowState } from "reactflow";

import { getEdgeParams } from "./utils";
import type { Rect } from "./utils";

/// A node's absolute rectangle once ReactFlow has measured it. Null until the
/// node has a measured size and an absolute position (e.g. the first frame).
function rectOf(node: Node | undefined): Rect | null {
  if (!node || !node.width || !node.height || !node.positionAbsolute) return null;
  return {
    x: node.positionAbsolute.x,
    y: node.positionAbsolute.y,
    width: node.width,
    height: node.height,
  };
}

/// A relationship arrow whose ends stick to the borders of the two objects it
/// connects (not a fixed handle). It reads both nodes' live rectangles from the
/// ReactFlow store, finds the border point on each facing the other, and routes
/// an orthogonal path between them with the arrowhead from the edge's marker.
function FloatingEdgeImpl({ id, source, target, markerEnd, style }: EdgeProps) {
  const sourceNode = useStore(
    useCallback((s: ReactFlowState) => s.nodeInternals.get(source), [source]),
  );
  const targetNode = useStore(
    useCallback((s: ReactFlowState) => s.nodeInternals.get(target), [target]),
  );

  const sourceRect = rectOf(sourceNode);
  const targetRect = rectOf(targetNode);
  if (!sourceRect || !targetRect) return null;

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceRect, targetRect);
  const [path] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
    borderRadius: 8,
  });

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}

const FloatingEdge = memo(FloatingEdgeImpl);

export { FloatingEdge };
