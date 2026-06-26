import type { Theme } from "@shared";

// Canonical syntax-token ids. Each maps to a `--m-syn-<id>` CSS variable
// consumed by the shared highlight style (see codeHighlight.ts). Order is the
// display order used by the Settings customisation UI.
const SYNTAX_TOKEN_IDS = [
  "keyword",
  "builtin",
  "function",
  "type",
  "string",
  "number",
  "constant",
  "comment",
  "operator",
  "punctuation",
  "bracket",
  "variable",
  "property",
] as const;

type SyntaxTokenId = (typeof SYNTAX_TOKEN_IDS)[number];

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

// The editor colour scheme is independent of the app theme. Each named scheme
// (default "oneDark") redefines the `--m-syn-*` vars via `[data-color-scheme="…"]`
// rules in tokens.css.
function applyColorScheme(scheme: string): void {
  document.documentElement.setAttribute("data-color-scheme", scheme);
}

// Per-token user overrides win over both theme and scheme because they are set
// as inline custom properties on the root element. Always clears every token
// var first so removing an override reverts to the scheme/theme value.
function applySyntaxOverrides(overrides: Record<string, string>): void {
  const root = document.documentElement;
  for (const id of SYNTAX_TOKEN_IDS) {
    const value = overrides[id];
    if (value) {
      root.style.setProperty(`--m-syn-${id}`, value);
    } else {
      root.style.removeProperty(`--m-syn-${id}`);
    }
  }
}

export { applyColorScheme, applySyntaxOverrides, applyTheme, SYNTAX_TOKEN_IDS };
export type { SyntaxTokenId };
