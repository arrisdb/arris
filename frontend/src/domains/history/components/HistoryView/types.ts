import type { ReactNode } from "react";
import type { ColumnSpec, QueryValue } from "@shared";

type RunStatus = "running" | "success" | "error" | "cancelled";
type RunSource = "cli" | "ui" | "canvas" | "dbt" | "sqlmesh";

interface RunPreview {
  columns: ColumnSpec[];
  rows: QueryValue[][];
  truncated: boolean;
}

interface RunRecord {
  id: string;
  connectionId: string;
  sql: string;
  source: RunSource;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  rowCount: number | null;
  error: string | null;
  preview: RunPreview | null;
}

interface PinnedQuery {
  id: string;
  title: string;
  sql: string;
  connectionId: string;
  fromRunId: string | null;
  createdAt: string;
}

interface HistoryViewProps {
  onOpenRun: (runId: string) => void;
  /// Extra per-row actions the host composes, such as Send to canvas.
  runActions?: (runId: string) => ReactNode;
}

export type { HistoryViewProps, PinnedQuery, RunPreview, RunRecord, RunSource, RunStatus };
