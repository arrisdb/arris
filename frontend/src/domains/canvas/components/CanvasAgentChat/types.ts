import type { EditorTab } from "@shell/types";

import type {
  AgentQuestion,
  AgentQuestionAnswer,
  ChatEntry,
  ChatRole,
} from "../../types";

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
