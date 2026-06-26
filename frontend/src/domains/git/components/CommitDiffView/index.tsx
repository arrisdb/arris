import { useEffect, useRef } from "react";
import { Icon } from "@shared/ui/Icon";
import { DiffFileSection } from "../GitDiffView/components/GitDiffViewContent";
import {
  formatCommitDate,
  shortHash,
} from "../GitHistoryView/utils";
import { useCommitDiffView } from "./hooks";
import type { CommitDiffViewProps } from "./types";
import "./index.css";

function CommitDiffView({ activeTab }: CommitDiffViewProps) {
  const view = useCommitDiffView(activeTab);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Once the diffs are in, scroll the file the user clicked in the detail
  // panel into view. No-op for "View Commit" (no focus file).
  useEffect(() => {
    if (!view.focusPath || view.loading) return;
    const el = sectionRefs.current[view.focusPath];
    el?.scrollIntoView?.({ block: "start" });
  }, [view.focusPath, view.loading, view.fileDiffs.length]);

  const detail = view.detail;

  return (
    <div className="mdbc-commit-diff-root" data-testid="commit-diff-view">
      {detail && (
        <div className="mdbc-commit-diff-header">
          <div className="mdbc-commit-diff-meta">
            <div className="mdbc-commit-diff-author-row">
              <span className="mdbc-commit-diff-author">{detail.author}</span>
              <span className="mdbc-commit-diff-muted">{formatCommitDate(detail.timestamp)}</span>
              <span className="mdbc-commit-diff-muted">{detail.email}</span>
            </div>
            {detail.summary && (
              <div className="mdbc-commit-diff-summary">{detail.summary}</div>
            )}
            {detail.body && (
              <pre className="mdbc-commit-diff-body">{detail.body}</pre>
            )}
          </div>
          <div className="mdbc-commit-diff-side">
            <span className="mdbc-commit-diff-stat-add">+{detail.additions}</span>
            <span className="mdbc-commit-diff-stat-del">−{detail.deletions}</span>
            <span className="mdbc-commit-diff-sha">
              <Icon name="gitFork" size={12} />
              {shortHash(detail.id)}
            </span>
          </div>
        </div>
      )}

      <div className="git-diff-content">
        {view.loading ? (
          <div className="mdbc-empty">Loading commit…</div>
        ) : view.error ? (
          <div className="mdbc-empty mdbc-git-error-text">{view.error}</div>
        ) : view.fileDiffs.length === 0 ? (
          <div className="mdbc-empty">No changes in this commit.</div>
        ) : (
          view.fileDiffs.map((diff, index) => (
            <div
              key={diff.path}
              ref={(el) => {
                sectionRefs.current[diff.path] = el;
              }}
            >
              <DiffFileSection
                diff={diff}
                repoRoot={view.repoPath}
                onToggleCollapse={() => view.onToggleCollapse(index)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export { CommitDiffView };
