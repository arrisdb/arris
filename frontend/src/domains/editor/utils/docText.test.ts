import { describe, it, expect } from "vitest";
import { Text } from "@codemirror/state";
import { docString } from "./docText";

describe("docString", () => {
  it("returns the document text", () => {
    const doc = Text.of(["SELECT 1;", "SELECT 2;"]);
    expect(docString(doc)).toBe("SELECT 1;\nSELECT 2;");
  });

  it("returns the SAME string instance for repeated calls on one doc version", () => {
    const doc = Text.of(["SELECT * FROM t"]);
    const a = docString(doc);
    const b = docString(doc);
    expect(a).toBe(b);
  });

  it("recomputes for a new document version", () => {
    const doc = Text.of(["SELECT 1"]);
    const edited = doc.replace(7, 8, Text.of(["2"]));
    expect(docString(doc)).toBe("SELECT 1");
    expect(docString(edited)).toBe("SELECT 2");
  });

  it("handles the empty document", () => {
    expect(docString(Text.empty)).toBe("");
  });
});
