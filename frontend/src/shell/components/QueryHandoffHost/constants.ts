// Rows loaded into the console tab; the grid fetches further pages itself.
const HANDOFF_PAGE_SIZE = 100;

// Claude's shared console per connection; each query is appended below the last.
const HANDOFF_TAB_TITLE = "Claude";
const HANDOFF_SQL_SEPARATOR = "\n\n";

export { HANDOFF_PAGE_SIZE, HANDOFF_SQL_SEPARATOR, HANDOFF_TAB_TITLE };
