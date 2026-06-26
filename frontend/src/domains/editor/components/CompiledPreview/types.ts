interface CompiledPreviewProps {
  compiledSql: string;
  isStale: boolean;
  isLoading: boolean;
  /// True when the last compile failed; swaps the neutral placeholder for a
  /// pointer to the command logs. Optional: the sqlmesh Rendered SQL reuse
  /// surfaces its own errors elsewhere and omits it.
  hasError?: boolean;
  onRefresh: () => void;
  onCollapse: () => void;
}

export type { CompiledPreviewProps };
