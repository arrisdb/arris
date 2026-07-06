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

// Pixel inset from the scroller's top-left corner when sampling the top row, to
// clear the border edge.
const ANCHOR_SAMPLE_INSET_PX = 1;

// No margin when re-scrolling the anchor row to the top; the pixel remainder is
// reapplied separately, so a margin would double-count.
const ANCHOR_SCROLL_Y_MARGIN_PX = 0;

export {
  SEMANTIC_CONTEXT_CHARS,
  SEMANTIC_PARSE_BUDGET_MS,
  SCROLL_ANCHOR_DEBOUNCE_MS,
  ANCHOR_SAMPLE_INSET_PX,
  ANCHOR_SCROLL_Y_MARGIN_PX,
};
