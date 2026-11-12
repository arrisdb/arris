interface QueryTarget {
  kind: "query";
  connectionId: string;
  sql: string;
  runId: string | null;
  newTab: boolean;
}

interface CanvasTarget {
  kind: "canvas";
  canvasId: string;
  title: string;
}

/// A query or canvas the CLI handed to this tab.
type QueryHandoff = { id: string } & (QueryTarget | CanvasTarget);

export type { QueryHandoff, QueryTarget };
