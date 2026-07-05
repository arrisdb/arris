const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
// The persistent per-tab element xterm is opened into; it travels between pane
// hosts on split/move so the session is never re-created.
const TERMINAL_CONTAINER_CLASS = "mdbc-terminal-session";
// Wait for a separator drag to settle before reflowing the grid. Refitting on
// every frame resizes (and so clears) the WebGL canvas, which reads as blinking.
const RESIZE_DEBOUNCE_MS = 100;
// 1.0 keeps box-drawing glyphs touching between rows; >1 leaves vertical gaps.
const DEFAULT_LINE_HEIGHT = 1.0;
const DEFAULT_LETTER_SPACING = 0;
const DEFAULT_TERMINAL_FONT =
  "ui-monospace, 'SF Mono', Menlo, Monaco, 'JetBrains Mono', 'Fira Code', 'Cascadia Mono', Consolas, monospace";

export {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_LETTER_SPACING,
  DEFAULT_TERMINAL_FONT,
  RESIZE_DEBOUNCE_MS,
  TERMINAL_CONTAINER_CLASS,
};
