// The local CLI backing the agent. Mirrors the Rust `AgentProvider`; the value
// is sent verbatim with every request and persisted as the global choice.
type AgentProvider = "codex" | "claude";

type ChatRole = "user" | "agent";

interface ChatMessage {
  id: string;
  kind: "message";
  role: ChatRole;
  text: string;
}

interface ToolCallItem {
  id: string;
  kind: "tool";
  tool: string;
  summary: string;
}

interface SqlBlockItem {
  id: string;
  kind: "sql";
  sql: string;
}

// A block of query results the user shared back to the agent. The full `table`
// is what was sent to Codex; the chat renders it collapsed behind `summary` so a
// 100-row dump doesn't dominate the conversation.
interface ResultShareItem {
  id: string;
  kind: "result";
  summary: string;
  table: string;
}

type ChatItem = ChatMessage | ToolCallItem | SqlBlockItem | ResultShareItem;

interface ContextChip {
  id: string;
  label: string;
  kind: "selection" | "file" | "result";
  text: string;
}

interface AgentThread {
  items: ChatItem[];
  streaming: boolean;
  sessionId: string | null;
  // Which provider produced `sessionId`. A session can only be resumed by the
  // same provider, so a turn run under a different provider starts fresh.
  sessionProvider: AgentProvider | null;
}

/// Provider CLI availability + the model it will use, from `cmd_agent_check`.
interface AgentStatus {
  available: boolean;
  model: string;
}

// Minimal shape of `cmd_run_query`'s result, owned locally so the agent feature
// doesn't depend on the editor's query types.
interface SharedQueryColumn {
  name: string;
  type_hint: string;
}

interface SharedQueryValue {
  kind: string;
  value?: boolean | number | string;
}

interface SharedQueryResult {
  columns: SharedQueryColumn[];
  rows: SharedQueryValue[][];
  rows_affected?: number;
}

type AgentEventKind = "session_started" | "message" | "tool_call" | "done" | "error";

/// Payload emitted by the backend `agent-event` channel (AgentEvent flattened
/// plus the originating turn id).
interface AgentEventEnvelope {
  turn_id: string;
  kind: AgentEventKind;
  text?: string;
  tool?: string;
  summary?: string;
  session_id?: string;
  // Resolved model the provider picked for this turn, on `session_started`.
  model?: string | null;
  message?: string;
}

export type {
  AgentProvider,
  ChatRole,
  ChatMessage,
  ToolCallItem,
  SqlBlockItem,
  ResultShareItem,
  ChatItem,
  ContextChip,
  AgentThread,
  AgentEventKind,
  AgentEventEnvelope,
  AgentStatus,
  SharedQueryColumn,
  SharedQueryValue,
  SharedQueryResult,
};
