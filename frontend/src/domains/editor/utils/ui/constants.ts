// Shared tuning constants for the editor's per-keystroke UI extensions.

// How far back before the viewport semantic-highlight classification starts.
// The role of a token depends on keywords to its LEFT (FROM/JOIN/WITH ... state
// machine), so leaves are collected from a context window preceding the first
// visible position. A window instead of the whole document keeps the
// per-keystroke cost bounded by the viewport, not the file; statements larger
// than the window may rarely misclassify their visible tail, which is
// acceptable for a heuristic overlay.
const SEMANTIC_CONTEXT_CHARS = 4000;

// Parse budget per semantic-highlight rebuild. The window is viewport-sized,
// so this is never hit in practice; it exists so a pathological single-line
// document cannot stall the keystroke. An incomplete tree self-heals: the
// plugin rebuilds when the background parser finishes (tree identity check).
const SEMANTIC_PARSE_BUDGET_MS = 50;

// Debounce for persisting the scroll anchor while the user scrolls. Coalesces
// the rapid scroll-event stream into one store write once scrolling settles.
const SCROLL_ANCHOR_DEBOUNCE_MS = 150;

// Measured width of the sticky .cm-gutters strip. The hunk action bar is
// position: sticky and must pin RIGHT of the gutters, which overlay content
// during horizontal scroll.
const GUTTERS_WIDTH_CSS_VAR = "--editor-gutters-width";

export {
  SEMANTIC_CONTEXT_CHARS,
  SEMANTIC_PARSE_BUDGET_MS,
  SCROLL_ANCHOR_DEBOUNCE_MS,
  GUTTERS_WIDTH_CSS_VAR,
};
