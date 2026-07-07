use std::path::PathBuf;
use std::sync::Arc;

use arris_engines::git::BranchInfo;
use arris_engines::{AppEnvironment, IpcError};
use tauri::State;

use crate::helpers::ipc_err;

#[tauri::command]
pub async fn cmd_git_clone(
    env: State<'_, Arc<AppEnvironment>>,
    url: String,
    dest: PathBuf,
) -> Result<String, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.clone_repo(&url, &dest))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_checkout(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    branch: String,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.checkout(&repo, &branch))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_delete_branch(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    branch: String,
    force: bool,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.delete_branch(&repo, &branch, force))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_remove_worktree(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    worktree_path: String,
    force: bool,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.remove_worktree(&repo, &worktree_path, force))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_worktree_list(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<Vec<arris_engines::git::WorktreeInfo>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.worktree_list(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_worktree_name(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<String, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.worktree_name(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_current_branch(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<Option<String>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.current_branch(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_file_statuses(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<Vec<arris_engines::git::FileStatus>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.file_statuses(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_file_diff_hunks(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    file_path: String,
) -> Result<Vec<arris_engines::git::DiffHunk>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.file_diff_hunks(&repo, &file_path))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_stage_hunk(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    file_path: String,
    hunk_index: usize,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.stage_hunk(&repo, &file_path, hunk_index))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_restore_change(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    file_path: String,
    line: u32,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.restore_change_block(&repo, &file_path, line))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_stage_files(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    paths: Vec<String>,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.stage_files(&repo, &paths))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_unstage_files(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    paths: Vec<String>,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.unstage_files(&repo, &paths))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_discard_files(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    paths: Vec<String>,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.discard_files(&repo, &paths))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_stage_all(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.stage_all(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_unstage_all(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.unstage_all(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_commit(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    message: String,
) -> Result<arris_engines::git::CommitInfo, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.commit(&repo, &message))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_push(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<String, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.push(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_push_state(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<arris_engines::git::PushState, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.push_state(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_last_commit(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<arris_engines::git::CommitInfo, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.last_commit(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_ahead_behind(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<(u32, u32), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.ahead_behind(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_file_diff_stats(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<Vec<(String, u32, u32)>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.file_diff_stats(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_list_branches(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<Vec<BranchInfo>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.list_branches(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_list_remotes(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<Vec<arris_engines::git::RemoteInfo>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.list_remotes(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_set_remote_url(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    name: String,
    url: String,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.set_remote_url(&repo, &name, &url))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_fetch(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<String, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.fetch(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_pull(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    mode: arris_engines::git::PullMode,
) -> Result<arris_engines::git::SyncResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.pull(&repo, mode))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_pull_from(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    remote: String,
    branch: String,
    mode: arris_engines::git::PullMode,
) -> Result<arris_engines::git::SyncResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.pull_from(&repo, &remote, &branch, mode))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_push_to(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    remote: String,
    branch: String,
) -> Result<String, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.push_to(&repo, &remote, &branch))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_force_push(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<String, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.force_push(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_merge_state(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<arris_engines::git::MergeState, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.merge_state(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_conflict_versions(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    file_path: String,
) -> Result<arris_engines::git::ConflictVersions, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.conflict_versions(&repo, &file_path))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_resolve_ours(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    file_path: String,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.resolve_ours(&repo, &file_path))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_resolve_theirs(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    file_path: String,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.resolve_theirs(&repo, &file_path))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_write_resolved(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    file_path: String,
    content: String,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.write_resolved(&repo, &file_path, &content))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_merge_continue(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.merge_continue(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_merge_abort(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.merge_abort(&repo))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_commit_graph(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    limit: usize,
) -> Result<Vec<arris_engines::git::CommitGraphRow>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.commit_graph(&repo, limit))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_search_commits(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    query: String,
    limit: usize,
) -> Result<Vec<arris_engines::git::CommitGraphRow>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.search_commits(&repo, &query, limit))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_commit_detail(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    commit: String,
) -> Result<arris_engines::git::CommitDetail, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.commit_detail(&repo, &commit))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_git_commit_diff(
    env: State<'_, Arc<AppEnvironment>>,
    repo: PathBuf,
    commit: String,
) -> Result<Vec<arris_engines::git::CommitFileDiff>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.git.commit_diff(&repo, &commit))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}
