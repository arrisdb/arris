import { useMemo, useState } from "react";
import { ipcErrorMessage } from "@shared";
import type { ColumnSpec } from "@shared";
import { Btn, Spinner } from "@shared/ui";
import { useConnectionsStore } from "@domains/connection/hooks";
import {
  DELETED_CONNECTION_LABEL,
  LOADING_CONNECTION_LABEL,
  NO_VALUE,
  PINNED_LABEL,
  PIN_LABEL,
  formatDuration,
  pinRunIPC,
} from "@domains/history";
import { ResultsDataTable } from "../ResultsTableView/components/ResultsDataTable";
import {
  ACTION_ERROR_TEST_ID,
  CONNECTION_TEST_ID,
  COPY_LABEL,
  COPY_TEST_ID,
  CUT_OFF_MESSAGE,
  CUT_OFF_TEST_ID,
  ROWS_AFFECTED_TEMPLATE,
  ROWS_AFFECTED_TEST_ID,
  ROWS_COUNT_TOKEN,
  ERROR_TEST_ID,
  NEXT_LABEL,
  NEXT_TEST_ID,
  NOT_CACHED_MESSAGE,
  NOT_CACHED_TEST_ID,
  NOT_FOUND_TEST_ID,
  NO_COLUMNS_MESSAGE,
  PIN_TEST_ID,
  LOADING_TEST_ID,
  RETRY_LABEL,
  RETRY_TEST_ID,
  PREVIOUS_LABEL,
  PREV_TEST_ID,
  RANGE_TEST_ID,
  RERUN_LABEL,
  RERUN_TEST_ID,
  ROW_COUNT_TEST_ID,
  RUNNING_LABEL,
  RUNNING_TEST_ID,
  RUN_NOT_FOUND_MESSAGE,
  RUN_PAGE_SIZE,
  SQL_TEST_ID,
  STATUS_TEST_ID,
  TABLE_TEST_ID,
} from "./constants";
import { useRun, useRunPage } from "./hooks";
import { rerunIPC } from "./ipc";
import type { VisibleResultRow } from "../ResultsTableView/types";
import type { RunResultViewProps } from "./types";
import { formatRowRange, toVisibleRows } from "./utils";
import "./index.css";

const NO_SETS = {
  deletedRows: new Set<number>(),
  edits: {},
  inserts: [],
  stagedKeys: new Set<string>(),
  searchMatches: new Set<string>(),
};
const noop = () => undefined;

// Read-only grid: the table's edit, sort and select handlers are inert here.
function ReadOnlyTable({
  columns,
  rows,
}: {
  columns: ColumnSpec[];
  rows: VisibleResultRow[];
}) {
  return (
    <div className="mdbc-run-table" data-testid={TABLE_TEST_ID}>
      <ResultsDataTable
        {...NO_SETS}
        columns={columns}
        rows={rows}
        editable={false}
        onCommitEdit={noop}
        onCommitInsert={noop}
        onSelectCell={noop}
        onToggleSort={noop}
        selectedCell={null}
        sortClauses={[]}
        tabId={null}
        currentMatchKey={null}
      />
    </div>
  );
}

