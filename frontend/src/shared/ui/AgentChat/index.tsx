import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { IconButton } from "../IconButton";
import "./index.css";

type ChatRole = "user" | "agent";

interface ChatBubbleProps {
  role: ChatRole;
  text: string;
}

interface ChatEmptyProps {
  title: string;
  text: string;
}

interface ChatTypingProps {
  onStop: () => void;
}

interface ChatInputProps {
  placeholder: string;
  disabled?: boolean;
  onSend: (text: string) => void;
  /// Optional banner rendered above the input (e.g. a CLI-unavailable warning).
  banner?: ReactNode;
}

/// One conversation bubble: the user's accent bubble or the agent's neutral one.
function ChatBubble({ role, text }: ChatBubbleProps) {
  return <div className={`mdbc-agent-msg ${role}`}>{text}</div>;
}

/// The centered empty state shown before the first turn.
function ChatEmpty({ title, text }: ChatEmptyProps) {
  return (
    <div className="mdbc-agent-empty">
      <div className="mdbc-agent-empty-title">{title}</div>
      <div className="mdbc-agent-empty-text">{text}</div>
    </div>
  );
}

/// The working indicator: animated dots plus an inline Stop button.
function ChatTyping({ onStop }: ChatTypingProps) {
  return (
    <div className="mdbc-agent-typing">
      <span className="mdbc-agent-dots" aria-label="Agent is working">
        <span />
        <span />
        <span />
      </span>
      <IconButton icon="square" label="Stop" variant="danger" size={13} onClick={onStop} />
    </div>
  );
}

/// The canonical agent input pill: a growable textarea in the shared search box,
/// submitting on Cmd/Ctrl+Enter. Clears itself on send.
function ChatInput({ placeholder, disabled, onSend, banner }: ChatInputProps) {
  const [value, setValue] = useState("");
  const submit = () => {
    if (!value.trim()) return;
    onSend(value);
    setValue("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <div className="mdbc-agent-input">
      {banner}
      <div className="mdbc-search">
        <textarea
          className="mdbc-search-input mdbc-agent-textarea"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}

export { ChatBubble, ChatEmpty, ChatInput, ChatTyping };
export type { ChatRole };
