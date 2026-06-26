import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentEventEnvelope, AgentProvider, AgentStatus, SharedQueryResult } from "./types";

// First 100 rows is the default scope; "all rows" omits the page size so the
// backend returns the full result set (no pagination ceiling).
const SHARE_PREVIEW_ROWS = 100;

function sendAgentMessageIPC(args: {
  provider: AgentProvider;
  connectionId: string | null;
  prompt: string;
  turnId: string;
  resumeSession: string | null;
}): Promise<void> {
  return invoke("cmd_agent_send", {
    provider: args.provider,
    connectionId: args.connectionId,
    prompt: args.prompt,
    turnId: args.turnId,
    resumeSession: args.resumeSession,
  });
}

function checkAgentIPC(provider: AgentProvider): Promise<AgentStatus> {
  return invoke("cmd_agent_check", { provider });
}

function cancelAgentIPC(turnId: string): Promise<void> {
  return invoke("cmd_agent_cancel", { turnId });
}

// Runs an agent-suggested query so its results can be fed back to Codex as the
// next turn. `allRows` omits the page size (full result set); otherwise only the
// first 100 rows are fetched.
function runShareQueryIPC(
  connectionId: string,
  sql: string,
  allRows: boolean,
): Promise<SharedQueryResult> {
  return invoke("cmd_run_query", {
    connectionId,
    sql,
    params: [],
    pageSize: allRows ? undefined : SHARE_PREVIEW_ROWS,
    page: allRows ? undefined : 0,
  });
}

function listenAgentEventsIPC(handler: (event: AgentEventEnvelope) => void): Promise<UnlistenFn> {
  return listen<AgentEventEnvelope>("agent-event", (evt) => handler(evt.payload));
}

export {
  sendAgentMessageIPC,
  checkAgentIPC,
  cancelAgentIPC,
  runShareQueryIPC,
  listenAgentEventsIPC,
};
