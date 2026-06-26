import type { CSSProperties } from "react";

interface PlanAttribute {
  key: string;
  value: string;
}

interface PlanNode {
  id?: string;
  label: string;
  node_type?: string;
  total_ms?: number;
  self_ms?: number;
  rows_actual?: number;
  rows_estimated?: number;
  cost_total?: number;
  attributes: PlanAttribute[];
  children: PlanNode[];
}

interface PlanResult {
  root: PlanNode;
  mode: "dryRun" | "analyze";
  raw: string;
}

interface PlanViewProps {
  plan: PlanResult | null;
}

interface PlanRowProps {
  node: PlanNode;
  depth: number;
  maxCost: number;
}

type PlanRowStyle = CSSProperties & Record<"--mdbc-plan-flame-indent", string>;
type PlanFlameStyle = CSSProperties & Record<"--mdbc-plan-flame-width" | "--mdbc-plan-flame-color" | "--mdbc-plan-flame-shadow", string>;

export type {
  PlanAttribute,
  PlanFlameStyle,
  PlanNode,
  PlanResult,
  PlanRowProps,
  PlanRowStyle,
  PlanViewProps,
};
