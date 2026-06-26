import { create } from "zustand";
import type { ComponentType } from "react";

// The editor pane is a generic tab host. Every non-default tab view (notebooks,
// git diffs, media previews, object definitions, …) is contributed here by its
// owning domain instead of being wired into a shell `switch`. A contribution
// declares which `tabType` it renders and how its element is wrapped; the
// router resolves the component to render for the active tab. Moving a tab view
// into a domain is a registry change, never a shell edit.
//
// `shared` is a leaf and must not import store types, so the tab is kept generic
// (`Tab`, erased to `unknown` inside the registry). Domains register components
// typed with their own `EditorTab`; the shell router passes the real tab in.

interface TabViewContribution<Tab = unknown> {
  // Matches `EditorTab.tabType`. One contribution per type; last registration
  // for a type wins (registration happens once, at startup).
  tabType: string;
  // When false the router renders the component bare; otherwise it wraps it in
  // the standard `.mdbc-tab-content` container (the common case).
  wrap?: boolean;
  Component: ComponentType<{ activeTab: Tab }>;
}

interface TabViewRegistryState {
  views: Record<string, TabViewContribution>;
  register: (view: TabViewContribution) => void;
}

const useTabViewRegistry = create<TabViewRegistryState>((set) => ({
  views: {},
  register: (view) =>
    set((state) => ({ views: { ...state.views, [view.tabType]: view } })),
}));

// Domains call this from their registration module. The component's concrete
// `Tab` prop is erased to the registry's `unknown` slot; the shell router holds
// the real `EditorTab` and supplies it at render.
function registerTabView<Tab>(view: TabViewContribution<Tab>): void {
  useTabViewRegistry.getState().register(view as TabViewContribution);
}

// Resolve the contribution for a tab type, or null when none is registered (the
// router then falls back to its built-in cases: console default, table, csv).
function useTabView(tabType: string | undefined): TabViewContribution | null {
  return useTabViewRegistry((state) => (tabType ? state.views[tabType] ?? null : null));
}

export { registerTabView, useTabView, useTabViewRegistry };
export type { TabViewContribution };
