import type { SettingsNavItem } from "./types";

const PANES: SettingsNavItem[] = [
  { key: "general", label: "General" },
  { key: "connections", label: "Connections" },
  { key: "appearance", label: "Appearance" },
  { key: "fonts", label: "Fonts" },
  { key: "formatter", label: "Formatter" },
  { key: "terminal", label: "Terminal" },
  { key: "keymap", label: "Keymap" },
];

const CONNECTION_AUTO_REFRESH_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "30000", label: "Every 30 seconds" },
  { value: "60000", label: "Every minute" },
  { value: "300000", label: "Every 5 minutes" },
  { value: "900000", label: "Every 15 minutes" },
];

const SETTINGS_SHEET = {
  title: "Settings",
  width: 780,
  height: 548,
  minWidth: 620,
  minHeight: 420,
  storageKey: "settings.sheet.size",
} as const;

const AUTO_SHELL_VALUE = "__auto__";

const FALLBACK_SHELLS = ["/bin/zsh", "/bin/bash", "/usr/local/bin/fish", "/bin/sh"];

const SQL_CASE_OPTIONS = [
  { value: "preserve", label: "Preserve" },
  { value: "upper", label: "UPPER" },
  { value: "lower", label: "lower" },
];

const INDENT_STYLE_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "tabularLeft", label: "Tabular Left" },
  { value: "tabularRight", label: "Tabular Right" },
];

const LOGICAL_OPERATOR_OPTIONS = [
  { value: "before", label: "Before (AND/OR on new line)" },
  { value: "after", label: "After (AND/OR at end)" },
];

const COMMA_POSITION_OPTIONS = [
  { value: "trailing", label: "Trailing (end of line)" },
  { value: "leading", label: "Leading (start of line)" },
];

const CSV_DELIMITER_OPTIONS = [
  { value: "comma", label: "Comma ( , )" },
  { value: "semicolon", label: "Semicolon ( ; )" },
  { value: "tab", label: "Tab ( \\t )" },
  { value: "pipe", label: "Pipe ( | )" },
];

const MARKDOWN_LIST_MARKER_OPTIONS = [
  { value: "dash", label: "Dash ( - )" },
  { value: "asterisk", label: "Asterisk ( * )" },
  { value: "plus", label: "Plus ( + )" },
];

const THEME_OPTIONS = [
  { value: "neon", label: "Neon" },
  { value: "classicDark", label: "Classic Dark" },
  { value: "light", label: "Light" },
];

const COLOR_SCHEME_OPTIONS = [
  { value: "oneDark", label: "One Dark" },
  { value: "dracula", label: "Dracula" },
  { value: "monokai", label: "Monokai" },
];

// One row per syntax token in the customisation list. `id` matches the
// `--m-syn-<id>` variable (see SYNTAX_TOKEN_IDS in styles/theme.ts).
const SYNTAX_TOKENS = [
  { id: "keyword", label: "Keyword" },
  { id: "builtin", label: "Built-in function" },
  { id: "function", label: "Function" },
  { id: "type", label: "Type" },
  { id: "string", label: "String" },
  { id: "number", label: "Number" },
  { id: "constant", label: "Constant" },
  { id: "comment", label: "Comment" },
  { id: "operator", label: "Operator" },
  { id: "punctuation", label: "Punctuation" },
  { id: "bracket", label: "Bracket" },
  { id: "variable", label: "Variable" },
  { id: "property", label: "Property / column" },
];

export {
  COLOR_SCHEME_OPTIONS,
  CONNECTION_AUTO_REFRESH_OPTIONS,
  SYNTAX_TOKENS,
  THEME_OPTIONS,
  AUTO_SHELL_VALUE,
  COMMA_POSITION_OPTIONS,
  CSV_DELIMITER_OPTIONS,
  FALLBACK_SHELLS,
  INDENT_STYLE_OPTIONS,
  LOGICAL_OPERATOR_OPTIONS,
  MARKDOWN_LIST_MARKER_OPTIONS,
  PANES,
  SETTINGS_SHEET,
  SQL_CASE_OPTIONS,
};
