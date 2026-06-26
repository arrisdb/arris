import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ipcErrorMessage } from "@shared";
import { useFilesStore } from "@domains/files/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import {
  gitHistoryCommitDetailIPC,
  gitHistoryCommitGraphIPC,
  gitHistoryListRemotesIPC,
  gitHistorySearchIPC,
} from "./ipc";
import type { CommitDetail } from "./ipc";
import { commitWebUrl, maxLane, shortHash } from "./utils";
import type { CommitGraphRow, GitHistoryViewModel } from "./types";

// Browse mode loads commits a page at a time. Loading more re-fetches the whole
// range with a larger limit (rather than a skip/offset window) so the lane
// layout (which depends on parent links across the entire set) stays correct.
const PAGE_SIZE = 200;
// Search runs server-side over the full history (not just loaded pages), so an
// old commit is still found. Results are capped and debounced.
const SEARCH_LIMIT = 500;
const SEARCH_DEBOUNCE_MS = 250;

function useGitHistoryView(): GitHistoryViewModel {
  const repoPath = useFilesStore((state) => state.rootPath);
  const openGitCommitDiffTab = useTabsStore((state) => state.openGitCommitDiffTab);
  const [rows, setRows] = useState<CommitGraphRow[]>([]);
  const [searchRows, setSearchRows] = useState<CommitGraphRow[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedCommit, setSelectedCommit] = useState<CommitGraphRow | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const limitRef = useRef(PAGE_SIZE);
  // Monotonic request ids: a stale fetch (repo switch, refresh, keystroke) is ignored.
  const requestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  const isSearch = query.trim().length > 0;

  useEffect(() => {
    if (!repoPath) {
      setRows([]);
      setHasMore(false);
      return;
    }
    limitRef.current = PAGE_SIZE;
    const request = ++requestRef.current;
    setIsLoading(true);
    setError(null);
    gitHistoryCommitGraphIPC(repoPath, PAGE_SIZE)
      .then((result) => {
        if (request !== requestRef.current) return;
        setRows(result);
        setHasMore(result.length >= PAGE_SIZE);
        setIsLoading(false);
      })
      .catch((e) => {
        if (request !== requestRef.current) return;
        setError(ipcErrorMessage(e));
        setRows([]);
        setHasMore(false);
        setIsLoading(false);
      });
  }, [repoPath, reloadToken]);

  // Reset the detail panel and reload the remote URL when the repo changes.
  useEffect(() => {
    setSelectedCommit(null);
    setDetail(null);
    setDetailError(null);
    setRemoteUrl(null);
    if (!repoPath) return;
    let cancelled = false;
    gitHistoryListRemotesIPC(repoPath)
      .then((remotes) => {
        if (cancelled) return;
        const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
        setRemoteUrl(origin?.url ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setRemoteUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  // Server-side search across the whole history, debounced per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (!repoPath || !q) {
      setSearchRows([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const request = ++searchRequestRef.current;
    const handle = setTimeout(() => {
      gitHistorySearchIPC(repoPath, q, SEARCH_LIMIT)
        .then((result) => {
          if (request !== searchRequestRef.current) return;
          setSearchRows(result);
          setIsSearching(false);
        })
        .catch((e) => {
          if (request !== searchRequestRef.current) return;
          setError(ipcErrorMessage(e));
          setSearchRows([]);
          setIsSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [repoPath, query]);

  // Load the selected commit's detail (metadata + changed files).
  useEffect(() => {
    if (!repoPath || !selectedCommit) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const request = ++detailRequestRef.current;
    setDetailLoading(true);
    setDetailError(null);
    gitHistoryCommitDetailIPC(repoPath, selectedCommit.id)
      .then((result) => {
        if (request !== detailRequestRef.current) return;
        setDetail(result);
        setDetailLoading(false);
      })
      .catch((e) => {
        if (request !== detailRequestRef.current) return;
        setDetailError(ipcErrorMessage(e));
        setDetail(null);
        setDetailLoading(false);
      });
  }, [repoPath, selectedCommit]);

  const onLoadMore = useCallback(() => {
    if (isSearch || !repoPath || isLoading || isLoadingMore || !hasMore) return;
    const nextLimit = limitRef.current + PAGE_SIZE;
    limitRef.current = nextLimit;
    const request = ++requestRef.current;
    setIsLoadingMore(true);
    gitHistoryCommitGraphIPC(repoPath, nextLimit)
      .then((result) => {
        if (request !== requestRef.current) return;
        setRows(result);
        setHasMore(result.length >= nextLimit);
        setIsLoadingMore(false);
      })
      .catch((e) => {
        if (request !== requestRef.current) return;
        setError(ipcErrorMessage(e));
        setIsLoadingMore(false);
      });
  }, [isSearch, repoPath, isLoading, isLoadingMore, hasMore]);

  const visibleRows = isSearch ? searchRows : rows;
  const laneCount = useMemo(() => maxLane(visibleRows) + 1, [visibleRows]);

  const onChangeQuery = useCallback((value: string) => setQuery(value), []);
  const onRefresh = useCallback(() => setReloadToken((t) => t + 1), []);
  const onSelectCommit = useCallback((row: CommitGraphRow) => setSelectedCommit(row), []);
  const onCloseDetail = useCallback(() => setSelectedCommit(null), []);

  const detailWebUrl = useMemo(
    () => (selectedCommit && remoteUrl ? commitWebUrl(remoteUrl, selectedCommit.id) : null),
    [selectedCommit, remoteUrl],
  );

  const onOpenCommitFile = useCallback(
    (path: string) => {
      if (!selectedCommit) return;
      openGitCommitDiffTab({
        commitId: selectedCommit.id,
        title: `${shortHash(selectedCommit.id)} — ${selectedCommit.summary}`,
        filePath: path,
      });
    },
    [selectedCommit, openGitCommitDiffTab],
  );

  const onViewCommit = useCallback(() => {
    if (!selectedCommit) return;
    openGitCommitDiffTab({
      commitId: selectedCommit.id,
      title: `${shortHash(selectedCommit.id)} — ${selectedCommit.summary}`,
    });
  }, [selectedCommit, openGitCommitDiffTab]);

  return {
    visibleRows,
    laneCount,
    query,
    isLoading,
    isLoadingMore,
    isSearching,
    hasMore,
    error,
    hasRepo: !!repoPath,
    onChangeQuery,
    onRefresh,
    onLoadMore,
    selectedCommitId: selectedCommit?.id ?? null,
    detail,
    detailLoading,
    detailError,
    detailWebUrl,
    onSelectCommit,
    onCloseDetail,
    onOpenCommitFile,
    onViewCommit,
  };
}

export { useGitHistoryView };
