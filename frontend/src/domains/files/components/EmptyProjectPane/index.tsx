import type { CSSProperties } from "react";
import { Icon } from "@shared/ui/Icon";
import { PaneContextMenuSurface } from "@shared/ui/ContextMenu";
import { useEmptyProjectPane } from "./hooks";
import {
  relativeTime,
  swatchColor,
} from "./utils";

function EmptyProjectPane() {
  const pane = useEmptyProjectPane();

  return (
    <PaneContextMenuSurface
      className="mdbc-empty-project"
      data-testid="empty-project-pane"
      context={null}
      getItems={pane.contextMenuItems}
    >
      <div className="mdbc-start-card" data-testid="start-project-card">
        <div className="mdbc-start-icon" aria-hidden="true">
          <Icon name="folder" size={18} />
        </div>
        <div className="mdbc-start-title">Start a project</div>
        <div className="mdbc-start-subtitle">
          Open a folder of SQL, dbt, or notebooks — or just point at a connection.
        </div>
        <button
          type="button"
          className="mdbc-start-btn primary"
          data-testid="start-new-project"
          onClick={pane.onClickOpenFolder}
        >
          <span className="label">+ New project…</span>
          {pane.openProjectShortcut && <span className="kbd">{pane.openProjectShortcut}</span>}
        </button>
        <button
          type="button"
          className="mdbc-start-btn"
          data-testid="start-open-folder"
          onClick={pane.onClickOpenFolder}
        >
          <span className="label">
            <Icon name="folder" size={12} /> Open folder…
          </span>
          {pane.openProjectShortcut && <span className="kbd">{pane.openProjectShortcut}</span>}
        </button>
        <button type="button" className="mdbc-start-link" disabled>
          <Icon name="gitBranch" size={12} /> Clone from Git…
        </button>
        <button type="button" className="mdbc-start-link" disabled>
          <Icon name="database" size={12} /> Connect database only
        </button>
      </div>

      <div className="mdbc-recent">
        <div className="mdbc-recent-head">
          <span>RECENT</span>
          <span className="count">{pane.recents.length}</span>
        </div>
        {pane.recents.length === 0 ? (
          <div className="mdbc-empty mdbc-recent-empty" data-testid="recent-empty">
            No recent projects yet.
          </div>
        ) : (
          pane.recents.map((recent) => (
            <button
              key={recent.path}
              type="button"
              className="mdbc-recent-row"
              data-testid={`recent-row-${recent.path}`}
              title={recent.path}
              onClick={() => pane.onClickRecent(recent)}
            >
              <span
                className="mdbc-recent-swatch mdbc-empty-project-accent-bg"
                style={{ "--mdbc-empty-project-accent-bg": swatchColor(recent.name) } as CSSProperties}
                aria-hidden="true"
              >
                {recent.name.charAt(0).toLowerCase()}
              </span>
              <span className="mdbc-recent-text">
                <span className="name">{recent.name}</span>
                <span className="meta">
                  {recent.branch ? (
                    <>
                      <Icon name="gitBranch" size={10} /> {recent.branch} ·{" "}
                    </>
                  ) : null}
                  {relativeTime(recent.openedAt)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </PaneContextMenuSurface>
  );
}

export { EmptyProjectPane };
