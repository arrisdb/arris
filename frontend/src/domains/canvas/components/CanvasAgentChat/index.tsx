import { useState } from "react";
import { ChatBubble, ChatEmpty, ChatInput, ChatTyping, MultiSelect, Spinner } from "@shared/ui";
import { Icon } from "@shared/ui/Icon";
import { AgentProviderSelect } from "@domains/agent";
import { markdownToHtml } from "@domains/editor";

import { AgentQuestionCard } from "./components/AgentQuestionCard";
import { useCanvasAgentChat } from "./hooks";
import type { CanvasAgentChatProps } from "./types";
import "./index.css";

/// The board's agent chat: pick the board's connections, type a request, and the
/// agent reads their schemas and the current board, then adds or revises objects.
/// When it needs data it cannot see (a query's rows), it asks with a question
/// card the user answers in place. Renders the shared agent-chat chrome so it
/// matches the SQL agent pane.
function CanvasAgentChat({ tab }: CanvasAgentChatProps) {
  const {
    answerQuestion,
    buildContext,
    cancel,
    connectionId,
    connectionIds,
    connectionOptions,
    describeQuery,
    entries,
    pickConnections,
    schemaLoading,
    send,
    streaming,
  } = useCanvasAgentChat(tab);
  const isEmpty = entries.length === 0 && !streaming;
  const [contextOpen, setContextOpen] = useState(false);

  return (
    <div className="mdbc-agent-pane">
      <div className="mdbc-pane-header">
        <span className="mdbc-pane-title">AGENT</span>
        <AgentProviderSelect />
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
            .filter((entry) => entry.text.length > 0 || entry.question || entry.action)
            .map((entry) => (
              <div key={entry.id} className={`mdbc-canvas-chat-row ${entry.role}`}>
                {entry.text.length > 0 ? (
                  entry.role === "agent" ? (
                    <div
                      className="mdbc-agent-msg agent mdbc-canvas-chat-md"
                      // Agent prose is markdown; the renderer escapes HTML, so this
                      // shows headings/lists/code/bold instead of raw syntax.
                      dangerouslySetInnerHTML={{ __html: markdownToHtml(entry.text) }}
                    />
                  ) : (
                    <ChatBubble role={entry.role} text={entry.text} />
                  )
                ) : null}
                {entry.action ? (
                  <div className="mdbc-canvas-chat-action">
                    <Icon name="check" size={12} />
                    <span>{entry.action}</span>
                  </div>
                ) : null}
                {entry.question ? (
                  <AgentQuestionCard
                    question={entry.question}
                    answered={Boolean(entry.answered)}
                    describeQuery={describeQuery}
                    onAnswer={(answer) => answerQuestion(entry.id, answer)}
                  />
                ) : null}
              </div>
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
