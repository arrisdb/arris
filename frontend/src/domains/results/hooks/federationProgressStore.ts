import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { DagNode, ProgressEvent } from "../components/FederationProgress/types";

interface FederationProgressState {
  dag: DagNode[] | null;
  isRunning: boolean;
  showDag: boolean;
  error: string | null;
  startRun: () => void;
  endRun: () => void;
  toggleDag: () => void;
  reset: () => void;
}

let listenersReady = false;

function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;

  listen<DagNode[]>("federation-plan", (event) => {
    useFederationProgressStore.setState({ dag: event.payload });
  });

  listen<ProgressEvent>("federation-progress", (event) => {
    const { nodeId, status, metrics } = event.payload;
    useFederationProgressStore.setState((state) => {
      if (!state.dag) return state;
      const dag = state.dag.map((node) =>
        node.id === nodeId ? { ...node, status, metrics: metrics ?? node.metrics } : node,
      );
      return { dag };
    });
  });
}

const useFederationProgressStore = create<FederationProgressState>((set) => ({
  dag: null,
  isRunning: false,
  showDag: false,
  error: null,

  startRun: () => {
    ensureListeners();
    set({ dag: null, isRunning: true, showDag: true, error: null });
  },

  endRun: () => {
    set((state) => ({
      isRunning: false,
      // Collapse the live plan graph on completion so the result viewer is the
      // default view; the toolbar gitFork toggle still re-opens the plan.
      showDag: false,
      dag: state.dag?.map((n) =>
        n.status !== "done" && n.status !== "error"
          ? { ...n, status: "done" as const }
          : n,
      ) ?? null,
    }));
  },

  toggleDag: () => {
    set((s) => ({ showDag: !s.showDag }));
  },

  reset: () => set({ dag: null, isRunning: false, showDag: false, error: null }),
}));

export { useFederationProgressStore };
