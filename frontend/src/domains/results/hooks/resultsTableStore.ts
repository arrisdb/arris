// Runtime-only; flushed via `apply_pending_writes` IPC when user clicks Upload.

import { create } from "zustand";
import type { QueryValue } from "../components/ResultsTableView/types";
import { DEFAULT_RESULTS_PAGE_SIZE } from "../constants";
import type { CellEdit, CellLocator, PendingInsert, ResultsPaneMode } from "../types";

interface ResultsTableState {
  edits: Record<string, CellEdit>;
  inserts: PendingInsert[];
  deletes: { tabId: string; rowIndex: number }[];
  modeByTab: Record<string, ResultsPaneMode>;
  /// Pane mode for the global bottom pane (Results vs Command Logs). Unlike
  /// `modeByTab`, this is not keyed by tab so Command Logs stays reachable even
  /// with no run or no open tab.
  globalMode: ResultsPaneMode;
  defaultPageSize: number;
  pageSizeByTab: Record<string, number>;
  currentPageByTab: Record<string, number>;
  /// User-dragged column widths in px, keyed tabId → column name. Columns
  /// without an entry size to content (capped at the stylesheet max-width).
  colWidthsByTab: Record<string, Record<string, number>>;
  /// True when the last pointer-down landed inside the bottom Results pane, so
  /// Cmd+W closes the active run chip there instead of the editor's file tab.
  bottomResultsFocused: boolean;
  setBottomResultsFocused: (focused: boolean) => void;
  setEdit: (locator: CellLocator, edit: CellEdit) => void;
  clearEdit: (locator: CellLocator) => void;
  addInsert: (insert: PendingInsert) => void;
  removeInsert: (draftId: string) => void;
  setInsertValue: (draftId: string, column: string, value: QueryValue) => void;
  toggleDelete: (tabId: string, rowIndex: number) => void;
  resetEditing: (tabId: string) => void;
  setMode: (tabId: string, mode: ResultsPaneMode) => void;
  setGlobalMode: (mode: ResultsPaneMode) => void;
  getPageSize: (tabId: string) => number;
  getPage: (tabId: string) => number;
  setPageSize: (tabId: string, size: number) => void;
  setPage: (tabId: string, page: number) => void;
  setDefaultPageSize: (size: number) => void;
  resetPage: (tabId: string) => void;
  setColWidth: (tabId: string, column: string, width: number) => void;
}

// Floor for a drag-resized column so it can't be collapsed to nothing.
const MIN_COL_WIDTH = 48;

function key(loc: CellLocator): string {
  return `${loc.tabId}:${loc.rowIndex}:${loc.column}`;
}

const useResultsTableStore = create<ResultsTableState>((set, get) => ({
  edits: {},
  inserts: [],
  deletes: [],
  modeByTab: {},
  globalMode: "results",
  defaultPageSize: DEFAULT_RESULTS_PAGE_SIZE,
  pageSizeByTab: {},
  currentPageByTab: {},
  colWidthsByTab: {},
  bottomResultsFocused: false,
  setBottomResultsFocused: (focused) => set({ bottomResultsFocused: focused }),
  setEdit: (locator, edit) =>
    set((s) => ({ edits: { ...s.edits, [key(locator)]: edit } })),
  clearEdit: (locator) =>
    set((s) => {
      const k = key(locator);
      const { [k]: _, ...rest } = s.edits;
      return { edits: rest };
    }),
  addInsert: (insert) => set((s) => ({ inserts: [...s.inserts, insert] })),
  removeInsert: (draftId) =>
    set((s) => ({ inserts: s.inserts.filter((i) => i.draftId !== draftId) })),
  setInsertValue: (draftId, column, value) =>
    set((s) => ({
      inserts: s.inserts.map((insert) =>
        insert.draftId === draftId
          ? { ...insert, values: { ...insert.values, [column]: value } }
          : insert,
      ),
    })),
  toggleDelete: (tabId, rowIndex) =>
    set((s) => {
      const exists = s.deletes.some(
        (d) => d.tabId === tabId && d.rowIndex === rowIndex,
      );
      return {
        deletes: exists
          ? s.deletes.filter(
              (d) => !(d.tabId === tabId && d.rowIndex === rowIndex),
            )
          : [...s.deletes, { tabId, rowIndex }],
      };
    }),
  resetEditing: (tabId) =>
    set((s) => {
      const filteredEdits: Record<string, CellEdit> = {};
      for (const k of Object.keys(s.edits)) {
        if (!k.startsWith(`${tabId}:`)) filteredEdits[k] = s.edits[k];
      }
      return {
        edits: filteredEdits,
        inserts: s.inserts.filter((i) => i.tabId !== tabId),
        deletes: s.deletes.filter((d) => d.tabId !== tabId),
      };
    }),
  setMode: (tabId, mode) => set((s) => ({ modeByTab: { ...s.modeByTab, [tabId]: mode } })),
  setGlobalMode: (mode) => set({ globalMode: mode }),
  getPageSize: (tabId) => get().pageSizeByTab[tabId] ?? get().defaultPageSize,
  getPage: (tabId) => get().currentPageByTab[tabId] ?? 0,
  setPageSize: (tabId, size) =>
    set((s) => ({
      pageSizeByTab: { ...s.pageSizeByTab, [tabId]: size },
      currentPageByTab: { ...s.currentPageByTab, [tabId]: 0 },
    })),
  setPage: (tabId, page) =>
    set((s) => ({
      currentPageByTab: { ...s.currentPageByTab, [tabId]: page },
    })),
  setDefaultPageSize: (size) => set({ defaultPageSize: size }),
  resetPage: (tabId) =>
    set((s) => ({
      currentPageByTab: { ...s.currentPageByTab, [tabId]: 0 },
    })),
  setColWidth: (tabId, column, width) =>
    set((s) => ({
      colWidthsByTab: {
        ...s.colWidthsByTab,
        [tabId]: { ...(s.colWidthsByTab[tabId] ?? {}), [column]: Math.max(MIN_COL_WIDTH, Math.round(width)) },
      },
    })),
}));

export {
  useResultsTableStore,
};
