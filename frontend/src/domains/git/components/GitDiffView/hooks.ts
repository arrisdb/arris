import { useCallback, useEffect, useMemo, useState } from "react";
import { useFilesStore } from "@domains/files/hooks";
import { useGitStore } from "../../hooks";
import { gitDiffViewFileDiffHunksIPC } from "./ipc";
import type { FileDiff, GitDiffViewViewModel } from "./types";

function useGitDiffView(): GitDiffViewViewModel {
  const fileStatuses = useGitStore((state) => state.fileStatuses);
  const selectedFile = useGitStore((state) => state.selectedFile);
  const repoPath = useFilesStore((state) => state.rootPath) ?? "";
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);

  const filesToShow = useMemo(() => {
    if (selectedFile) {
      return fileStatuses.filter((status) => status.path === selectedFile);
    }
    return fileStatuses;
  }, [fileStatuses, selectedFile]);

  const fetchDiffs = useCallback(async () => {
    if (!repoPath || filesToShow.length === 0) {
      setFileDiffs([]);
      return;
    }
    setLoading(true);
    const results: FileDiff[] = [];
    for (const file of filesToShow) {
      try {
        const hunks = await gitDiffViewFileDiffHunksIPC(repoPath, file.path);
        results.push({ path: file.path, hunks, collapsed: false });
      } catch {
        results.push({ path: file.path, hunks: [], collapsed: false });
      }
    }
    setFileDiffs(results);
    setLoading(false);
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
    loading,
    onToggleCollapse,
    repoPath,
  };
}

export { useGitDiffView };
