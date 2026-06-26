import type { DbtDocs } from "@shared";

interface DbtDocsPreviewProps {
  docs: DbtDocs | null;
  /// `uniqueId` of the model whose docs to display (the editor's current node).
  modelId: string | null;
  isLoading: boolean;
  isStale: boolean;
  /// True when the last `dbt docs generate` failed; swaps the neutral
  /// placeholder for a pointer to the command logs.
  hasError?: boolean;
  onRefresh: () => void;
  onCollapse: () => void;
}

export type { DbtDocsPreviewProps };
