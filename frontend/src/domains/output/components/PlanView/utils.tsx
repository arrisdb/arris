import type {
  PlanFlameStyle,
  PlanNode,
  PlanRowProps,
  PlanRowStyle,
} from "./types";

function hasStructuredPlan(root: PlanNode | undefined): boolean {
  return Boolean(
    root && (root.children?.length ?? 0) > 0 ||
    (root && (root.label || root.attributes?.length)),
  );
}

function computeMax(node: PlanNode | undefined, fn: (node: PlanNode) => number): number {
  if (!node) return 1;
  let max = 1;
  const walk = (current: PlanNode) => {
    const value = fn(current);
    if (value > max) max = value;
    (current.children ?? []).forEach(walk);
  };
  walk(node);
  return max;
}

function planCost(node: PlanNode): number {
  return node.total_ms ?? node.cost_total ?? 0;
}

function flameHeat(actualMs: number | undefined): string {
  if (actualMs === undefined) return "var(--m-accent)";
  if (actualMs > 500) return "#ff6b6b";
  if (actualMs > 100) return "#ffa14a";
  if (actualMs > 10) return "#ffd960";
  return "#5be39a";
}

function planRowStyle(depth: number): PlanRowStyle {
  return { "--mdbc-plan-flame-indent": `${12 + depth * 16}px` };
}

function planFlameStyle(node: PlanNode, maxCost: number): PlanFlameStyle {
  const heat = planCost(node);
  const flameWidth = maxCost > 0 ? Math.max(6, (heat / maxCost) * 220) : 0;
  const flameColor = flameHeat(node.total_ms);
  return {
    "--mdbc-plan-flame-width": `${flameWidth}px`,
    "--mdbc-plan-flame-color": flameColor,
    "--mdbc-plan-flame-shadow": `0 0 12px ${flameColor}`,
  };
}

function renderPlanRow({ node, depth, maxCost }: PlanRowProps) {
  return (
    <div>
      <div className="mdbc-plan-flame-row mdbc-plan-flame-row-indent" style={planRowStyle(depth)}>
        <div className="mdbc-plan-flame-track">
          <div className="mdbc-plan-flame-bar mdbc-plan-flame-bar-style" style={planFlameStyle(node, maxCost)} />
        </div>
        <div className="mdbc-plan-flame-details">
          <div className="mdbc-plan-flame-title-row">
            <span className="mdbc-plan-flame-label">{node.label}</span>
            {node.node_type && (
              <span className="mdbc-plan-flame-meta">
                {node.node_type}
              </span>
            )}
          </div>
          <div className="mdbc-plan-flame-stats">
            {node.cost_total !== undefined && (
              <span>cost {node.cost_total.toFixed(2)}</span>
            )}
            {node.rows_actual !== undefined && (
              <span>rows {node.rows_actual.toFixed(0)}</span>
            )}
            {node.total_ms !== undefined && (
              <span>{node.total_ms.toFixed(2)} ms</span>
            )}
            {(node.attributes ?? []).slice(0, 3).map((attribute, index) => (
              <span key={`${attribute.key}-${index}`}>
                {attribute.key}: {attribute.value}
              </span>
            ))}
          </div>
        </div>
      </div>
      {(node.children ?? []).map((child, index) => (
        <div key={child.id ?? index}>
          {renderPlanRow({ node: child, depth: depth + 1, maxCost })}
        </div>
      ))}
    </div>
  );
}

export {
  computeMax,
  flameHeat,
  hasStructuredPlan,
  planCost,
  renderPlanRow,
};
