import { useCallback, useEffect, useState } from "react";
import { ipcErrorMessage } from "@shared";
import { useFilesStore } from "@domains/files/hooks";
import { useGitStore } from "../../hooks";
import {
  gitConflictMergeAbortIPC,
  gitConflictMergeContinueIPC,
  gitConflictMergeStateIPC,
  gitConflictResolveOursIPC,
  gitConflictResolveTheirsIPC,
  gitConflictVersionsIPC,
  gitConflictWriteResolvedIPC,
} from "./ipc";
import { allResolved, assembleResolved, conflictCount, parseConflicts, setResolution } from "./utils";
import type { ConflictResolution, ConflictSegment, GitConflictViewModel } from "./types";

function useGitConflictView(): GitConflictViewModel {
  const repoPath = useFilesStore((state) => state.rootPath);
  const refreshGit = useGitStore((state) => state.refreshFileStatuses);
  const [mergeKind, setMergeKind] = useState("none");
  const [conflictedFiles, setConflictedFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [segments, setSegments] = useState<ConflictSegment[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFileSegments = useCallback(
    async (repo: string, path: string) => {
      const versions = await gitConflictVersionsIPC(repo, path);
      setSegments(parseConflicts(versions.merged));
    },
    [],
  );

  const reloadMergeState = useCallback(async () => {
    if (!repoPath) return;
    try {
      const state = await gitConflictMergeStateIPC(repoPath);
      setMergeKind(state.kind);
      setConflictedFiles(state.conflicted);
      // Keep the selection if it's still conflicted, else pick the first one.
      setSelectedFile((prev) => {
        const next = prev && state.conflicted.includes(prev) ? prev : state.conflicted[0] ?? null;
        if (next) void loadFileSegments(repoPath, next).catch(() => setSegments([]));
        else setSegments([]);
        return next;
      });
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }, [repoPath, loadFileSegments]);

  useEffect(() => {
    void reloadMergeState();
  }, [reloadMergeState]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (!repoPath) return;
      setIsBusy(true);
      setError(null);
      try {
        await fn();
        await reloadMergeState();
        await refreshGit();
      } catch (e) {
        setError(ipcErrorMessage(e));
      } finally {
        setIsBusy(false);
      }
    },
    [repoPath, reloadMergeState, refreshGit],
  );

  const onSelectFile = useCallback(
    (path: string) => {
      if (!repoPath) return;
      setSelectedFile(path);
      void loadFileSegments(repoPath, path).catch((e) => setError(ipcErrorMessage(e)));
    },
    [repoPath, loadFileSegments],
  );

  const onAcceptHunk = useCallback((index: number, resolution: ConflictResolution) => {
    setSegments((prev) => setResolution(prev, index, resolution));
  }, []);

  const onUseOurs = useCallback(() => {
    if (selectedFile) void run(() => gitConflictResolveOursIPC(repoPath!, selectedFile));
  }, [run, repoPath, selectedFile]);

  const onUseTheirs = useCallback(() => {
    if (selectedFile) void run(() => gitConflictResolveTheirsIPC(repoPath!, selectedFile));
  }, [run, repoPath, selectedFile]);

  const onMarkResolved = useCallback(() => {
    if (selectedFile) {
      void run(() => gitConflictWriteResolvedIPC(repoPath!, selectedFile, assembleResolved(segments)));
    }
  }, [run, repoPath, selectedFile, segments]);

  const onContinue = useCallback(() => {
    void run(() => gitConflictMergeContinueIPC(repoPath!));
  }, [run, repoPath]);

  const onAbort = useCallback(() => {
    void run(() => gitConflictMergeAbortIPC(repoPath!));
  }, [run, repoPath]);

  const totalConflicts = conflictCount(segments);
  const resolvedCount = segments.filter(
    (s) => s.kind === "conflict" && s.resolution !== null,
  ).length;

  return {
    hasRepo: !!repoPath,
    mergeKind,
    conflictedFiles,
    selectedFile,
    segments,
    conflictCount: totalConflicts,
    resolvedCount,
    allResolved: allResolved(segments),
    isBusy,
    error,
    onSelectFile,
    onAcceptHunk,
    onUseOurs,
    onUseTheirs,
    onMarkResolved,
    onContinue,
    onAbort,
  };
}

export { useGitConflictView };
