import type { ReactNode, RefObject } from "react";
import type { PaneContextMenuItems } from "@shared/ui/ContextMenu";
import type { CommandLogEntry, CommandLogNode, CommandLogStatus } from "../../types";

type StatusFilter = "all" | CommandLogStatus;

interface CommandLogsViewModel {
  entries: CommandLogEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
  filterText: string;
  setFilterText: (value: string) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (value: StatusFilter) => void;
  onClickClear: () => void;
}

interface CommandLogEntryProps {
  command: string;
  status: CommandLogStatus;
  /// Pre-formatted duration (e.g. "1.2s"); empty while running.
  durationLabel: string;
  /// Pre-formatted wall-clock time (e.g. "10:35:02 AM").
  timestampLabel: string;
  nodes: CommandLogNode[];
  rawOutput: string;
  /// Full executed query, shown in an expandable "Raw query" block below the
  /// raw output. Set only for SQL entries; absent for CLI commands.
  rawQuery?: string;
  /// Source tab label (e.g. "Console 107"), shown as a badge when present.
  tabTitle?: string;
  defaultExpanded?: boolean;
  /// Custom body replacing the default nodes + raw output (e.g. a Plan/Diff link).
  children?: ReactNode;
}

interface AnsiSegment {
  text: string;
  color?: string;
  bold?: boolean;
}

type CommandLogsContextMenuItems = PaneContextMenuItems<null>;

export type {
  AnsiSegment,
  CommandLogEntryProps,
  CommandLogsContextMenuItems,
  CommandLogsViewModel,
  StatusFilter,
};
