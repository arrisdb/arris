// Recent projects/files opened on the left-sidebar empty state.
// Persisted to localStorage so the list survives reloads.

import { create } from "zustand";
import { MAX_RECENTS, RECENTS_STORAGE_KEY } from "../constants";
import type { RecentEntry } from "../types";

interface RecentsState {
  recents: RecentEntry[];
  add: (entry: RecentEntry) => void;
  remove: (path: string) => void;
  clear: () => void;
}

function loadFromStorage(): RecentEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentEntry =>
        e &&
        typeof e.path === "string" &&
        typeof e.name === "string" &&
        (e.kind === "folder" || e.kind === "file") &&
        typeof e.openedAt === "number",
    );
  } catch {
    return [];
  }
}

function persist(recents: RecentEntry[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(recents));
  } catch {
    // ignore quota / disabled storage
  }
}

const useRecentsStore = create<RecentsState>((set, get) => ({
  recents: loadFromStorage(),
  add: (entry) => {
    const filtered = get().recents.filter((e) => e.path !== entry.path);
    const next = [entry, ...filtered].slice(0, MAX_RECENTS);
    persist(next);
    set({ recents: next });
  },
  remove: (path) => {
    const next = get().recents.filter((e) => e.path !== path);
    persist(next);
    set({ recents: next });
  },
  clear: () => {
    persist([]);
    set({ recents: [] });
  },
}));

export {
  useRecentsStore,
};
