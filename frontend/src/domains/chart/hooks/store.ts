import { create } from "zustand";

interface ChartEditorState {
  targetTabId: string | null;
  // Bumped on every open() so the panel can re-trigger its shine animation
  // even when it is already open for the same tab.
  pulse: number;
  open: (tabId: string) => void;
  close: () => void;
}

const useChartEditorStore = create<ChartEditorState>((set) => ({
  targetTabId: null,
  pulse: 0,
  open: (tabId) => set((state) => ({ targetTabId: tabId, pulse: state.pulse + 1 })),
  close: () => set({ targetTabId: null }),
}));

export {
  useChartEditorStore,
};
