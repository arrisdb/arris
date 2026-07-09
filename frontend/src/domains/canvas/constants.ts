import type { ComponentKind } from "./types";

/// Schema version of the serialized `CanvasDoc`. Bump when the persisted shape
/// changes; `parseDoc` rejects unknown versions and falls back to an empty board.
const CANVAS_DOC_VERSION = 1;

/// The fenced-block language tag the agent emits and `parseAgentCanvas` reads.
const CANVAS_SPEC_FENCE = "arris-canvas";

/// The fenced-block language tag the agent emits to ASK the user something
/// (instead of changing the board), read by `parseAgentQuestion`.
const CANVAS_ASK_FENCE = "arris-ask";

/// Every object kind the agent-spec parser accepts inside an `arris-canvas`
/// block. Adding a kind to the union means adding it here too.
const KNOWN_KINDS: ComponentKind[] = [
  "text",
  "sticky",
  "query",
  "chart",
  "table",
  "shape",
];

/// Default object sizes (canvas units), per kind. Used by the object factory and
/// when the agent omits geometry.
const DEFAULT_SIZE: Record<ComponentKind, { w: number; h: number }> = {
  text: { w: 320, h: 120 },
  sticky: { w: 220, h: 200 },
  query: { w: 540, h: 300 },
  chart: { w: 560, h: 360 },
  table: { w: 540, h: 320 },
  shape: { w: 220, h: 160 },
};

/// Gap between auto-laid-out objects (canvas units).
const LAYOUT_GAP = 32;

/// Where the first auto-laid-out object lands when the board is empty.
const LAYOUT_ORIGIN = { x: 80, y: 80 };

/// Debounce before serializing the live board back into the tab's text.
const CANVAS_SAVE_DEBOUNCE_MS = 400;

/// Prefix of the backend cancellation id for a cell run
/// (`<prefix>:<tabId>:<cellId>`), passed to run and cancel IPC alike.
const CANVAS_QUERY_ID_PREFIX = "canvas-cell";

export {
  CANVAS_ASK_FENCE,
  CANVAS_DOC_VERSION,
  CANVAS_QUERY_ID_PREFIX,
  CANVAS_SAVE_DEBOUNCE_MS,
  CANVAS_SPEC_FENCE,
  DEFAULT_SIZE,
  KNOWN_KINDS,
  LAYOUT_GAP,
  LAYOUT_ORIGIN,
};
