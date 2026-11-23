// Rows loaded into the console tab; the grid fetches further pages itself.
const HANDOFF_PAGE_SIZE = 100;

// Console name when the CLI ran outside a known agent; each query is appended below the last.
const HANDOFF_TAB_TITLE = "Agent";
const HANDOFF_SQL_SEPARATOR = "\n\n";
// Used when the tab's language has no line-comment marker of its own.
const HANDOFF_DEFAULT_COMMENT = "--";
// Ends each query so the console runs only the statement under the cursor.
const HANDOFF_STATEMENT_END = ";";

// Only a page in view takes queries, so a background tab cannot swallow them.
const HANDOFF_VISIBLE_STATE: DocumentVisibilityState = "visible";
const VISIBILITY_CHANGE_EVENT = "visibilitychange";

export { HANDOFF_VISIBLE_STATE, VISIBILITY_CHANGE_EVENT, HANDOFF_DEFAULT_COMMENT, HANDOFF_STATEMENT_END, HANDOFF_PAGE_SIZE, HANDOFF_SQL_SEPARATOR, HANDOFF_TAB_TITLE };
