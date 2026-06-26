import { useState } from "react";
import type { MouseEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "@shared/ui/Icon";
import type { NewProjectDialogProps, ProjectKind } from "../../types";

const NEW_PROJECT_TITLES: Record<ProjectKind, string> = {
  empty: "New empty project",
  dbt: "New dbt project",
  sqlmesh: "New SQLMesh project",
};

function NewProjectDialog({
  kind,
  onCreate,
  onCancel,
}: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");

  function onClickBrowse() {
    openDialog({ directory: true, title: "Project location" })
      .then((selected) => {
        if (typeof selected === "string") setLocation(selected);
      })
      .catch(() => {});
  }

  function onClickDialog(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
  }

  function onClickCreate() {
    onCreate(name.trim(), location.trim());
  }

  return (
    <div
      className="welcome-dialog-overlay"
      data-testid="welcome-newproject-dialog"
      onClick={onCancel}
    >
      <div className="welcome-dialog welcome-clone-dialog" onClick={onClickDialog}>
        <div className="welcome-dialog-header">
          <div className="welcome-dialog-title">{NEW_PROJECT_TITLES[kind]}</div>
          <button
            type="button"
            className="mdbc-icon-btn square"
            aria-label="Close"
            data-testid="welcome-newproject-close"
            onClick={onCancel}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <label className="welcome-clone-label">
          Project name
          <input
            className="welcome-clone-input"
            data-testid="welcome-newproject-name"
            type="text"
            placeholder="my-project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label className="welcome-clone-label">
          Location
          <div className="welcome-clone-dest-row">
            <input
              className="welcome-clone-input"
              data-testid="welcome-newproject-location"
              type="text"
              placeholder="/path/to/parent/folder"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
            <button
              type="button"
              className="mdbc-btn-icon"
              aria-label="Browse"
              title="Browse…"
              data-testid="welcome-newproject-browse"
              onClick={onClickBrowse}
            >
              <Icon name="folder" size={14} />
            </button>
          </div>
        </label>
        <div className="welcome-dialog-actions">
          <button
            type="button"
            className="mdbc-btn welcome-dialog-btn"
            data-testid="welcome-newproject-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="mdbc-btn primary welcome-dialog-btn"
            data-testid="welcome-newproject-create"
            disabled={!name.trim() || !location.trim()}
            onClick={onClickCreate}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export { NewProjectDialog };
