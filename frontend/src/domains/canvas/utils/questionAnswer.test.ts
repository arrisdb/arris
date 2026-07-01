import { describe, expect, it } from "vitest";

import { buildQuestionAnswer } from "./questionAnswer";

const result = (val: string) =>
  ({
    columns: [{ name: "category", type_hint: "text" }],
    rows: [[{ kind: "text", value: val }]],
    elapsed: 0,
  }) as never;

describe("buildQuestionAnswer", () => {
  it("share approved: emits a titled results block and a note", () => {
    const out = buildQuestionAnswer(
      { type: "share_results", queryIds: ["q1"] },
      { type: "share_results", shared: true },
      [{ id: "q1", title: "Monthly sales", result: result("Books") }],
    );
    expect(out?.prompt).toContain("# Results: Monthly sales");
    expect(out?.prompt).toContain("category (text)");
    expect(out?.note).toContain("Shared results: Monthly sales");
  });

  it("share declined: emits a follow-up that carries no rows", () => {
    const out = buildQuestionAnswer(
      { type: "share_results", queryIds: ["q1"] },
      { type: "share_results", shared: false },
      [{ id: "q1", title: "Monthly sales", result: result("Books") }],
    );
    expect(out?.prompt).not.toContain("# Results:");
    expect(out?.note).toMatch(/declined/i);
  });

  it("approved but no requested cell has a result yields null (nothing to send)", () => {
    const out = buildQuestionAnswer(
      { type: "share_results", queryIds: ["q1"] },
      { type: "share_results", shared: true },
      [{ id: "q1", title: "Monthly sales" }],
    );
    expect(out).toBeNull();
  });
});
