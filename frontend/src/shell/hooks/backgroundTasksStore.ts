import { create } from "zustand";
import type { BackgroundTask } from "../types";

interface BackgroundTasksState {
  tasks: Map<string, string>;
  startTask: (id: string, label: string) => void;
  endTask: (id: string) => void;
  activeTasks: () => BackgroundTask[];
}

const useBackgroundTasksStore = create<BackgroundTasksState>(
  (set, get) => ({
    tasks: new Map(),
    startTask: (id, label) => {
      set((state) => {
        const next = new Map(state.tasks);
        next.set(id, label);
        return { tasks: next };
      });
    },
    endTask: (id) => {
      set((state) => {
        const next = new Map(state.tasks);
        next.delete(id);
        return { tasks: next };
      });
    },
    activeTasks: () => {
      const result: BackgroundTask[] = [];
      get().tasks.forEach((label, id) => {
        result.push({ id, label });
      });
      return result;
    },
  }),
);

export {
  useBackgroundTasksStore,
};
