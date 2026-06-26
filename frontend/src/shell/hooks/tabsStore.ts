// Pane groups live entirely in the frontend (the backend `query_tabs.json`
// schema stores only the flat tab list); the group layout is persisted
// separately to localStorage by App.tsx. The layout is a `PaneNode` tree;
// see `paneTree.ts` for the pure arrangement helpers this store builds on.

import { create } from "zustand";
import type {
  ObjectIdentity,
  TableRef,
} from "@shared";
import { useSettingsStore } from "@shared/settings";
import type { EditorTab, PaneNode, SplitDirection } from "../types";
import {
  findLeaf,
  findLeafWithTab,
  firstLeaf,
  leavesOf,
  makeLeaf,
  mapLeaves,
  pruneEmpty,
  setSplitSizes,
  splitLeaf,
} from "../utils/paneTree";

interface TabsState {
  tabs: EditorTab[];
  /// Pane layout tree. Leaves (`PaneGroup`) own a subset of `tabs` and render
  /// their own tab bar + editor + result pane; splits arrange them in 2D.
  /// `null` when no panes are open.
  layout: PaneNode | null;
  /// Group the user last interacted with, receives newly-opened tabs.
  focusedPaneGroupId: string | null;
  /// Tab id currently shown in the focused group; mirrors that group's
  /// `selectedTabId`. Kept on the state so existing call-sites
  /// (`useTabsStore(s => s.activeId)`) keep working.
  activeId: string | null;

