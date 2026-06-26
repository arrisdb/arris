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

export {
  CARTESIAN_SERIES_KINDS,
  DEFAULT_PALETTE,
  TOOLTIP_STYLE,
};
