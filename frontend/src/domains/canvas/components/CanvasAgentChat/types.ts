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

export type { CanvasAgentChatProps, ChatEntry, ChatRole };