function RunResultView({ runId, onOpenRun, runActions }: RunResultViewProps) {
  const { data, notFound, error } = useRun(runId);
  const connections = useConnectionsStore((state) => state.connections);
  const loaded = useConnectionsStore((state) => state.connectionsLoaded);
  const [offset, setOffset] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = data?.run;
  const cached = run?.status === "success" && data?.cached === true;
  const {
    page,
    pageOffset,
    loading,
    notCached,
    error: pageError,
    retry,
  } = useRunPage(runId, offset, RUN_PAGE_SIZE, cached);
  const pageRows = useMemo(() => toVisibleRows(page?.rows ?? []), [page]);
  const previewRows = useMemo(
    () => toVisibleRows(run?.preview?.rows ?? []),
    [run],
  );

  if (notFound)
    return (
      <p className="mdbc-run-message" data-testid={NOT_FOUND_TEST_ID}>
        {RUN_NOT_FOUND_MESSAGE}
      </p>
    );
  if (error)
    return (
      <p className="mdbc-run-error" data-testid={ERROR_TEST_ID}>
        {error}
      </p>
    );
  if (!run) return <Spinner />;

  const connectionName =
    connections.find((c) => c.id === run.connectionId)?.name ??
    (loaded ? DELETED_CONNECTION_LABEL : LOADING_CONNECTION_LABEL);
  const duration = run.finishedAt
    ? formatDuration(Date.parse(run.finishedAt) - Date.parse(run.startedAt))
    : NO_VALUE;
  const total = run.rowCount ?? 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(run.sql);
    } catch (copyFailure) {
      setActionError(ipcErrorMessage(copyFailure));
    }
  };
  // One action at a time so a double click cannot start two pins or two runs.
  const guarded = (action: () => Promise<void>) => {
    setPending(true);
    return action()
      .catch((failure) => setActionError(ipcErrorMessage(failure)))
      .finally(() => setPending(false));
  };
  const pin = () =>
    guarded(() =>
      pinRunIPC(run.id).then(() => {
        setActionError(null);
        setPinned(true);
      }),
    );
  const rerun = () =>
    guarded(() => rerunIPC(run).then(({ run: next }) => onOpenRun(next.id)));

  const showPaged = cached && !notCached && page !== null;
  const showPreview =
    run.status === "success" && !showPaged && (!cached || notCached);

  return (
    <div className="mdbc-run">
      <div className="mdbc-run-sql-row">
        <pre className="mdbc-run-sql" data-testid={SQL_TEST_ID}>
          {run.sql}
        </pre>
        <Btn onClick={() => void copy()}>
          <span data-testid={COPY_TEST_ID}>{COPY_LABEL}</span>
        </Btn>
      </div>
      <div className="mdbc-run-meta">
        <span data-testid={CONNECTION_TEST_ID}>{connectionName}</span>
        <span
          className={`mdbc-run-status ${run.status}`}
          data-testid={STATUS_TEST_ID}
        >
          {run.status}
        </span>
        <span>{new Date(run.startedAt).toLocaleString()}</span>
        <span>{duration}</span>
        <span data-testid={ROW_COUNT_TEST_ID}>{run.rowCount ?? NO_VALUE}</span>
        <Btn onClick={() => void pin()} disabled={pinned || pending}>
          <span data-testid={PIN_TEST_ID}>
            {pinned ? PINNED_LABEL : PIN_LABEL}
          </span>
        </Btn>
        <Btn onClick={() => void rerun()} disabled={pending}>
          <span data-testid={RERUN_TEST_ID}>{RERUN_LABEL}</span>
        </Btn>
        {runActions?.(run.id)}
      </div>
      {actionError && (
        <p className="mdbc-run-error" data-testid={ACTION_ERROR_TEST_ID}>
          {actionError}
        </p>
      )}
      {run.status === "running" && (
        <p className="mdbc-run-message" data-testid={RUNNING_TEST_ID}>
          <Spinner /> {RUNNING_LABEL}
        </p>
      )}
      {run.status === "error" && (
        <p className="mdbc-run-error" data-testid={ERROR_TEST_ID}>
          {run.error}
        </p>
      )}
      {pageError && (
        <p className="mdbc-run-error" data-testid={ERROR_TEST_ID}>
          {pageError}{" "}
          <Btn onClick={retry}>
            <span data-testid={RETRY_TEST_ID}>{RETRY_LABEL}</span>
          </Btn>
        </p>
      )}
      {cached && loading && !page && (
        <p className="mdbc-run-message" data-testid={LOADING_TEST_ID}>
          <Spinner />
        </p>
      )}
      {showPaged && page && (
        <>
          {page.columns.length === 0 ? (
            <p className="mdbc-run-message" data-testid={ROWS_AFFECTED_TEST_ID}>
              {ROWS_AFFECTED_TEMPLATE.replace(ROWS_COUNT_TOKEN, String(total))}
            </p>
          ) : (
            <ReadOnlyTable columns={page.columns} rows={pageRows} />
          )}
          {page.has_more && (
            <p className="mdbc-run-message" data-testid={CUT_OFF_TEST_ID}>
              {CUT_OFF_MESSAGE}
            </p>
          )}
          <div className="mdbc-run-pager">
            <button
              type="button"
              data-testid={PREV_TEST_ID}
              disabled={loading || pageOffset === 0}
              onClick={() => setOffset(pageOffset - RUN_PAGE_SIZE)}
            >
              {PREVIOUS_LABEL}
            </button>
            <span data-testid={RANGE_TEST_ID}>
              {formatRowRange(pageOffset, page.rows.length, total)}
            </span>
            <button
              type="button"
              data-testid={NEXT_TEST_ID}
              disabled={
                loading ||
                page.rows.length < RUN_PAGE_SIZE ||
                pageOffset + page.rows.length >= total
              }
              onClick={() => setOffset(pageOffset + RUN_PAGE_SIZE)}
            >
              {NEXT_LABEL}
            </button>
          </div>
        </>
      )}
      {showPreview && (
        <>
          <p className="mdbc-run-message" data-testid={NOT_CACHED_TEST_ID}>
            {NOT_CACHED_MESSAGE}
          </p>
          {run.preview && run.preview.columns.length > 0 ? (
            <ReadOnlyTable columns={run.preview.columns} rows={previewRows} />
          ) : (
            <p className="mdbc-run-message">{NO_COLUMNS_MESSAGE}</p>
          )}
        </>
      )}
    </div>
  );
}

export { RunResultView };
