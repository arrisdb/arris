import type { QueryResult } from "@shared";

import type { AgentQuestion, AgentQuestionAnswer } from "../types";
import { serializeResultTable } from "./resultTable";

/// A query object the user might share: its title and, if it has run, its result.
interface ShareableQuery {
  id: string;
  title: string;
  result?: QueryResult;
}

/// The follow-up turn an answered question produces: `prompt` is sent to the
/// agent, `note` is the short user-bubble label shown in the chat.
interface QuestionFollowUp {
  prompt: string;
  note: string;
}

function shareResultsFollowUp(
  queryIds: string[],
  shared: boolean,
  queries: ShareableQuery[],
): QuestionFollowUp | null {
  if (!shared) {
    return {
      prompt:
        "I decided not to share those results. Continue without them, or tell me what else you need.",
      note: "Declined to share results.",
    };
  }
  const byId = new Map(queries.map((q) => [q.id, q]));
  const blocks: string[] = [];
  const labels: string[] = [];
  for (const id of queryIds) {
    const q = byId.get(id);
    if (!q || !q.result) continue;
    const { table, rowCount, colCount } = serializeResultTable(q.result);
    blocks.push(`# Results: ${q.title || "Query"}\n${table}`);
    labels.push(`${q.title || "Query"} · ${rowCount}×${colCount}`);
  }
  // Approved, but none of the requested cells has a result to send.
  if (blocks.length === 0) return null;
  return {
    prompt: `${blocks.join("\n\n")}\n\nHere are the results you asked for. Use them to continue.`,
    note: `Shared results: ${labels.join(", ")}`,
  };
}

/// Turn an answered question into the follow-up turn to send, switching on the
/// question type. Returns null when there is nothing to send (e.g. sharing was
/// approved but no requested query has a result yet).
function buildQuestionAnswer(
  question: AgentQuestion,
  answer: AgentQuestionAnswer,
  queries: ShareableQuery[],
): QuestionFollowUp | null {
  switch (question.type) {
    case "share_results":
      return shareResultsFollowUp(
        question.queryIds,
        answer.type === "share_results" ? answer.shared : false,
        queries,
      );
    default:
      return null;
  }
}

export { buildQuestionAnswer };
export type { QuestionFollowUp, ShareableQuery };
