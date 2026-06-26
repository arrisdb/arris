// Command-log domain types: the model behind the streamed dbt/sqlmesh/sql run
// log surfaced by the output pane and owned by `useCommandLogStore`.

type CommandLogKind = "sql" | "dbt" | "sqlmesh" | "python";
type CommandLogStatus = "running" | "success" | "error";

interface CommandLogNode {
  name: string;
  type: string;
  status: "success" | "error";
  durationMs: number;
}

interface CommandLogEntry {
  id: string;
  kind: CommandLogKind;
  /// One-line command shown in the header (e.g. `dbt run --select stg_customers`).
  command: string;
  status: CommandLogStatus;
  startedAt: number;
  endedAt?: number;
  /// Real elapsed time reported by the runner; falls back to endedAt - startedAt.
  durationMs?: number;
  /// Verbatim CLI / console output accumulated for this command.
  rawOutput: string;
  nodes: CommandLogNode[];
  /// Source tab id, when the command originated from a tab.
  tabId?: string;
  /// Source tab label (e.g. "Console 107"), shown as a badge in the header.
  tabTitle?: string;
}

interface StartCommandInput {
  kind: CommandLogKind;
  command: string;
  startedAt: number;
  tabId?: string;
  tabTitle?: string;
}

interface FinishCommandPatch {
  status: Exclude<CommandLogStatus, "running">;
  endedAt: number;
  durationMs?: number;
}

export type {
  CommandLogEntry,
  CommandLogKind,
  CommandLogNode,
  CommandLogStatus,
  FinishCommandPatch,
  StartCommandInput,
};
