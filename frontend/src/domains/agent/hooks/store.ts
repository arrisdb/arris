import { create } from "zustand";
import {
  cancelAgentIPC,
  checkAgentIPC,
  sendAgentMessageIPC,
} from "@domains/agent/components/AgentPane/ipc";
import type {
  AgentEventEnvelope,
  AgentProvider,
  AgentThread,
  ChatItem,
  ContextChip,
} from "@domains/agent/components/AgentPane/types";

let idCounter = 0;
const nextId = () => `agent-item-${(idCounter += 1)}`;

const emptyThread = (): AgentThread => ({
  items: [],
  streaming: false,
  sessionId: null,
  sessionProvider: null,
});

// The chosen provider is a single global preference, persisted to localStorage
// so it survives restarts.
const PROVIDER_STORAGE_KEY = "arris.agent.provider";

const loadProvider = (): AgentProvider => {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PROVIDER_STORAGE_KEY) : null;
    return raw === "claude" || raw === "codex" ? raw : "codex";
  } catch {
    return "codex";
  }
};

const saveProvider = (provider: AgentProvider): void => {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
  } catch {
    // localStorage may be disabled.
  }
};

/// Split assistant text into prose messages and ```sql fenced blocks.
const splitSqlBlocks = (text: string): ChatItem[] => {
  const out: ChatItem[] = [];
  const fence = /```sql\s*([\s\S]*?)```/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    const before = text.slice(last, match.index).trim();
    if (before) out.push({ id: nextId(), kind: "message", role: "agent", text: before });
    out.push({ id: nextId(), kind: "sql", sql: match[1].trim() });
    last = fence.lastIndex;
  }
  const tail = text.slice(last).trim();
  if (tail) out.push({ id: nextId(), kind: "message", role: "agent", text: tail });
  if (out.length === 0) out.push({ id: nextId(), kind: "message", role: "agent", text });
  return out;
};

const serializeChips = (chips: ContextChip[]): string =>
  chips.length === 0 ? "" : `${chips.map((c) => `# ${c.label}\n${c.text}`).join("\n\n")}\n\n`;

interface AgentState {
  threads: Record<string, AgentThread>;
  activeConnectionId: string | null;
  provider: AgentProvider;
  available: boolean | null;
  model: string | null;
  turns: Record<string, string>;
  setActiveConnection: (id: string | null) => void;
  setProvider: (provider: AgentProvider) => void;
  appendUserMessage: (threadKey: string, text: string) => void;
  sendMessage: (
    threadKey: string,
    connectionId: string | null,
    prompt: string,
    chips: ContextChip[],
  ) => Promise<string>;
  sendResultShare: (
    threadKey: string,
    connectionId: string | null,
    share: { summary: string; table: string; prompt: string },
  ) => Promise<string>;
  handleEvent: (envelope: AgentEventEnvelope) => void;
  checkAgent: () => Promise<void>;
  cancel: (threadKey: string) => void;
  clearThread: (threadKey: string) => void;
  paneOpen: boolean;
  togglePane: () => void;
  openPane: () => void;
  closePane: () => void;
}

/// The id of the in-flight turn for a thread, if any.
const activeTurnId = (turns: Record<string, string>, threadKey: string): string | undefined =>
  Object.keys(turns).find((id) => turns[id] === threadKey);

