import { useState } from "react";
import type { KeyboardEvent } from "react";

import { useCanvasAgentChat } from "./hooks";
import type { CanvasAgentChatProps } from "./types";
import "./index.css";

/// The board's agent chat: type a request, the agent designs objects and adds
/// them to this canvas. Mirrors the reference's left "Agents" panel.
function CanvasAgentChat({ tab }: CanvasAgentChatProps) {
  const { cancel, connectionId, entries, send, streaming } = useCanvasAgentChat(tab);
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (!draft.trim() || streaming) return;
    send(draft);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="mdbc-canvas-chat">
      <div className="mdbc-canvas-chat-head">
        <span className="mdbc-canvas-chat-title">Agent</span>
      </div>
      <div className="mdbc-canvas-chat-log">
        {entries.length === 0 ? (
          <div className="mdbc-canvas-chat-empty">
            Ask the agent to build something, like "monthly sales by category".
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={`mdbc-canvas-chat-msg ${entry.role}${entry.pending ? " pending" : ""}`}
            >
              {entry.text}
            </div>
          ))
        )}
      </div>
      <div className="mdbc-canvas-chat-input">
        <textarea
          className="mdbc-canvas-chat-textarea"
          value={draft}
          rows={2}
          placeholder={connectionId ? "Ask the agent…" : "Connect a database to use the agent"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {streaming ? (
          <button type="button" className="mdbc-btn danger" onClick={cancel}>
            Stop
          </button>
        ) : (
          <button type="button" className="mdbc-btn primary" disabled={!draft.trim()} onClick={submit}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

export { CanvasAgentChat };
