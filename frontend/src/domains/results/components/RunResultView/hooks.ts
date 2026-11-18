import { useCallback, useEffect, useRef, useState } from "react";
import { ipcErrorMessage } from "@shared";
import type { QueryResult } from "@shared";
import { ApiError, currentProject, subscribe } from "@shared/api";
import { HISTORY_CHANGED_EVENT } from "@domains/history";
import { RESULT_NOT_CACHED_CODE, RUN_NOT_FOUND_CODE } from "./constants";
import { fetchRunPageIPC, getRunIPC } from "./ipc";
import type { RunWithCache } from "./types";

interface RunState {
  data: RunWithCache | null;
  notFound: boolean;
  error: string | null;
}

const INITIAL_STATE: RunState = { data: null, notFound: false, error: null };

// Loads the run; while it is still running, refetches when this project's history changes.
function useRun(runId: string): RunState {
  const [state, setState] = useState<RunState>(INITIAL_STATE);
  const reload = useRef<() => void>(() => undefined);
  const running = state.data?.run.status === "running";

  useEffect(() => {
    let latest = 0;
    let cancelled = false;
    reload.current = () => {
      const request = ++latest;
      getRunIPC(runId)
        .then((data) => {
          if (!cancelled && request === latest) setState({ ...INITIAL_STATE, data });
        })
        .catch((failure) => {
          if (cancelled || request !== latest) return;
          const notFound =
            failure instanceof ApiError && failure.code === RUN_NOT_FOUND_CODE;
          setState({
            ...INITIAL_STATE,
            notFound,
            error: notFound ? null : ipcErrorMessage(failure),
          });
        });
    };
    reload.current();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!running) return;
    return subscribe((event) => {
      if (
        event.kind === HISTORY_CHANGED_EVENT &&
        event.project === currentProject()
      )
        reload.current();
    });
  }, [running]);

  return state;
}

interface PageState {
  page: QueryResult | null;
  /// Offset the shown page was fetched for; lags `offset` while the next page loads.
  pageOffset: number;
  loading: boolean;
  notCached: boolean;
  error: string | null;
  retry: () => void;
}

interface PageResult {
  offset: number;
  page: QueryResult | null;
  notCached: boolean;
  error: string | null;
}

// Fetches one page of the cached result; a cache miss flips to notCached instead of an error.
function useRunPage(
  runId: string,
  offset: number,
  limit: number,
  enabled: boolean,
): PageState {
  const [result, setResult] = useState<PageResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setResult(null);
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchRunPageIPC(runId, offset, limit)
      .then((page) => {
        if (!cancelled) setResult({ offset, page, notCached: false, error: null });
      })
      .catch((failure) => {
        if (cancelled) return;
        const notCached =
          failure instanceof ApiError &&
          failure.code === RESULT_NOT_CACHED_CODE;
        setResult({
          offset,
          page: null,
          notCached,
          error: notCached ? null : ipcErrorMessage(failure),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [runId, offset, limit, enabled, attempt]);

  return {
    page: result?.page ?? null,
    pageOffset: result?.offset ?? offset,
    loading: enabled && (result === null || result.offset !== offset),
    notCached: result?.notCached ?? false,
    error: result?.error ?? null,
    retry,
  };
}

export { useRun, useRunPage };
