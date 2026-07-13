const DEFAULT_PALETTE = [
  "#7c8cff",
  "#a78bff",
  "#5be39a",
  "#ffa14a",
  "#ff7ab2",
  "#7adce4",
];

const TOOLTIP_STYLE = {
  background: "rgba(28,28,32,0.92)",
  border: "0.5px solid rgb(var(--m-overlay-rgb) / 0.12)",
  borderRadius: 10,
  fontSize: "var(--m-fs-sm)",
};

// Kinds where splitting one measure into a series per category is coherent.
// Combo is excluded: it mixes measures (bar measure + line measure), which is
// meaningless when every series is the same measure.
const CARTESIAN_SERIES_KINDS = new Set(["bar", "line", "area"]);

// Significant digits kept when abbreviating axis tick numbers.
const AXIS_NUMBER_FRACTION_DIGITS = 1;

// Default left/right plot margin (px). Wider than Recharts' default so long Y
// tick labels are not clipped at the container edge; overridable per chart.
const DEFAULT_PLOT_PADDING_X = 16;

// Fixed top/bottom plot margin (px), matching Recharts' small default.
const PLOT_PADDING_Y = 5;

export {
  AXIS_NUMBER_FRACTION_DIGITS,
  CARTESIAN_SERIES_KINDS,
  DEFAULT_PALETTE,
  DEFAULT_PLOT_PADDING_X,
  PLOT_PADDING_Y,
  TOOLTIP_STYLE,
};
