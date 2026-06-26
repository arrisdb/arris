use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    #[serde(default)]
    pub is_remote: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub summary: String,
    pub author: String,
    pub timestamp: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub status: String,
    pub index_status: String,
    pub worktree_status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub is_main: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushState {
    pub has_remote: bool,
    pub has_upstream: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
}

/// How a pull integrates upstream changes into the current branch.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PullMode {
    Merge,
    Rebase,
}

/// Result of a fetch/pull. `conflicted` is non-empty when the operation
/// stopped on merge/rebase conflicts the user must resolve.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    /// Human-readable git stdout/stderr, surfaced in the UI.
    pub message: String,
    /// Absolute paths of files left in a conflicted state.
    pub conflicted: Vec<String>,
}

/// An in-progress merge or rebase that needs the user's attention. `kind` is
/// `"merge"`, `"rebase"`, or `"none"` when the tree is clean.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergeState {
    pub in_progress: bool,
    pub kind: String,
    pub conflicted: Vec<String>,
}

/// The three stages of a conflicted file for a 3-way merge editor, plus the
/// current working-tree text (with conflict markers) the user edits.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersions {
    /// Common ancestor (index stage 1). `None` for add/add conflicts.
    pub base: Option<String>,
    /// Our side (index stage 2 / HEAD).
    pub ours: String,
    /// Their side (index stage 3 / incoming).
    pub theirs: String,
    /// Current on-disk content, including `<<<<<<<` markers.
    pub merged: String,
}

/// A ref label attached to a commit (branch, remote branch, tag, or HEAD).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitRef {
    pub name: String,
    /// `"head"`, `"localBranch"`, `"remoteBranch"`, or `"tag"`.
    pub kind: String,
}

/// A single segment of the commit graph drawn within one row's vertical band.
/// `from_col` is the lane position at the top of the band, `to_col` at the
/// bottom. All bends happen at commit rows, so passing lanes are `from == to`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub from_col: u32,
    pub to_col: u32,
}

/// One row of the commit-history graph: the commit metadata plus its computed
/// lane column, the ref badges on it, and the edges to draw in its band.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitGraphRow {
    pub id: String,
    pub parents: Vec<String>,
    pub summary: String,
    pub author: String,
    pub timestamp: i64,
    pub refs: Vec<CommitRef>,
    /// Lane index of this commit's dot.
    pub column: u32,
    pub edges: Vec<GraphEdge>,
}

/// A single file touched by a commit, with its `--numstat` line counts. Binary
/// files report zero additions/deletions (numstat shows `-` for them).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileChange {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
}

/// Full metadata for one commit plus the list of files it changed and the
/// total line counts across them. Backs the commit-detail panel.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub id: String,
    pub summary: String,
    /// Commit message body (everything after the summary line); empty if none.
    pub body: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub additions: u32,
    pub deletions: u32,
    pub files: Vec<CommitFileChange>,
}

/// One changed file's diff within a commit: its path, line counts, and the
/// parsed hunks. Backs the per-commit diff view.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileDiff {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<DiffHunk>,
}
