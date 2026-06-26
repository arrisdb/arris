import { create } from "zustand";
import type { EditorHandle } from "@domains/editor/utils/ui/setup";

interface EditorHandleState {
  handle: EditorHandle | null;
  activeTabId: string | null;
  setHandle: (handle: EditorHandle | null, activeTabId: string | null) => void;
  clearHandle: () => void;
}

const useEditorHandleStore = create<EditorHandleState>((set) => ({
  handle: null,
  activeTabId: null,
  setHandle: (handle, activeTabId) => set({ handle, activeTabId }),
  clearHandle: () => set({ handle: null, activeTabId: null }),
}));

export { useEditorHandleStore };
