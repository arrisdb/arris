import { ChatBubble, ChatEmpty, ChatInput, ChatTyping, Select } from "@shared/ui";
import { AgentProviderSelect } from "@domains/agent";

import { useCanvasAgentChat } from "./hooks";
import type { CanvasAgentChatProps } from "./types";
import "./index.css";

/// The board's agent chat: pick the board's connection, type a request, and the
/// agent reads the schema and the current board, then adds or revises objects.
/// Renders the shared agent-chat chrome so it matches the SQL agent pane.
function CanvasAgentChat({ tab }: CanvasAgentChatProps) {
  const { cancel, connectionId, connectionOptions, entries, pickConnection, send, streaming } =
    useCanvasAgentChat(tab);
  const isEmpty = entries.length === 0 && !streaming;

  return (
    <div className="mdbc-agent-pane">
      <div className="mdbc-pane-header">
        <span className="mdbc-pane-title">AGENT</span>
        <AgentProviderSelect />
      </div>
      <div className="mdbc-canvas-chat-conn">
        <span className="mdbc-canvas-chat-conn-label">Connection</span>
        <Select
          value={connectionId ?? ""}
          options={connectionOptions}
          onChange={pickConnection}
          placeholder="No connection"
          data-testid="canvas-connection-select"
        />
      </div>
      <div className="mdbc-agent-stream">
        {isEmpty ? (
          <ChatEmpty
            title="Ask the agent to build your board"
            text={
              connectionId
                ? 'Describe an analysis, like "monthly sales by category". The agent reads your schema and the current board, then adds or revises objects.'
                : "Pick a connection above so the agent can read your schema, then describe the analysis you want."
            }
          />
        ) : (
          entries
            .filter((entry) => entry.text.length > 0)
            .map((entry) => (
              <ChatBubble key={entry.id} role={entry.role} text={entry.text} />
            ))
        )}
        {streaming ? <ChatTyping onStop={cancel} /> : null}
      </div>
      <ChatInput
        placeholder={
          connectionId ? "Ask the agent… (⌘↵ to send)" : "Connect a database to use the agent"
        }
        onSend={send}
      />
    </div>
  );
}

export { CanvasAgentChat };