  setTabs: (tabs: EditorTab[]) => void;
  /// Replace the pane layout tree (used during localStorage hydration).
  setLayout: (layout: PaneNode | null, focusedId: string | null) => void;
  openTab: (tab: EditorTab) => void;
  addTab: (opts: { connectionId?: string; kind?: string; title?: string }) => EditorTab;
  /// Open (or refocus) a built-in read-only document (e.g. bundled license
  /// text) as an in-memory markdown tab. Deduped by title; carries no
  /// `filePath`, so it is never written to disk.
  openDocTab: (opts: { title: string; text: string }) => EditorTab;
  openFileTab: (opts: { filePath: string; title: string; text: string; kind: string; cursor?: number; connectionId?: string }) => EditorTab;
  /// Open (or refocus) a `.ipynb` file as a notebook tab. Carries the raw file
  /// text; the NotebookView parses it into cells on mount.
  openNotebookTab: (opts: { filePath: string; title: string; text: string }) => EditorTab;
  openMediaTab: (opts: { filePath: string; title: string }) => EditorTab;
  openTableTab: (opts: { connectionId: string; tableRef: TableRef; kind: string; editable: boolean; text?: string }) => EditorTab;
  /// Open (or refocus) the editor tab bound to a pinned query. One tab per
  /// `pinnedQueryId`; reopening refreshes its `text`/`title` from the query and
  /// refocuses. Edits flow back to the pinned query via `usePinnedQueryTabSync`.
  openPinnedQueryTab: (opts: { pinnedQueryId: string; title: string; text: string; kind: string; connectionId?: string }) => EditorTab;
  /// Open (or refocus) a read-only DDL tab for a database object. One tab per
  /// connection + object identity (kind/database/schema/name); reopening
  /// refreshes its DDL `text` and refocuses.
  openObjectDefinitionTab: (opts: { connectionId: string; object: ObjectIdentity; kind: string; title: string; text: string }) => EditorTab;
  openTerminalTab: () => EditorTab;
  /// Open a brand-new untitled in-memory notebook tab (not backed by a file).
  /// The NotebookView seeds it with a single empty Python cell on mount.
  openUntitledNotebookTab: () => EditorTab;
  /// Open (or refocus) the single "Uncommitted Changes" git diff tab. Only one
  /// can ever exist; a second call refocuses the existing one.
  openGitDiffTab: () => EditorTab;
  openGitHistoryTab: () => EditorTab;
  /// Open (or refocus) the per-commit diff tab for `commitId`. One tab per
  /// commit; reopening updates the `filePath` to focus and refocuses it.
  openGitCommitDiffTab: (opts: { commitId: string; title: string; filePath?: string }) => EditorTab;
  openGitConflictTab: () => EditorTab;
  /// Remove the tab from its pane group (the editor "closes" it) but keep
  /// the tab in `tabs[]` so the right-sidebar EditorTabsSection still lists
  /// it. Use `deleteTab` to fully discard.
  closeTab: (id: string) => void;
  /// Permanently remove the tab from `tabs[]` and any pane group.
  deleteTab: (id: string) => void;
  focusTab: (id: string) => void;
  focusGroup: (groupId: string) => void;
  /// Move a tab into a brand-new group adjacent to its current one, in the
  /// given direction. No-op when the source group only has one tab.
  splitTab: (tabId: string, direction: SplitDirection) => void;
  /// Move a tab from its current group into `targetGroupId`. Auto-collapses
  /// an emptied source group.
  moveTabToGroup: (tabId: string, targetGroupId: string) => void;
  updateTab: (id: string, patch: Partial<EditorTab>) => void;
  reorderTabInGroup: (groupId: string, fromIndex: number, toIndex: number) => void;
  /// Set the flex fractions of a split's children (driven by dragging the
  /// separator between two panes).
  resizeSplit: (splitId: string, sizes: number[]) => void;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/// Focus an already-placed tab inside its current leaf (selecting it). Returns
/// `null` when the tab isn't in any leaf (it was closed).
function selectTabInLeaf(
  layout: PaneNode | null,
  tabId: string,
): { layout: PaneNode; focusedPaneGroupId: string } | null {
  const leaf = findLeafWithTab(layout, tabId);
  if (!leaf || !layout) return null;
  return {
    layout: mapLeaves(layout, (l) =>
      l.id === leaf.id ? { ...l, selectedTabId: tabId } : l,
    ),
    focusedPaneGroupId: leaf.id,
  };
}

/// Attach a tab id to the focused leaf, creating a root leaf when the layout is
/// empty. Used when (re)opening a tab that has no current pane placement.
function attachTabToFocusedLeaf(
  layout: PaneNode | null,
  focusedId: string | null,
  tabId: string,
): { layout: PaneNode; focusedPaneGroupId: string } {
  if (!layout) {
    const leaf = makeLeaf([tabId], tabId);
    return { layout: leaf, focusedPaneGroupId: leaf.id };
  }
  const fid =
    focusedId && findLeaf(layout, focusedId) ? focusedId : firstLeaf(layout)!.id;
  return {
    layout: mapLeaves(layout, (l) =>
      l.id === fid
        ? { ...l, tabIds: [...l.tabIds, tabId], selectedTabId: tabId }
        : l,
    ),
    focusedPaneGroupId: fid,
  };
}

/// Reconcile a pane layout against the flat tab list:
///  * drop tabIds that no longer exist
///  * drop empty leaves and collapse single-child splits
///  * append any orphan tab ids to the first leaf (or a fresh root leaf)
///  * make sure each leaf's `selectedTabId` is one of its tabIds
///  * make sure `focusedPaneGroupId` points at a real leaf
function reconcileLayout(
  tabs: EditorTab[],
  layout: PaneNode | null,
  focusedId: string | null,
): { layout: PaneNode | null; focusedPaneGroupId: string | null; activeId: string | null } {
  const tabIds = new Set(tabs.map((t) => t.id));
  let next: PaneNode | null = layout
    ? mapLeaves(layout, (l) => {
        const filtered = l.tabIds.filter((id) => tabIds.has(id));
        const selected =
          l.selectedTabId && filtered.includes(l.selectedTabId)
            ? l.selectedTabId
            : (filtered[filtered.length - 1] ?? null);
        return { ...l, tabIds: filtered, selectedTabId: selected };
      })
    : null;
  next = pruneEmpty(next);

  // Tabs not in any leaf → first leaf (creating a root leaf if needed).
  // Skip closed tabs; they belong in tabs[] but not in any pane group.
  const claimed = new Set(leavesOf(next).flatMap((l) => l.tabIds));
  const orphans = tabs
    .filter((t) => !claimed.has(t.id) && !t.closed)
    .map((t) => t.id);
  if (orphans.length > 0) {
    if (!next) {
      next = makeLeaf(orphans, orphans[0]);
    } else {
      const firstId = firstLeaf(next)!.id;
      next = mapLeaves(next, (l) =>
        l.id === firstId
          ? {
              ...l,
              tabIds: [...l.tabIds, ...orphans],
              selectedTabId: l.selectedTabId ?? orphans[0],
            }
          : l,
      );
    }
  }

  if (!next) return { layout: null, focusedPaneGroupId: null, activeId: null };
  const validFocused =
    focusedId && findLeaf(next, focusedId) ? focusedId : firstLeaf(next)!.id;
  const focused = findLeaf(next, validFocused)!;
  return {
    layout: next,
    focusedPaneGroupId: validFocused,
    activeId: focused.selectedTabId,
  };
}

const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  layout: null,
  focusedPaneGroupId: null,
  activeId: null,
  setTabs: (tabs) =>
    set((s) => {
      const r = reconcileLayout(tabs, s.layout, s.focusedPaneGroupId);
      return {
        tabs,
        layout: r.layout,
        focusedPaneGroupId: r.focusedPaneGroupId,
        activeId: r.activeId,
      };
    }),
  setLayout: (layout, focusedId) =>
    set((s) => {
      // Hydration call (`s.tabs` may be empty when pane layout loads from
      // localStorage *before* `setTabs` runs). Skip reconciliation so the
      // persisted layout survives until `setTabs` reconciles against the
      // real tab list.
      if (s.tabs.length === 0) {
        const validFocused =
          focusedId && findLeaf(layout, focusedId)
            ? focusedId
            : firstLeaf(layout)?.id ?? null;
        return {
          layout,
          focusedPaneGroupId: validFocused,
          activeId: null,
        };
      }
      const r = reconcileLayout(s.tabs, layout, focusedId);
      return {
        layout: r.layout,
        focusedPaneGroupId: r.focusedPaneGroupId,
        activeId: r.activeId,
      };
    }),
  openTab: (tab) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.id === tab.id);
      if (existing) {
        // Already known: just focus it inside its owning group.
        const sel = selectTabInLeaf(s.layout, tab.id);
        if (!sel) return {};
        return { ...sel, activeId: tab.id };
      }
      return appendTabToFocusedGroup(s, { ...tab, createdAt: tab.createdAt ?? Date.now() });
    }),
  addTab: ({ connectionId, kind, title }) => {
    const seq = get().tabs.length + 1;
    const tab: EditorTab = {
      id: makeId(),
      title: title ?? `Console ${seq}`,
      text: "",
      kind: kind ?? "sql",
      connectionId: connectionId,
      cursor: 0,
      tabType: "console",
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  openDocTab: ({ title, text }) => {
    const existing = get().tabs.find(
      (t) => t.tabType === "doc" && t.title === title,
    );
    if (existing) {
      set((s) => {
        const tabs =
          existing.text !== text
            ? s.tabs.map((t) => (t.id === existing.id ? { ...t, text } : t))
            : s.tabs;
        const sel = selectTabInLeaf(s.layout, existing.id);
        if (sel) {
          return { tabs, layout: sel.layout, focusedPaneGroupId: sel.focusedPaneGroupId, activeId: existing.id };
        }
        const att = attachTabToFocusedLeaf(s.layout, s.focusedPaneGroupId, existing.id);
        return { tabs, layout: att.layout, focusedPaneGroupId: att.focusedPaneGroupId, activeId: existing.id };
      });
      return { ...existing, text };
    }
    const tab: EditorTab = {
      id: makeId(),
      title,
      text,
      kind: "markdown",
      cursor: 0,
      tabType: "doc",
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  openFileTab: ({ filePath, title, text, kind, cursor: cursorPos, connectionId }) => {
    const existing = get().tabs.find((t) => t.filePath === filePath);
    if (existing) {
      // Refocus + refresh contents (file may have changed on disk).
      set((s) => {
        const updatedTabs = s.tabs.map((t) =>
          t.id === existing.id
            ? { ...t, text, title, kind, ...(connectionId !== undefined ? { connectionId } : {}), ...(cursorPos != null ? { cursor: cursorPos, refreshToken: (t.refreshToken ?? 0) + 1 } : {}) }
            : t,
        );
        const sel = selectTabInLeaf(s.layout, existing.id);
        if (sel) {
          return {
            tabs: updatedTabs,
            layout: sel.layout,
            focusedPaneGroupId: sel.focusedPaneGroupId,
            activeId: existing.id,
          };
        }
        // Tab was closed (removed from the layout but still in tabs[]).
        // Re-attach only this tab to the focused group; don't reconcile
        // all tabs, which would resurrect every other closed tab too.
        const att = attachTabToFocusedLeaf(s.layout, s.focusedPaneGroupId, existing.id);
        return {
          tabs: updatedTabs,
          layout: att.layout,
          focusedPaneGroupId: att.focusedPaneGroupId,
          activeId: existing.id,
        };
      });
      return { ...existing, text, title, kind };
    }
    const tab: EditorTab = {
      id: makeId(),
      title,
      text,
      kind,
      connectionId,
      cursor: cursorPos ?? 0,
      tabType: "file",
      filePath,
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  openNotebookTab: ({ filePath, title, text }) => {
    const existing = get().tabs.find((t) => t.filePath === filePath);
    if (existing) {
      // Refocus the existing notebook tab without clobbering unsaved edits,
      // the NotebookView keeps the live cell document in its own store.
      get().focusTab(existing.id);
      return existing;
    }
    const tab: EditorTab = {
      id: makeId(),
      title,
      text,
      kind: "notebook",
      cursor: 0,
      tabType: "notebook",
      filePath,
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  openMediaTab: ({ filePath, title }) => {
    const existing = get().tabs.find((t) => t.filePath === filePath);
    if (existing) {
      get().focusTab(existing.id);
      return existing;
    }
    const tab: EditorTab = {
      id: makeId(),
      title,
      text: "",
      kind: "media",
      cursor: 0,
      tabType: "media",
      filePath,
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  openTableTab: ({ connectionId, tableRef, kind, editable, text }) => {
    const existing = get().tabs.find(
      (t) =>
        t.tabType === "table" &&
        t.connectionId === connectionId &&
        t.tableRef?.name === tableRef.name &&
        t.tableRef?.schema === tableRef.schema,
    );
    if (existing) {
      set((s) => {
        const tabs = text && existing.text !== text
          ? s.tabs.map((t) => t.id === existing.id ? { ...t, text } : t)
          : s.tabs;
        const sel = selectTabInLeaf(s.layout, existing.id);
        if (sel) {
          return {
            tabs,
            layout: sel.layout,
            focusedPaneGroupId: sel.focusedPaneGroupId,
            activeId: existing.id,
          };
        }
        const att = attachTabToFocusedLeaf(s.layout, s.focusedPaneGroupId, existing.id);
        return {
          tabs,
          layout: att.layout,
          focusedPaneGroupId: att.focusedPaneGroupId,
          activeId: existing.id,
        };
      });
      return text ? { ...existing, text } : existing;
    }
    const tab: EditorTab = {
      id: makeId(),
      title: tableRef.name,
      text: text ?? "",
      kind,
      connectionId: connectionId,
      cursor: 0,
      tabType: "table",
      tableRef,
      tableEditable: editable,
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    return tab;
  },
  openPinnedQueryTab: ({ pinnedQueryId, title, text, kind, connectionId }) => {
    const existing = get().tabs.find(
      (t) => t.tabType === "pinned" && t.pinnedQueryId === pinnedQueryId,
    );
    if (existing) {
      set((s) => {
        const tabs =
          existing.text !== text || existing.title !== title
            ? s.tabs.map((t) =>
                t.id === existing.id
                  ? {
                      ...t,
                      text,
                      title,
                      refreshToken: (t.refreshToken ?? 0) + 1,
                    }
                  : t,
              )
            : s.tabs;
        const sel = selectTabInLeaf(s.layout, existing.id);
        if (sel) {
          return {
            tabs,
            layout: sel.layout,
            focusedPaneGroupId: sel.focusedPaneGroupId,
            activeId: existing.id,
          };
        }
        const att = attachTabToFocusedLeaf(s.layout, s.focusedPaneGroupId, existing.id);
        return {
          tabs,
          layout: att.layout,
          focusedPaneGroupId: att.focusedPaneGroupId,
          activeId: existing.id,
        };
      });
      return { ...existing, text, title };
    }
    const tab: EditorTab = {
      id: makeId(),
      title,
      text,
      kind,
      connectionId,
      cursor: 0,
      tabType: "pinned",
      pinnedQueryId,
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  openObjectDefinitionTab: ({ connectionId, object, kind, title, text }) => {
    const existing = get().tabs.find(
      (t) =>
        t.tabType === "definition" &&
        t.connectionId === connectionId &&
        t.objectRef?.kind === object.kind &&
        t.objectRef?.name === object.name &&
        t.objectRef?.schema === object.schema &&
        t.objectRef?.database === object.database,
    );
    if (existing) {
      set((s) => {
        const tabs = existing.text !== text
          ? s.tabs.map((t) => (t.id === existing.id ? { ...t, text } : t))
          : s.tabs;
        const sel = selectTabInLeaf(s.layout, existing.id);
        if (sel) {
          return {
            tabs,
            layout: sel.layout,
            focusedPaneGroupId: sel.focusedPaneGroupId,
            activeId: existing.id,
          };
        }
        const att = attachTabToFocusedLeaf(s.layout, s.focusedPaneGroupId, existing.id);
        return {
          tabs,
          layout: att.layout,
          focusedPaneGroupId: att.focusedPaneGroupId,
          activeId: existing.id,
        };
      });
      return { ...existing, text };
    }
    const tab: EditorTab = {
      id: makeId(),
      title,
      text,
      kind,
      connectionId,
      cursor: 0,
      tabType: "definition",
      objectRef: object,
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    return tab;
  },
  openTerminalTab: () => {
    const seq = get().tabs.filter((t) => t.tabType === "terminal").length + 1;
    const tab: EditorTab = {
      id: makeId(),
      title: `Terminal ${seq}`,
      text: "",
      kind: "terminal",
      cursor: 0,
      tabType: "terminal",
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  openUntitledNotebookTab: () => {
    // Derive the next number from the highest existing "Notebook N" title rather
    // than a count: closed notebooks linger in tabs[] (closed: true) and still
    // show in the sidebar, so a count would skip and collide (e.g. two "2").
    const maxSeq = get().tabs.reduce((max, t) => {
      if (t.tabType !== "notebook") return max;
      const m = /^Notebook (\d+)$/.exec(t.title);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    const tab: EditorTab = {
      id: makeId(),
      title: `Notebook ${maxSeq + 1}`,
      text: "",
      kind: "notebook",
      cursor: 0,
      tabType: "notebook",
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  openGitDiffTab: () => {
    const existing = get().tabs.find((t) => t.tabType === "gitdiff");
    if (existing) {
      get().focusTab(existing.id);
      return existing;
    }
    const tab: EditorTab = {
      id: makeId(),
      title: "Uncommitted Changes",
      text: "",
      kind: "diff",
      cursor: 0,
      tabType: "gitdiff",
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  openGitHistoryTab: () => {
    const existing = get().tabs.find((t) => t.tabType === "githistory");
    if (existing) {
      get().focusTab(existing.id);
      return existing;
    }
    const tab: EditorTab = {
      id: makeId(),
      title: "Git History",
      text: "",
      kind: "githistory",
      cursor: 0,
      tabType: "githistory",
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  openGitCommitDiffTab: ({ commitId, title, filePath }) => {
    const existing = get().tabs.find(
      (t) => t.tabType === "gitcommitdiff" && t.commitId === commitId,
    );
    if (existing) {
      // Reopening from a different file just retargets the focus file.
      if (existing.filePath !== filePath) {
        get().updateTab(existing.id, { filePath });
      }
      get().focusTab(existing.id);
      return existing;
    }
    const tab: EditorTab = {
      id: makeId(),
      title,
      text: "",
      kind: "commitdiff",
      cursor: 0,
      tabType: "gitcommitdiff",
      commitId,
      filePath,
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  openGitConflictTab: () => {
    const existing = get().tabs.find((t) => t.tabType === "gitconflict");
    if (existing) {
      get().focusTab(existing.id);
      return existing;
    }
    const tab: EditorTab = {
      id: makeId(),
      title: "Resolve Conflicts",
      text: "",
      kind: "gitconflict",
      cursor: 0,
      tabType: "gitconflict",
      createdAt: Date.now(),
    };
    set((s) => appendTabToFocusedGroup(s, tab));
    useSettingsStore.getState().hideBottomPane();
    return tab;
  },
  closeTab: (id) =>
    set((s) => {
      const closedTab = s.tabs.find((t) => t.id === id);
      // File, terminal and git-diff tabs are ephemeral: remove from tabs[]
      // entirely on close. Console/table tabs (and untitled in-memory notebooks)
      // stay in tabs[] marked as closed so they remain in their sidebar section
      // but don't reopen on restart. File-backed notebooks are removed like files.
      const isFileBackedNotebook =
        closedTab?.tabType === "notebook" && !!closedTab.filePath;
      const tabs =
        closedTab?.tabType === "file" ||
        isFileBackedNotebook ||
        closedTab?.tabType === "terminal" ||
        closedTab?.tabType === "definition" ||
        closedTab?.tabType === "gitdiff"
          ? s.tabs.filter((t) => t.id !== id)
          : s.tabs.map((t) => (t.id === id ? { ...t, closed: true } : t));
      // Drop the id from its owning leaf; collapse a leaf that becomes empty.
      let layout = s.layout
        ? mapLeaves(s.layout, (l) => {
            if (!l.tabIds.includes(id)) return l;
            const tabIds = l.tabIds.filter((x) => x !== id);
            const selectedTabId =
              l.selectedTabId === id
                ? (tabIds[tabIds.length - 1] ?? null)
                : l.selectedTabId;
            return { ...l, tabIds, selectedTabId };
          })
        : null;
      layout = pruneEmpty(layout);
      const focusedPaneGroupId =
        s.focusedPaneGroupId && findLeaf(layout, s.focusedPaneGroupId)
          ? s.focusedPaneGroupId
          : firstLeaf(layout)?.id ?? null;
      const focused = focusedPaneGroupId ? findLeaf(layout, focusedPaneGroupId) : null;
      return {
        tabs,
        layout,
        focusedPaneGroupId,
        activeId: focused?.selectedTabId ?? null,
      };
    }),
  deleteTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const r = reconcileLayout(tabs, s.layout, s.focusedPaneGroupId);
      return {
        tabs,
        layout: r.layout,
        focusedPaneGroupId: r.focusedPaneGroupId,
        activeId: r.activeId,
      };
    }),
  focusTab: (id) =>
    set((s) => {
      const sel = selectTabInLeaf(s.layout, id);
      if (sel) {
        const tabs = s.tabs.map((t) =>
          t.id === id ? { ...t, closed: undefined } : t,
        );
        return {
          tabs,
          layout: sel.layout,
          focusedPaneGroupId: sel.focusedPaneGroupId,
          activeId: id,
        };
      }
      // Tab exists but is closed (no pane placement). Re-open it in the
      // focused group, creating one if there are no groups left.
      if (!s.tabs.some((t) => t.id === id)) return {};
      const tabs = s.tabs.map((t) =>
        t.id === id ? { ...t, closed: undefined } : t,
      );
      const att = attachTabToFocusedLeaf(s.layout, s.focusedPaneGroupId, id);
      return {
        tabs,
        layout: att.layout,
        focusedPaneGroupId: att.focusedPaneGroupId,
        activeId: id,
      };
    }),
  focusGroup: (groupId) =>
    set((s) => {
      const g = findLeaf(s.layout, groupId);
      if (!g) return {};
      return {
        focusedPaneGroupId: groupId,
        activeId: g.selectedTabId,
      };
    }),
  splitTab: (tabId, direction) =>
    set((s) => {
      const src = findLeafWithTab(s.layout, tabId);
      // Splitting requires at least two tabs in the source group, otherwise
      // the move would just leave an empty group behind.
      if (!src || !s.layout || src.tabIds.length <= 1) return {};
      const remaining = src.tabIds.filter((x) => x !== tabId);
      const updated = mapLeaves(s.layout, (l) =>
        l.id === src.id
          ? {
              ...l,
              tabIds: remaining,
              selectedTabId:
                src.selectedTabId === tabId
                  ? (remaining[remaining.length - 1] ?? null)
                  : src.selectedTabId,
            }
          : l,
      );
      const newLeaf = makeLeaf([tabId], tabId);
      const layout = splitLeaf(updated, src.id, direction, newLeaf);
      return {
        layout,
        focusedPaneGroupId: newLeaf.id,
        activeId: tabId,
      };
    }),
  moveTabToGroup: (tabId, targetGroupId) =>
    set((s) => {
      const src = findLeafWithTab(s.layout, tabId);
      const tgt = findLeaf(s.layout, targetGroupId);
      if (!src || !tgt || src.id === tgt.id || !s.layout) return {};
      let layout: PaneNode | null = mapLeaves(s.layout, (l) => {
        if (l.id === src.id) {
          const tabIds = l.tabIds.filter((x) => x !== tabId);
          return {
            ...l,
            tabIds,
            selectedTabId:
              l.selectedTabId === tabId
                ? (tabIds[tabIds.length - 1] ?? null)
                : l.selectedTabId,
          };
        }
        if (l.id === tgt.id) {
          return { ...l, tabIds: [...l.tabIds, tabId], selectedTabId: tabId };
        }
        return l;
      });
      layout = pruneEmpty(layout);
      const focusedPaneGroupId = findLeaf(layout, targetGroupId)
        ? targetGroupId
        : firstLeaf(layout)?.id ?? null;
      const focused = focusedPaneGroupId ? findLeaf(layout, focusedPaneGroupId) : null;
      return {
        layout,
        focusedPaneGroupId,
        activeId: focused?.selectedTabId ?? null,
      };
    }),
  updateTab: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  reorderTabInGroup: (groupId, fromIndex, toIndex) =>
    set((s) => {
      const g = findLeaf(s.layout, groupId);
      if (!g || !s.layout) return {};
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= g.tabIds.length ||
        toIndex >= g.tabIds.length ||
        fromIndex === toIndex
      ) {
        return {};
      }
      const next = g.tabIds.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const layout = mapLeaves(s.layout, (l) =>
        l.id === groupId ? { ...l, tabIds: next } : l,
      );
      return { layout };
    }),
  resizeSplit: (splitId, sizes) =>
    set((s) => {
      if (!s.layout) return {};
      return { layout: setSplitSizes(s.layout, splitId, sizes) };
    }),
}));

/// Add a brand-new tab to the focused group (creating one if none exists)
/// and return the partial state update.
function appendTabToFocusedGroup(
  s: TabsState,
  tab: EditorTab,
): Partial<TabsState> {
  const tabs = [...s.tabs, tab];
  const { layout, focusedPaneGroupId } = attachTabToFocusedLeaf(
    s.layout,
    s.focusedPaneGroupId,
    tab.id,
  );
  return {
    tabs,
    layout,
    focusedPaneGroupId,
    activeId: tab.id,
  };
}

export {
  useTabsStore,
};
