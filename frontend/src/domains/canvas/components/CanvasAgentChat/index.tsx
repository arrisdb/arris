import { useState } from "react";
import { ChatBubble, ChatEmpty, ChatInput, ChatTyping, MultiSelect, Select, Spinner } from "@shared/ui";
import { Icon } from "@shared/ui/Icon";
import { AgentProviderSelect } from "@domains/agent";

import { useCanvasAgentChat } from "./hooks";
import type { CanvasAgentChatProps } from "./types";
import "./index.css";

/// The board's agent chat: pick the board's connections, type a request, and the
/// agent reads their schemas and the current board, then adds or revises objects.
/// Renders the shared agent-chat chrome so it matches the SQL agent pane.
function CanvasAgentChat({ tab }: CanvasAgentChatProps) {
  const {
    attachResult,
    attachments,
    buildContext,
    cancel,
    connectionId,
    connectionIds,
    connectionOptions,
    entries,
    pickConnections,
    removeAttachment,
    resultOptions,
    schemaLoading,
    send,
    streaming,
  } = useCanvasAgentChat(tab);
  const isEmpty = entries.length === 0 && !streaming;
  const [contextOpen, setContextOpen] = useState(false);

  return (
    <div className="mdbc-agent-pane">
      <div className="mdbc-canvas-chat-toolbar">
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
        <MultiSelect
          values={connectionIds}
          options={connectionOptions}
          onChange={pickConnections}
          placeholder="No connection"
          data-testid="canvas-connection-select"
        />
      </div>
      {schemaLoading ? (
        <div className="mdbc-canvas-chat-status">
          <Spinner size={12} />
          <span>Fetching schema &amp; table info…</span>
        </div>
      ) : null}
      {connectionId ? (
        <div className="mdbc-canvas-chat-context">
          <button
            type="button"
            className="mdbc-canvas-chat-context-toggle"
            aria-expanded={contextOpen}
            onClick={() => setContextOpen((open) => !open)}
            data-testid="canvas-context-toggle"
          >
            <Icon name={contextOpen ? "chevronDown" : "chevronRight"} size={12} />
            <span>Context</span>
          </button>
          {contextOpen ? (
            <pre className="mdbc-canvas-chat-context-body">{buildContext()}</pre>
          ) : null}
        </div>
      ) : null}
      <div className="mdbc-agent-stream">
        {isEmpty ? (
          <ChatEmpty
            title="Ask the agent to build your board"
            text={
              connectionId
                ? 'Describe an analysis, like "monthly sales by category". The agent reads your schema and the current board, then adds or revises objects.'
                : "Pick one or more connections above so the agent can read their schema, then describe the analysis you want."
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
