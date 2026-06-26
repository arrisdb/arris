import { useState } from "react";
import type { CSSProperties, PointerEvent, UIEvent } from "react";
import { Icon } from "@shared/ui/Icon";
import { Tooltip } from "@shared/ui";
import { useGitHistoryView } from "./hooks";
import {
  edgePath,
  formatCommitDate,
  laneColor,
  laneX,
  shortHash,
} from "./utils";
import type { CommitDetail } from "./ipc";
import type { CommitGraphRow, CommitRef, GitHistoryViewModel } from "./types";
import {
  DETAIL_DEFAULT_WIDTH,
  DETAIL_MAX_WIDTH,
  DETAIL_MIN_WIDTH,
  DOT_RADIUS,
  LANE_WIDTH,
  LOAD_MORE_THRESHOLD,
  ROW_HEIGHT,
} from "./constants";
import "./index.css";

// Badges are tinted with their commit's lane color so a branch chip visually
// matches the lane/dot it sits on in the graph. HEAD stays bold for emphasis.
function RefBadge({ commitRef, color }: { commitRef: CommitRef; color: string }) {
  return (
    <span
      className={`mdbc-git-ref-badge${commitRef.kind === "head" ? " is-head" : ""}`}
      style={{ "--mdbc-ref-color": color } as CSSProperties}
    >
      {commitRef.name}
    </span>
  );
}

