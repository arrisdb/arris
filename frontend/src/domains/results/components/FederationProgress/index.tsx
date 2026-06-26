import { useFederationProgressStore } from "../../hooks";
import { type CSSProperties } from "react";
import { useFederationProgressLayout } from "./hooks";
import type { DagNode } from "./types";
import {
  assignLayers,
  computeGridLayout,
  edgePath,
  formatMetrics,
  splitLabel,
  statusClass,
} from "./utils";
import "./index.css";

function FederationProgress() {
  const dag = useFederationProgressStore((s) => s.dag);
  const { containerRef, edges, svgSize } = useFederationProgressLayout(dag);

  if (!dag || dag.length === 0) return null;

  const depths = assignLayers(dag);
  const maxDepth = Math.max(...depths.values());

  const layers: DagNode[][] = [];
  for (let d = 0; d <= maxDepth; d++) {
    layers.push(dag.filter((n) => depths.get(n.id) === d));
  }

  const { pos, cols, rows } = computeGridLayout(layers);

  return (
    <div
      className="mdbc-fed-dag"
      ref={containerRef}
      style={{ '--fed-cols': cols, '--fed-rows': rows } as CSSProperties}
    >
      <svg className="mdbc-fed-svg" width={svgSize.w} height={svgSize.h}>
        <defs>
          <marker id="fed-arrow" viewBox="0 0 10 6" refX="10" refY="3"
            markerWidth="8" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 3 L 0 6 z" fill="#6b7280" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          return (
            <path
              key={i}
              d={edgePath(e)}
              fill="none"
              stroke="#6b7280"
              strokeWidth={2}
              markerEnd="url(#fed-arrow)"
            />
          );
        })}
      </svg>
      {layers.flat().map((node) => {
        const [col, row] = pos.get(node.id)!;
        const { title, detail } = splitLabel(node.label);
        return (
          <div
            key={node.id}
            data-node-id={node.id}
            className={`mdbc-fed-node ${statusClass(node.status)}`}
            style={{ '--fed-col': col, '--fed-row': row } as CSSProperties}
          >
            <span className="mdbc-fed-node-label">{title}</span>
            {detail && <span className="mdbc-fed-node-detail">{detail}</span>}
            {node.metrics && <span className="mdbc-fed-node-metrics">{formatMetrics(node)}</span>}
          </div>
        );
      })}
    </div>
  );
}

export { FederationProgress };
