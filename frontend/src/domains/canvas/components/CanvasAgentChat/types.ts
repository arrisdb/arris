import type { EditorTab } from "@shell/types";

import type { AgentQuestion, AgentQuestionAnswer } from "../../types";

/// A query object's title and run dimensions, for the question card to show what
/// the agent is asking to read.
interface QueryResultInfo {
  title: string;
  hasResult: boolean;
  rowCount: number;
  colCount: number;
}

interface AgentQuestionCardProps {
  question: AgentQuestion;
  answered: boolean;
  describeQuery: (id: string) => QueryResultInfo;
  onAnswer: (answer: AgentQuestionAnswer) => void;
}

type ChatRole = "user" | "agent";

/// One turn in the canvas chat log. The agent entry streams (`pending`) then
/// settles into a summary of what was added. When the agent asks the user
/// something instead of changing the board, the entry carries a `question` and
/// renders a question card; `answered` is set once the user responds.
interface ChatEntry {
  id: string;
  role: ChatRole;
  text: string;
  pending?: boolean;
  /// The board change the agent made this turn (added/updated/removed objects),
  /// kept separate from `text` so the reply prose and the action it took render
  /// with their own fixed styling instead of running together.
  action?: string;
  question?: AgentQuestion;
  answered?: boolean;
}

interface CanvasAgentChatProps {
  tab: EditorTab;
}

export type {
  AgentQuestionCardProps,
  CanvasAgentChatProps,
  ChatEntry,
  ChatRole,
  QueryResultInfo,
};
