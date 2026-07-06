import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFilesStore } from "@domains/files/hooks";
import { useGitStore } from "../../hooks";
import { gitDiffViewFileDiffHunksIPC } from "./ipc";
import type { FileDiff, GitDiffViewViewModel } from "./types";

function useGitDiffView(): GitDiffViewViewModel {
  const fileStatuses = useGitStore((state) => state.fileStatuses);
  const selectedFile = useGitStore((state) => state.selectedFile);
  const repoPath = useFilesStore((state) => state.rootPath) ?? "";
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const requestRef = useRef(0);

  const filesToShow = useMemo(() => {
    if (selectedFile) {
      return fileStatuses.filter((status) => status.path === selectedFile);
    }
    return fileStatuses;
  }, [fileStatuses, selectedFile]);

  // Stale-while-revalidate: every status change (stage/unstage/save) refetches,
  // but the previous diffs stay on screen until the new ones land, so the view
  // never flashes a loading state after the first load. Collapsed state is
  // carried over by path; a request token drops out-of-order responses.
  const fetchDiffs = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!repoPath || filesToShow.length === 0) {
      setFileDiffs([]);
      setHasLoaded(true);
      return;
    }
    const results: FileDiff[] = [];
    for (const file of filesToShow) {
      try {
        const hunks = await gitDiffViewFileDiffHunksIPC(repoPath, file.path);
        results.push({ path: file.path, hunks, collapsed: false });
      } catch {
        results.push({ path: file.path, hunks: [], collapsed: false });
      }
    }
    if (requestId !== requestRef.current) return;
    setFileDiffs((prev) => {
      const collapsedByPath = new Map(prev.map((diff) => [diff.path, diff.collapsed]));
      return results.map((diff) => ({
        ...diff,
        collapsed: collapsedByPath.get(diff.path) ?? false,
      }));
    });
    setHasLoaded(true);
  }, [repoPath, filesToShow]);

  useEffect(() => {
    fetchDiffs();
  }, [fetchDiffs]);

  const onToggleCollapse = useCallback((index: number) => {
    setFileDiffs((prev) =>
      prev.map((diff, diffIndex) => (
        diffIndex === index ? { ...diff, collapsed: !diff.collapsed } : diff
      )),
    );
  }, []);

  return {
    fileDiffs,
    fileStatusesCount: fileStatuses.length,
    loading: !hasLoaded,
    onToggleCollapse,
    repoPath,
  };
}

export { useGitDiffView };
