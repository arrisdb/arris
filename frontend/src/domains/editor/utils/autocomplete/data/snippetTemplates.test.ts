import { describe, it, expect } from "vitest";
import { buildSnippetCompletions, SQL_SNIPPET_DEFS } from "./snippetTemplates";

describe("buildSnippetCompletions", () => {
  it("returns completions for all defined snippets", () => {
    const completions = buildSnippetCompletions();
    expect(completions).toHaveLength(SQL_SNIPPET_DEFS.length);
  });

  it("uses trigger as label and description as detail", () => {
    const completions = buildSnippetCompletions();
    const sel = completions.find((c) => c.label === "sel");
    expect(sel).toBeDefined();
    expect(sel!.detail).toBe("SELECT * FROM ...");
    expect(sel!.type).toBe("snippet");
    expect(sel!.boost).toBe(-5);
  });

  it("has apply function for snippet expansion", () => {
    const completions = buildSnippetCompletions();
    for (const c of completions) {
      expect(typeof c.apply).toBe("function");
    }
  });

  it("includes common SQL patterns", () => {
    const labels = buildSnippetCompletions().map((c) => c.label);
    expect(labels).toContain("sel");
    expect(labels).toContain("ins");
    expect(labels).toContain("upd");
    expect(labels).toContain("del");
    expect(labels).toContain("cte");
    expect(labels).toContain("crt");
  });
});
