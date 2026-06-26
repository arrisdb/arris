import { describe, it, expect } from "vitest";
import { findEsRestRequestAt } from "./esRestLanguage";

describe("findEsRestRequestAt", () => {
  it("returns null for empty doc", () => {
    expect(findEsRestRequestAt("", 0)).toBeNull();
    expect(findEsRestRequestAt("   ", 0)).toBeNull();
  });

  it("returns full range for a single request", () => {
    const doc = "GET /logs/_search";
    const r = findEsRestRequestAt(doc, 5);
    expect(r).toEqual({ from: 0, to: doc.length });
  });

  it("splits at HTTP method lines", () => {
    const doc = [
      "POST /logs/_search",
      '{"query": {"match_all": {}}}',
      "",
      "GET /_cluster/health",
    ].join("\n");
    const first = findEsRestRequestAt(doc, 0);
    expect(doc.slice(first!.from, first!.to).trim()).toBe(
      'POST /logs/_search\n{"query": {"match_all": {}}}'
    );

    const second = findEsRestRequestAt(doc, doc.indexOf("GET"));
    expect(doc.slice(second!.from, second!.to).trim()).toBe(
      "GET /_cluster/health"
    );
  });

  it("cursor in body stays in same request", () => {
    const doc = "POST /a\n{\"x\":1}\nGET /b";
    const r = findEsRestRequestAt(doc, doc.indexOf('"x"'));
    expect(doc.slice(r!.from, r!.to).trim()).toContain("POST /a");
    expect(doc.slice(r!.from, r!.to).trim()).toContain('"x"');
  });

  it("falls back to last block if cursor past end", () => {
    const doc = "GET /a\nGET /b";
    const r = findEsRestRequestAt(doc, doc.length + 10);
    expect(doc.slice(r!.from, r!.to).trim()).toBe("GET /b");
  });
});
