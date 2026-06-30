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
  connectionId: string | null;
  prompt: string;
  turnId: string;
  resumeSession: string | null;
}

/// Start one canvas-profile agent turn (Claude). The backend injects the
/// connection's schema and the arris-canvas contract, then streams `agent-event`s.
function sendCanvasAgentIPC(args: SendCanvasAgentArgs): Promise<void> {
  return invoke("cmd_agent_send", {
    provider: "claude",
    profile: "canvas",
    connectionId: args.connectionId,
    prompt: args.prompt,
    turnId: args.turnId,
    resumeSession: args.resumeSession,
  });
}

function cancelCanvasAgentIPC(turnId: string): Promise<void> {
  return invoke("cmd_agent_cancel", { turnId });
}

function listenCanvasAgentEventsIPC(
  handler: (event: CanvasAgentEventEnvelope) => void,
): Promise<UnlistenFn> {
  return listen<CanvasAgentEventEnvelope>("agent-event", (evt) => handler(evt.payload));
}

export { cancelCanvasAgentIPC, listenCanvasAgentEventsIPC, sendCanvasAgentIPC };
export type { CanvasAgentEventEnvelope };