const useAgentStore = create<AgentState>((set, get) => {
  // Start an agent turn for `prompt` and mark the thread streaming. Both a typed
  // message and a shared result set funnel through here so the turn lifecycle
  // (id, streaming flag, error surfacing) lives in one place.
  const dispatchTurn = async (
    threadKey: string,
    connectionId: string | null,
    prompt: string,
  ): Promise<string> => {
    const turnId = crypto.randomUUID();
    const provider = get().provider;
    const thread = get().threads[threadKey] ?? emptyThread();
    // Only resume when the existing session was produced by the current
    // provider; codex and claude session ids are not interchangeable.
    const resumeSession = thread.sessionProvider === provider ? thread.sessionId : null;
    set((state) => ({
      activeConnectionId: connectionId,
      turns: { ...state.turns, [turnId]: threadKey },
      threads: {
        ...state.threads,
        [threadKey]: { ...(state.threads[threadKey] ?? emptyThread()), streaming: true },
      },
    }));
    try {
      await sendAgentMessageIPC({ provider, connectionId, prompt, turnId, resumeSession });
    } catch (err) {
      // The backend streams errors as events, so a rejection here means the IPC
      // itself failed to dispatch. Surface it and clear streaming so the turn
      // never hangs on an eternal typing indicator.
      get().handleEvent({ turn_id: turnId, kind: "error", message: String(err) });
    }
    return turnId;
  };

  return {
    threads: {},
    activeConnectionId: null,
    provider: loadProvider(),
    available: null,
    model: null,
    turns: {},
    paneOpen: false,

    togglePane: () => set((state) => ({ paneOpen: !state.paneOpen })),
    openPane: () => set({ paneOpen: true }),
    closePane: () => set({ paneOpen: false }),

    setActiveConnection: (id) => set({ activeConnectionId: id }),

    setProvider: (provider) => {
      saveProvider(provider);
      // Reset availability/model so the header doesn't show the previous
      // provider's status while the new check resolves.
      set({ provider, available: null, model: null });
      get().checkAgent();
    },

    appendUserMessage: (threadKey, text) =>
      set((state) => {
        const thread = state.threads[threadKey] ?? emptyThread();
        const items: ChatItem[] = [
          ...thread.items,
          { id: nextId(), kind: "message", role: "user", text },
        ];
        return { threads: { ...state.threads, [threadKey]: { ...thread, items } } };
      }),

    sendMessage: async (threadKey, connectionId, prompt, chips) => {
      get().appendUserMessage(threadKey, prompt);
      return dispatchTurn(threadKey, connectionId, `${serializeChips(chips)}${prompt}`);
    },

    sendResultShare: async (threadKey, connectionId, share) => {
      // The collapsed result item is what the user sees; the full table travels
      // to the agent inside `share.prompt`.
      set((state) => {
        const thread = state.threads[threadKey] ?? emptyThread();
        const items: ChatItem[] = [
          ...thread.items,
          { id: nextId(), kind: "result", summary: share.summary, table: share.table },
        ];
        return { threads: { ...state.threads, [threadKey]: { ...thread, items } } };
      });
      return dispatchTurn(threadKey, connectionId, share.prompt);
    },

    handleEvent: (envelope) =>
      set((state) => {
        const connectionId = state.turns[envelope.turn_id];
        if (!connectionId) return {};
        const thread = state.threads[connectionId] ?? emptyThread();
        let items = thread.items;
        let streaming = thread.streaming;
        let sessionId = thread.sessionId;
        let sessionProvider = thread.sessionProvider;
        let turns = state.turns;
        let model = state.model;

        switch (envelope.kind) {
          case "session_started":
            sessionId = envelope.session_id ?? sessionId;
            // Tag the session with the provider that produced it so a later turn
            // under a different provider knows not to resume it.
            sessionProvider = state.provider;
            // The provider reports the model it actually resolved (e.g. a
            // configured "default" becomes the concrete model); show that.
            if (envelope.model) model = envelope.model;
            break;
          case "message":
            if (envelope.text) items = [...items, ...splitSqlBlocks(envelope.text)];
            break;
          case "tool_call":
            items = [
              ...items,
              { id: nextId(), kind: "tool", tool: envelope.tool ?? "tool", summary: envelope.summary ?? "" },
            ];
            break;
          case "error":
            items = [
              ...items,
              { id: nextId(), kind: "message", role: "agent", text: envelope.message ?? "Agent error" },
            ];
            streaming = false;
            turns = removeKey(turns, envelope.turn_id);
            break;
          case "done":
            streaming = false;
            turns = removeKey(turns, envelope.turn_id);
            break;
        }
        return {
          turns,
          model,
          threads: {
            ...state.threads,
            [connectionId]: { items, streaming, sessionId, sessionProvider },
          },
        };
      }),

    checkAgent: async () => {
      const status = await checkAgentIPC(get().provider);
      set({ available: status.available, model: status.model });
    },

    cancel: (threadKey) => {
      const turnId = activeTurnId(get().turns, threadKey);
      if (!turnId) return;
      cancelAgentIPC(turnId);
      set((state) => ({
        turns: removeKey(state.turns, turnId),
        threads: {
          ...state.threads,
          [threadKey]: { ...(state.threads[threadKey] ?? emptyThread()), streaming: false },
        },
      }));
    },

    clearThread: (threadKey) => {
      // Clearing also stops any in-flight turn so its events can't repopulate the
      // thread we just emptied.
      const turnId = activeTurnId(get().turns, threadKey);
      if (turnId) cancelAgentIPC(turnId);
      set((state) => ({
        turns: turnId ? removeKey(state.turns, turnId) : state.turns,
        threads: { ...state.threads, [threadKey]: emptyThread() },
      }));
    },
  };
});

const removeKey = (record: Record<string, string>, key: string): Record<string, string> => {
  const next = { ...record };
  delete next[key];
  return next;
};

export { useAgentStore };
