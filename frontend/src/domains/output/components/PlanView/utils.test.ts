import { describe, expect, it } from "vitest";
import type { PlanNode } from "./types";
import {
  computeMax,
  flameHeat,
  hasStructuredPlan,
  planCost,
} from "./utils";

function node(overrides: Partial<PlanNode>): PlanNode {
  return {
    label: "root",
    attributes: [],
    children: [],
    ...overrides,
  };
}

describe("PlanView utils", () => {
  it("detects structured plans", () => {
    expect(hasStructuredPlan(node({ label: "Seq Scan" }))).toBe(true);
    expect(hasStructuredPlan(node({ label: "", attributes: [], children: [] }))).toBe(false);
  });

  it("computes max plan cost recursively", () => {
    const root = node({
      total_ms: 5,
      children: [
        node({ total_ms: 20 }),
        node({ cost_total: 10 }),
      ],
    });
    expect(computeMax(root, planCost)).toBe(20);
  });

  it("maps heat colors by duration", () => {
    expect(flameHeat(undefined)).toBe("var(--m-accent)");
    expect(flameHeat(5)).toBe("#5be39a");
    expect(flameHeat(50)).toBe("#ffd960");
    expect(flameHeat(200)).toBe("#ffa14a");
    expect(flameHeat(600)).toBe("#ff6b6b");
  });
});
