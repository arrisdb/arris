import { ChatBubble, ChatEmpty, ChatInput, ChatTyping } from "@shared/ui";

import { useCanvasAgentChat } from "./hooks";
import type { CanvasAgentChatProps } from "./types";

/// The board's agent chat: type a request, the agent reads the schema and the
/// current board, then adds or revises canvas objects. Renders the shared
/// agent-chat chrome so it is visually identical to the SQL agent pane.
function CanvasAgentChat({ tab }: CanvasAgentChatProps) {
  const { cancel, connectionId, entries, send, streaming } = useCanvasAgentChat(tab);
  const isEmpty = entries.length === 0 && !streaming;

  return (
    <div className="mdbc-agent-pane">
      <div className="mdbc-pane-header">
        <span className="mdbc-pane-title">AGENT</span>
      </div>
      <div className="mdbc-agent-stream">
        {isEmpty ? (
          <ChatEmpty
            title="Ask the agent to build your board"
            text='Describe an analysis, like "monthly sales by category". The agent reads your schema and the current board, then adds or revises objects.'
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
