type ServerEventKind =
  | "history_changed"
  | "pins_changed"
  | "connections_changed"
  | "connection_request_resolved"
  | "canvas_changed"
  | "canvas_cell_ingested"
  | "tool_runs_changed"
  | "query_open_requested";

interface ServerEvent {
  kind: ServerEventKind;
  project: string | null;
  payload: unknown;
}

interface ApiErrorBody {
  error: { code: string; message: string };
}

export type { ApiErrorBody, ServerEvent, ServerEventKind };
