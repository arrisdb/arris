import { create } from "zustand";
import {
  loadPinnedQueriesIPC,
  savePinnedQueriesIPC,
} from "@domains/pinnedQueries/components/PinnedQueriesPane/ipc";
import type { PinnedQueriesState } from "@domains/pinnedQueries/components/PinnedQueriesPane/types";
import { useChartEditorStore } from "@domains/chart/hooks";
import { useAgentStore } from "@domains/agent/hooks";

const usePinnedQueriesStore = create<PinnedQueriesState>((set, get) => ({
  queries: [],
  paneOpen: false,

  // Names need not be unique; each pinned query (and its editor tab) is keyed
  // by a generated id, so duplicate display names are allowed.
  addQuery: (q) => {
    const id = crypto.randomUUID();
    set((s) => ({ queries: [...s.queries, { ...q, id }] }));
    get().persist();
    return id;
  },

  removeQuery: (id) => {
    set((s) => ({ queries: s.queries.filter((q) => q.id !== id) }));
    get().persist();
  },

  patchQuery: (id, patch) => {
    set((s) => ({
      queries: s.queries.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    }));
    get().persist();
  },

  setQueries: (queries) => set({ queries }),

  togglePane: () => {
    if (get().paneOpen) get().closePane();
    else get().openPane();
  },
  // The right sidebar shows one pane at a time, so revealing pinned queries
  // closes the chart editor and agent panel. Routing every open through here
  // keeps the rail toggles mutually exclusive no matter who opens the pane
  // (toggle command, "pin query" actions, etc.).
  openPane: () => {
    useChartEditorStore.getState().close();
    useAgentStore.getState().closePane();
    set({ paneOpen: true });
  },
  closePane: () => set({ paneOpen: false }),

  hydrate: async () => {
    const queries = await loadPinnedQueriesIPC();
    set({ queries });
  },

  persist: async () => {
    const { queries } = get();
    await savePinnedQueriesIPC(queries);
  },
}));

export {
  usePinnedQueriesStore,
};
