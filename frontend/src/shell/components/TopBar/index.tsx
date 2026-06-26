import { Icon } from "@shared/ui/Icon";
import { IconButton, SearchInput } from "@shared/ui";
import { UpdateButton } from "@shell/components/UpdateChecker";
import { TOP_BAR_TABS } from "./constants";
import { useTopBar } from "./hooks";
import { worktreeDisplayName } from "./utils";
import "./index.css";

export function TopBar() {
  const {
    activeTab,
    branchFilter,
    branchName,
    branchPickerRef,
    busyBranch,
    canSwitchBranch,
    currentBranch,
    error,
    filteredBranches,
    filteredWorktrees,
    isBranchPickerOpen,
    isWorktreePickerOpen,
    onBranchFilterChange,
    onCheckoutBranch,
    onClickBranchesTab,
    onClickDeleteBranch,
    onClickRemoveWorktree,
    onClickStashTab,
    onClickToggleBranchPicker,
    onClickToggleWorktreePicker,
    onWorktreeFilterChange,
    projectName,
    repoPath,
    worktreeFilter,
    worktreeLabel,
    worktreePickerRef,
  } = useTopBar();

  return (
    <div className="mdbc-topbar" data-testid="top-bar">
      <div className="mdbc-topbar-left">
        <span className="mdbc-topbar-project" data-testid="top-bar-project">
          {projectName}
        </span>
        {worktreeLabel && (
          <>
            <div className="mdbc-topbar-popover-anchor" ref={worktreePickerRef}>
              <button
                type="button"
                className="mdbc-topbar-branch"
                data-testid="top-bar-worktree-btn"
                disabled={!canSwitchBranch}
                onClick={onClickToggleWorktreePicker}
              >
                <Icon name="gitFork" size={13} />
                <span data-testid="top-bar-worktree">{worktreeLabel}</span>
              </button>
              {isWorktreePickerOpen && (
                <div className="mdbc-branch-popover" data-testid="worktree-popover">
                  <SearchInput
                    value={worktreeFilter}
                    onChange={onWorktreeFilterChange}
                    placeholder="Select a worktree..."
                    ariaLabel="Select a worktree"
                    autoFocus
                  />
                  <div className="mdbc-branch-list" role="listbox" aria-label="Worktrees">
                    {filteredWorktrees.length === 0 ? (
                      <div className="mdbc-branch-empty">No matching worktrees</div>
                    ) : (
                      filteredWorktrees.map((worktree) => {
                        const name = worktreeDisplayName(worktree);
                        const isCurrent = worktree.path === repoPath;
                        const canRemove = !worktree.isMain && !isCurrent;
                        return (
                          <div className="mdbc-branch-row-wrap" key={worktree.path}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={isCurrent}
                              className={`mdbc-branch-row mdbc-branch-row-tall${isCurrent ? " selected" : ""}`}
                              disabled
                            >
                              <span className="mdbc-branch-check">{isCurrent ? "✓" : ""}</span>
                              <span className="mdbc-branch-icon">
                                <Icon name="gitBranch" size={13} />
                              </span>
                              <span className="mdbc-branch-row-detail">
                                <span className="mdbc-branch-name">{name}</span>
                                <span className="mdbc-branch-row-sub">
                                  {worktree.branch ?? "detached"} · {worktree.head.slice(0, 7)}
                                </span>
                              </span>
                            </button>
                            {canRemove && (
                              <IconButton
                                icon="trash"
                                label={`Remove worktree ${name}`}
                                title="Remove worktree"
                                variant="default"
                                size={13}
                                className="mdbc-branch-remove"
                                onClick={() => onClickRemoveWorktree(worktree.path)}
                              />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
            <span className="mdbc-topbar-separator">/</span>
          </>
        )}
        <div className="mdbc-topbar-popover-anchor" ref={branchPickerRef}>
          <button
            type="button"
            className="mdbc-topbar-branch"
            aria-label={`Git branch: ${branchName}`}
            disabled={!canSwitchBranch}
            aria-expanded={isBranchPickerOpen}
            onClick={onClickToggleBranchPicker}
          >
            <Icon name="gitBranch" size={13} />
            <span data-testid="top-bar-branch">{branchName}</span>
          </button>
          {isBranchPickerOpen && (
            <div className="mdbc-branch-popover" data-testid="branch-popover">
              <div className="mdbc-branch-tabs" role="tablist" aria-label="Git components">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === TOP_BAR_TABS.branches}
                  className={activeTab === TOP_BAR_TABS.branches ? "active" : undefined}
                  onClick={onClickBranchesTab}
                >
                  Branches
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === TOP_BAR_TABS.stash}
                  className={activeTab === TOP_BAR_TABS.stash ? "active" : undefined}
                  onClick={onClickStashTab}
                >
                  Stash
                </button>
              </div>
              <SearchInput
                value={branchFilter}
                onChange={onBranchFilterChange}
                placeholder={activeTab === TOP_BAR_TABS.branches ? "Select branch..." : "Search stash..."}
                ariaLabel={activeTab === TOP_BAR_TABS.branches ? "Select branch" : "Search stash"}
                autoFocus
              />
              {activeTab === TOP_BAR_TABS.branches ? (
                <div className="mdbc-branch-list" role="listbox" aria-label="Branches">
                  {filteredBranches.length === 0 ? (
                    <div className="mdbc-branch-empty">No matching branches</div>
                  ) : (
                    filteredBranches.map((branch) => {
                      const selected = branch.name === currentBranch;
                      const canDelete = !branch.isRemote && !selected;
                      return (
                        <div
                          className="mdbc-branch-row-wrap"
                          key={`${branch.isRemote ? "remote" : "local"}:${branch.name}`}
                        >
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`mdbc-branch-row${selected ? " selected" : ""}`}
                            onClick={() => onCheckoutBranch(branch.name)}
                            disabled={busyBranch !== null}
                          >
                            <span className="mdbc-branch-check">{selected ? "✓" : ""}</span>
                            <span className="mdbc-branch-icon">
                              <Icon name={branch.isRemote ? "download" : "gitBranch"} size={13} />
                            </span>
                            <span className="mdbc-branch-name">{branch.name}</span>
                            {busyBranch === branch.name && (
                              <span className="mdbc-branch-meta">Switching...</span>
                            )}
                          </button>
                          {canDelete && (
                            <IconButton
                              icon="trash"
                              label={`Delete branch ${branch.name}`}
                              title="Delete branch"
                              variant="default"
                              size={13}
                              className="mdbc-branch-remove"
                              onClick={() => onClickDeleteBranch(branch.name)}
                              disabled={busyBranch !== null}
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="mdbc-branch-empty">No stash entries</div>
              )}
              {error ? <div className="mdbc-branch-error">{error}</div> : null}
            </div>
          )}
        </div>
      </div>
      <div className="mdbc-topbar-right">
        <UpdateButton />
      </div>
    </div>
  );
}
