import { Spinner } from "@shared/ui";

import type { QueryRunState } from "../../../../../../types";
import { runResultSummary, runStreamingSummary } from "../../utils";
import { SPINNER_SIZE } from "./constants";
import { useLiveElapsed } from "./hooks";
import { formatElapsed, formatRunTimestamp } from "./utils";

/// One-line run status under the query editor. Idle shows a prompt; while running
/// it shows a spinner plus a live elapsed timer (and the streaming row count once
/// the first page lands); once settled it shows the row summary with the total
/// execution time and the last-execution timestamp.
function QueryStatus({ run }: { run: QueryRunState | undefined }) {
  const liveMs = useLiveElapsed(run?.running ? run.startedAt : undefined);

  if (run?.error) {
    return <span className="mdbc-canvas-result-error">{run.error}</span>;
  }
  if (run?.running) {
    return (
      <span className="mdbc-canvas-query-running">
        <Spinner size={SPINNER_SIZE} />
        <span className="mdbc-canvas-run-elapsed">{formatElapsed(liveMs ?? 0)}</span>
        {run.result && (
          <span className="mdbc-canvas-result-empty">{runStreamingSummary(run.result)}</span>
        )}
      </span>
    );
  }
  if (run?.result) {
    const timing =
      run.startedAt !== undefined && run.endedAt !== undefined
        ? ` · ${formatElapsed(run.endedAt - run.startedAt)} · ${formatRunTimestamp(run.endedAt)}`
        : "";
    return (
      <span className="mdbc-canvas-result-empty">
        {runResultSummary(run.result, run.totalRows, run.complete)}
        {timing}
      </span>
    );
  }
  return <span className="mdbc-canvas-result-empty">Run the query to preview data</span>;
}

export { QueryStatus };
