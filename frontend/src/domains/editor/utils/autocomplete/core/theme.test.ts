import { describe, it, expect } from "vitest";
import { kindGlyph, kindColor, arrisCompletionTheme } from "./theme";

describe("kindGlyph", () => {
  it("returns table glyph", () => expect(kindGlyph("table")).toBe("▦"));
  it("returns column glyph", () => expect(kindGlyph("column")).toBe("·"));
  it("returns function glyph", () => expect(kindGlyph("function")).toBe("ƒ"));
  it("returns keyword glyph", () => expect(kindGlyph("keyword")).toBe("•"));
  it("returns schema glyph", () => expect(kindGlyph("schema")).toBe("▣"));
  it("returns default for unknown", () => expect(kindGlyph("other")).toBe("›"));
  it("returns default for undefined", () => expect(kindGlyph(undefined)).toBe("›"));
});

describe("kindColor", () => {
  it("table is blue", () => expect(kindColor("table")).toBe("#8fb6ff"));
  it("column is light blue", () => expect(kindColor("column")).toBe("#b9d6ff"));
  it("function is yellow", () => expect(kindColor("function")).toBe("#ffd96a"));
  it("keyword is pink", () => expect(kindColor("keyword")).toBe("#ff8fbf"));
  it("schema is accent-2", () => expect(kindColor("schema")).toBe("var(--m-accent-2)"));
  it("unknown is grey", () => expect(kindColor("other")).toBe("#a0a0aa"));
});

describe("arrisCompletionTheme", () => {
  it("returns an array of extensions", () => {
    const exts = arrisCompletionTheme(13);
    expect(Array.isArray(exts)).toBe(true);
    expect(exts.length).toBe(2);
  });
});
