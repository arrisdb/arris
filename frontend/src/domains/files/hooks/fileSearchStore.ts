import { create } from "zustand";
import {
  DEFAULT_FILE_SEARCH_MODE,
  FILE_SEARCH_DEBOUNCE_MS,
  FILE_SEARCH_LIMIT,
} from "@domains/files/components/FileSearchPopover/constants";
import {
  fileSearchPopoverSearchContentIPC,
  fileSearchPopoverSearchFilesIPC,
} from "@domains/files/components/FileSearchPopover/ipc";
import type {
  ContentMatch,
  FileMatch,
  SearchMode,
} from "@domains/files/components/FileSearchPopover/types";

interface FileSearchState {
  open: boolean;
  mode: SearchMode;
  query: string;
  fileResults: FileMatch[];
  contentResults: ContentMatch[];
  selectedIndex: number;
  loading: boolean;
  show: (mode: SearchMode) => void;
  hide: () => void;
  setQuery: (q: string) => void;
  setMode: (mode: SearchMode) => void;
  selectNext: () => void;
  selectPrev: () => void;
  resultCount: () => number;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const useFileSearchStore = create<FileSearchState>((set, get) => ({
  open: false,
  mode: DEFAULT_FILE_SEARCH_MODE,
  query: "",
  fileResults: [],
  contentResults: [],
  selectedIndex: 0,
  loading: false,

  show: (mode) =>
    set({
      open: true,
      mode,
      query: "",
      fileResults: [],
      contentResults: [],
      selectedIndex: 0,
      loading: false,
    }),

  hide: () =>
    set({
      open: false,
      query: "",
      fileResults: [],
      contentResults: [],
      selectedIndex: 0,
      loading: false,
    }),

  setMode: (mode) => {
    set({ mode, fileResults: [], contentResults: [], selectedIndex: 0 });
    const { query } = get();
    if (query) get().setQuery(query);
  },

  setQuery: (q) => {
    set({ query: q, loading: q.length > 0 });
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!q) {
      set({ fileResults: [], contentResults: [], selectedIndex: 0, loading: false });
      return;
    }
    debounceTimer = setTimeout(async () => {
      const { mode } = get();
      try {
        if (mode === "file") {
          const results = await fileSearchPopoverSearchFilesIPC(q, FILE_SEARCH_LIMIT);
          set({ fileResults: results, loading: false, selectedIndex: 0 });
        } else {
          const results = await fileSearchPopoverSearchContentIPC(q, FILE_SEARCH_LIMIT);
          set({ contentResults: results, loading: false, selectedIndex: 0 });
        }
      } catch {
        set({ loading: false });
      }
    }, FILE_SEARCH_DEBOUNCE_MS);
  },

  selectNext: () => {
    const count = get().resultCount();
    if (count > 0) set((s) => ({ selectedIndex: (s.selectedIndex + 1) % count }));
  },

  selectPrev: () => {
    const count = get().resultCount();
    if (count > 0)
      set((s) => ({ selectedIndex: (s.selectedIndex - 1 + count) % count }));
  },

  resultCount: () => {
    const { mode, fileResults, contentResults } = get();
    return mode === "file" ? fileResults.length : contentResults.length;
  },
}));

export {
  useFileSearchStore,
};
