import type { SelectOption } from "@shared/ui/Select";
import type { CommandLogsContextMenuItems } from "./types";

const ANSI_RE = /\x1b\[([0-9;]*)m/g;

/// Raw query block shows at most this many lines before the "Show full query"
/// toggle appears.
const MAX_RAW_QUERY_LINES = 8;

const SGR_COLORS: Record<number, string> = {
  30: "#1a1a2e",
  31: "#f7768e",
  32: "#9ece6a",
  33: "#e0af68",
  34: "#7aa2f7",
  35: "#bb9af7",
  36: "#7dcfff",
  37: "#c0caf5",
  90: "#565f89",
  91: "#f7768e",
  92: "#9ece6a",
  93: "#e0af68",
  94: "#7aa2f7",
  95: "#bb9af7",
  96: "#7dcfff",
  97: "#c0caf5",
};

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: "all", label: "All statuses" },
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
  { value: "running", label: "Running" },
];

const commandLogsContextMenuItems: CommandLogsContextMenuItems = () => [];

export {
  ANSI_RE,
  MAX_RAW_QUERY_LINES,
  SGR_COLORS,
  STATUS_FILTER_OPTIONS,
  commandLogsContextMenuItems,
};
