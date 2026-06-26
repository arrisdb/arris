import { usePinnedQueriesStore } from "../../hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { PinnedQueriesPaneViewModel } from "./types";
import { openPinnedQuery } from "./utils";

// How long the "Copied" confirmation stays on the copy button after a successful
// clipboard write.
const COPIED_FEEDBACK_MS = 1500;

function usePinnedQueriesPane(): PinnedQueriesPaneViewModel {
  const queries = usePinnedQueriesStore((state) => state.queries);
  const patchQuery = usePinnedQueriesStore((state) => state.patchQuery);
  const removeQuery = usePinnedQueriesStore((state) => state.removeQuery);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const onDoubleClickQuery = useCallback((queryId: string) => {
    const query = usePinnedQueriesStore.getState().queries.find((item) => item.id === queryId);
    if (query) openPinnedQuery(query);
  }, []);

  const onCopyQuery = useCallback((queryId: string) => {
    const query = usePinnedQueriesStore.getState().queries.find((item) => item.id === queryId);
    if (!query) return;
    Promise.resolve(navigator.clipboard?.writeText(query.text))
      .then(() => {
        setCopiedId(queryId);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopiedId(null), COPIED_FEEDBACK_MS);
      })
      .catch(() => {});
  }, []);

  const onStartRename = useCallback((queryId: string) => {
    const query = usePinnedQueriesStore.getState().queries.find((item) => item.id === queryId);
    if (!query) return;
    setRenamingId(queryId);
    setRenameDraft(query.name);
  }, []);

  const onChangeRenameDraft = useCallback((value: string) => {
    setRenameDraft(value);
  }, []);

  const onCommitRename = useCallback((queryId: string) => {
    const name = renameDraft.trim();
    if (name.length > 0) patchQuery(queryId, { name });
    setRenamingId(null);
    setRenameDraft("");
  }, [patchQuery, renameDraft]);

  const onCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameDraft("");
  }, []);

  const onRemoveQuery = useCallback((queryId: string) => {
    removeQuery(queryId);
  }, [removeQuery]);

  return {
    queries,
    copiedId,
    renamingId,
    renameDraft,
    onCancelRename,
    onChangeRenameDraft,
    onCommitRename,
    onCopyQuery,
    onDoubleClickQuery,
    onRemoveQuery,
    onStartRename,
  };
}

// Debounce window for mirroring per-keystroke editor edits back to the pinned
// query store (each patch persists to disk, so we coalesce bursts of typing).
const FLUSH_DELAY_MS = 400;

interface PinnedTabPatch {
  text?: string;
  name?: string;
}

// Mirror every open "pinned" tab's live title/text into the pinned query it
// edits. Only writes a field when it actually differs so the reverse (store →
// tab) sync converges instead of patching forever.
function mirrorPinnedTabsToStore(): void {
  const tabs = useTabsStore.getState().tabs;
  const pinned = usePinnedQueriesStore.getState();
  for (const tab of tabs) {
    if (tab.tabType !== "pinned" || !tab.pinnedQueryId) continue;
    const query = pinned.queries.find((q) => q.id === tab.pinnedQueryId);
    if (!query) continue;
    const patch: PinnedTabPatch = {};
    if (tab.text !== query.text) patch.text = tab.text;
    if (tab.title !== query.name) patch.name = tab.title;
    if (patch.text === undefined && patch.name === undefined) continue;
    pinned.patchQuery(query.id, patch);
  }
}

// Keep pinned-query editor tabs and the pinned query store in step. Mount once
// (ContentView). Editing/renaming a pinned tab updates its query; removing a
// query closes its tab.
function usePinnedQueryTabSync(): void {
  const tabs = useTabsStore((s) => s.tabs);
  const queries = usePinnedQueriesStore((s) => s.queries);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(mirrorPinnedTabsToStore, FLUSH_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tabs]);

  useEffect(() => {
    const liveIds = new Set(queries.map((q) => q.id));
    // Removing a pinned query closes its editor tab.
    for (const tab of useTabsStore.getState().tabs) {
      if (tab.tabType === "pinned" && tab.pinnedQueryId && !liveIds.has(tab.pinnedQueryId)) {
        useTabsStore.getState().deleteTab(tab.id);
      }
    }
    // Renaming a pinned query (e.g. from the pane) renames its open tab.
    for (const query of queries) {
      const tab = useTabsStore
        .getState()
        .tabs.find((t) => t.tabType === "pinned" && t.pinnedQueryId === query.id);
      if (tab && tab.title !== query.name) {
        useTabsStore.getState().updateTab(tab.id, { title: query.name });
      }
    }
  }, [queries]);
}

export { usePinnedQueriesPane, usePinnedQueryTabSync };
