import { create } from "zustand";
import { useMemo } from "react";
import type { ComponentType } from "react";

// The rails (left/right sidebars) are generic frames. Every pane that can live
// in a rail is contributed here by its owning domain instead of being wired
// into the shell. A pane declares which side it defaults to and how it behaves;
// the rail host resolves which contribution to render. Because placement is
// data (and overridable at runtime via `setSide`), moving a pane from one rail
// to the other is a registry change, never a shell edit.

type PaneSide = "left" | "right";

// "primary" panes are mutually exclusive on a side: at most one shows, chosen
// by priority among the active ones (or by an explicit selector on the left).
// "section" panes stack: every active section on the side renders together.
type PaneKind = "primary" | "section";

interface PaneContribution {
  id: string;
  side: PaneSide;
  kind: PaneKind;
  // Higher priority wins when several primaries are active on the same side.
  priority: number;
  // Short label for the left-rail primary selector; unused by sections.
  title?: string;
  // Domain-owned eligibility hook. The rail host calls it every render in a
  // stable order, so it must obey the Rules of Hooks like any other hook.
  useActive: () => boolean;
  Component: ComponentType;
}

interface PaneRegistryState {
  panes: Record<string, PaneContribution>;
  // Runtime placement overrides (e.g. user drags a pane to the other rail).
  // Keyed by pane id; absent means "use the contribution's default side".
  sideOverrides: Record<string, PaneSide>;
  register: (pane: PaneContribution) => void;
  setSide: (id: string, side: PaneSide | null) => void;
}

const usePaneRegistry = create<PaneRegistryState>((set) => ({
  panes: {},
  sideOverrides: {},
  register: (pane) =>
    set((state) => ({ panes: { ...state.panes, [pane.id]: pane } })),
  setSide: (id, side) =>
    set((state) => {
      const next = { ...state.sideOverrides };
      if (side === null) delete next[id];
      else next[id] = side;
      return { sideOverrides: next };
    }),
}));

function registerPane(pane: PaneContribution): void {
  usePaneRegistry.getState().register(pane);
}

function setPaneSide(id: string, side: PaneSide | null): void {
  usePaneRegistry.getState().setSide(id, side);
}

// --- Pure resolution helpers (no React; unit-testable) ----------------------

function resolvedSide(
  pane: PaneContribution,
  overrides: Record<string, PaneSide>,
): PaneSide {
  return overrides[pane.id] ?? pane.side;
}

// Every pane resolved onto `side`, highest priority first (id as a stable
// tiebreak so ordering is deterministic). Optionally filtered to one kind.
function panesForSide(
  panes: Record<string, PaneContribution>,
  overrides: Record<string, PaneSide>,
  side: PaneSide,
  kind?: PaneKind,
): PaneContribution[] {
  return Object.values(panes)
    .filter((pane) => resolvedSide(pane, overrides) === side)
    .filter((pane) => (kind ? pane.kind === kind : true))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

// The single primary to render on a side: the highest-priority active one.
// `candidates` is assumed already priority-sorted (see panesForSide).
function activePrimary(
  candidates: PaneContribution[],
  activeIds: ReadonlySet<string>,
): PaneContribution | null {
  return candidates.find((pane) => pane.kind === "primary" && activeIds.has(pane.id)) ?? null;
}

// Every active section on a side, in priority order.
function activeSections(
  candidates: PaneContribution[],
  activeIds: ReadonlySet<string>,
): PaneContribution[] {
  return candidates.filter((pane) => pane.kind === "section" && activeIds.has(pane.id));
}

// --- Rail resolution hook ---------------------------------------------------

interface RailContent {
  primary: PaneContribution | null;
  sections: PaneContribution[];
}

// Resolves what a rail should render for `side`: the single active primary plus
// every active section. The candidate set is fixed at startup (panes register
// once, before the first render), so iterating it and calling each `useActive`
// hook keeps a stable hook order across renders: the Rules of Hooks invariant
// this relies on. Adding panes at runtime would break that and is intentionally
// not supported; only placement (side) changes at runtime.
function useRailContent(side: PaneSide): RailContent {
  const panes = usePaneRegistry((state) => state.panes);
  const overrides = usePaneRegistry((state) => state.sideOverrides);
  const candidates = useMemo(() => panesForSide(panes, overrides, side), [panes, overrides, side]);

  const activeIds = new Set<string>();
  for (const pane of candidates) {
    if (pane.useActive()) activeIds.add(pane.id);
  }

  return {
    primary: activePrimary(candidates, activeIds),
    sections: activeSections(candidates, activeIds),
  };
}

export {
  activePrimary,
  activeSections,
  panesForSide,
  registerPane,
  resolvedSide,
  setPaneSide,
  useRailContent,
  usePaneRegistry,
};
export type { PaneContribution, PaneKind, PaneSide };
