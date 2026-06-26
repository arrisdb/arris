import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Shared CodeMirror syntax-highlight palette. Language-agnostic: it keys off
// Lezer tags, so SQL, Python, and any other grammar render with the same
// colours. Colours come from `--m-syn-*` CSS variables, supplied by the active
// theme and overridden by the chosen editor colour scheme (see tokens.css and
// styles/theme.ts). Single source of truth for every editor in the app.
//
// The token set is intentionally fine-grained so output reads as richly as
// editors like Zed: built-in functions, column/member references, constants and
// brackets each get their own hue instead of collapsing into a few colours.
const arrisHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--m-syn-keyword)", fontWeight: "600" },
  { tag: [t.standard(t.name), t.macroName], color: "var(--m-syn-builtin)" },
  { tag: [t.string, t.special(t.string)], color: "var(--m-syn-string)" },
  { tag: t.regexp, color: "var(--m-syn-string)" },
  { tag: t.number, color: "var(--m-syn-number)" },
  // NULL / TRUE / FALSE read as keywords (e.g. SQL `NOT NULL`, `DEFAULT TRUE`), so
  // they share the keyword colour; other atoms keep the constant colour.
  { tag: [t.bool, t.null], color: "var(--m-syn-keyword)", fontWeight: "600" },
  { tag: t.atom, color: "var(--m-syn-constant)" },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: "var(--m-syn-comment)",
    fontStyle: "italic",
  },
  { tag: t.operator, color: "var(--m-syn-operator)" },
  { tag: t.punctuation, color: "var(--m-syn-punctuation)" },
  {
    tag: [t.bracket, t.brace, t.paren, t.squareBracket],
    color: "var(--m-syn-bracket)",
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "var(--m-syn-function)",
  },
  { tag: t.standard(t.function(t.variableName)), color: "var(--m-syn-builtin)" },
  // `propertyName`/`variableName`/`function(...)` cover grammars that emit them
  // (Python, JSON, etc.). `@codemirror/lang-sql` is coarser: it tags every
  // identifier (tables, columns, aliases, CTEs, and both sides of `a.b`) as a
  // single `name` tag, so colouring `name` is what gives SQL its identifier hue
  // (one colour for all; the grammar exposes no finer distinction).
  { tag: t.propertyName, color: "var(--m-syn-property)" },
  // YAML mapping keys come through as `definition(propertyName)` (the more
  // specific tag), unlike SQL `a.b` access / JSON keys / markdown lists which
  // emit plain `propertyName`. Giving the definition variant the function hue
  // keeps YAML keys clearly distinct from their string values without recolouring
  // identifiers in any other language.
  { tag: t.definition(t.propertyName), color: "var(--m-syn-function)" },
  { tag: [t.variableName, t.name], color: "var(--m-syn-variable)" },
  { tag: [t.typeName, t.className], color: "var(--m-syn-type)" },
  // Markdown tags. SQL/Python grammars don't emit these, so adding them is
  // additive: only Markdown documents pick them up. Markers (`#`, `*`, `>`,
  // `-`) come through as `processingInstruction`; fenced/inline code as
  // `monospace`.
  {
    tag: [
      t.heading,
      t.heading1,
      t.heading2,
      t.heading3,
      t.heading4,
      t.heading5,
      t.heading6,
    ],
    color: "var(--m-syn-keyword)",
    fontWeight: "700",
  },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--m-syn-function)", textDecoration: "underline" },
  { tag: t.monospace, color: "var(--m-syn-string)" },
  { tag: t.quote, color: "var(--m-syn-comment)", fontStyle: "italic" },
  { tag: t.list, color: "var(--m-syn-property)" },
  { tag: t.contentSeparator, color: "var(--m-syn-punctuation)" },
  { tag: t.processingInstruction, color: "var(--m-syn-keyword)" },
]);

export { arrisHighlight };
