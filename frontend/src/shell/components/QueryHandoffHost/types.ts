interface QueryHandoff {
  id: string;
  connectionId: string;
  sql: string;
  runId: string | null;
}

export type { QueryHandoff };
