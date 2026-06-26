import { Icon } from "@shared/ui/Icon";
import { CloneDialog } from "./components/CloneDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { useWelcomeScreen } from "./hooks";
import { timeAgo } from "./utils";
import "./index.css";

export function WelcomeScreen() {
  const {
    cloneError,
    isCloning,
    onCancelCloneDialog,
    onCancelNewProject,
    onCancelScaffold,
    onClickNewProject,
    onClickOpenFolder,
    onClickRecentProject,
    onClickShowCloneDialog,
    onCloneSubmit,
    onConfirmScaffold,
    onCreateNewProject,
    pendingNewProject,
    pendingScaffold,
    recents,
    showCloneDialog,
  } = useWelcomeScreen();

  return (
    <div className="mdbc welcome-screen" data-testid="welcome-screen">
      <div className="welcome-content">
        <div className="welcome-icon" aria-hidden="true">
          <img className="welcome-logo" src="/brand/arris-logo.png" alt="" />
        </div>

        <h1 className="welcome-heading">Welcome to Arris</h1>

        <p className="welcome-subtitle">
          Modern data IDE for modern data teams
        </p>

        <div className="welcome-section">
          <div className="welcome-section-head">NEW PROJECT</div>
          <div className="welcome-project-types" data-testid="welcome-project-types">
            <button
              type="button"
              className="welcome-project-card"
              data-testid="welcome-new-empty"
              onClick={() => onClickNewProject("empty")}
            >
              <span className="welcome-project-card-icon" aria-hidden="true">
                <Icon name="terminal" size={20} />
              </span>
              <span className="welcome-project-card-label">Empty project</span>
              <span className="welcome-project-card-desc">Just exploring</span>
            </button>

            <button
              type="button"
              className="welcome-project-card"
              data-testid="welcome-new-dbt"
              onClick={() => onClickNewProject("dbt")}
            >
              <span className="welcome-project-card-icon" aria-hidden="true">
                <img className="welcome-project-card-logo" src="/db-logos/dbt.png" alt="dbt" />
              </span>
              <span className="welcome-project-card-label">dbt</span>
              <span className="welcome-project-card-desc">Sample dbt project</span>
            </button>

            <button
              type="button"
              className="welcome-project-card"
              data-testid="welcome-new-sqlmesh"
              onClick={() => onClickNewProject("sqlmesh")}
            >
              <span className="welcome-project-card-icon" aria-hidden="true">
                <img className="welcome-project-card-logo" src="/db-logos/sqlmesh.png" alt="SQLMesh" />
              </span>
              <span className="welcome-project-card-label">SQLMesh</span>
              <span className="welcome-project-card-desc">Sample SQLMesh project</span>
            </button>
          </div>
        </div>

        <div className="welcome-section">
          <div className="welcome-section-head">OPEN EXISTING</div>
          <div className="welcome-actions">
            <button
              type="button"
              className="mdbc-btn primary welcome-action-btn"
              data-testid="welcome-open-folder"
              onClick={onClickOpenFolder}
            >
              <Icon name="folder" size={14} />
              Open folder
            </button>

            <button
              type="button"
              className="mdbc-btn welcome-action-btn"
              data-testid="welcome-clone"
              onClick={onClickShowCloneDialog}
            >
              <Icon name="gitBranch" size={14} />
              Clone…
            </button>
          </div>
        </div>

        {recents.length > 0 && (
          <div className="welcome-section welcome-recents">
            <div className="welcome-section-head">PICK UP WHERE YOU LEFT OFF</div>
            <div className="welcome-recents-grid" data-testid="welcome-recents-grid">
              {recents.map((recent) => (
                <button
                  key={recent.path}
                  type="button"
                  className="welcome-recent-card"
                  data-testid={`welcome-recent-${recent.path}`}
                  title={recent.path}
                  onClick={() => onClickRecentProject(recent.path)}
                >
                  <span className="welcome-recent-icon" aria-hidden="true">
                    <Icon name="folder" size={16} />
                  </span>
                  <span className="welcome-recent-info">
                    <span className="welcome-recent-name">{recent.name}</span>
                    <span className="welcome-recent-meta">
                      {recent.branch ? (
                        <>
                          <Icon name="gitBranch" size={10} />
                          {recent.branch} ·{" "}
                        </>
                      ) : null}
                      {timeAgo(recent.openedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {showCloneDialog && (
        <CloneDialog
          onClone={onCloneSubmit}
          onCancel={onCancelCloneDialog}
          isCloning={isCloning}
          error={cloneError}
        />
      )}

      {pendingNewProject && (
        <NewProjectDialog
          kind={pendingNewProject.kind}
          onCreate={onCreateNewProject}
          onCancel={onCancelNewProject}
        />
      )}

      {pendingScaffold && (
        <ConfirmDialog
          title="Folder is not empty"
          message="This folder already contains files. Scaffold files may overwrite existing content. Continue anyway?"
          onConfirm={onConfirmScaffold}
          onCancel={onCancelScaffold}
        />
      )}
    </div>
  );
}
