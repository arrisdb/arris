interface QueryTarget {
  kind: "query";
  connectionId: string;
  sql: string;
  runId: string | null;
  newTab: boolean;
  /// What the query answers, from `--note`.
  note: string | null;
  /// Short agent session id; each session gets its own console.
  session: string | null;
}

interface CanvasTarget {
  kind: "canvas";
  canvasId: string;
  title: string;
}

interface CloseTabsTarget {
  kind: "closeTabs";
  tabIds: string[];
}

/// A query, canvas or tab close the CLI handed to this tab.
type QueryHandoff = { id: string } & (QueryTarget | CanvasTarget | CloseTabsTarget);

export type { QueryHandoff, QueryTarget };
