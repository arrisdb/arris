import { describe, expect, it } from "vitest";

// Design guard: the app has exactly two configurable font roles.
//
//   var(--m-font)                          UI font   : all chrome.
//   var(--m-font-editor, var(--m-font-mono))  editor font: every monospace /
//                                          code / data surface.
//
// Components must reference ONLY these two values (or `inherit`). `--m-font-mono`
// is not a third role: it exists solely as the mono fallback baked into the
// editor declaration, so the only legal way to spell monospace is the full
// `var(--m-font-editor, var(--m-font-mono))`. This keeps the UI/editor font
// settings authoritative: no surface can silently pin a font outside them.
//
// Definition files are exempt because they DECLARE the underlying stacks rather
// than consume a role: tokens.css (the token values), editorFont.ts /
// uiFont.ts (the JS fallback strings applied to the CSS variables).

const UI = "var(--m-font)";
const EDITOR = "var(--m-font-editor, var(--m-font-mono))";
const ALLOWED = new Set([UI, EDITOR, "inherit"]);

const EXEMPT = [
  "/tokens.css",
  "/bundledFonts.css",
  "/editorFont.ts",
  "/uiFont.ts",
];

const cssModules = import.meta.glob("../../../**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const codeModules = import.meta.glob("../../../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function isExempt(path: string): boolean {
  if (path.includes(".test.")) return true;
  return EXEMPT.some((suffix) => path.endsWith(suffix));
}

function normalize(value: string): string {
  return value
    .replace(/!important/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

// CSS `font-family: <value>;` declarations.
function cssFontValues(source: string): string[] {
  const out: string[] = [];
  const re = /font-family\s*:\s*([^;}]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    out.push(normalize(match[1]));
  }
  return out;
}

// JS/TS `fontFamily: "<value>"` string literals (CodeMirror/xterm themes).
function jsFontValues(source: string): string[] {
  const out: string[] = [];
  const re = /fontFamily\s*:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    out.push(normalize(match[1]));
  }
  return out;
}

function collectViolations(
  modules: Record<string, string>,
  extract: (source: string) => string[],
): string[] {
  const violations: string[] = [];
  for (const [path, source] of Object.entries(modules)) {
    if (isExempt(path)) continue;
    for (const value of extract(source)) {
      if (!ALLOWED.has(value)) {
        violations.push(`${path}: "${value}"`);
      }
    }
  }
  return violations;
}

describe("font token discipline", () => {
  it("loads stylesheets and source to scan", () => {
    expect(Object.keys(cssModules).length).toBeGreaterThan(0);
    expect(Object.keys(codeModules).length).toBeGreaterThan(0);
  });

  it("CSS font-family declarations use only the UI or editor font role", () => {
    const violations = collectViolations(cssModules, cssFontValues);
    expect(
      violations,
      `Disallowed font-family values. Use ${UI} (chrome) or ${EDITOR} (code/data):\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("JS fontFamily literals use only the UI or editor font role", () => {
    const violations = collectViolations(codeModules, jsFontValues);
    expect(
      violations,
      `Disallowed fontFamily literals. Use ${UI} (chrome) or ${EDITOR} (code/data):\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
