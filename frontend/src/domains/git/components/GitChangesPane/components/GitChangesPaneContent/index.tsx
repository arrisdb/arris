import { useState } from "react";
import type { CSSProperties } from "react";
import { ContextMenu } from "@shared/ui/ContextMenu";
import { Icon } from "@shared/ui/Icon";
import { SplitButton } from "@shared/ui";
import type { SplitButtonItem } from "@shared/ui";
import { fileKindForName } from "@domains/files";
import type {
  DirRowProps,
  GitChangesPaneContentProps,
  GitFileRowProps,
  RemotesEditorProps,
} from "../../types";
import {
  gitChangeFileName,
  gitStatusColor,
  isDirectoryEntry,
  isStaged,
  parseRemoteBranchTarget,
} from "../../utils";

function DirRow({
  node,
  depth,
  selectedFile,
  onSelect,
  diffStats,
  onToggleStage,
  onContextMenu,
}: DirRowProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <>
      {node.name && (
        <button
          type="button"
          className="mdbc-file-row mdbc-git-change-row-indent"
          onClick={() => setExpanded((value) => !value)}
        >
          {Array.from({ length: depth }, (_, index) => (
            <span key={index} className="mdbc-indent-guide" aria-hidden="true" />
          ))}
          <span className="mdbc-file-icon folder">
            <Icon name="folder" size={14} />
          </span>
          <span className="mdbc-file-name">{node.name}</span>
        </button>
      )}
      {(expanded || !node.name) && (
        <>
          {node.files.map((file) => {
            const staged = isStaged(file);
            const childDepth = depth + (node.name ? 1 : 0);
            return (
              <GitFileRow
                key={file.path}
                childDepth={childDepth}
                file={file}
                selected={file.path === selectedFile}
                stats={diffStats.get(file.path)}
                staged={staged}
                onSelect={onSelect}
                onToggleStage={onToggleStage}
                onContextMenu={onContextMenu}
              />
            );
          })}
          {node.children.map((child) => (
            <DirRow
              key={child.path}
              node={child}
              depth={depth + (node.name ? 1 : 0)}
              selectedFile={selectedFile}
              onSelect={onSelect}
              diffStats={diffStats}
              onToggleStage={onToggleStage}
              onContextMenu={onContextMenu}
            />
          ))}
        </>
      )}
    </>
  );
}

