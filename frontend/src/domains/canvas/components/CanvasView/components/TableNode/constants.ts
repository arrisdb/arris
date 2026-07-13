import type { QueryValue } from "@shared";

// Rows per page in a table object's result grid: bounds what is rendered and
// shipped at once, not the total (the full result stays in the backend cache).
const TABLE_PAGE_ROWS = 200;

// Size of the centered logo in the empty (no source / not-yet-run) state.
const EMPTY_LOGO_SIZE = 40;

// Rows fetched per page while downloading the full result, so the export can
// report progress (fetched / total) and cancel between chunks.
const DOWNLOAD_CHUNK_ROWS = 50000;

// "YYYY-MM-DD HH:MM:SS" zero-padding for the last-refresh timestamp.
const TIMESTAMP_PAD_WIDTH = 2;
const TIMESTAMP_PAD_CHAR = "0";

// The table cell reuses the results grid read-only: no staged edits/inserts/
// deletes ever, so these frozen singletons satisfy those props with stable refs.
const EMPTY_EDITS: Record<string, { next: QueryValue }> = {};
const EMPTY_INSERTS: { draftId: string; values: Record<string, QueryValue> }[] = [];
const EMPTY_DELETED_ROWS: Set<number> = new Set();
const EMPTY_STAGED_KEYS: Set<string> = new Set();
const NOOP = () => {};

export {
  DOWNLOAD_CHUNK_ROWS,
  EMPTY_DELETED_ROWS,
  EMPTY_EDITS,
  EMPTY_INSERTS,
  EMPTY_LOGO_SIZE,
  EMPTY_STAGED_KEYS,
  NOOP,
  TABLE_PAGE_ROWS,
  TIMESTAMP_PAD_CHAR,
  TIMESTAMP_PAD_WIDTH,
};
