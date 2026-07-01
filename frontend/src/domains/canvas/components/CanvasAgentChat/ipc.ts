import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type CanvasAgentEventKind = "session_started" | "message" | "tool_call" | "done" | "error";

/// The `agent-event` payload (AgentEvent flattened + the originating turn id).
/// Owned locally by this boundary, not imported from the central IPC types.
interface CanvasAgentEventEnvelope {
  turn_id: string;
  kind: CanvasAgentEventKind;
  text?: string;
  tool?: string;
  summary?: string;
  session_id?: string;
  model?: string | null;
  message?: string;
}

interface SendCanvasAgentArgs {
  /// The agent CLI to run (Codex or Claude), chosen in the chat header.
  provider: "codex" | "claude";
  connectionId: string | null;
  prompt: string;
  /// A compact summary of the objects already on the board, so the agent can
  /// reference, modify, or remove them by id. Empty when the board is empty.
  boardContext: string;
  /// A schema assembled across several connections, used when the board spans
  /// more than one database: each connection's DDL labeled with its id and
  /// dialect. Null for a single-connection board (the backend resolves it).
  schemaOverride: string | null;
  turnId: string;
  resumeSession: string | null;
}

/// Start one canvas-profile agent turn with the chosen provider. The backend
/// injects the connection's schema (or `schemaOverride` for a multi-connection
/// board), the current board, and the arris-canvas contract, then streams
/// `agent-event`s.
function sendCanvasAgentIPC(args: SendCanvasAgentArgs): Promise<void> {
  return invoke("cmd_agent_send", {
    provider: args.provider,
    profile: "canvas",
    connectionId: args.connectionId,
    prompt: args.prompt,
    boardContext: args.boardContext,
    schemaOverride: args.schemaOverride,
    turnId: args.turnId,
    resumeSession: args.resumeSession,
  });
}

function cancelCanvasAgentIPC(turnId: string): Promise<void> {
  return invoke("cmd_agent_cancel", { turnId });
}

/// Fetch the schema DDL the agent would receive for a connection (the same
/// deep-loaded snapshot a turn inlines), so the chat can show a "fetching
/// schema" indicator and preview the exact context.
function fetchCanvasSchemaContextIPC(connectionId: string): Promise<string> {
  return invoke("cmd_agent_schema_context", { connectionId });
}

function listenCanvasAgentEventsIPC(
  handler: (event: CanvasAgentEventEnvelope) => void,
): Promise<UnlistenFn> {
  return listen<CanvasAgentEventEnvelope>("agent-event", (evt) => handler(evt.payload));
}

export {
  cancelCanvasAgentIPC,
  fetchCanvasSchemaContextIPC,
  listenCanvasAgentEventsIPC,
  sendCanvasAgentIPC,
};
export type { CanvasAgentEventEnvelope };
