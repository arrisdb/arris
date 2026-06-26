import { useGitConflictView } from "./hooks";
import type { ConflictHunkSegment, ConflictResolution, GitConflictViewModel } from "./types";
import { fileName } from "./utils";
import "./index.css";

function HunkSide({ label, lines, active }: { label: string; lines: string[]; active: boolean }) {
  return (
    <div className={`mdbc-conflict-side ${active ? "active" : ""}`}>
      <div className="mdbc-conflict-side-label">{label}</div>
      <pre className="mdbc-conflict-code">{lines.join("\n") || " "}</pre>
    </div>
  );
}

function ConflictHunk({
  hunk,
  index,
  onAccept,
}: {
  hunk: ConflictHunkSegment;
  index: number;
  onAccept: (index: number, resolution: ConflictResolution) => void;
}) {
  return (
    <div className={`mdbc-conflict-hunk ${hunk.resolution ? "resolved" : ""}`} data-testid={`conflict-hunk-${index}`}>
      <div className="mdbc-conflict-hunk-bar">
        <span className="mdbc-conflict-hunk-label">
          Conflict {hunk.resolution ? `· ${hunk.resolution}` : "· unresolved"}
        </span>
        <div className="mdbc-git-changes-actions">
          <button
            className={`mdbc-git-action-small ${hunk.resolution === "ours" ? "selected" : ""}`}
            onClick={() => onAccept(index, "ours")}
            data-testid={`conflict-accept-ours-${index}`}
          >
            Use Ours
          </button>
          <button
            className={`mdbc-git-action-small ${hunk.resolution === "theirs" ? "selected" : ""}`}
            onClick={() => onAccept(index, "theirs")}
            data-testid={`conflict-accept-theirs-${index}`}
          >
            Use Theirs
          </button>
          <button
            className={`mdbc-git-action-small ${hunk.resolution === "both" ? "selected" : ""}`}
            onClick={() => onAccept(index, "both")}
          >
            Both
          </button>
        </div>
      </div>
      <div className="mdbc-conflict-sides">
        <HunkSide label="Ours (HEAD)" lines={hunk.ours} active={hunk.resolution === "ours" || hunk.resolution === "both"} />
        <HunkSide label="Theirs (incoming)" lines={hunk.theirs} active={hunk.resolution === "theirs" || hunk.resolution === "both"} />
      </div>
    </div>
  );
}

function ConflictBody({ view }: { view: GitConflictViewModel }) {
  if (!view.selectedFile) {
    return <div className="mdbc-empty">Select a conflicted file to resolve.</div>;
  }
  // Conflict segments carry their global hunk index for accept callbacks.
  let hunkIndex = -1;
  return (
    <div className="mdbc-conflict-doc">
      {view.segments.map((seg, i) => {
        if (seg.kind === "text") {
          return (
            <pre key={i} className="mdbc-conflict-context">
              {seg.lines.join("\n")}
            </pre>
          );
        }
        hunkIndex = i;
        return <ConflictHunk key={i} hunk={seg} index={i} onAccept={view.onAcceptHunk} />;
      })}
      {hunkIndex === -1 && (
        <div className="mdbc-empty">No conflict markers remain in this file.</div>
      )}
    </div>
  );
}

function GitConflictView() {
  const view = useGitConflictView();

  if (!view.hasRepo) {
    return <div className="mdbc-empty">Open a git repository to resolve conflicts.</div>;
  }
  if (view.mergeKind === "none" && view.conflictedFiles.length === 0) {
    return <div className="mdbc-empty">No merge or rebase in progress. Nothing to resolve.</div>;
  }

  return (
    <div className="mdbc-conflict-root">
      <div className="mdbc-conflict-header">
        <span className="mdbc-conflict-title">
          Resolving {view.mergeKind} · {view.conflictedFiles.length} file(s) with conflicts
        </span>
        <div className="mdbc-git-changes-actions">
          <button
            className="mdbc-btn primary"
            disabled={view.isBusy || view.conflictedFiles.length > 0}
            onClick={view.onContinue}
            data-testid="conflict-continue"
          >
            Continue {view.mergeKind}
          </button>
          <button
            className="mdbc-git-action-small"
            disabled={view.isBusy}
            onClick={view.onAbort}
            data-testid="conflict-abort"
          >
            Abort
          </button>
        </div>
      </div>

      {view.error && <div className="mdbc-git-change-path mdbc-git-error-text">{view.error}</div>}

      <div className="mdbc-conflict-body">
        <div className="mdbc-conflict-filelist">
          {view.conflictedFiles.length === 0 ? (
            <div className="mdbc-empty">All conflicts resolved. Continue the {view.mergeKind}.</div>
          ) : (
            view.conflictedFiles.map((path) => (
              <button
                key={path}
                className={`mdbc-file-row ${path === view.selectedFile ? "selected" : ""}`}
                onClick={() => view.onSelectFile(path)}
                data-testid={`conflict-file-${fileName(path)}`}
              >
                <span className="mdbc-file-name mdbc-git-error-text">{fileName(path)}</span>
              </button>
            ))
          )}
        </div>

        <div className="mdbc-conflict-main">
          {view.selectedFile && (
            <div className="mdbc-conflict-toolbar">
              <span className="mdbc-conflict-file-path">{view.selectedFile}</span>
              <span className="mdbc-conflict-progress">
                {view.resolvedCount} / {view.conflictCount} hunks
              </span>
              <div className="mdbc-git-changes-actions">
                <button className="mdbc-git-action-small" disabled={view.isBusy} onClick={view.onUseOurs}>
                  Whole: Ours
                </button>
                <button className="mdbc-git-action-small" disabled={view.isBusy} onClick={view.onUseTheirs}>
                  Whole: Theirs
                </button>
                <button
                  className="mdbc-btn primary"
                  disabled={view.isBusy || !view.allResolved}
                  onClick={view.onMarkResolved}
                  data-testid="conflict-mark-resolved"
                >
                  Mark Resolved
                </button>
              </div>
            </div>
          )}
          <ConflictBody view={view} />
        </div>
      </div>
    </div>
  );
}

export { GitConflictView };
