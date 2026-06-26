
import { create } from "zustand";
import type { BrowseFilters, SortClause } from "@domains/results";

const SCHEMA_SELECTIONS_KEY = "arris.schemaSelections";

function loadSchemaSelections(): Record<string, string[]> {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(SCHEMA_SELECTIONS_KEY)
        : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

function saveSchemaSelections(value: Record<string, string[]>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SCHEMA_SELECTIONS_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be disabled.
  }
}

interface SchemaUiState {
  selectedNodeId: string | null;
  /// Connection that owns `selectedNodeId`. A node path alone is ambiguous (the
  /// same `db.schema.name` can exist under two connections), so commands acting
  /// on the selection (e.g. Show Definition via Cmd+B) read this to resolve the
  /// owning connection rather than guessing from the active connection.
  selectedConnectionId: string | null;
  expanded: Record<string, boolean>;
  filtersByTab: Record<string, BrowseFilters>;
  selectedSchemasByConnection: Record<string, string[]>;
  selectNode: (id: string | null, connectionId?: string | null) => void;
  toggleExpanded: (id: string) => void;
  setFilter: (tabId: string, raw: string) => void;
  setSorts: (tabId: string, sorts: SortClause[]) => void;
  toggleSort: (tabId: string, column: string) => void;
  resetFilters: (tabId: string) => void;
  filtersFor: (tabId: string) => BrowseFilters;
  setSelectedSchemas: (connectionId: string, schemas: string[]) => void;
}

const emptyFilters: BrowseFilters = { filter: { raw: "" }, sorts: [] };

const useSchemaUiStore = create<SchemaUiState>((set, get) => ({
  selectedNodeId: null,
  selectedConnectionId: null,
  expanded: {},
  filtersByTab: {},
  selectedSchemasByConnection: loadSchemaSelections(),
  selectNode: (id, connectionId) =>
    set({
      selectedNodeId: id,
      selectedConnectionId: id ? (connectionId ?? null) : null,
    }),
  toggleExpanded: (id) =>
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
  setFilter: (tabId, raw) =>
    set((s) => {
      const cur = s.filtersByTab[tabId] ?? emptyFilters;
      return {
        filtersByTab: {
          ...s.filtersByTab,
          [tabId]: { ...cur, filter: { raw } },
        },
      };
    }),
  setSorts: (tabId, sorts) =>
    set((s) => {
      const cur = s.filtersByTab[tabId] ?? emptyFilters;
      return {
        filtersByTab: { ...s.filtersByTab, [tabId]: { ...cur, sorts } },
      };
    }),
  toggleSort: (tabId, column) =>
    set((s) => {
      const cur = s.filtersByTab[tabId] ?? emptyFilters;
      const idx = cur.sorts.findIndex((c) => c.column === column);
      let sorts: SortClause[];
      if (idx === -1) sorts = [...cur.sorts, { column, direction: "asc" }];
      else if (cur.sorts[idx].direction === "asc")
        sorts = cur.sorts.map((c, i) =>
          i === idx ? { ...c, direction: "desc" as const } : c,
        );
      else sorts = cur.sorts.filter((_, i) => i !== idx);
      return {
        filtersByTab: { ...s.filtersByTab, [tabId]: { ...cur, sorts } },
      };
    }),
  resetFilters: (tabId) =>
    set((s) => {
      const { [tabId]: _, ...rest } = s.filtersByTab;
      return { filtersByTab: rest };
    }),
  filtersFor: (tabId) => get().filtersByTab[tabId] ?? emptyFilters,
  setSelectedSchemas: (connectionId, schemas) =>
    set((s) => {
      const next = {
        ...s.selectedSchemasByConnection,
        [connectionId]: schemas,
      };
      saveSchemaSelections(next);
      return { selectedSchemasByConnection: next };
    }),
}));

export {
  useSchemaUiStore,
};
