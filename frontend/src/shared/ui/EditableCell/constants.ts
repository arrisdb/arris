// Cap on the single-line preview rendered in a table cell. The full value stays
// in `display` (used for editing) and in the row detail pane; this only bounds
// what the grid shows so a multi-KB JSON / long text cell renders a readable
// truncated string ("{"id":1,"name":...…") instead of a bare ellipsis.
// TODO: consolidate into a configurable setting in the Settings pane.
const MAX_PREVIEW_CHARS = 500;

export { MAX_PREVIEW_CHARS };
