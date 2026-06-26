import { afterEach, describe, expect, it } from "vitest";
import { applyUiFontFamily, uiFontCssValue } from "./uiFont";

afterEach(() => {
  document.documentElement.style.removeProperty("--m-font");
});

describe("UI font preference", () => {
  it("quotes selected font family and keeps the sans-serif fallback", () => {
    expect(uiFontCssValue("Inter")).toContain('"Inter"');
    expect(uiFontCssValue("Inter")).toContain("sans-serif");
  });

  it("returns null when no family is selected", () => {
    expect(uiFontCssValue(null)).toBeNull();
  });

  it("escapes quotes in font family names", () => {
    expect(uiFontCssValue('My "Font"')).toContain('"My \\"Font\\""');
  });

  it("applies and clears the base --m-font variable", () => {
    applyUiFontFamily("Inter");
    expect(document.documentElement.style.getPropertyValue("--m-font")).toContain("Inter");

    applyUiFontFamily(null);
    expect(document.documentElement.style.getPropertyValue("--m-font")).toBe("");
  });
});