function GitChangesPaneContent({ pane }: GitChangesPaneContentProps) {
  const [pullTarget, setPullTarget] = useState("");
  const [pushTarget, setPushTarget] = useState("");

  const targetPlaceholder = `${pane.defaultRemote} ${pane.currentBranch ?? ""}`.trim();
  const gitActionItems: SplitButtonItem[] = [
    {
      id: "fetch",
      label: pane.isFetching ? "Fetching…" : "Fetch",
      loading: pane.isFetching,
      onClick: pane.onClickFetch,
    },
    {
      id: "pull",
      label: pane.isPulling ? "Pulling…" : "Pull",
      loading: pane.isPulling,
      disabled: !pane.hasUpstream,
      onClick: pane.onClickPull,
    },
    {
      id: "pullFrom",
      label: "Pull From",
      scope: pullTarget,
      scopeEditable: true,
      scopePlaceholder: targetPlaceholder,
      onScopeChange: setPullTarget,
      onClick: () => {
        const { remote, branch } = parseRemoteBranchTarget(
          pullTarget,
          pane.defaultRemote,
          pane.currentBranch ?? "",
        );
        pane.onPullFrom(remote, branch);
      },
    },
    {
      id: "push",
      label: pane.isPushing ? "Pushing…" : pane.pushLabel,
      loading: pane.isPushing,
      disabled: pane.pushDisabled,
      onClick: pane.onClickPush,
    },
    {
      id: "pushTo",
      label: "Push to",
      scope: pushTarget,
      scopeEditable: true,
      scopePlaceholder: targetPlaceholder,
      onScopeChange: setPushTarget,
      onClick: () => {
        const { remote, branch } = parseRemoteBranchTarget(
          pushTarget,
          pane.defaultRemote,
          pane.currentBranch ?? "",
        );
        pane.onPushTo(remote, branch);
      },
    },
    {
      id: "forcePush",
      label: "Force push",
      disabled: !pane.hasUpstream,
      onClick: pane.onForcePush,
    },
  ];

  return (
    <>
      {pane.fileStatuses.length === 0 ? (
        <div className="mdbc-empty mdbc-git-changes-list">No changes detected.</div>
      ) : (
        <>
          <div className="mdbc-section-head">
            <span>{pane.fileStatuses.length} Changes</span>
            <div className="mdbc-git-changes-actions">
              <button className="mdbc-btn" onClick={pane.onClickStageAll}>
                Stage All
              </button>
              <button className="mdbc-btn" onClick={pane.onClickUnstageAll}>
                Unstage All
              </button>
            </div>
          </div>

          <div className="mdbc-file-tree mdbc-git-changes-list">
            <DirRow
              node={pane.tree}
              depth={0}
              selectedFile={pane.selectedFile}
              onSelect={pane.onSelectFile}
              diffStats={pane.diffStats}
              onToggleStage={pane.onToggleStage}
              onContextMenu={pane.onContextMenuFile}
            />
          </div>
        </>
      )}

      {pane.contextMenuState && (
        <ContextMenu
          x={pane.contextMenuState.x}
          y={pane.contextMenuState.y}
          items={pane.getFileMenuItems(pane.contextMenuState.context)}
          onClose={pane.onCloseContextMenu}
          data-testid="git-file-ctx-menu"
        />
      )}

      <div className="mdbc-pane-actions">
        {pane.mergeInProgress && (
          <div className="mdbc-git-conflict-banner" data-testid="git-conflict-banner">
            <span>
              {pane.mergeKind} in progress — {pane.conflictedCount} conflicted file(s)
            </span>
            <button
              className="mdbc-btn primary mdbc-git-full-width"
              onClick={pane.onClickResolveConflicts}
              data-testid="git-resolve-conflicts"
            >
              Resolve Conflicts
            </button>
          </div>
        )}

        <div className="mdbc-pane-meta">
          <span className="mdbc-git-branch-label" data-testid="git-branch-label">
            <Icon name="gitBranch" size={12} />
            <span>{pane.currentBranch ?? ""}</span>
          </span>
        </div>

        <textarea
          className="mdbc-pane-textarea mdbc-git-commit-box"
          value={pane.commitMessage}
          onChange={(event) => pane.onChangeCommitMessage(event.target.value)}
          placeholder="Enter commit message"
          onKeyDown={pane.onKeyDownCommitMessage}
        />

        <div className="mdbc-git-commit-row">
          {pane.showSync && (
            <SplitButton
              items={gitActionItems}
              defaultItemId="push"
              data-testid="git-actions"
            />
          )}
          <button
            className="mdbc-btn primary"
            disabled={!pane.hasStagedFiles || !pane.commitMessage.trim() || pane.isCommitting}
            onClick={pane.onClickCommit}
          >
            {pane.isCommitting ? "Committing…" : "Commit"}
          </button>
        </div>

        <div className="mdbc-git-history-footer">
          <span className="mdbc-git-history-footer-msg" title={pane.lastCommit?.summary}>
            {pane.lastCommit?.summary ?? ""}
          </span>
          <button
            className="mdbc-icon-btn"
            onClick={pane.onClickShowHistory}
            title="Git history"
            aria-label="Git history"
            data-testid="git-show-history"
          >
            <Icon name="history" size={14} />
          </button>
        </div>

        <RemotesEditor remotes={pane.remotes} onSave={pane.onSaveRemoteUrl} />

        {pane.movedRemoteUrl && (
          <div className="mdbc-git-remote-moved" data-testid="git-remote-moved">
            <span>
              Remote moved to <code>{pane.movedRemoteUrl}</code>
            </span>
            <button
              className="mdbc-btn primary mdbc-git-full-width"
              onClick={pane.onClickApplyMovedRemote}
              data-testid="git-remote-moved-apply"
            >
              Update remote &amp; push
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function RemotesEditor({ remotes, onSave }: RemotesEditorProps) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (remotes.length === 0) return null;

  return (
    <div className="mdbc-git-remotes-section">
      <button
        type="button"
        className="mdbc-git-remotes-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="git-remotes-toggle"
      >
        <Icon name={open ? "chevronDown" : "chevronRight"} size={11} />
        <span>Remotes</span>
      </button>
      {open && (
        <div className="mdbc-git-remotes" data-testid="git-remotes-editor">
          {remotes.map((remote) => {
            const draft = drafts[remote.name] ?? remote.url;
            const dirty = draft.trim() !== remote.url && draft.trim().length > 0;
            // Persist on blur / Enter, with no explicit Save button.
            const commit = () => {
              if (dirty) onSave(remote.name, draft.trim());
            };
            return (
              <input
                key={remote.name}
                className="mdbc-pane-input mdbc-git-remote-input"
                value={draft}
                placeholder={remote.name}
                title={remote.name}
                onChange={(event) =>
                  setDrafts((prev) => ({ ...prev, [remote.name]: event.target.value }))
                }
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commit();
                    event.currentTarget.blur();
                  }
                }}
                data-testid={`git-remote-input-${remote.name}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function GitFileRow({
  childDepth,
  file,
  selected,
  stats,
  staged,
  onSelect,
  onToggleStage,
  onContextMenu,
}: GitFileRowProps) {
  const fileName = gitChangeFileName(file.path);
  const isDir = isDirectoryEntry(file.path);
  const fileKind = fileKindForName(fileName);
  const fileIconClass = fileKind === "sql" ? "sql" : fileKind === "yaml" ? "yaml" : "default";

  return (
    <button
      type="button"
      className={[
        `mdbc-file-row ${selected ? "selected" : ""}`,
        "mdbc-git-change-row-indent",
      ].filter(Boolean).join(" ")}
      onClick={() => onSelect(file.path)}
      onContextMenu={(event) => onContextMenu(event, file)}
      data-testid={`git-file-${fileName}`}
    >
      {Array.from({ length: childDepth }, (_, index) => (
        <span key={index} className="mdbc-indent-guide" aria-hidden="true" />
      ))}
      <span className={`mdbc-file-icon ${isDir ? "folder" : `file ${fileIconClass}`}`}>
        <Icon name={isDir ? "folder" : "fileText"} size={14} />
      </span>
      <span
        className="mdbc-file-name mdbc-git-change-status-color"
        style={{ "--mdbc-git-change-status-color": gitStatusColor(file.status) } as CSSProperties}
      >
        {fileName}
      </span>
      {stats && (
        <span className="meta mdbc-git-change-row-meta">
          <span className="mdbc-git-success-text">+{stats.added}</span>
          <span className="mdbc-git-error-text">−{stats.deleted}</span>
        </span>
      )}
      <input
        className="mdbc-checkbox mdbc-git-change-checkbox"
        type="checkbox"
        checked={staged}
        onChange={(event) => {
          event.stopPropagation();
          onToggleStage(file.path, staged);
        }}
        onClick={(event) => event.stopPropagation()}
      />
    </button>
  );
}

export { GitChangesPaneContent };
