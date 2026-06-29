import { useState } from "react";
import { ChatBubble, ChatEmpty, ChatInput, ChatTyping, Select, Spinner } from "@shared/ui";
import { AgentProviderSelect } from "@domains/agent";

import { useCanvasAgentChat } from "./hooks";
import type { CanvasAgentChatProps } from "./types";
import "./index.css";

/// The board's agent chat: pick the board's connection, type a request, and the
/// agent reads the schema and the current board, then adds or revises objects.
/// Renders the shared agent-chat chrome so it matches the SQL agent pane.
function CanvasAgentChat({ tab }: CanvasAgentChatProps) {
  const {
    attachResult,
    attachments,
    buildContext,
    cancel,
    connectionId,
    connectionOptions,
    entries,
    pickConnection,
    removeAttachment,
    resultOptions,
    schemaLoading,
    send,
    streaming,
  } = useCanvasAgentChat(tab);
  const isEmpty = entries.length === 0 && !streaming;
  const [contextText, setContextText] = useState<string | null>(null);

  return (
    <div className="mdbc-agent-pane">
      <div className="mdbc-pane-header">
        <span className="mdbc-pane-title">AGENT</span>
        <AgentProviderSelect />
        {resultOptions.length > 0 ? (
          <div className="mdbc-canvas-chat-addresults">
            <Select
              value=""
              options={resultOptions}
              onChange={attachResult}
              placeholder="+ Add results"
              data-testid="canvas-add-results"
            />
          </div>
        ) : null}
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
        <button
          type="button"
          className="mdbc-btn text-only"
          disabled={!connectionId}
          onClick={() => setContextText(buildContext())}
        >
          Context
        </button>
      </div>
      {schemaLoading ? (
        <div className="mdbc-canvas-chat-status">
          <Spinner size={12} />
          <span>Fetching schema &amp; table info…</span>
        </div>
      ) : null}
      {contextText !== null ? (
        <div className="mdbc-canvas-chat-context">
          <div className="mdbc-canvas-chat-context-head">
            <span className="mdbc-canvas-chat-context-title">Context sent to the agent</span>
            <button
              type="button"
              className="mdbc-btn text-only"
              onClick={() => setContextText(null)}
            >
              Close
            </button>
          </div>
          <pre className="mdbc-canvas-chat-context-body">{contextText}</pre>
        </div>
      ) : (
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
      )}
      {attachments.length > 0 ? (
        <div className="mdbc-canvas-chat-chips">
          {attachments.map((att) => (
            <span key={att.id} className="mdbc-canvas-chat-chip" title={att.label}>
              {att.label}
              <button
                type="button"
                className="mdbc-canvas-chat-chip-remove"
                aria-label={`Remove ${att.label}`}
                onClick={() => removeAttachment(att.id)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
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
