import type { ReactNode } from "react";
import type { RunRecord } from "@domains/history";

interface RunResultViewProps {
  runId: string;
  onOpenRun: (runId: string) => void;
  /// Extra run actions the host composes, such as Send to canvas.
  runActions?: (runId: string) => ReactNode;
}

// `cached` is false once the full result has left the server's in-memory cache.
interface RunWithCache {
  run: RunRecord;
  cached: boolean;
}

export type { RunResultViewProps, RunWithCache };
