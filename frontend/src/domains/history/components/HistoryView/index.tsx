import { useMemo, useState } from "react";
import { ipcErrorMessage } from "@shared";
import { SearchInput } from "@shared/ui";
import { useConnectionsStore } from "@domains/connection/hooks";
import {
  DELETED_CONNECTION_LABEL,
  EMPTY_TEST_ID,
  ERROR_TEST_ID,
  FILTER_PLACEHOLDER,
  FILTER_TEST_ID,
  HISTORY_EMPTY_MESSAGE,
  HISTORY_NO_MATCH_MESSAGE,
  LOADING_CONNECTION_LABEL,
  NO_VALUE,
  PINNED_LABEL,
  PIN_LABEL,
  PIN_TEST_ID,
  ROW_OPEN_TEST_ID,
  ROW_TEST_ID,
} from "./constants";
import { useHistory } from "./hooks";
import { pinRunIPC } from "./ipc";
import type { HistoryViewProps } from "./types";
import { filterRuns, firstSqlLine, formatDuration, formatRelativeTime } from "./utils";
import "./index.css";

function HistoryView({ onOpenRun, runActions }: HistoryViewProps) {
  const { runs, error } = useHistory();
  const connections = useConnectionsStore((state) => state.connections);
  const loaded = useConnectionsStore((state) => state.connectionsLoaded);
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [pinError, setPinError] = useState<string | null>(null);

  const connectionName = useMemo(() => {
    const names = new Map(connections.map((c) => [c.id, c.name]));
    return (id: string) =>
      names.get(id) ?? (loaded ? DELETED_CONNECTION_LABEL : LOADING_CONNECTION_LABEL);
  }, [connections, loaded]);
  const visible = useMemo(
    () => filterRuns(runs, query, connectionName),
    [runs, query, connectionName],
  );
  const now = Date.now();

  const pin = (runId: string) =>
    pinRunIPC(runId)
      .then(() => {
        setPinError(null);
        setPinned((prev) => new Set(prev).add(runId));
      })
      .catch((pinFailure) => setPinError(ipcErrorMessage(pinFailure)));

  return (
    <div className="mdbc-history">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={FILTER_PLACEHOLDER}
        testId={FILTER_TEST_ID}
      />
      {(error ?? pinError) && (
        <p className="mdbc-history-error" data-testid={ERROR_TEST_ID}>
          {error ?? pinError}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="mdbc-history-empty" data-testid={EMPTY_TEST_ID}>
          {runs.length === 0 ? HISTORY_EMPTY_MESSAGE : HISTORY_NO_MATCH_MESSAGE}
        </p>
      ) : (
        <ul className="mdbc-history-list">
          {visible.map((run) => (
            <li
              key={run.id}
              className="mdbc-history-row"
              data-testid={ROW_TEST_ID}
              onClick={() => onOpenRun(run.id)}
            >
              <span className={`mdbc-history-status ${run.status}`}>{run.status}</span>
              {/* Row click handles the mouse; this button gives keyboard users a stop. */}
              <button
                type="button"
                className="mdbc-history-sql"
                title={run.sql}
                data-testid={ROW_OPEN_TEST_ID}
              >
                {firstSqlLine(run.sql)}
              </button>
              <span className="mdbc-history-meta">{connectionName(run.connectionId)}</span>
              <span className="mdbc-history-meta">{run.source}</span>
              <span className="mdbc-history-meta">{formatRelativeTime(run.startedAt, now)}</span>
              <span className="mdbc-history-meta">
                {formatDuration(
                  run.finishedAt
                    ? Date.parse(run.finishedAt) - Date.parse(run.startedAt)
                    : undefined,
                )}
              </span>
              <span className="mdbc-history-meta">{run.rowCount ?? NO_VALUE}</span>
              <button
                type="button"
                className="mdbc-history-pin"
                data-testid={PIN_TEST_ID}
                disabled={pinned.has(run.id)}
                onClick={(event) => {
                  event.stopPropagation();
                  void pin(run.id);
                }}
              >
                {pinned.has(run.id) ? PINNED_LABEL : PIN_LABEL}
              </button>
              {runActions?.(run.id)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { HistoryView };
