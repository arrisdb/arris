// Waits for typing or selecting to settle before telling the server.
const UI_CONTEXT_PUSH_DEBOUNCE_MS = 400;
// Tabs without a `tabType` are SQL consoles, matching the server's tab list.
const DEFAULT_TAB_TYPE = "console";
const UI_CONTEXT_SAVE_CMD = "ui_context_save";

export { DEFAULT_TAB_TYPE, UI_CONTEXT_PUSH_DEBOUNCE_MS, UI_CONTEXT_SAVE_CMD };
