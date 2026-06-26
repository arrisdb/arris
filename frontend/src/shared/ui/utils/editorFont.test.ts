import { afterEach, describe, expect, it } from "vitest";
import { applyEditorFontFamily, editorFontCssValue, uniqueFontFamilies } from "./editorFont";

afterEach(() => {
  document.documentElement.style.removeProperty("--m-font-editor");
});

describe("editor font preference", () => {
  it("quotes selected font family and keeps monospace fallback", () => {
    expect(editorFontCssValue("JetBrains Mono")).toContain('"JetBrains Mono"');
    expect(editorFontCssValue("JetBrains Mono")).toContain("var(--m-font-mono");
  });

  it("escapes quotes in font family names", () => {
    expect(editorFontCssValue('Mono "Custom"')).toContain('"Mono \\"Custom\\""');
  });

  it("applies and clears root CSS variable", () => {
    applyEditorFontFamily("JetBrains Mono");
    expect(document.documentElement.style.getPropertyValue("--m-font-editor")).toContain(
      "JetBrains Mono",
    );

    applyEditorFontFamily(null);
    expect(document.documentElement.style.getPropertyValue("--m-font-editor")).toBe("");
  });

  it("deduplicates and sorts font families", () => {
    expect(uniqueFontFamilies([" Menlo ", "JetBrains Mono", "Menlo", ""])).toEqual([
      "JetBrains Mono",
      "Menlo",
    ]);
  });
});
