import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

interface FederationTab {
  id: string;
  title: string;
  participatingConnectionIds: string[];
  text: string;
}

interface PersistedFederationTab {
  id: string;
  title: string;
  participatingConnectionIds?: string[];
  text?: string;
}

function persistedToFederationTabs(persisted: PersistedFederationTab[]): FederationTab[] {
  return persisted.map((tab) => ({
    id: tab.id,
    title: tab.title,
    participatingConnectionIds: tab.participatingConnectionIds ?? [],
    text: tab.text ?? "",
  }));
}

function federationTabsToPersisted(tabs: FederationTab[]): PersistedFederationTab[] {
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    participatingConnectionIds: tab.participatingConnectionIds,
    text: tab.text,
  }));
}

function loadFederationTabsIPC(): Promise<PersistedFederationTab[]> {
  return invoke("cmd_load_federation_tabs");
}

function saveFederationTabsIPC(tabs: PersistedFederationTab[]): Promise<void> {
  return invoke("cmd_save_federation_tabs", { tabs });
}

interface FederationState {
  tabs: FederationTab[];
  activeId: string | null;
  addTab: (tab: FederationTab) => void;
  removeTab: (id: string) => void;
  focusTab: (id: string) => void;
  setText: (id: string, text: string) => void;
  toggleParticipant: (id: string, connectionId: string) => void;
  setTabs: (tabs: PersistedFederationTab[]) => void;
  /// Loads tabs from disk via IPC; replaces in-memory list.
  hydrate: () => Promise<void>;
  /// Persists current tabs via IPC. Caller invokes after mutations.
  persist: () => Promise<void>;
}

const useFederationStore = create<FederationState>((set) => ({
  tabs: [],
  activeId: null,
  addTab: (tab) => set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id })),
  removeTab: (id) =>
    set((s) => {
      const next = s.tabs.filter((t) => t.id !== id);
      return {
        tabs: next,
        activeId:
          s.activeId === id
            ? next.length
              ? next[next.length - 1].id
              : null
            : s.activeId,
      };
    }),
  focusTab: (id) => set({ activeId: id }),
  setText: (id, text) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, text } : t)),
    })),
  toggleParticipant: (id, connectionId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== id) return t;
        const has = t.participatingConnectionIds.includes(connectionId);
        return {
          ...t,
          participatingConnectionIds: has
            ? t.participatingConnectionIds.filter((c) => c !== connectionId)
            : [...t.participatingConnectionIds, connectionId],
        };
      }),
    })),
  setTabs: (persisted) => {
    const tabs = persistedToFederationTabs(persisted);
    set({
      tabs,
      activeId: tabs.length ? tabs[tabs.length - 1].id : null,
    });
  },

  hydrate: async () => {
    const persisted = await loadFederationTabsIPC();
    const tabs = persistedToFederationTabs(persisted);
    set({
      tabs,
      activeId: tabs.length ? tabs[tabs.length - 1].id : null,
    });
  },
  persist: async () => {
    const snapshot = useFederationStore.getState().tabs;
    await saveFederationTabsIPC(federationTabsToPersisted(snapshot));
  },
}));

export { useFederationStore };
