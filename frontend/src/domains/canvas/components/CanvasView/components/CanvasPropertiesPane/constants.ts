import type { SelectOption } from "@shared/ui";

import type { ComponentKind } from "../../../../types";

/// Human label for each object kind, shown in the properties-pane header.
const KIND_LABEL: Record<ComponentKind, string> = {
  text: "Text",
  sticky: "Sticky note",
  query: "Query",
  chart: "Chart",
  table: "Table",
  shape: "Shape",
};

/// Sticky-note tints (mirrors the shared `StickyColor`).
const STICKY_COLOR_OPTIONS: SelectOption[] = [
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "pink", label: "Pink" },
  { value: "purple", label: "Purple" },
];

/// Default hexes for the shape colour pickers (the renderer's own fallbacks use
/// non-hex tokens, which a native colour input can't display).
const DEFAULT_SHAPE_FILL = "#3a3950";
const DEFAULT_SHAPE_STROKE = "#7c6cff";
const DEFAULT_TEXT_COLOR = "#e8e8ea";

export {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  DEFAULT_TEXT_COLOR,
  KIND_LABEL,
  STICKY_COLOR_OPTIONS,
};
