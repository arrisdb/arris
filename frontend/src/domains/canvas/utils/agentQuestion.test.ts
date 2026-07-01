import { describe, expect, it } from "vitest";

import { parseAgentQuestion } from "./agentQuestion";

const ask = (json: unknown) => "Sure.\n```arris-ask\n" + JSON.stringify(json) + "\n```";

describe("parseAgentQuestion", () => {
  it("parses a share_results question from an arris-ask block", () => {
    const raw = ask({ type: "share_results", queryIds: ["q1", "q2"], reason: "need rows" });
    expect(parseAgentQuestion(raw)).toEqual({
      type: "share_results",
      queryIds: ["q1", "q2"],
      reason: "need rows",
    });
  });

  it("returns null when there is no ask block", () => {
    expect(parseAgentQuestion("just prose")).toBeNull();
    expect(parseAgentQuestion("```arris-canvas\n{}\n```")).toBeNull();
  });

  it("rejects an unknown type or empty queryIds", () => {
    expect(parseAgentQuestion(ask({ type: "mystery" }))).toBeNull();
    expect(parseAgentQuestion(ask({ type: "share_results", queryIds: [] }))).toBeNull();
  });

  it("tolerates malformed JSON", () => {
    expect(parseAgentQuestion("```arris-ask\n{not json}\n```")).toBeNull();
  });
});
