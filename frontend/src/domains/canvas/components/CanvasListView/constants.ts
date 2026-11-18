const CANVASES_TITLE = "Canvases";
const NEW_LABEL = "New canvas";
const RENAME_LABEL = "Rename";
const DELETE_LABEL = "Delete";
const RENAME_PROMPT = "New title";
const EMPTY_MESSAGE = "No canvases yet. Create one, or ask Claude to put a result on a canvas.";
const LIST_TEST_ID = "canvas-list";
const ERROR_TEST_ID = "canvas-list-error";

/// Delete confirmation for one canvas.
function deleteConfirm(title: string): string {
  return `Delete canvas "${title}"? This cannot be undone.`;
}

/// "N objects" meta for one row.
function objectCountLabel(count: number): string {
  return count === 1 ? "1 object" : `${count} objects`;
}

export {
  CANVASES_TITLE,
  DELETE_LABEL,
  EMPTY_MESSAGE,
  ERROR_TEST_ID,
  LIST_TEST_ID,
  NEW_LABEL,
  RENAME_LABEL,
  RENAME_PROMPT,
  deleteConfirm,
  objectCountLabel,
};
