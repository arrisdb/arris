import {
  EMPTY_MESSAGE,
  FAILED_TITLE,
  OUTPUT_TITLE,
  RUNS_TEST_ID,
  RUN_DETAIL_TEST_ID,
  exitLabel,
} from "./constants";
import { useToolRuns } from "./hooks";
import type { ToolRunsViewProps } from "./types";
import { summaryLabel } from "./utils";
import "./index.css";

/// Logged `arris <tool> cli` runs, newest first; the open run shows its summary and output tail.
function ToolRunsView({ tool, runId, onOpenRun }: ToolRunsViewProps) {
  const { runs, run, error } = useToolRuns(tool, runId);

  return (
    <div className="mdbc-analytics-runs">
      {error && <p className="mdbc-analytics-message">{error}</p>}
      <div className="mdbc-analytics-runs-list" data-testid={RUNS_TEST_ID}>
        {runs.length === 0 && !error && <p className="mdbc-analytics-message">{EMPTY_MESSAGE}</p>}
        {runs.map((r) => (
          <button
            key={r.id}
            type="button"
            className="mdbc-analytics-run-row"
            aria-current={r.id === runId ? "page" : undefined}
            onClick={() => onOpenRun(r.id)}
          >
            <code>{[tool, ...r.args].join(" ")}</code>
            <span className={r.exitCode === 0 ? "mdbc-analytics-muted" : "mdbc-analytics-failed"}>
              {exitLabel(r.exitCode)}
            </span>
            <span className="mdbc-analytics-muted">{new Date(r.startedAt).toLocaleString()}</span>
            <span className="mdbc-analytics-muted">{summaryLabel(r.summary)}</span>
          </button>
        ))}
      </div>
      {run && (
        <div className="mdbc-analytics-run-detail" data-testid={RUN_DETAIL_TEST_ID}>
          <h2>
            <code>{[tool, ...run.args].join(" ")}</code>
          </h2>
          <span className="mdbc-analytics-muted">
            {[exitLabel(run.exitCode), run.dir, summaryLabel(run.summary)].filter(Boolean).join(" · ")}
          </span>
          {run.summary && run.summary.failed.length > 0 && (
            <section className="mdbc-analytics-model-section">
              <h3>{FAILED_TITLE}</h3>
              {run.summary.failed.map((id) => (
                <code key={id}>{id}</code>
              ))}
            </section>
          )}
          <section className="mdbc-analytics-model-section">
            <h3>{OUTPUT_TITLE}</h3>
            <pre className="mdbc-analytics-code">{run.outputTail}</pre>
          </section>
        </div>
      )}
    </div>
  );
}

export { ToolRunsView };
