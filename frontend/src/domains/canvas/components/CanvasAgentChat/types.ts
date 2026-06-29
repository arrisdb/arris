import type { EditorTab } from "@shell/types";

type ChatRole = "user" | "agent";

/// One turn in the canvas chat log. The agent entry streams (`pending`) then
/// settles into a summary of what was added.
interface ChatEntry {
  id: string;
  role: ChatRole;
  text: string;
  pending?: boolean;
}

interface CanvasAgentChatProps {
  tab: EditorTab;
}

/// A query object's result the user attached to the next message. `table` is the
/// serialized markdown sent to the agent; `label` is the removable chip shown
/// above the input.
interface ResultAttachment {
  id: string;
  queryId: string;
  label: string;
  table: string;
}

export type { CanvasAgentChatProps, ChatEntry, ChatRole, ResultAttachment };
