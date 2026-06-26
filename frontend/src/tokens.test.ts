import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Anchored on this file's location (src root) so it is cwd-independent.
const here = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(resolve(here, "tokens.css"), "utf8");

function lightBlock(): string {
  const start = tokensCss.indexOf('[data-theme="light"]');
  const end = tokensCss.indexOf("}", start);
  return tokensCss.slice(start, end);
}

function tokenValue(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`token ${name} not found`);
  return match[1].trim();
}

// Flatten a (possibly translucent) foreground color over an opaque background.
function flattenOverWhite(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!rgba) throw new Error(`unparseable color: ${value}`);
  const [r, g, b] = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
  // Background is the light window/surface white (#ffffff = 255).
  return [r, g, b].map((c) => Math.round(c * a + 255 * (1 - a))) as [number, number, number];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastVsWhite(value: string): number {
  const l = relativeLuminance(flattenOverWhite(value));
  const white = 1;
  return (white + 0.05) / (l + 0.05);
}

describe("light theme text contrast", () => {
  const block = lightBlock();

  it("primary and secondary text meet WCAG AA (4.5:1) on white", () => {
    expect(contrastVsWhite(tokenValue(block, "--m-fg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastVsWhite(tokenValue(block, "--m-fg-2"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastVsWhite(tokenValue(block, "--m-fg-3"))).toBeGreaterThanOrEqual(4.5);
  });

  it("muted/decorative text meets the 3:1 large-text threshold", () => {
    expect(contrastVsWhite(tokenValue(block, "--m-fg-4"))).toBeGreaterThanOrEqual(3);
  });

  it("placeholder hint text is dimmer than muted text yet still perceptible", () => {
    const placeholder = contrastVsWhite(tokenValue(block, "--m-placeholder"));
    // Visibly dimmer than the muted --m-fg-4 so hints don't read as entered values...
    expect(placeholder).toBeLessThan(contrastVsWhite(tokenValue(block, "--m-fg-4")));
    // ...but not so faint as to be invisible.
    expect(placeholder).toBeGreaterThanOrEqual(2);
  });
});

describe("light theme syntax highlighting contrast", () => {
  const block = lightBlock();

  it("code tokens are readable on the white editor background", () => {
    for (const token of [
      "--m-syn-keyword",
      "--m-syn-string",
      "--m-syn-number",
      "--m-syn-operator",
      "--m-syn-function",
      "--m-syn-variable",
      "--m-syn-type",
    ]) {
      expect(contrastVsWhite(tokenValue(block, token))).toBeGreaterThanOrEqual(4.5);
    }
    // Comments are intentionally de-emphasised but must clear the 3:1 floor.
    expect(contrastVsWhite(tokenValue(block, "--m-syn-comment"))).toBeGreaterThanOrEqual(3);
  });
});