function GraphCell({ row, laneCount }: { row: CommitGraphRow; laneCount: number }) {
  const width = Math.max(laneCount, 1) * LANE_WIDTH;
  return (
    <svg
      className="mdbc-git-graph-cell"
      width={width}
      height="100%"
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {row.edges.map((edge, i) => (
        <path
          key={i}
          d={edgePath(edge.fromCol, edge.toCol, LANE_WIDTH, ROW_HEIGHT)}
          fill="none"
          stroke={laneColor(edge.toCol)}
          strokeWidth={1.5}
        />
      ))}
      <circle
        cx={laneX(row.column, LANE_WIDTH)}
        cy={ROW_HEIGHT / 2}
        r={DOT_RADIUS}
        fill={laneColor(row.column)}
        stroke="var(--mdbc-bg, #1a1a1a)"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function CommitRowView({
  row,
  laneCount,
  selected,
  onSelect,
}: {
  row: CommitGraphRow;
  laneCount: number;
  selected: boolean;
  onSelect: (row: CommitGraphRow) => void;
}) {
  return (
    <div
      className={`mdbc-git-history-row${selected ? " is-selected" : ""}`}
      data-testid={`git-history-row-${shortHash(row.id)}`}
      onClick={() => onSelect(row)}
    >
      <div className="mdbc-git-history-graph">
        <GraphCell row={row} laneCount={laneCount} />
      </div>
      <div className="mdbc-git-history-desc">
        <span className="mdbc-git-history-summary">{row.summary}</span>
      </div>
      <div className="mdbc-git-history-refs">
        {row.refs.map((commitRef) => (
          <RefBadge
            key={`${commitRef.kind}-${commitRef.name}`}
            commitRef={commitRef}
            color={laneColor(row.column)}
          />
        ))}
      </div>
      <div className="mdbc-git-history-date">{formatCommitDate(row.timestamp)}</div>
      <div className="mdbc-git-history-author">{row.author}</div>
      <div className="mdbc-git-history-hash">{shortHash(row.id)}</div>
    </div>
  );
}

function CommitFileRow({
  path,
  additions,
  deletions,
  onOpen,
}: {
  path: string;
  additions: number;
  deletions: number;
  onOpen: (path: string) => void;
}) {
  const name = path.split("/").pop() ?? path;
  const dir = path.slice(0, path.length - name.length).replace(/\/$/, "");
  return (
    <Tooltip label={`View Changes\n${path}`}>
      <button
        type="button"
        className="mdbc-commit-file-row"
        onClick={() => onOpen(path)}
        data-testid={`commit-file-${name}`}
      >
        <Icon name="fileText" size={12} />
        <span className="mdbc-commit-file-name">{name}</span>
        {dir && <span className="mdbc-commit-file-dir">{dir}</span>}
        <span className="mdbc-commit-file-stat">
          <span className="mdbc-commit-stat-add">+{additions}</span>
          <span className="mdbc-commit-stat-del">−{deletions}</span>
        </span>
      </button>
    </Tooltip>
  );
}

function CommitDetailBody({
  detail,
  webUrl,
  onOpenFile,
  onViewCommit,
}: {
  detail: CommitDetail;
  webUrl: string | null;
  onOpenFile: (path: string) => void;
  onViewCommit: () => void;
}) {
  return (
    <>
      <div className="mdbc-commit-detail-scroll">
        <div className="mdbc-commit-detail-line">
          <Icon name="pencil" size={12} />
          <span className="mdbc-commit-detail-muted">{detail.author}</span>
        </div>
        <div className="mdbc-commit-detail-line">
          <Icon name="clock" size={12} />
          <span className="mdbc-commit-detail-muted">{formatCommitDate(detail.timestamp)}</span>
        </div>
        <div className="mdbc-commit-detail-line">
          <Icon name="mail" size={12} />
          <span className="mdbc-commit-detail-muted">{detail.email}</span>
        </div>
        <div className="mdbc-commit-detail-line">
          <Icon name="hash" size={12} />
          <span className="mdbc-commit-detail-sha">{detail.id}</span>
        </div>

        <hr className="mdbc-commit-detail-sep" />

        <div className="mdbc-commit-detail-message">
          <div className="mdbc-commit-detail-summary">{detail.summary}</div>
          {detail.body && <pre className="mdbc-commit-detail-body">{detail.body}</pre>}
        </div>

        <div className="mdbc-commit-detail-files-head">
          <span>
            {detail.files.length} Changed File{detail.files.length !== 1 ? "s" : ""}
          </span>
          <span className="mdbc-commit-detail-files-stat">
            <span className="mdbc-commit-stat-add">+{detail.additions}</span>
            <span className="mdbc-commit-stat-del">−{detail.deletions}</span>
          </span>
        </div>

        <div className="mdbc-commit-detail-files">
          {detail.files.map((file) => (
            <CommitFileRow
              key={file.path}
              path={file.path}
              additions={file.additions}
              deletions={file.deletions}
              onOpen={onOpenFile}
            />
          ))}
        </div>
      </div>

      <div className="mdbc-commit-detail-actions">
        {webUrl && (
          <a
            className="mdbc-btn"
            href={webUrl}
            target="_blank"
            rel="noreferrer"
            data-testid="commit-detail-github"
          >
            <Icon name="externalLink" size={12} />
            View on GitHub
          </a>
        )}
        <button
          type="button"
          className="mdbc-btn"
          onClick={onViewCommit}
          data-testid="commit-detail-view-commit"
        >
          <Icon name="gitFork" size={12} />
          View Commit Details
        </button>
      </div>
    </>
  );
}

function CommitDetailPanel({
  view,
  width,
  onResizePointerDown,
}: {
  view: GitHistoryViewModel;
  width: number;
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="mdbc-commit-detail-panel"
      data-testid="commit-detail-panel"
      style={{ "--commit-detail-width": `${width}px` } as CSSProperties}
    >
      <div
        className="mdbc-commit-detail-resizer"
        onPointerDown={onResizePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize commit details"
        data-testid="commit-detail-resizer"
      />
      <button
        type="button"
        className="mdbc-icon-btn xs mdbc-commit-detail-close"
        onClick={view.onCloseDetail}
        aria-label="Close commit details"
        data-testid="commit-detail-close"
      >
        <Icon name="x" size={12} />
      </button>
      {view.detailLoading ? (
        <div className="mdbc-empty">Loading commit…</div>
      ) : view.detailError ? (
        <div className="mdbc-empty mdbc-git-error-text">{view.detailError}</div>
      ) : view.detail ? (
        <CommitDetailBody
          detail={view.detail}
          webUrl={view.detailWebUrl}
          onOpenFile={view.onOpenCommitFile}
          onViewCommit={view.onViewCommit}
        />
      ) : null}
    </div>
  );
}

function GitHistoryView() {
  const view = useGitHistoryView();
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT_WIDTH);

  function onScrollList(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= LOAD_MORE_THRESHOLD) {
      view.onLoadMore();
    }
  }

  // Drag the panel's left border to resize. Pointer capture keeps move events
  // flowing to the handle even when the cursor leaves it during the drag.
  function onResizePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = detailWidth;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    // Suppress text selection across the whole window while dragging.
    document.body.style.userSelect = "none";
    function onMove(moveEvent: globalThis.PointerEvent) {
      const next = startWidth + (startX - moveEvent.clientX);
      setDetailWidth(Math.min(DETAIL_MAX_WIDTH, Math.max(DETAIL_MIN_WIDTH, next)));
    }
    function onUp(upEvent: globalThis.PointerEvent) {
      document.body.style.userSelect = "";
      handle.releasePointerCapture?.(upEvent.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  return (
    <div className="mdbc-git-history-root">
      <div className="mdbc-git-history-toolbar">
        <input
          className="mdbc-pane-input mdbc-git-history-search"
          placeholder="Search commits…"
          value={view.query}
          onChange={(event) => view.onChangeQuery(event.target.value)}
          data-testid="git-history-search"
        />
        <Tooltip label="Refresh">
          <button
            className="mdbc-git-action-small mdbc-git-history-refresh"
            onClick={view.onRefresh}
            aria-label="Refresh"
            data-testid="git-history-refresh"
          >
            <Icon name="refreshCw" size={12} />
          </button>
        </Tooltip>
      </div>

      <div className="mdbc-git-history-head">
        <span className="mdbc-git-history-graph">Graph</span>
        <span className="mdbc-git-history-desc">Description</span>
        <span className="mdbc-git-history-refs">Branch</span>
        <span className="mdbc-git-history-date">Date</span>
        <span className="mdbc-git-history-author">Author</span>
        <span className="mdbc-git-history-hash">Commit</span>
      </div>

      <div className="mdbc-git-history-body">
        <div className="mdbc-git-history-list" onScroll={onScrollList}>
          {!view.hasRepo ? (
            <div className="mdbc-empty">Open a git repository to view its history.</div>
          ) : view.isLoading ? (
            <div className="mdbc-empty">Loading history…</div>
          ) : view.error ? (
            <div className="mdbc-empty mdbc-git-error-text">{view.error}</div>
          ) : view.visibleRows.length === 0 ? (
            <div className="mdbc-empty">{view.isSearching ? "Searching…" : "No commits match."}</div>
          ) : (
            <>
              {view.visibleRows.map((row) => (
                <CommitRowView
                  key={row.id}
                  row={row}
                  laneCount={view.laneCount}
                  selected={row.id === view.selectedCommitId}
                  onSelect={view.onSelectCommit}
                />
              ))}
              {view.isLoadingMore && (
                <div className="mdbc-git-history-loading-more" data-testid="git-history-loading-more">
                  Loading more…
                </div>
              )}
            </>
          )}
        </div>

        {view.selectedCommitId && (
          <CommitDetailPanel
            view={view}
            width={detailWidth}
            onResizePointerDown={onResizePointerDown}
          />
        )}
      </div>
    </div>
  );
}

export { GitHistoryView };
