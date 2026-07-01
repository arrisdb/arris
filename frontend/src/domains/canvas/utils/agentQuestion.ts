import { CANVAS_ASK_FENCE } from "../constants";
import type { AgentQuestion } from "../types";

/// Pull the JSON object out of the first ```arris-ask fenced block. Returns null
/// when the reply has no such block or its body is not valid JSON.
function extractAskBlock(raw: string): unknown {
  const re = new RegExp("```" + CANVAS_ASK_FENCE + "\\s*([\\s\\S]*?)```");
  const m = raw.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

/// Validate a parsed object into a typed question, one case per question type.
/// An unknown or malformed type yields null, so the turn falls back to prose.
function toQuestion(obj: unknown): AgentQuestion | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  switch (o.type) {
    case "share_results": {
      const ids = Array.isArray(o.queryIds)
        ? o.queryIds.filter((v): v is string => typeof v === "string")
        : [];
      if (ids.length === 0) return null;
      const reason = typeof o.reason === "string" ? o.reason : undefined;
      return { type: "share_results", queryIds: ids, reason };
    }
    default:
      return null;
  }
}

/// Parse the agent's reply into the question it is asking the user, or null when
/// it asked nothing (the reply is board changes or plain prose).
function parseAgentQuestion(raw: string): AgentQuestion | null {
  return toQuestion(extractAskBlock(raw));
}

export { parseAgentQuestion };
