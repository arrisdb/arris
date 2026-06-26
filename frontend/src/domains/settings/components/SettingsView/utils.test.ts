import { describe, expect, it } from "vitest";
import { buildFontOptions } from "./utils";
import {
  BUNDLED_FONTS,
  DEFAULT_EDITOR_FONT_LABEL,
  DEFAULT_EDITOR_FONT_VALUE,
} from "@shared/ui/utils/editorFont";

describe("buildFontOptions", () => {
  it("always offers the bundled fonts, even with no system fonts reported", () => {
    const values = buildFontOptions([]).map((o) => o.value);
    for (const font of BUNDLED_FONTS) {
      expect(values).toContain(font);
    }
  });

  it("appends installed system fonts after the bundled fonts", () => {
    const values = buildFontOptions([
      "Source Code Pro for Powerline",
      "Menlo",
    ]).map((o) => o.value);
    expect(values).toContain("Source Code Pro for Powerline");
    expect(values).toContain("Menlo");
    for (const font of BUNDLED_FONTS) {
      expect(values).toContain(font);
    }
  });

  it("never offers an unverified name (only bundled + reported system fonts)", () => {
    const values = buildFontOptions(["Menlo"]).slice(1).map((o) => o.value);
    const allowed = new Set([...BUNDLED_FONTS, "Menlo"]);
    for (const value of values) {
      expect(allowed.has(value)).toBe(true);
    }
  });

  it("does not duplicate a bundled font that is also installed", () => {
    const values = buildFontOptions(["Source Code Pro", "Menlo"]).map((o) => o.value);
    const scp = values.filter((v) => v === "Source Code Pro");
    expect(scp).toHaveLength(1);
  });

  it("always leads with the Default sentinel option", () => {
    expect(buildFontOptions(["Menlo"])[0]).toEqual({
      value: DEFAULT_EDITOR_FONT_VALUE,
      label: DEFAULT_EDITOR_FONT_LABEL,
    });
    expect(buildFontOptions([])[0].value).toBe(DEFAULT_EDITOR_FONT_VALUE);
  });
});
