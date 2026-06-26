import { useState } from "react";
import type { MouseEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "@shared/ui/Icon";
import type { CloneDialogProps } from "../../types";

function CloneDialog({
  onClone,
  onCancel,
  isCloning,
  error,
}: CloneDialogProps) {
  const [url, setUrl] = useState("");
  const [dest, setDest] = useState("");

  function onClickBrowse() {
    openDialog({ directory: true, title: "Clone destination" })
      .then((selected) => {
        if (typeof selected === "string") setDest(selected);
      })
      .catch(() => {});
  }

  function onClickDialog(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
  }

  function onClickOverlay() {
    if (!isCloning) onCancel();
  }

  function onClickSubmit() {
    onClone(url.trim(), dest.trim());
  }

  return (
    <div
      className="welcome-dialog-overlay"
      data-testid="welcome-clone-dialog"
      onClick={onClickOverlay}
    >
      <div className="welcome-dialog welcome-clone-dialog" onClick={onClickDialog}>
        <div className="welcome-dialog-header">
          <div className="welcome-dialog-title">Clone Repository</div>
          <button
            type="button"
            className="mdbc-icon-btn square"
            aria-label="Close"
            data-testid="welcome-clone-close"
            onClick={onCancel}
            disabled={isCloning}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <label className="welcome-clone-label">
          Repository URL
          <input
            className="welcome-clone-input"
            data-testid="welcome-clone-url"
            type="text"
            placeholder="https://github.com/user/repo.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isCloning}
            autoFocus
          />
        </label>
        <label className="welcome-clone-label">
          Destination
          <div className="welcome-clone-dest-row">
            <input
              className="welcome-clone-input"
              data-testid="welcome-clone-dest"
              type="text"
              placeholder="/path/to/folder"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              disabled={isCloning}
            />
            <button
              type="button"
              className="mdbc-btn welcome-clone-browse"
              data-testid="welcome-clone-browse"
              onClick={onClickBrowse}
              disabled={isCloning}
            >
              Browse…
            </button>
          </div>
        </label>
        {error && (
          <div className="welcome-clone-error" data-testid="welcome-clone-error">{error}</div>
        )}
        <div className="welcome-dialog-actions">
          <button
            type="button"
            className="mdbc-btn welcome-dialog-btn"
            data-testid="welcome-clone-cancel"
            onClick={onCancel}
            disabled={isCloning}
          >
            Cancel
          </button>
          <button
            type="button"
            className="mdbc-btn primary welcome-dialog-btn"
            data-testid="welcome-clone-submit"
            disabled={!url.trim() || !dest.trim() || isCloning}
            onClick={onClickSubmit}
          >
            {isCloning ? (
              <>
                <Icon name="loader" size={14} className="welcome-clone-spinner" />
                Cloning…
              </>
            ) : (
              "Clone"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export { CloneDialog };
