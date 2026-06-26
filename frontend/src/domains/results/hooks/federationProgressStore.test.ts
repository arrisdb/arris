import { describe, it, expect, beforeEach } from "vitest";
import { useFederationProgressStore } from "./federationProgressStore";
import type { DagNode } from "@domains/results/components/FederationProgress/types";

function node(id: number, status: DagNode["status"]): DagNode {
  return { id, label: `n${id}`, status, children: [] };
}

describe("federationProgress endRun", () => {
  beforeEach(() => {
    useFederationProgressStore.getState().reset();
  });

  it("hides the DAG when the run completes so the result viewer shows by default", () => {
    useFederationProgressStore.setState({
      isRunning: true,
      showDag: true,
      dag: [node(1, "running")],
    });
    useFederationProgressStore.getState().endRun();
    const state = useFederationProgressStore.getState();
    expect(state.isRunning).toBe(false);
    expect(state.showDag).toBe(false);
  });

  it("marks unfinished nodes as done on completion", () => {
    useFederationProgressStore.setState({
      isRunning: true,
      showDag: true,
      dag: [node(1, "running"), node(2, "error")],
    });
    useFederationProgressStore.getState().endRun();
    const dag = useFederationProgressStore.getState().dag!;
    expect(dag[0].status).toBe("done");
    expect(dag[1].status).toBe("error");
  });

  it("still lets the user toggle the plan back on after completion", () => {
    useFederationProgressStore.setState({
      isRunning: true,
      showDag: true,
      dag: [node(1, "running")],
    });
    useFederationProgressStore.getState().endRun();
    useFederationProgressStore.getState().toggleDag();
    expect(useFederationProgressStore.getState().showDag).toBe(true);
  });
});
