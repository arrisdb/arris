import { useCallback, useEffect, useRef, useState } from "react";
import type { DagNode, Edge, SvgSize } from "./types";

function useFederationProgressLayout(dag: DagNode[] | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [svgSize, setSvgSize] = useState<SvgSize>({ w: 0, h: 0 });

  const computeEdges = useCallback(() => {
    const container = containerRef.current;
    if (!container || !dag) return;

    const rect = container.getBoundingClientRect();
    setSvgSize({ w: rect.width, h: rect.height });

    const nextEdges: Edge[] = [];
    for (const node of dag) {
      const targetEl = container.querySelector(`[data-node-id="${node.id}"]`);
      if (!targetEl) continue;
      const targetRect = targetEl.getBoundingClientRect();

      for (const childId of node.children) {
        const sourceEl = container.querySelector(`[data-node-id="${childId}"]`);
        if (!sourceEl) continue;
        const sourceRect = sourceEl.getBoundingClientRect();

        nextEdges.push({
          x1: sourceRect.right - rect.left,
          y1: sourceRect.top + sourceRect.height / 2 - rect.top,
          x2: targetRect.left - rect.left,
          y2: targetRect.top + targetRect.height / 2 - rect.top,
        });
      }
    }
    setEdges(nextEdges);
  }, [dag]);

  useEffect(() => {
    requestAnimationFrame(computeEdges);
  }, [dag, computeEdges]);

  return {
    containerRef,
    edges,
    svgSize,
  };
}

export { useFederationProgressLayout };
