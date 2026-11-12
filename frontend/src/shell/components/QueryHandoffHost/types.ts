interface QueryHandoff {
  id: string;
  connectionId: string;
  sql: string;
  runId: string | null;
  newTab: boolean;
}

export type { QueryHandoff };
