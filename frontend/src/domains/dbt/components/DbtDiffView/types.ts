import type { QueryResult, SlimDiffResult } from "@shared";

interface DbtDiffViewProps {
  result: SlimDiffResult;
}

interface DiffSampleProps {
  title: string;
  emptyHint: string;
  sample: QueryResult;
}

// Old (prod) and new samples for updated rows, each ordered by key so they align
// row-for-row by index.
interface UpdatedDiffGridProps {
  prod: QueryResult;
  next: QueryResult;
}

export type { DbtDiffViewProps, DiffSampleProps, UpdatedDiffGridProps };
