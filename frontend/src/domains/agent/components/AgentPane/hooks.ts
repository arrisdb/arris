import { useConnectionsStore } from "@domains/connection";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentStore } from "../../hooks/store";
import { useEditorHandleStore } from "@domains/editor/hooks";
import { useRunHistoryStore } from "@domains/results/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { SelectOption } from "@shared/ui";
import { listenAgentEventsIPC, runShareQueryIPC } from "./ipc";
import type { ChatItem, ContextChip } from "./types";
import { serializeQueryResult } from "./utils";

interface AgentPaneModel {
  items: ChatItem[];
  streaming: boolean;
  chips: ContextChip[];
  available: boolean | null;
  hasMessages: boolean;
  canShare: boolean;
  connectionOptions: SelectOption[];
  /// Recent results of the active tab's runs, offered in the "Add results"
  /// picker. Empty when the tab has no run with a result.
  resultOptions: SelectOption[];
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
  onAttachResult: (runId: string) => void;
  onRemoveChip: (id: string) => void;
  onInsert: (sql: string) => void;
  onReplace: (sql: string) => void;
  onShareResults: (sql: string, allRows: boolean) => void;
  onPickConnection: (connectionId: string) => void;
}

// Tauri rejects IPC with an { code, message } object; pull the message out.
const ipcText = (err: unknown): string =>
  typeof err === "object" && err !== null && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);

const lineCount = (text: string): number => (text.match(/\n/g)?.length ?? 0) + 1;

// Thread key used when no database connection is active. The agent still writes
// and explains generic SQL, so it needs a stable bucket for that conversation.
const NO_CONNECTION_THREAD_KEY = "(no connection)";

