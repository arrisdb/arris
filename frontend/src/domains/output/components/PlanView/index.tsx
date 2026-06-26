import type { PlanViewProps } from "./types";
import {
  computeMax,
  hasStructuredPlan,
  planCost,
  renderPlanRow,
} from "./utils";
import "./index.css";

function PlanView({ plan }: PlanViewProps) {
  if (!plan) {
    return (
      <div className="mdbc-plan-empty">
        Run "Explain" to see the query plan.
      </div>
    );
  }

  const root = plan.root;
  if (plan.raw && !hasStructuredPlan(root)) {
    return (
      <pre className="mdbc-plan-json">
        {plan.raw}
      </pre>
    );
  }

  const maxCost = computeMax(root, planCost);
  return (
    <div className="mdbc-plan-flame-list">
      {renderPlanRow({ node: root, depth: 0, maxCost })}
    </div>
  );
}

export {
  PlanView,
};
