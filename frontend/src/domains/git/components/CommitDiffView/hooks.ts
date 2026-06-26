import { useCallback, useEffect, useState } from "react";
import { ipcErrorMessage } from "@shared";
import { useFilesStore } from "@domains/files/hooks";
import { commitDetailIPC, commitDiffIPC } from "./ipc";
import type { CommitDetail } from "./ipc";
import type { FileDiff } from "../GitDiffView/types";
import type { CommitDiffViewModel, CommitDiffViewProps } from "./types";

function useCommitDiffView(activeTab: CommitDiffViewProps["activeTab"]): CommitDiffViewModel {
  const repoPath = useFilesStore((state) => state.rootPath) ?? "";
  const commitId = activeTab.commitId ?? "";
  const focusPath = activeTab.filePath;
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoPath || !commitId) {
      setDetail(null);
      setFileDiffs([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      commitDetailIPC(repoPath, commitId),
      commitDiffIPC(repoPath, commitId),
    ])
      .then(([commitDetail, files]) => {
        if (cancelled) return;
        setDetail(commitDetail);
        setFileDiffs(
          files.map((file) => ({ path: file.path, hunks: file.hunks, collapsed: false })),
        );
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(ipcErrorMessage(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, commitId]);

  const onToggleCollapse = useCallback((index: number) => {
    setFileDiffs((prev) =>
      prev.map((diff, diffIndex) =>
        diffIndex === index ? { ...diff, collapsed: !diff.collapsed } : diff,
      ),
    );
  }, []);

  return {
    detail,
    fileDiffs,
    loading,
    error,
    repoPath,
    focusPath,
    onToggleCollapse,
  };
}

export { useCommitDiffView };