const useAgentPane = (): AgentPaneModel => {
  const activeTab = useTabsStore((state) => state.tabs.find((t) => t.id === state.activeId));
  const selectedConnectionId = useConnectionsStore((state) => state.selectedId);
  const connections = useConnectionsStore((state) => state.connections);

  // The editor context (active tab, then the explicitly selected connection)
  // determines the conversation: it keys the thread so each connection keeps its
  // own history, and the "(no connection)" bucket holds generic-SQL chats.
  const editorConnectionId = activeTab?.connectionId ?? selectedConnectionId ?? null;
  const threadKey = editorConnectionId ?? NO_CONNECTION_THREAD_KEY;

  // When there is no editor connection the user can pick one inline (per the
  // share prompt under a SQL block) without leaving the conversation: the pick
  // only sets the connection queries run against, never the thread key, so the
  // "(no connection)" chat stays put.
  const [pickedConnectionId, setPickedConnectionId] = useState<string | null>(null);
  const runConnectionId = editorConnectionId ?? pickedConnectionId;

  const connectionOptions = useMemo<SelectOption[]>(
    () => connections.map((c) => ({ value: c.id, label: c.name })),
    [connections],
  );

  const thread = useAgentStore((state) => state.threads[threadKey]);
  const available = useAgentStore((state) => state.available);

  const [removedChips, setRemovedChips] = useState<Set<string>>(new Set());

  // Results the user explicitly attached to the next message (not automatic).
  // Sourced from the active tab's run history; each rides as a `result` context
  // chip, so `serializeChips` folds it into the prompt like any other chip.
  const [attachedResults, setAttachedResults] = useState<ContextChip[]>([]);
  const runsByTab = useRunHistoryStore((state) => state.runsByTab);

  const resultOptions = useMemo<SelectOption[]>(() => {
    if (!activeTab) return [];
    return (runsByTab[activeTab.id] ?? [])
      .filter((r) => r.status === "success" && r.result)
      .map((r) => {
        const rows = r.result?.rows.length ?? 0;
        const cols = r.result?.columns.length ?? 0;
        return { value: r.id, label: `${r.customName ?? `#${r.ordinal}`} · ${rows}×${cols}` };
      });
  }, [activeTab, runsByTab]);

  const onAttachResult = useCallback(
    (runId: string) => {
      const run = (activeTab ? runsByTab[activeTab.id] ?? [] : []).find((r) => r.id === runId);
      if (!run?.result) return;
      const { table, rowCount, colCount } = serializeQueryResult(run.result);
      const id = `result:${runId}`;
      // Replace any prior attachment of the same run so re-attaching refreshes
      // rather than duplicating.
      setAttachedResults((prev) => [
        ...prev.filter((c) => c.id !== id),
        {
          id,
          kind: "result",
          label: `${run.customName ?? `#${run.ordinal}`} · ${rowCount}×${colCount}`,
          text: table,
        },
      ]);
    },
    [activeTab, runsByTab],
  );

  // Subscribe once to streamed agent events and check the active provider's CLI.
  useEffect(() => {
    const unlisten = listenAgentEventsIPC((event) =>
      useAgentStore.getState().handleEvent(event),
    );
    useAgentStore.getState().checkAgent();
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    useAgentStore.getState().setActiveConnection(editorConnectionId);
    setRemovedChips(new Set());
    setAttachedResults([]);
    // A real editor connection takes over; drop any inline pick so it can't
    // shadow the connection the conversation now belongs to.
    setPickedConnectionId(null);
  }, [editorConnectionId]);

  const chips = useMemo<ContextChip[]>(() => {
    if (!activeTab) return [];
    const out: ContextChip[] = [];
    const selection = activeTab.selection;
    if (selection && selection.from !== selection.to) {
      const text = activeTab.text.slice(selection.from, selection.to);
      out.push({
        id: "selection",
        kind: "selection",
        label: `selection · ${lineCount(text)} lines`,
        text,
      });
    }
    if (activeTab.text.trim()) {
      out.push({ id: "file", kind: "file", label: activeTab.title, text: activeTab.text });
    }
    return [...out.filter((chip) => !removedChips.has(chip.id)), ...attachedResults];
  }, [activeTab, attachedResults, removedChips]);

  const onSend = (text: string) => {
    if (!text.trim()) return;
    useAgentStore.getState().sendMessage(threadKey, runConnectionId, text.trim(), chips);
    // Attached results are one-shot context for this message; the editor
    // selection/file chips persist as long as they apply.
    setAttachedResults([]);
  };

  const onStop = () => useAgentStore.getState().cancel(threadKey);
  const onClear = () => useAgentStore.getState().clearThread(threadKey);

  const onInsert = (sql: string) => {
    const handle = useEditorHandleStore.getState().handle;
    if (!handle) return;
    const range = handle.insertAtCursor(sql);
    handle.highlightRange(range.from, range.to);
  };

  const onReplace = (sql: string) => {
    const handle = useEditorHandleStore.getState().handle;
    if (!handle) return;
    // Replace the user's current selection (the text they sent as context). With
    // no selection, fall back to replacing the whole document.
    const selection = activeTab?.selection;
    const hasSelection = !!selection && selection.from !== selection.to;
    const from = hasSelection ? selection.from : 0;
    const to = hasSelection ? selection.to : Number.MAX_SAFE_INTEGER;
    handle.replaceRange(from, to, sql);
    handle.highlightRange(from, from + sql.length);
  };

  // Run an agent-suggested query and feed its results back as the next turn. A
  // query failure becomes a corrective turn so Codex can fix its own SQL.
  const onShareResults = async (sql: string, allRows: boolean) => {
    if (!runConnectionId) return;
    try {
      const result = await runShareQueryIPC(runConnectionId, sql, allRows);
      const { table, rowCount, colCount } = serializeQueryResult(result);
      const scope = allRows ? "all rows" : `first ${rowCount}`;
      useAgentStore.getState().sendResultShare(threadKey, runConnectionId, {
        summary: `Shared ${rowCount} row${rowCount === 1 ? "" : "s"} × ${colCount} col${colCount === 1 ? "" : "s"}`,
        table,
        prompt: `Here are the results of running that query (${scope}):\n\n${table}`,
      });
    } catch (err) {
      const message = ipcText(err);
      useAgentStore.getState().sendResultShare(threadKey, runConnectionId, {
        summary: "Query failed",
        table: message,
        prompt: `That query failed with this error:\n\n${message}\n\nPlease fix the query.`,
      });
    }
  };

  // Pick a connection to run & share against when the conversation has none.
  // Connect it first if it isn't live, then make it the run connection so the
  // share buttons replace the picker.
  const onPickConnection = (id: string) => {
    const conn = connections.find((c) => c.id === id);
    if (!conn) return;
    if (!conn.isConnected) useConnectionsStore.getState().connectAndLoad(id);
    setPickedConnectionId(id);
  };

  return {
    items: thread?.items ?? [],
    streaming: thread?.streaming ?? false,
    chips,
    available,
    hasMessages: (thread?.items.length ?? 0) > 0,
    canShare: runConnectionId !== null,
    connectionOptions,
    resultOptions,
    onSend,
    onStop,
    onClear,
    onAttachResult,
    onRemoveChip: (id) => {
      // A result chip lives in its own state; everything else is hidden via the
      // removed-chips set so derived selection/file chips can be dismissed.
      if (attachedResults.some((c) => c.id === id)) {
        setAttachedResults((prev) => prev.filter((c) => c.id !== id));
      } else {
        setRemovedChips((prev) => new Set(prev).add(id));
      }
    },
    onInsert,
    onReplace,
    onShareResults,
    onPickConnection,
  };
};

export { useAgentPane };
