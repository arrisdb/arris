use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use crate::Engine;
use super::*;

pub struct GitEngine;

impl GitEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn current_branch(&self, repo_path: &Path) -> Result<Option<String>, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if output.status.success() {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !name.is_empty() {
                return Ok(Some(name));
            }
        }

        let repo =
            gix::open(&root).map_err(|_| GitError::NotARepo(root.display().to_string()))?;
        Ok(repo
            .head_name()
            .map_err(|e| GitError::Gix(e.to_string()))?
            .map(|n| n.shorten().to_string()))
    }

    pub fn list_branches(&self, repo_path: &Path) -> Result<Vec<BranchInfo>, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let repo =
            gix::open(&root).map_err(|_| GitError::NotARepo(root.display().to_string()))?;
        let current = self.current_branch(&root).ok().flatten();
        let mut out = Vec::new();
        let refs = repo
            .references()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        let local = refs
            .local_branches()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        for r in local.flatten() {
            let full = r.name().shorten().to_string();
            out.push(BranchInfo {
                is_current: current.as_deref() == Some(full.as_str()),
                name: full,
                is_remote: false,
                upstream: None,
            });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    /// Returns local + remote branches in a single list. Remote branches are
    /// flagged with `is_remote = true` and have `name` of the form
    /// `origin/main`. Local branches without a tracking remote leave
    /// `upstream = None`; the upstream lookup is best-effort and silently skips
    /// errors so the call doesn't fail an entire repo just because one ref is
    /// dangling.
    pub fn list_all_branches(&self, repo_path: &Path) -> Result<Vec<BranchInfo>, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let repo =
            gix::open(&root).map_err(|_| GitError::NotARepo(root.display().to_string()))?;
        let current = self.current_branch(&root).ok().flatten();
        let mut out = Vec::new();
        let refs = repo
            .references()
            .map_err(|e| GitError::Gix(e.to_string()))?;

        if let Ok(local) = refs.local_branches() {
            for r in local.flatten() {
                let full = r.name().shorten().to_string();
                out.push(BranchInfo {
                    is_current: current.as_deref() == Some(full.as_str()),
                    name: full,
                    is_remote: false,
                    upstream: None,
                });
            }
        }
        if let Ok(remote) = refs.remote_branches() {
            for r in remote.flatten() {
                let full = r.name().shorten().to_string();
                out.push(BranchInfo {
                    is_current: false,
                    name: full,
                    is_remote: true,
                    upstream: None,
                });
            }
        }
        out.sort_by(|a, b| (a.is_remote, a.name.clone()).cmp(&(b.is_remote, b.name.clone())));
        Ok(out)
    }

    pub fn worktree_list(&self, repo_path: &Path) -> Result<Vec<WorktreeInfo>, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["worktree", "list", "--porcelain"])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            return Err(GitError::Gix("git worktree list failed".to_string()));
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut result = Vec::new();
        let mut path: Option<String> = None;
        let mut head = String::new();
        let mut branch: Option<String> = None;
        let mut is_first = true;
        for line in text.lines() {
            if line.starts_with("worktree ") {
                if let Some(p) = path.take() {
                    result.push(WorktreeInfo {
                        path: p,
                        branch: branch.take(),
                        head: std::mem::take(&mut head),
                        is_main: is_first,
                    });
                    is_first = false;
                }
                path = Some(line.strip_prefix("worktree ").unwrap().to_string());
            } else if line.starts_with("HEAD ") {
                head = line.strip_prefix("HEAD ").unwrap().to_string();
            } else if line.starts_with("branch ") {
                let full = line.strip_prefix("branch ").unwrap();
                branch = Some(
                    full.strip_prefix("refs/heads/")
                        .unwrap_or(full)
                        .to_string(),
                );
            }
        }
        if let Some(p) = path.take() {
            result.push(WorktreeInfo {
                path: p,
                branch: branch.take(),
                head,
                is_main: is_first,
            });
        }
        Ok(result)
    }

    pub fn worktree_name(&self, repo_path: &Path) -> Result<String, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["rev-parse", "--git-dir"])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            return Err(GitError::NotARepo(repo_path.display().to_string()));
        }
        let git_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if git_dir == ".git" {
            Ok("main worktree".to_string())
        } else {
            let basename = root
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "worktree".to_string());
            Ok(basename)
        }
    }

    pub fn file_statuses(&self, repo_path: &Path) -> Result<Vec<FileStatus>, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let scope = self.scoped_pathspec(&root, repo_path);
        let mut cmd = Command::new("git");
        cmd.args(["status", "--porcelain=v1"]).current_dir(&root);
        if let Some(pathspec) = &scope {
            cmd.arg("--").arg(pathspec);
        }
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            return Err(GitError::NotARepo(repo_path.display().to_string()));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut result = Vec::new();
        for line in stdout.lines() {
            if line.len() < 4 {
                continue;
            }
            let idx = line.as_bytes()[0];
            let wt = line.as_bytes()[1];
            let raw_path = &line[3..];
            let status = match (idx, wt) {
                (b'?', b'?') => "?",
                (b'A', _) | (_, b'A') => "A",
                (b'D', _) | (_, b'D') => "D",
                (b'R', _) => "R",
                _ => "M",
            };
            let rel_path = if status == "R" {
                raw_path
                    .split(" -> ")
                    .last()
                    .unwrap_or(raw_path)
                    .to_string()
            } else {
                raw_path.to_string()
            };
            let abs_path = root.join(&rel_path);
            result.push(FileStatus {
                path: abs_path.to_string_lossy().into_owned(),
                status: status.to_string(),
                index_status: String::from_utf8_lossy(&[idx]).to_string(),
                worktree_status: String::from_utf8_lossy(&[wt]).to_string(),
            });
        }
        Ok(result)
    }

    pub fn file_diff_hunks(
        &self,
        repo_path: &Path,
        file_path: &str,
    ) -> Result<Vec<DiffHunk>, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let abs = std::path::Path::new(file_path);
        let rel = abs.strip_prefix(&root).unwrap_or(abs);
        let output = Command::new("git")
            .args(["diff", "HEAD", "--", &rel.to_string_lossy()])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        Self::parse_diff_hunks(&stdout)
    }

    pub fn checkout(&self, repo_path: &Path, branch: &str) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["checkout", branch])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(GitError::Gix(format!("git checkout failed: {stderr}")));
        }
        Ok(())
    }

    /// Delete a local branch. With `force = false` runs `git branch -d`, which
    /// refuses branches not merged into their upstream/HEAD (squash-merged
    /// branches included); `force = true` runs `git branch -D`. Git itself
    /// refuses to delete the currently checked-out branch.
    pub fn delete_branch(
        &self,
        repo_path: &Path,
        branch: &str,
        force: bool,
    ) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let flag = if force { "-D" } else { "-d" };
        let output = Command::new("git")
            .args(["branch", flag, branch])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(GitError::Gix(format!("git branch {flag} failed: {stderr}")));
        }
        Ok(())
    }

    /// Remove a linked worktree at `worktree_path`. With `force = false` runs
    /// `git worktree remove`, which refuses a worktree with uncommitted or
    /// untracked changes; `force = true` adds `--force`. Git refuses to remove
    /// the main worktree.
    pub fn remove_worktree(
        &self,
        repo_path: &Path,
        worktree_path: &str,
        force: bool,
    ) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let mut cmd = Command::new("git");
        cmd.args(["worktree", "remove"]).current_dir(&root);
        if force {
            cmd.arg("--force");
        }
        cmd.arg(worktree_path);
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(GitError::Gix(format!(
                "git worktree remove failed: {stderr}"
            )));
        }
        Ok(())
    }

    pub fn clone_repo(&self, url: &str, dest: &Path) -> Result<String, GitError> {
        let output = Command::new("git")
            .args(["clone", url])
            .arg(dest)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(GitError::Gix(format!("git clone failed: {stderr}")));
        }
        let canonical = dest.canonicalize().unwrap_or_else(|_| dest.to_path_buf());
        Ok(canonical.to_string_lossy().into_owned())
    }

    pub fn stage_files(&self, repo_path: &Path, paths: &[String]) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let mut cmd = Command::new("git");
        cmd.arg("add").arg("--").current_dir(&root);
        for p in paths {
            let abs = std::path::Path::new(p);
            let rel = abs.strip_prefix(&root).unwrap_or(abs);
            cmd.arg(rel);
        }
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git add failed: {stderr}")));
        }
        Ok(())
    }

    pub fn unstage_files(&self, repo_path: &Path, paths: &[String]) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let mut cmd = Command::new("git");
        cmd.args(["reset", "HEAD", "--"]).current_dir(&root);
        for p in paths {
            let abs = std::path::Path::new(p);
            let rel = abs.strip_prefix(&root).unwrap_or(abs);
            cmd.arg(rel);
        }
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git reset failed: {stderr}")));
        }
        Ok(())
    }

    /// Discard all changes to the given tracked files, resetting both the index
    /// and the working tree to `HEAD` via `git checkout HEAD -- <paths>`.
    /// Untracked files have no `HEAD` version and are not handled here.
    pub fn discard_files(&self, repo_path: &Path, paths: &[String]) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let mut cmd = Command::new("git");
        cmd.args(["checkout", "HEAD", "--"]).current_dir(&root);
        for p in paths {
            let abs = std::path::Path::new(p);
            let rel = abs.strip_prefix(&root).unwrap_or(abs);
            cmd.arg(rel);
        }
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git checkout failed: {stderr}")));
        }
        Ok(())
    }

    pub fn stage_all(&self, repo_path: &Path) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let scope = self.scoped_pathspec(&root, repo_path);
        let mut cmd = Command::new("git");
        cmd.args(["add", "-A", "--"]).current_dir(&root);
        if let Some(pathspec) = &scope {
            cmd.arg(pathspec);
        }
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git add -A failed: {stderr}")));
        }
        Ok(())
    }

    pub fn unstage_all(&self, repo_path: &Path) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let scope = self.scoped_pathspec(&root, repo_path);
        let mut cmd = Command::new("git");
        cmd.args(["reset", "HEAD"]).current_dir(&root);
        if let Some(pathspec) = &scope {
            cmd.arg("--").arg(pathspec);
        }
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git reset failed: {stderr}")));
        }
        Ok(())
    }

    pub fn commit(&self, repo_path: &Path, message: &str) -> Result<CommitInfo, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["commit", "-m", message])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git commit failed: {stderr}")));
        }
        self.last_commit(repo_path)
    }

    pub fn push(&self, repo_path: &Path) -> Result<String, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let state = self.push_state(&root)?;
        if !state.has_remote {
            return Err(GitError::Gix("no remote configured".to_string()));
        }
        let mut cmd = Command::new("git");
        cmd.current_dir(&root);
        if state.has_upstream {
            cmd.arg("push");
        } else {
            // First push for a branch with no upstream: publish it and set the
            // upstream so future pushes can be a bare `git push`.
            let remote = self.default_remote(&root)?;
            let branch = self
                .current_branch(&root)?
                .ok_or_else(|| GitError::Gix("no current branch to push".to_string()))?;
            cmd.args(["push", "--set-upstream", &remote, &branch]);
        }
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git push failed: {stderr}")));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr_out = String::from_utf8_lossy(&output.stderr);
        Ok(format!("{stdout}{stderr_out}").trim().to_string())
    }

    /// Push the current branch to an explicit remote/branch, e.g.
    /// `git push <remote> <branch>`. Backs the "Push to" action when the user
    /// targets a ref other than the configured upstream.
    pub fn push_to(
        &self,
        repo_path: &Path,
        remote: &str,
        branch: &str,
    ) -> Result<String, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["push", remote, branch])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git push failed: {stderr}")));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr_out = String::from_utf8_lossy(&output.stderr);
        Ok(format!("{stdout}{stderr_out}").trim().to_string())
    }

    /// Force-push the current branch with `--force-with-lease`, which refuses
    /// to clobber remote commits the local ref has not seen. Requires an
    /// upstream to compare against.
    pub fn force_push(&self, repo_path: &Path) -> Result<String, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let state = self.push_state(&root)?;
        if !state.has_remote {
            return Err(GitError::Gix("no remote configured".to_string()));
        }
        if !state.has_upstream {
            return Err(GitError::Gix(
                "current branch has no upstream to force-push".to_string(),
            ));
        }
        let output = Command::new("git")
            .args(["push", "--force-with-lease"])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git force-push failed: {stderr}")));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr_out = String::from_utf8_lossy(&output.stderr);
        Ok(format!("{stdout}{stderr_out}").trim().to_string())
    }

    pub fn push_state(&self, repo_path: &Path) -> Result<PushState, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let remotes = Command::new("git")
            .arg("remote")
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        let has_remote = remotes.status.success()
            && !String::from_utf8_lossy(&remotes.stdout).trim().is_empty();
        let upstream = Command::new("git")
            .args([
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        let has_upstream = upstream.status.success();
        Ok(PushState {
            has_remote,
            has_upstream,
        })
    }

    /// List configured remotes with their push URLs. `git remote -v` reports a
    /// `(fetch)` and a `(push)` line per remote; we keep the push URL since that
    /// is the one a push uses (and the one a "repository moved" error refers to).
    pub fn list_remotes(&self, repo_path: &Path) -> Result<Vec<RemoteInfo>, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["remote", "-v"])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git remote -v failed: {stderr}")));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut remotes: Vec<RemoteInfo> = Vec::new();
        for line in stdout.lines() {
            // Format: "<name>\t<url> (fetch|push)".
            let Some((name, rest)) = line.split_once('\t') else {
                continue;
            };
            let url = rest.split_whitespace().next().unwrap_or("").to_string();
            let is_push = rest.ends_with("(push)");
            match remotes.iter_mut().find(|r| r.name == name) {
                Some(existing) if is_push => existing.url = url,
                Some(_) => {}
                None => remotes.push(RemoteInfo {
                    name: name.to_string(),
                    url,
                }),
            }
        }
        Ok(remotes)
    }

    pub fn set_remote_url(
        &self,
        repo_path: &Path,
        name: &str,
        url: &str,
    ) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["remote", "set-url", name, url])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git remote set-url failed: {stderr}")));
        }
        Ok(())
    }

    pub fn last_commit(&self, repo_path: &Path) -> Result<CommitInfo, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["log", "-1", "--format=%H%n%s%n%an%n%ct"])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            return Err(GitError::Gix("no commits yet".to_string()));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout.trim().lines().collect();
        if lines.len() < 4 {
            return Err(GitError::Gix("unexpected git log output".to_string()));
        }
        Ok(CommitInfo {
            id: lines[0].to_string(),
            summary: lines[1].to_string(),
            author: lines[2].to_string(),
            timestamp: lines[3].parse().unwrap_or(0),
        })
    }

    pub fn ahead_behind(&self, repo_path: &Path) -> Result<(u32, u32), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            return Ok((0, 0));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let parts: Vec<&str> = stdout.trim().split('\t').collect();
        if parts.len() == 2 {
            let ahead = parts[0].parse().unwrap_or(0);
            let behind = parts[1].parse().unwrap_or(0);
            Ok((ahead, behind))
        } else {
            Ok((0, 0))
        }
    }

    pub fn file_diff_stats(
        &self,
        repo_path: &Path,
    ) -> Result<Vec<(String, u32, u32)>, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let scope = self.scoped_pathspec(&root, repo_path);
        let mut cmd = Command::new("git");
        cmd.args(["diff", "HEAD", "--numstat"]).current_dir(&root);
        if let Some(pathspec) = &scope {
            cmd.arg("--").arg(pathspec);
        }
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut result = Vec::new();
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                let added: u32 = parts[0].parse().unwrap_or(0);
                let deleted: u32 = parts[1].parse().unwrap_or(0);
                let abs_path = root.join(parts[2]);
                result.push((abs_path.to_string_lossy().into_owned(), added, deleted));
            }
        }
        Ok(result)
    }

    /// Stage a single diff hunk of a file. `hunk_index` matches the order
    /// returned by [`file_diff_hunks`]. Reconstructs the unified-diff patch for
    /// just that hunk and applies it to the index via `git apply --cached`.
    pub fn stage_hunk(
        &self,
        repo_path: &Path,
        file_path: &str,
        hunk_index: usize,
    ) -> Result<(), GitError> {
        self.apply_hunk(repo_path, file_path, hunk_index, &["apply", "--cached"])
    }

    /// Discard every change block intersecting new-file lines
    /// `start_line..=end_line`, from both the worktree and any staged copy.
    pub fn restore_change_blocks(
        &self,
        repo_path: &Path,
        file_path: &str,
        start_line: u32,
        end_line: u32,
    ) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let abs = std::path::Path::new(file_path);
        let rel = abs.strip_prefix(&root).unwrap_or(abs);
        let rel_str = rel.to_string_lossy();
        let diff_text = Self::diff_output(&root, &["diff", "HEAD", "--", &rel_str])?;
        let no_block = || GitError::Gix(format!("no change block in lines {start_line}-{end_line}"));
        let (header, blocks) = Self::change_blocks(&diff_text).ok_or_else(no_block)?;
        let targets: Vec<&ChangeBlock> = blocks
            .iter()
            .filter(|b| Self::block_matches_new_range(b, start_line, end_line))
            .collect();
        if targets.is_empty() {
            return Err(no_block());
        }
        let hunks: String = targets.iter().map(|b| b.hunk.as_str()).collect();
        let patch = format!("{header}{hunks}");
        Self::apply_patch(&root, &patch, &["apply", "--reverse", "--unidiff-zero"])?;

        // A staged copy of a block would keep the file listed as changed
        // even though the worktree now matches HEAD; drop it from the index.
        let cached_text = Self::diff_output(&root, &["diff", "--cached", "--", &rel_str])?;
        if let Some((cached_header, cached_blocks)) = Self::change_blocks(&cached_text) {
            let hunks: String = cached_blocks
                .iter()
                .filter(|c| targets.iter().any(|t| Self::old_ranges_overlap(t, c)))
                .map(|c| c.hunk.as_str())
                .collect();
            if !hunks.is_empty() {
                let cached_patch = format!("{cached_header}{hunks}");
                Self::apply_patch(
                    &root,
                    &cached_patch,
                    &["apply", "--cached", "--reverse", "--unidiff-zero"],
                )?;
            }
        }
        Ok(())
    }

    /// Run a `git diff` variant and return its stdout.
    fn diff_output(root: &Path, args: &[&str]) -> Result<String, GitError> {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    /// Fetch all remotes, pruning deleted remote-tracking refs. Returns the
    /// combined git output. Does not touch the working tree.
    pub fn fetch(&self, repo_path: &Path) -> Result<String, GitError> {
        let root = self.git_toplevel(repo_path)?;
        if !self.push_state(&root)?.has_remote {
            return Err(GitError::Gix("no remote configured".to_string()));
        }
        let output = Command::new("git")
            .args(["fetch", "--all", "--prune"])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git fetch failed: {stderr}")));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = format!("{stdout}{stderr}").trim().to_string();
        Ok(if msg.is_empty() {
            "Already up to date.".to_string()
        } else {
            msg
        })
    }

    /// Pull the upstream branch into the current branch using the given mode
    /// (merge or rebase). A non-zero git exit with conflicts is not an error:
    /// the returned [`SyncResult`] carries the conflicted file list so the UI
    /// can open the conflict resolver. Any other failure is a hard error.
    pub fn pull(&self, repo_path: &Path, mode: PullMode) -> Result<SyncResult, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let state = self.push_state(&root)?;
        if !state.has_remote {
            return Err(GitError::Gix("no remote configured".to_string()));
        }
        if !state.has_upstream {
            return Err(GitError::Gix(
                "current branch has no upstream to pull from".to_string(),
            ));
        }
        let mut cmd = Command::new("git");
        cmd.arg("pull").current_dir(&root);
        match mode {
            PullMode::Merge => {
                // `--no-rebase` forces a merge even when branches diverged and
                // no `pull.rebase` is configured (git otherwise refuses).
                cmd.args(["--no-rebase", "--no-edit"]);
            }
            PullMode::Rebase => {
                cmd.arg("--rebase");
            }
        }
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = format!("{stdout}{stderr}").trim().to_string();
        let conflicted = self.conflicted_files(&root)?;
        if !output.status.success() && conflicted.is_empty() {
            // Failed for a reason other than conflicts (e.g. dirty tree).
            return Err(GitError::Gix(format!("git pull failed: {message}")));
        }
        Ok(SyncResult {
            message,
            conflicted,
        })
    }

    /// Pull an explicit remote/branch into the current branch (merge or
    /// rebase), e.g. `git pull <remote> <branch>`. Like [`Self::pull`],
    /// conflicts are surfaced in the returned [`SyncResult`] rather than
    /// treated as a hard error. Backs the "Pull From" action.
    pub fn pull_from(
        &self,
        repo_path: &Path,
        remote: &str,
        branch: &str,
        mode: PullMode,
    ) -> Result<SyncResult, GitError> {
        let root = self.git_toplevel(repo_path)?;
        if !self.push_state(&root)?.has_remote {
            return Err(GitError::Gix("no remote configured".to_string()));
        }
        let mut cmd = Command::new("git");
        cmd.arg("pull").current_dir(&root);
        match mode {
            PullMode::Merge => {
                cmd.args(["--no-rebase", "--no-edit"]);
            }
            PullMode::Rebase => {
                cmd.arg("--rebase");
            }
        }
        cmd.args([remote, branch]);
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = format!("{stdout}{stderr}").trim().to_string();
        let conflicted = self.conflicted_files(&root)?;
        if !output.status.success() && conflicted.is_empty() {
            return Err(GitError::Gix(format!("git pull failed: {message}")));
        }
        Ok(SyncResult {
            message,
            conflicted,
        })
    }

    /// Report whether a merge or rebase is in progress and which files are
    /// still conflicted. `kind` is `"merge"`, `"rebase"`, or `"none"`.
    pub fn merge_state(&self, repo_path: &Path) -> Result<MergeState, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let git_dir = self.git_dir(&root)?;
        let kind = if git_dir.join("rebase-merge").exists()
            || git_dir.join("rebase-apply").exists()
        {
            "rebase"
        } else if git_dir.join("MERGE_HEAD").exists() {
            "merge"
        } else {
            "none"
        };
        let conflicted = self.conflicted_files(&root)?;
        Ok(MergeState {
            in_progress: kind != "none",
            kind: kind.to_string(),
            conflicted,
        })
    }

    /// Absolute paths of files with unresolved conflicts (`git diff
    /// --name-only --diff-filter=U`).
    pub fn conflicted_files(&self, repo_path: &Path) -> Result<Vec<String>, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["diff", "--name-only", "--diff-filter=U"])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            return Ok(Vec::new());
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| root.join(l).to_string_lossy().into_owned())
            .collect())
    }

    /// Read the three merge stages of a conflicted file (base / ours / theirs)
    /// plus the current on-disk text with conflict markers, for a 3-way editor.
    pub fn conflict_versions(
        &self,
        repo_path: &Path,
        file_path: &str,
    ) -> Result<ConflictVersions, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let abs = std::path::Path::new(file_path);
        let rel = abs.strip_prefix(&root).unwrap_or(abs).to_string_lossy().into_owned();
        let stage = |n: u8| -> Option<String> {
            let out = Command::new("git")
                .arg("show")
                .arg(format!(":{n}:{rel}"))
                .current_dir(&root)
                .output()
                .ok()?;
            if out.status.success() {
                Some(String::from_utf8_lossy(&out.stdout).into_owned())
            } else {
                None
            }
        };
        let merged = std::fs::read_to_string(&root.join(&rel)).unwrap_or_default();
        Ok(ConflictVersions {
            base: stage(1),
            ours: stage(2).unwrap_or_default(),
            theirs: stage(3).unwrap_or_default(),
            merged,
        })
    }

    /// Resolve a conflicted file by taking our side entirely, then stage it.
    pub fn resolve_ours(&self, repo_path: &Path, file_path: &str) -> Result<(), GitError> {
        self.checkout_side(repo_path, file_path, "--ours")
    }

    /// Resolve a conflicted file by taking their side entirely, then stage it.
    pub fn resolve_theirs(&self, repo_path: &Path, file_path: &str) -> Result<(), GitError> {
        self.checkout_side(repo_path, file_path, "--theirs")
    }

    /// Write resolved `content` to a conflicted file and stage it, marking the
    /// conflict resolved.
    pub fn write_resolved(
        &self,
        repo_path: &Path,
        file_path: &str,
        content: &str,
    ) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let abs = std::path::Path::new(file_path);
        let rel = abs.strip_prefix(&root).unwrap_or(abs);
        std::fs::write(root.join(rel), content).map_err(|e| GitError::Gix(e.to_string()))?;
        self.stage_files(&root, &[file_path.to_string()])
    }

    /// Finish an in-progress merge or rebase once all conflicts are resolved.
    /// For a merge, commits with the default merge message; for a rebase,
    /// continues to the next patch.
    pub fn merge_continue(&self, repo_path: &Path) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let state = self.merge_state(&root)?;
        if !state.conflicted.is_empty() {
            return Err(GitError::Gix(
                "cannot continue: conflicts remain unresolved".to_string(),
            ));
        }
        let (cmd_args, env_skip): (&[&str], bool) = match state.kind.as_str() {
            "rebase" => (&["rebase", "--continue"], true),
            "merge" => (&["commit", "--no-edit"], false),
            _ => return Err(GitError::Gix("no merge or rebase in progress".to_string())),
        };
        let mut cmd = Command::new("git");
        cmd.args(cmd_args).current_dir(&root);
        if env_skip {
            // Don't drop into an editor for the rebase continue message.
            cmd.env("GIT_EDITOR", "true");
        }
        let output = cmd.output().map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git continue failed: {stderr}")));
        }
        Ok(())
    }

    /// Abort an in-progress merge or rebase, restoring the pre-pull state.
    pub fn merge_abort(&self, repo_path: &Path) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let state = self.merge_state(&root)?;
        let args: &[&str] = match state.kind.as_str() {
            "rebase" => &["rebase", "--abort"],
            "merge" => &["merge", "--abort"],
            _ => return Err(GitError::Gix("no merge or rebase in progress".to_string())),
        };
        let output = Command::new("git")
            .args(args)
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git abort failed: {stderr}")));
        }
        Ok(())
    }

    /// Build the commit-history graph across all refs, newest first, capped at
    /// `limit` commits. Each row carries its lane column, ref badges, and the
    /// edges to render in its band (see [`Self::layout_lanes`]).
    pub fn commit_graph(
        &self,
        repo_path: &Path,
        limit: usize,
    ) -> Result<Vec<CommitGraphRow>, GitError> {
        let root = self.git_toplevel(repo_path)?;
        // \x1f (unit separator) delimits fields; %D lists ref names on the commit.
        let output = Command::new("git")
            .args([
                "log",
                "--all",
                "--date-order",
                &format!("-n{limit}"),
                "--pretty=format:%H\x1f%P\x1f%s\x1f%an\x1f%ct\x1f%D",
            ])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            // No commits yet -> empty graph rather than an error.
            return Ok(Vec::new());
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(Self::layout_lanes(&stdout))
    }

    /// Search the entire commit history (all refs) for `query`, matched
    /// case-insensitively against the commit hash, summary, author, and ref
    /// names. Returns up to `limit` matching rows. Unlike `commit_graph`, which
    /// only sees a loaded page, this scans the full `--all` log so a match in an
    /// old commit is still found. An empty query returns no rows.
    pub fn search_commits(
        &self,
        repo_path: &Path,
        query: &str,
        limit: usize,
    ) -> Result<Vec<CommitGraphRow>, GitError> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Ok(Vec::new());
        }
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args([
                "log",
                "--all",
                "--date-order",
                "--pretty=format:%H\x1f%P\x1f%s\x1f%an\x1f%ct\x1f%D",
            ])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            return Ok(Vec::new());
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let matched = stdout
            .lines()
            .filter(|line| Self::commit_line_matches(line, &needle))
            .take(limit)
            .collect::<Vec<_>>()
            .join("\n");
        Ok(Self::layout_lanes(&matched))
    }

    /// Metadata for a single commit plus the files it changed and their line
    /// counts. Backs the commit-detail panel. `--no-renames` keeps file paths
    /// stable (a rename shows as a delete + add) so the numstat paths match the
    /// per-file diffs from [`Self::commit_diff`].
    pub fn commit_detail(
        &self,
        repo_path: &Path,
        commit: &str,
    ) -> Result<CommitDetail, GitError> {
        let root = self.git_toplevel(repo_path)?;
        // \x1f (unit separator) delimits fields; %b (body) is last so it may
        // contain its own newlines without breaking the split.
        let meta = Command::new("git")
            .args([
                "show",
                "-s",
                "--format=%H\x1f%an\x1f%ae\x1f%ct\x1f%s\x1f%b",
                commit,
            ])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !meta.status.success() {
            let stderr = String::from_utf8_lossy(&meta.stderr).trim().to_string();
            return Err(GitError::Gix(format!("git show failed: {stderr}")));
        }
        let meta_str = String::from_utf8_lossy(&meta.stdout);
        let base = Self::parse_commit_meta(&meta_str)
            .ok_or_else(|| GitError::Gix("unexpected git show output".to_string()))?;

        let stat = Command::new("git")
            .args(["show", "--no-renames", "--numstat", "--format=", commit])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        let stat_str = String::from_utf8_lossy(&stat.stdout);
        let files = Self::parse_numstat(&stat_str);
        let additions = files.iter().map(|f| f.additions).sum();
        let deletions = files.iter().map(|f| f.deletions).sum();
        Ok(CommitDetail {
            additions,
            deletions,
            files,
            ..base
        })
    }

    /// Per-file diffs for a single commit (one entry per changed file, each with
    /// its parsed hunks). Backs the per-commit diff view. Uses `git show` so the
    /// first commit (no parent) still diffs against the empty tree.
    pub fn commit_diff(
        &self,
        repo_path: &Path,
        commit: &str,
    ) -> Result<Vec<CommitFileDiff>, GitError> {
        let root = self.git_toplevel(repo_path)?;
        let output = Command::new("git")
            .args(["show", "--no-renames", "--no-color", "--format=", commit])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(GitError::Gix(format!("git show failed: {stderr}")));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        Self::parse_commit_diff(&stdout)
    }

}

impl GitEngine {
    /// True if a raw `git log` line matches `needle` (already lowercased) on the
    /// commit hash, summary, author, or any ref name. Mirrors the frontend's
    /// former client-side filter so search results stay consistent.
    fn commit_line_matches(line: &str, needle: &str) -> bool {
        let mut fields = line.split('\u{1f}');
        let id = fields.next().unwrap_or("");
        let _parents = fields.next().unwrap_or("");
        let summary = fields.next().unwrap_or("");
        let author = fields.next().unwrap_or("");
        let _timestamp = fields.next().unwrap_or("");
        let refs = fields.next().unwrap_or("");
        id.to_lowercase().contains(needle)
            || summary.to_lowercase().contains(needle)
            || author.to_lowercase().contains(needle)
            || refs.to_lowercase().contains(needle)
    }

    fn git_toplevel(&self, path: &Path) -> Result<std::path::PathBuf, GitError> {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        if !canonical.exists() {
            return Err(GitError::NotARepo(path.display().to_string()));
        }
        let output = Command::new("git")
            .args(["rev-parse", "--show-toplevel"])
            .current_dir(&canonical)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            return Err(GitError::NotARepo(path.display().to_string()));
        }
        let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let root_path = std::path::PathBuf::from(root);
        Ok(root_path.canonicalize().unwrap_or(root_path))
    }

    fn default_remote(&self, root: &Path) -> Result<String, GitError> {
        let output = Command::new("git")
            .arg("remote")
            .current_dir(root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let remotes: Vec<&str> = stdout
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect();
        if remotes.contains(&"origin") {
            Ok("origin".to_string())
        } else if let Some(first) = remotes.first() {
            Ok((*first).to_string())
        } else {
            Err(GitError::Gix("no remote configured".to_string()))
        }
    }

    fn scoped_pathspec(
        &self,
        root: &Path,
        repo_path: &Path,
    ) -> Option<std::path::PathBuf> {
        let scope = repo_path
            .canonicalize()
            .unwrap_or_else(|_| repo_path.to_path_buf());
        let rel = scope.strip_prefix(root).ok()?;
        if rel.as_os_str().is_empty() {
            None
        } else {
            Some(rel.to_path_buf())
        }
    }

    fn parse_diff_hunks(diff_text: &str) -> Result<Vec<DiffHunk>, GitError> {
        let mut hunks = Vec::new();
        let mut current: Option<DiffHunk> = None;

        for line in diff_text.lines() {
            if let Some(rest) = line.strip_prefix("@@ ") {
                if let Some(h) = current.take() {
                    hunks.push(h);
                }
                if let Some(hunk) = Self::parse_hunk_header(rest) {
                    current = Some(hunk);
                }
            } else if let Some(ref mut hunk) = current {
                if let Some(text) = line.strip_prefix('+') {
                    hunk.lines.push(DiffLine {
                        kind: "add".into(),
                        text: text.into(),
                    });
                } else if let Some(text) = line.strip_prefix('-') {
                    hunk.lines.push(DiffLine {
                        kind: "del".into(),
                        text: text.into(),
                    });
                } else if let Some(text) = line.strip_prefix(' ') {
                    hunk.lines.push(DiffLine {
                        kind: "ctx".into(),
                        text: text.into(),
                    });
                }
            }
        }
        if let Some(h) = current {
            hunks.push(h);
        }
        Ok(hunks)
    }

    fn parse_hunk_header(rest: &str) -> Option<DiffHunk> {
        let end = rest.find(" @@")?;
        let parts = &rest[..end];
        let mut iter = parts.split_whitespace();
        let old = iter.next()?.strip_prefix('-')?;
        let new_part = iter.next()?.strip_prefix('+')?;
        let (old_start, old_count) = Self::parse_range(old);
        let (new_start, new_count) = Self::parse_range(new_part);
        Some(DiffHunk {
            old_start,
            old_count,
            new_start,
            new_count,
            lines: Vec::new(),
        })
    }

    fn parse_range(s: &str) -> (u32, u32) {
        if let Some((start, count)) = s.split_once(',') {
            (start.parse().unwrap_or(0), count.parse().unwrap_or(0))
        } else {
            (s.parse().unwrap_or(0), 1)
        }
    }

    /// Parse the `\x1f`-delimited `git show -s` metadata line into a
    /// `CommitDetail` with empty file/count fields (filled in by the caller).
    fn parse_commit_meta(meta: &str) -> Option<CommitDetail> {
        let mut fields = meta.splitn(6, '\u{1f}');
        let id = fields.next()?.trim().to_string();
        let author = fields.next()?.to_string();
        let email = fields.next()?.to_string();
        let timestamp = fields.next()?.trim().parse().unwrap_or(0);
        let summary = fields.next()?.to_string();
        let body = fields.next().unwrap_or("").trim_end().to_string();
        if id.is_empty() {
            return None;
        }
        Some(CommitDetail {
            id,
            summary,
            body,
            author,
            email,
            timestamp,
            additions: 0,
            deletions: 0,
            files: Vec::new(),
        })
    }

    /// Parse `git show --numstat` output (`additions\tdeletions\tpath` per line)
    /// into per-file change records. Binary files (counts shown as `-`) report
    /// zero on both sides.
    fn parse_numstat(text: &str) -> Vec<CommitFileChange> {
        text.lines()
            .filter_map(|line| {
                let mut cols = line.split('\t');
                let additions = cols.next()?;
                let deletions = cols.next()?;
                let path = cols.next()?;
                if path.is_empty() {
                    return None;
                }
                Some(CommitFileChange {
                    path: path.to_string(),
                    additions: additions.parse().unwrap_or(0),
                    deletions: deletions.parse().unwrap_or(0),
                })
            })
            .collect()
    }

    /// Split a multi-file `git show` patch into per-file diffs, parsing each
    /// file's hunks and counting its added/removed lines.
    fn parse_commit_diff(diff_text: &str) -> Result<Vec<CommitFileDiff>, GitError> {
        let mut files = Vec::new();
        let mut path: Option<String> = None;
        let mut buf = String::new();
        for line in diff_text.lines() {
            if line.starts_with("diff --git ") {
                if let Some(p) = path.take() {
                    files.push(Self::build_file_diff(p, &buf)?);
                }
                buf.clear();
                path = Some(Self::path_from_diff_header(line));
            } else if path.is_some() {
                buf.push_str(line);
                buf.push('\n');
            }
        }
        if let Some(p) = path.take() {
            files.push(Self::build_file_diff(p, &buf)?);
        }
        Ok(files)
    }

    /// Extract the new file path from a `diff --git a/<old> b/<new>` header.
    fn path_from_diff_header(line: &str) -> String {
        if let Some(idx) = line.rfind(" b/") {
            return line[idx + 3..].to_string();
        }
        line.trim_start_matches("diff --git ").to_string()
    }

    /// Build one `CommitFileDiff` from a single file's patch body, summing its
    /// add/del line counts from the parsed hunks.
    fn build_file_diff(path: String, body: &str) -> Result<CommitFileDiff, GitError> {
        let hunks = Self::parse_diff_hunks(body)?;
        let mut additions = 0;
        let mut deletions = 0;
        for hunk in &hunks {
            for line in &hunk.lines {
                match line.kind.as_str() {
                    "add" => additions += 1,
                    "del" => deletions += 1,
                    _ => {}
                }
            }
        }
        Ok(CommitFileDiff {
            path,
            additions,
            deletions,
            hunks,
        })
    }

    fn apply_hunk(
        &self,
        repo_path: &Path,
        file_path: &str,
        hunk_index: usize,
        git_args: &[&str],
    ) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let abs = std::path::Path::new(file_path);
        let rel = abs.strip_prefix(&root).unwrap_or(abs);
        let output = Command::new("git")
            .args(["diff", "HEAD", "--", &rel.to_string_lossy()])
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        let diff_text = String::from_utf8_lossy(&output.stdout);
        let patch = Self::single_hunk_patch(&diff_text, hunk_index)
            .ok_or_else(|| GitError::Gix(format!("diff hunk {hunk_index} not found")))?;
        Self::apply_patch(&root, &patch, git_args)
    }

    /// Pipe a patch into `git <git_args>` (an apply variant) run at `root`.
    fn apply_patch(root: &Path, patch: &str, git_args: &[&str]) -> Result<(), GitError> {
        let mut child = Command::new("git")
            .args(git_args)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| GitError::Gix("failed to open git apply stdin".to_string()))?;
            stdin
                .write_all(patch.as_bytes())
                .map_err(|e| GitError::Gix(e.to_string()))?;
        }
        let out = child
            .wait_with_output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(GitError::Gix(format!("git apply failed: {stderr}")));
        }
        Ok(())
    }

    /// Reconstruct a standalone unified-diff patch containing only the hunk at
    /// `hunk_index`, preserving the file header so `git apply` can locate it.
    /// Returns `None` if the diff has no header or the index is out of range.
    fn single_hunk_patch(diff_text: &str, hunk_index: usize) -> Option<String> {
        let mut header = String::new();
        let mut hunks: Vec<String> = Vec::new();
        let mut current: Option<String> = None;

        for line in diff_text.lines() {
            if line.starts_with("@@ ") {
                if let Some(h) = current.take() {
                    hunks.push(h);
                }
                let mut hunk = String::new();
                hunk.push_str(line);
                hunk.push('\n');
                current = Some(hunk);
            } else if let Some(ref mut h) = current {
                h.push_str(line);
                h.push('\n');
            } else {
                header.push_str(line);
                header.push('\n');
            }
        }
        if let Some(h) = current.take() {
            hunks.push(h);
        }

        if header.is_empty() {
            return None;
        }
        let hunk = hunks.get(hunk_index)?;
        Some(format!("{header}{hunk}"))
    }

    /// Split a unified diff into its file header and zero-context change
    /// blocks (one per contiguous `-`/`+` run). `None` when the diff is empty.
    fn change_blocks(diff_text: &str) -> Option<(String, Vec<ChangeBlock>)> {
        let mut header = String::new();
        for l in diff_text.lines() {
            if l.starts_with("@@ ") {
                break;
            }
            header.push_str(l);
            header.push('\n');
        }
        if header.is_empty() {
            return None;
        }

        let hunks = Self::parse_diff_hunks(diff_text).ok()?;
        let mut blocks: Vec<ChangeBlock> = Vec::new();
        for hunk in &hunks {
            // Zero-count ranges name the line BEFORE the change; walking
            // counters must start on the first real line either side.
            let mut old_line = if hunk.old_count == 0 { hunk.old_start + 1 } else { hunk.old_start };
            let mut new_line = if hunk.new_count == 0 { hunk.new_start + 1 } else { hunk.new_start };
            let mut dels: Vec<&str> = Vec::new();
            let mut adds: Vec<&str> = Vec::new();
            let mut block_old_start = old_line;
            let mut block_new_start = new_line;

            let flush = |dels: &mut Vec<&str>,
                             adds: &mut Vec<&str>,
                             block_old_start: u32,
                             block_new_start: u32,
                             at_eof: bool,
                             blocks: &mut Vec<ChangeBlock>| {
                if dels.is_empty() && adds.is_empty() {
                    return;
                }
                let (old_start, old_count) = if dels.is_empty() {
                    (block_old_start.saturating_sub(1), 0)
                } else {
                    (block_old_start, dels.len() as u32)
                };
                let (new_start, new_count) = if adds.is_empty() {
                    (block_new_start.saturating_sub(1), 0)
                } else {
                    (block_new_start, adds.len() as u32)
                };
                let mut body = String::new();
                for d in dels.iter() {
                    body.push('-');
                    body.push_str(d);
                    body.push('\n');
                }
                for a in adds.iter() {
                    body.push('+');
                    body.push_str(a);
                    body.push('\n');
                }
                blocks.push(ChangeBlock {
                    old_start,
                    old_count,
                    new_start,
                    new_count,
                    at_eof,
                    hunk: format!("@@ -{old_start},{old_count} +{new_start},{new_count} @@\n{body}"),
                });
                dels.clear();
                adds.clear();
            };

            for diff_line in &hunk.lines {
                match diff_line.kind.as_str() {
                    "ctx" => {
                        flush(&mut dels, &mut adds, block_old_start, block_new_start, false, &mut blocks);
                        old_line += 1;
                        new_line += 1;
                        block_old_start = old_line;
                        block_new_start = new_line;
                    }
                    "del" => {
                        if dels.is_empty() && adds.is_empty() {
                            block_old_start = old_line;
                            block_new_start = new_line;
                        }
                        dels.push(&diff_line.text);
                        old_line += 1;
                    }
                    "add" => {
                        if dels.is_empty() && adds.is_empty() {
                            block_old_start = old_line;
                        }
                        if adds.is_empty() {
                            block_new_start = new_line;
                        }
                        adds.push(&diff_line.text);
                        new_line += 1;
                    }
                    _ => {}
                }
            }
            flush(&mut dels, &mut adds, block_old_start, block_new_start, true, &mut blocks);
        }
        Some((header, blocks))
    }

    /// Whether the block intersects new-file lines `start..=end`. A deletion-
    /// only block matches the row it sits above (EOF clamps to the last line).
    fn block_matches_new_range(block: &ChangeBlock, start: u32, end: u32) -> bool {
        if block.new_count == 0 {
            let anchor = block.new_start + 1;
            (anchor >= start && anchor <= end)
                || (block.at_eof && block.new_start >= start && block.new_start <= end)
        } else {
            block.new_start <= end && start < block.new_start + block.new_count
        }
    }

    /// Same-HEAD-span test in doubled coords (line n = 2n, gap after n = 2n+1);
    /// one slack unit joins an insertion gap to an adjacent changed line.
    fn old_ranges_overlap(a: &ChangeBlock, b: &ChangeBlock) -> bool {
        let span = |start: u32, count: u32| -> (u64, u64) {
            if count == 0 {
                let gap = 2 * u64::from(start) + 1;
                (gap, gap)
            } else {
                (2 * u64::from(start), 2 * u64::from(start + count - 1))
            }
        };
        let (a_lo, a_hi) = span(a.old_start, a.old_count);
        let (b_lo, b_hi) = span(b.old_start, b.old_count);
        a_lo.max(b_lo) <= a_hi.min(b_hi) + 1
    }

    /// Absolute path of the repo's git directory (`git rev-parse --git-dir`),
    /// resolved against the worktree root so relative results are usable.
    fn git_dir(&self, root: &Path) -> Result<std::path::PathBuf, GitError> {
        let output = Command::new("git")
            .args(["rev-parse", "--absolute-git-dir"])
            .current_dir(root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            return Err(GitError::NotARepo(root.display().to_string()));
        }
        let dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(std::path::PathBuf::from(dir))
    }

    /// Resolve a conflicted file to one side (`--ours` / `--theirs`) and stage
    /// it, marking the conflict resolved.
    fn checkout_side(
        &self,
        repo_path: &Path,
        file_path: &str,
        side: &str,
    ) -> Result<(), GitError> {
        let root = self.git_toplevel(repo_path)?;
        let abs = std::path::Path::new(file_path);
        let rel = abs.strip_prefix(&root).unwrap_or(abs);
        let output = Command::new("git")
            .args(["checkout", side, "--"])
            .arg(rel)
            .current_dir(&root)
            .output()
            .map_err(|e| GitError::Gix(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitError::Gix(format!("git checkout {side} failed: {stderr}")));
        }
        self.stage_files(&root, &[file_path.to_string()])
    }

    /// Assign each commit a lane column and the edges to draw in its band from
    /// `git log` output. The model is gitk-style: lanes are vertical lines that
    /// only bend at commit rows, so every [`GraphEdge`] is contained in one
    /// row's band (top `from_col` -> bottom `to_col`); passing lanes keep their
    /// column. `lines` is the `%H\x1f%P\x1f%s\x1f%an\x1f%ct\x1f%D` stream.
    fn layout_lanes(lines: &str) -> Vec<CommitGraphRow> {
        let mut rows: Vec<CommitGraphRow> = Vec::new();
        // `lanes[i]` is the commit id lane `i` is currently waiting to reach.
        let mut lanes: Vec<Option<String>> = Vec::new();

        for line in lines.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let mut fields = line.split('\u{1f}');
            let id = fields.next().unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }
            let parents: Vec<String> = fields
                .next()
                .unwrap_or("")
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            let summary = fields.next().unwrap_or("").to_string();
            let author = fields.next().unwrap_or("").to_string();
            let timestamp = fields.next().unwrap_or("").trim().parse().unwrap_or(0);
            let refs = Self::parse_refs(fields.next().unwrap_or(""));

            // Lane this commit's dot occupies: the first lane waiting for it,
            // otherwise a fresh lane (a branch tip).
            let node_column = match lanes.iter().position(|l| l.as_deref() == Some(&id)) {
                Some(i) => i,
                None => {
                    let slot = lanes.iter().position(|l| l.is_none());
                    match slot {
                        Some(i) => i,
                        None => {
                            lanes.push(None);
                            lanes.len() - 1
                        }
                    }
                }
            };

            let mut edges: Vec<GraphEdge> = Vec::new();
            // Other lanes also waiting for this commit merge into the node.
            for (i, lane) in lanes.iter_mut().enumerate() {
                if i == node_column {
                    continue;
                }
                match lane {
                    Some(waiting) if waiting == &id => {
                        edges.push(GraphEdge {
                            from_col: i as u32,
                            to_col: node_column as u32,
                        });
                        *lane = None;
                    }
                    Some(_) => edges.push(GraphEdge {
                        from_col: i as u32,
                        to_col: i as u32,
                    }),
                    None => {}
                }
            }

            // Emit the node's parent lines and update outgoing lane state.
            if let Some(first) = parents.first() {
                lanes[node_column] = Some(first.clone());
                edges.push(GraphEdge {
                    from_col: node_column as u32,
                    to_col: node_column as u32,
                });
                for parent in &parents[1..] {
                    let pcol = match lanes.iter().position(|l| l.as_deref() == Some(parent)) {
                        Some(i) => i,
                        None => match lanes.iter().position(|l| l.is_none()) {
                            Some(i) => {
                                lanes[i] = Some(parent.clone());
                                i
                            }
                            None => {
                                lanes.push(Some(parent.clone()));
                                lanes.len() - 1
                            }
                        },
                    };
                    if lanes[pcol].is_none() {
                        lanes[pcol] = Some(parent.clone());
                    }
                    edges.push(GraphEdge {
                        from_col: node_column as u32,
                        to_col: pcol as u32,
                    });
                }
            } else {
                // Root commit: its lane ends here.
                lanes[node_column] = None;
            }

            // Drop trailing empty lanes so width stays compact.
            while matches!(lanes.last(), Some(None)) {
                lanes.pop();
            }

            rows.push(CommitGraphRow {
                id,
                parents,
                summary,
                author,
                timestamp,
                refs,
                column: node_column as u32,
                edges,
            });
        }
        rows
    }

    /// Parse a `%D` ref list (e.g. `HEAD -> main, origin/main, tag: v1`) into
    /// classified [`CommitRef`] badges.
    fn parse_refs(decoration: &str) -> Vec<CommitRef> {
        let mut out = Vec::new();
        for raw in decoration.split(',') {
            let part = raw.trim();
            if part.is_empty() {
                continue;
            }
            if let Some(branch) = part.strip_prefix("HEAD -> ") {
                out.push(CommitRef {
                    name: "HEAD".to_string(),
                    kind: "head".to_string(),
                });
                out.push(CommitRef {
                    name: branch.to_string(),
                    kind: "localBranch".to_string(),
                });
            } else if part == "HEAD" {
                out.push(CommitRef {
                    name: "HEAD".to_string(),
                    kind: "head".to_string(),
                });
            } else if let Some(tag) = part.strip_prefix("tag: ") {
                out.push(CommitRef {
                    name: tag.to_string(),
                    kind: "tag".to_string(),
                });
            } else if part.contains('/') {
                out.push(CommitRef {
                    name: part.to_string(),
                    kind: "remoteBranch".to_string(),
                });
            } else {
                out.push(CommitRef {
                    name: part.to_string(),
                    kind: "localBranch".to_string(),
                });
            }
        }
        out
    }
}

impl Engine for GitEngine {
    fn name(&self) -> &str {
        "git"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn rejects_non_repo_directory() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        let err = engine.current_branch(tmp.path()).unwrap_err();
        assert!(matches!(err, GitError::NotARepo(_)));
    }

    #[test]
    fn returns_current_branch_for_init_repo() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        // Use system git to create a quick repo so test stays simple.
        let ok = Command::new("git")
            .args(["init", "-b", "trunk"])
            .current_dir(tmp.path())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            eprintln!("skipping: system git unavailable");
            return;
        }
        assert_eq!(
            engine.current_branch(tmp.path()).unwrap(),
            Some("trunk".to_string())
        );
    }

    #[test]
    fn list_all_branches_runs_without_error_on_empty_repo() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        let ok = Command::new("git")
            .args(["init", "-b", "trunk"])
            .current_dir(tmp.path())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            eprintln!("skipping: system git unavailable");
            return;
        }
        let all = engine.list_all_branches(tmp.path()).unwrap();
        // Empty repo: no commits -> no branch refs. Should not error.
        assert!(all.iter().all(|b| !b.name.is_empty()));
    }

    #[test]
    fn branch_queries_work_from_nested_project_folder() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::create_dir_all(tmp.path().join("nested/project")).unwrap();
        std::fs::write(tmp.path().join("nested/project/a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();

        let nested = tmp.path().join("nested/project");
        assert_eq!(
            engine.current_branch(&nested).unwrap(),
            Some("main".to_string())
        );
        let branches = engine.list_all_branches(&nested).unwrap();
        assert!(branches.iter().any(|b| b.name == "main" && b.is_current));
    }

    #[test]
    fn file_statuses_returns_modified_and_untracked() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        let ok = Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(tmp.path())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            eprintln!("skipping: system git unavailable");
            return;
        }
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(tmp.path())
            .status()
            .ok();
        std::fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "a.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();
        // Modify tracked file
        std::fs::write(tmp.path().join("a.txt"), "changed").unwrap();
        // Create untracked file
        std::fs::write(tmp.path().join("b.txt"), "new").unwrap();
        let statuses = engine.file_statuses(tmp.path()).unwrap();
        let canon = tmp.path().canonicalize().unwrap();
        let a_abs = canon.join("a.txt").to_string_lossy().to_string();
        let b_abs = canon.join("b.txt").to_string_lossy().to_string();
        assert!(statuses.iter().any(|s| s.path == a_abs && s.status == "M"));
        assert!(statuses.iter().any(|s| s.path == b_abs && s.status == "?"));
    }

    #[test]
    fn file_diff_hunks_returns_changes() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        let ok = Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(tmp.path())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            eprintln!("skipping: system git unavailable");
            return;
        }
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(tmp.path())
            .status()
            .ok();
        std::fs::write(tmp.path().join("f.txt"), "line1\nline2\n").unwrap();
        Command::new("git")
            .args(["add", "f.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();
        std::fs::write(tmp.path().join("f.txt"), "line1\nchanged\nline3\n").unwrap();
        let hunks = engine.file_diff_hunks(tmp.path(), "f.txt").unwrap();
        assert!(!hunks.is_empty());
        assert!(hunks[0].lines.iter().any(|l| l.kind == "add"));
    }

    #[test]
    fn parse_diff_hunks_parses_unified_diff() {
        let diff = "\
diff --git a/f.txt b/f.txt
index abc..def 100644
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,4 @@
 line1
-old
+new
+extra
 line3
";
        let hunks = GitEngine::parse_diff_hunks(diff).unwrap();
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].old_count, 3);
        assert_eq!(hunks[0].new_start, 1);
        assert_eq!(hunks[0].new_count, 4);
        assert_eq!(hunks[0].lines.len(), 5);
        assert_eq!(hunks[0].lines[0].kind, "ctx");
        assert_eq!(hunks[0].lines[1].kind, "del");
        assert_eq!(hunks[0].lines[2].kind, "add");
        assert_eq!(hunks[0].lines[3].kind, "add");
        assert_eq!(hunks[0].lines[4].kind, "ctx");
    }

    #[test]
    fn parse_numstat_parses_counts_and_skips_binary() {
        let stat = "12\t3\tsrc/main.rs\n0\t5\tREADME.md\n-\t-\tlogo.png\n";
        let files = GitEngine::parse_numstat(stat);
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].path, "src/main.rs");
        assert_eq!((files[0].additions, files[0].deletions), (12, 3));
        assert_eq!(files[1].path, "README.md");
        assert_eq!((files[1].additions, files[1].deletions), (0, 5));
        // Binary file: counts shown as "-" parse to zero.
        assert_eq!(files[2].path, "logo.png");
        assert_eq!((files[2].additions, files[2].deletions), (0, 0));
    }

    #[test]
    fn parse_commit_meta_splits_metadata_and_body() {
        let meta = "abc123\u{1f}Jane Doe\u{1f}jane@example.com\u{1f}1700000000\u{1f}Add feature\u{1f}Body line 1\nBody line 2\n";
        let detail = GitEngine::parse_commit_meta(meta).unwrap();
        assert_eq!(detail.id, "abc123");
        assert_eq!(detail.author, "Jane Doe");
        assert_eq!(detail.email, "jane@example.com");
        assert_eq!(detail.timestamp, 1700000000);
        assert_eq!(detail.summary, "Add feature");
        assert_eq!(detail.body, "Body line 1\nBody line 2");
    }

    #[test]
    fn parse_commit_diff_splits_files_and_counts_lines() {
        let diff = "\
diff --git a/a.txt b/a.txt
index 111..222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
 keep
-old
+new
+extra
diff --git a/b.txt b/b.txt
new file mode 100644
index 000..333
--- /dev/null
+++ b/b.txt
@@ -0,0 +1,1 @@
+hello
";
        let files = GitEngine::parse_commit_diff(diff).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "a.txt");
        assert_eq!((files[0].additions, files[0].deletions), (2, 1));
        assert_eq!(files[0].hunks.len(), 1);
        assert_eq!(files[1].path, "b.txt");
        assert_eq!((files[1].additions, files[1].deletions), (1, 0));
    }

    #[test]
    fn commit_detail_and_diff_for_known_commit() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        // First commit: create file.txt with two lines.
        std::fs::write(tmp.path().join("file.txt"), "one\ntwo\n").unwrap();
        Command::new("git")
            .args(["add", "file.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();
        // Second commit: change one line, add a new file. Use a body so the
        // metadata-with-body parsing is exercised end to end.
        std::fs::write(tmp.path().join("file.txt"), "one\nTWO\n").unwrap();
        std::fs::write(tmp.path().join("new.txt"), "hi\n").unwrap();
        Command::new("git")
            .args(["add", "file.txt", "new.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "edit\n\nthe body"])
            .current_dir(tmp.path())
            .status()
            .ok();

        let head = engine.last_commit(tmp.path()).unwrap();

        let detail = engine.commit_detail(tmp.path(), &head.id).unwrap();
        assert_eq!(detail.id, head.id);
        assert_eq!(detail.summary, "edit");
        assert_eq!(detail.body, "the body");
        assert_eq!(detail.author, "Test");
        assert_eq!(detail.email, "test@test.com");
        assert_eq!(detail.files.len(), 2);
        // file.txt: 1 line replaced (1 add, 1 del); new.txt: 1 add.
        assert_eq!(detail.additions, 2);
        assert_eq!(detail.deletions, 1);
        let file_change = detail
            .files
            .iter()
            .find(|f| f.path == "file.txt")
            .unwrap();
        assert_eq!((file_change.additions, file_change.deletions), (1, 1));

        let diff = engine.commit_diff(tmp.path(), &head.id).unwrap();
        assert_eq!(diff.len(), 2);
        let new_file = diff.iter().find(|f| f.path == "new.txt").unwrap();
        assert_eq!((new_file.additions, new_file.deletions), (1, 0));
        assert_eq!(new_file.hunks.len(), 1);
        let edited = diff.iter().find(|f| f.path == "file.txt").unwrap();
        assert_eq!((edited.additions, edited.deletions), (1, 1));
    }

    #[test]
    fn list_branches_returns_empty_or_initial_for_empty_repo() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        let ok = Command::new("git")
            .args(["init", "-b", "trunk"])
            .current_dir(tmp.path())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            eprintln!("skipping: system git unavailable");
            return;
        }
        // Without a commit there are no branch refs; should produce an empty list.
        let branches = engine.list_branches(tmp.path()).unwrap();
        assert!(branches.iter().all(|b| !b.name.is_empty()));
    }

    fn init_repo(tmp: &std::path::Path) -> bool {
        let ok = Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(tmp)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            return false;
        }
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(tmp)
            .status()
            .ok();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(tmp)
            .status()
            .ok();
        true
    }

    fn commit_a_file(tmp: &std::path::Path) {
        std::fs::write(tmp.join("a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "a.txt"])
            .current_dir(tmp)
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp)
            .status()
            .ok();
    }

    fn add_bare_remote(tmp: &std::path::Path) -> tempfile::TempDir {
        let remote = tempfile::tempdir().unwrap();
        Command::new("git")
            .args(["init", "--bare"])
            .current_dir(remote.path())
            .status()
            .ok();
        Command::new("git")
            .args(["remote", "add", "origin", remote.path().to_str().unwrap()])
            .current_dir(tmp)
            .status()
            .ok();
        remote
    }

    #[test]
    fn push_state_reports_no_remote_and_no_upstream() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_a_file(tmp.path());
        let state = engine.push_state(tmp.path()).unwrap();
        assert!(!state.has_remote);
        assert!(!state.has_upstream);
    }

    #[test]
    fn push_without_remote_errors() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_a_file(tmp.path());
        let err = engine.push(tmp.path()).unwrap_err();
        match err {
            GitError::Gix(msg) => assert!(msg.contains("no remote configured")),
            other => panic!("expected no-remote error, got {other:?}"),
        }
    }

    #[test]
    fn push_sets_upstream_on_first_push() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_a_file(tmp.path());
        let _remote = add_bare_remote(tmp.path());

        // Before first push: remote present, no upstream yet.
        let before = engine.push_state(tmp.path()).unwrap();
        assert!(before.has_remote);
        assert!(!before.has_upstream);

        // First push should publish the branch and set its upstream.
        engine.push(tmp.path()).expect("first push should succeed");

        let after = engine.push_state(tmp.path()).unwrap();
        assert!(after.has_remote);
        assert!(after.has_upstream);
    }

    #[test]
    fn list_remotes_reports_origin_push_url() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        let remote = add_bare_remote(tmp.path());
        let remotes = engine.list_remotes(tmp.path()).unwrap();
        // One logical remote, deduped from the (fetch)/(push) pair.
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].name, "origin");
        assert_eq!(remotes[0].url, remote.path().to_str().unwrap());
    }

    #[test]
    fn set_remote_url_updates_origin() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        let _remote = add_bare_remote(tmp.path());
        let new_url = "https://github.com/arrisdb/arris.git";
        engine
            .set_remote_url(tmp.path(), "origin", new_url)
            .expect("set-url should succeed");
        let remotes = engine.list_remotes(tmp.path()).unwrap();
        assert_eq!(remotes[0].url, new_url);
    }

    #[test]
    fn set_remote_url_errors_for_unknown_remote() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        let err = engine
            .set_remote_url(tmp.path(), "nope", "https://example.com/x.git")
            .unwrap_err();
        assert!(matches!(err, GitError::Gix(_)));
    }

    #[test]
    fn file_statuses_includes_index_and_worktree_status() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "a.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();
        // Stage a modification
        std::fs::write(tmp.path().join("a.txt"), "changed").unwrap();
        Command::new("git")
            .args(["add", "a.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();
        let statuses = engine.file_statuses(tmp.path()).unwrap();
        let a = statuses.iter().find(|s| s.path.ends_with("a.txt")).unwrap();
        assert_eq!(a.index_status, "M");
        assert_eq!(a.worktree_status, " ");
    }

    #[test]
    fn stage_and_unstage_files() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "a.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();
        std::fs::write(tmp.path().join("a.txt"), "changed").unwrap();

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("a.txt").to_string_lossy().to_string();

        // Stage
        engine.stage_files(tmp.path(), &[abs.clone()]).unwrap();
        let statuses = engine.file_statuses(tmp.path()).unwrap();
        let a = statuses.iter().find(|s| s.path.ends_with("a.txt")).unwrap();
        assert_eq!(a.index_status, "M");

        // Unstage
        engine.unstage_files(tmp.path(), &[abs]).unwrap();
        let statuses = engine.file_statuses(tmp.path()).unwrap();
        let a = statuses.iter().find(|s| s.path.ends_with("a.txt")).unwrap();
        assert_eq!(a.worktree_status, "M");
        assert_eq!(a.index_status, " ");
    }

    #[test]
    fn stage_all_and_unstage_all() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();
        std::fs::write(tmp.path().join("a.txt"), "changed").unwrap();
        std::fs::write(tmp.path().join("b.txt"), "new").unwrap();

        engine.stage_all(tmp.path()).unwrap();
        let statuses = engine.file_statuses(tmp.path()).unwrap();
        assert!(
            statuses
                .iter()
                .all(|s| s.index_status != " " && s.index_status != "?")
        );

        engine.unstage_all(tmp.path()).unwrap();
        let statuses = engine.file_statuses(tmp.path()).unwrap();
        for s in &statuses {
            assert!(s.index_status == " " || s.index_status == "?");
        }
    }

    #[test]
    fn file_statuses_scopes_to_subdirectory() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::create_dir_all(tmp.path().join("app")).unwrap();
        std::fs::create_dir_all(tmp.path().join("other")).unwrap();
        std::fs::write(tmp.path().join("app/a.txt"), "hello").unwrap();
        std::fs::write(tmp.path().join("other/b.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();

        std::fs::write(tmp.path().join("app/a.txt"), "changed").unwrap();
        std::fs::write(tmp.path().join("other/b.txt"), "changed").unwrap();
        std::fs::write(tmp.path().join("app/new.txt"), "new").unwrap();

        let statuses = engine.file_statuses(&tmp.path().join("app")).unwrap();
        let canon = tmp.path().canonicalize().unwrap();
        assert_eq!(statuses.len(), 2);
        assert!(statuses.iter().all(|s| {
            s.path
                .starts_with(canon.join("app").to_string_lossy().as_ref())
        }));
        assert!(statuses.iter().any(|s| s.path.ends_with("app/a.txt")));
        assert!(statuses.iter().any(|s| s.path.ends_with("app/new.txt")));
        assert!(!statuses.iter().any(|s| s.path.ends_with("other/b.txt")));
    }

    #[test]
    fn stage_all_and_unstage_all_scope_to_subdirectory() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::create_dir_all(tmp.path().join("app")).unwrap();
        std::fs::create_dir_all(tmp.path().join("other")).unwrap();
        std::fs::write(tmp.path().join("app/a.txt"), "hello").unwrap();
        std::fs::write(tmp.path().join("other/b.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();

        std::fs::write(tmp.path().join("app/a.txt"), "changed").unwrap();
        std::fs::write(tmp.path().join("other/b.txt"), "changed").unwrap();

        engine.stage_all(&tmp.path().join("app")).unwrap();
        let statuses = engine.file_statuses(tmp.path()).unwrap();
        let app = statuses
            .iter()
            .find(|s| s.path.ends_with("app/a.txt"))
            .unwrap();
        let other = statuses
            .iter()
            .find(|s| s.path.ends_with("other/b.txt"))
            .unwrap();
        assert_eq!(app.index_status, "M");
        assert_eq!(other.index_status, " ");
        assert_eq!(other.worktree_status, "M");

        engine.unstage_all(&tmp.path().join("app")).unwrap();
        let statuses = engine.file_statuses(tmp.path()).unwrap();
        let app = statuses
            .iter()
            .find(|s| s.path.ends_with("app/a.txt"))
            .unwrap();
        assert_eq!(app.index_status, " ");
        assert_eq!(app.worktree_status, "M");
    }

    #[test]
    fn file_diff_stats_scopes_to_subdirectory() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::create_dir_all(tmp.path().join("app")).unwrap();
        std::fs::create_dir_all(tmp.path().join("other")).unwrap();
        std::fs::write(tmp.path().join("app/a.txt"), "one\n").unwrap();
        std::fs::write(tmp.path().join("other/b.txt"), "one\n").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();

        std::fs::write(tmp.path().join("app/a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(tmp.path().join("other/b.txt"), "one\ntwo\n").unwrap();

        let stats = engine.file_diff_stats(&tmp.path().join("app")).unwrap();
        assert_eq!(stats.len(), 1);
        assert!(stats[0].0.ends_with("app/a.txt"));
        assert_eq!(stats[0].1, 1);
        assert_eq!(stats[0].2, 0);
    }

    #[test]
    fn commit_and_last_commit() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(tmp.path())
            .status()
            .ok();
        let info = engine.commit(tmp.path(), "test commit").unwrap();
        assert_eq!(info.summary, "test commit");
        assert_eq!(info.author, "Test");
        assert!(!info.id.is_empty());

        let last = engine.last_commit(tmp.path()).unwrap();
        assert_eq!(last.id, info.id);
        assert_eq!(last.summary, "test commit");
    }

    #[test]
    fn clone_repo_creates_valid_repo() {
        let engine = GitEngine::new();
        let source = tempfile::tempdir().unwrap();
        if !init_repo(source.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::write(source.path().join("a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(source.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(source.path())
            .status()
            .ok();

        let dest = tempfile::tempdir().unwrap();
        let clone_dest = dest.path().join("cloned");
        let result = engine.clone_repo(&source.path().to_string_lossy(), &clone_dest);
        assert!(result.is_ok());
        assert!(clone_dest.join(".git").exists());
        assert!(clone_dest.join("a.txt").exists());
        assert_eq!(
            engine.current_branch(&clone_dest).unwrap(),
            Some("main".to_string())
        );
    }

    #[test]
    fn clone_repo_fails_with_bad_url() {
        let engine = GitEngine::new();
        let dest = tempfile::tempdir().unwrap();
        let clone_dest = dest.path().join("cloned");
        let result =
            engine.clone_repo("https://invalid.example.com/no-such-repo.git", &clone_dest);
        assert!(result.is_err());
    }

    #[test]
    fn ahead_behind_no_upstream() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();
        let (a, b) = engine.ahead_behind(tmp.path()).unwrap();
        assert_eq!(a, 0);
        assert_eq!(b, 0);
    }

    #[test]
    fn checkout_switches_branch() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["branch", "feature"])
            .current_dir(tmp.path())
            .status()
            .ok();

        engine.checkout(tmp.path(), "feature").unwrap();
        assert_eq!(
            engine.current_branch(tmp.path()).unwrap(),
            Some("feature".to_string())
        );

        engine.checkout(tmp.path(), "main").unwrap();
        assert_eq!(
            engine.current_branch(tmp.path()).unwrap(),
            Some("main".to_string())
        );
    }

    #[test]
    fn checkout_nonexistent_branch_fails() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();

        let err = engine.checkout(tmp.path(), "nonexistent").unwrap_err();
        match err {
            GitError::Gix(msg) => assert!(msg.contains("git checkout failed")),
            _ => panic!("expected GitError::Gix"),
        }
    }

    #[test]
    fn single_hunk_patch_extracts_one_hunk_with_header() {
        let diff = "\
diff --git a/f.txt b/f.txt
index abc..def 100644
--- a/f.txt
+++ b/f.txt
@@ -1,1 +1,1 @@
-a
+A
@@ -10,1 +10,1 @@
-j
+J
";
        let first = GitEngine::single_hunk_patch(diff, 0).unwrap();
        assert!(first.contains("--- a/f.txt"));
        assert!(first.contains("+++ b/f.txt"));
        assert!(first.contains("@@ -1,1 +1,1 @@"));
        assert!(first.contains("+A"));
        assert!(!first.contains("+J"));

        let second = GitEngine::single_hunk_patch(diff, 1).unwrap();
        assert!(second.contains("@@ -10,1 +10,1 @@"));
        assert!(second.contains("+J"));
        assert!(!second.contains("+A"));

        assert!(GitEngine::single_hunk_patch(diff, 2).is_none());
    }

    fn commit_ten_line_file(tmp: &std::path::Path) {
        std::fs::write(
            tmp.join("f.txt"),
            "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n",
        )
        .unwrap();
        Command::new("git")
            .args(["add", "f.txt"])
            .current_dir(tmp)
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp)
            .status()
            .ok();
    }

    #[test]
    fn stage_hunk_stages_only_selected_hunk() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_ten_line_file(tmp.path());
        // Two separated changes -> two distinct hunks.
        std::fs::write(
            tmp.path().join("f.txt"),
            "A\nb\nc\nd\ne\nf\ng\nh\ni\nJ\n",
        )
        .unwrap();

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();
        assert_eq!(engine.file_diff_hunks(tmp.path(), &abs).unwrap().len(), 2);

        engine.stage_hunk(tmp.path(), &abs, 0).unwrap();

        let staged = Command::new("git")
            .args(["diff", "--cached"])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        let staged = String::from_utf8_lossy(&staged.stdout);
        assert!(staged.contains("+A"));
        assert!(!staged.contains("+J"));
    }

    #[test]
    fn restore_change_blocks_reverts_only_block_in_merged_hunk() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_ten_line_file(tmp.path());
        // Two edits 3 unchanged lines apart: git merges them into ONE hunk.
        std::fs::write(
            tmp.path().join("f.txt"),
            "a\nB\nc\nd\ne\nF\ng\nh\ni\nj\n",
        )
        .unwrap();

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();
        assert_eq!(engine.file_diff_hunks(tmp.path(), &abs).unwrap().len(), 1);

        engine.restore_change_blocks(tmp.path(), &abs, 6, 6).unwrap();

        let content = std::fs::read_to_string(tmp.path().join("f.txt")).unwrap();
        assert_eq!(content, "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n");
    }

    #[test]
    fn restore_change_blocks_removes_inserted_run_only() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_ten_line_file(tmp.path());
        // Edit line 2 and insert two lines after e; one merged hunk.
        std::fs::write(
            tmp.path().join("f.txt"),
            "a\nB\nc\nd\ne\nX\nY\nf\ng\nh\ni\nj\n",
        )
        .unwrap();

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();

        // Cursor on the second inserted row removes the whole inserted run.
        engine.restore_change_blocks(tmp.path(), &abs, 7, 7).unwrap();

        let content = std::fs::read_to_string(tmp.path().join("f.txt")).unwrap();
        assert_eq!(content, "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n");
    }

    #[test]
    fn restore_change_blocks_restores_deleted_block_only() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_ten_line_file(tmp.path());
        // Edit line 2 and delete f/g; deletion anchors on the row below (h).
        std::fs::write(
            tmp.path().join("f.txt"),
            "a\nB\nc\nd\ne\nh\ni\nj\n",
        )
        .unwrap();

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();

        engine.restore_change_blocks(tmp.path(), &abs, 6, 6).unwrap();

        let content = std::fs::read_to_string(tmp.path().join("f.txt")).unwrap();
        assert_eq!(content, "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n");
    }

    #[test]
    fn restore_change_blocks_restores_deletion_at_eof() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_ten_line_file(tmp.path());
        std::fs::write(
            tmp.path().join("f.txt"),
            "a\nb\nc\nd\ne\nf\ng\nh\ni\n",
        )
        .unwrap();

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();

        // The UI clamps the trailing-deletion anchor to the last line (9).
        engine.restore_change_blocks(tmp.path(), &abs, 9, 9).unwrap();

        let content = std::fs::read_to_string(tmp.path().join("f.txt")).unwrap();
        assert_eq!(content, "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n");
    }

    #[test]
    fn restore_change_blocks_rejects_unchanged_line() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_ten_line_file(tmp.path());
        std::fs::write(
            tmp.path().join("f.txt"),
            "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n",
        )
        .unwrap();

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();

        // Line 4 sits inside the hunk's context but is not a change block.
        assert!(engine.restore_change_blocks(tmp.path(), &abs, 4, 4).is_err());
    }

    #[test]
    fn restore_change_blocks_reverts_all_blocks_in_selected_range() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_ten_line_file(tmp.path());
        // Three separate blocks (B at 2, F at 6, J at 10); selecting lines
        // 2-6 must revert B and F but leave J untouched.
        std::fs::write(
            tmp.path().join("f.txt"),
            "a\nB\nc\nd\ne\nF\ng\nh\ni\nJ\n",
        )
        .unwrap();

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();
        engine.restore_change_blocks(tmp.path(), &abs, 2, 6).unwrap();

        let content = std::fs::read_to_string(tmp.path().join("f.txt")).unwrap();
        assert_eq!(content, "a\nb\nc\nd\ne\nf\ng\nh\ni\nJ\n");
    }

    #[test]
    fn restore_change_blocks_unstages_staged_copy_of_block() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_ten_line_file(tmp.path());
        std::fs::write(
            tmp.path().join("f.txt"),
            "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n",
        )
        .unwrap();
        Command::new("git")
            .args(["add", "f.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();
        engine.restore_change_blocks(tmp.path(), &abs, 2, 2).unwrap();

        let content = std::fs::read_to_string(tmp.path().join("f.txt")).unwrap();
        assert_eq!(content, "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n");
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&status.stdout).trim(), "");
    }

    #[test]
    fn restore_change_blocks_keeps_other_staged_blocks() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_ten_line_file(tmp.path());
        // Two staged blocks (B at 2, F at 6); discarding F must leave B staged.
        std::fs::write(
            tmp.path().join("f.txt"),
            "a\nB\nc\nd\ne\nF\ng\nh\ni\nj\n",
        )
        .unwrap();
        Command::new("git")
            .args(["add", "f.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();
        engine.restore_change_blocks(tmp.path(), &abs, 6, 6).unwrap();

        let content = std::fs::read_to_string(tmp.path().join("f.txt")).unwrap();
        assert_eq!(content, "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n");
        let cached = Command::new("git")
            .args(["diff", "--cached"])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        let cached = String::from_utf8_lossy(&cached.stdout);
        assert!(cached.contains("+B"));
        assert!(!cached.contains("+F"));
    }

    #[test]
    fn restore_change_blocks_discards_staged_and_worktree_versions() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_ten_line_file(tmp.path());
        // Stage version X of line 2, then edit the worktree to version Y:
        // discarding the block must drop BOTH and leave the file clean.
        std::fs::write(
            tmp.path().join("f.txt"),
            "a\nX\nc\nd\ne\nf\ng\nh\ni\nj\n",
        )
        .unwrap();
        Command::new("git")
            .args(["add", "f.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();
        std::fs::write(
            tmp.path().join("f.txt"),
            "a\nY\nc\nd\ne\nf\ng\nh\ni\nj\n",
        )
        .unwrap();

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();
        engine.restore_change_blocks(tmp.path(), &abs, 2, 2).unwrap();

        let content = std::fs::read_to_string(tmp.path().join("f.txt")).unwrap();
        assert_eq!(content, "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n");
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&status.stdout).trim(), "");
    }

    #[test]
    fn discard_files_reverts_tracked_file() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        std::fs::write(tmp.path().join("a.txt"), "original\n").unwrap();
        Command::new("git")
            .args(["add", "a.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(tmp.path())
            .status()
            .ok();
        // Modify and stage the change.
        std::fs::write(tmp.path().join("a.txt"), "changed\n").unwrap();
        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("a.txt").to_string_lossy().to_string();
        engine.stage_files(tmp.path(), &[abs.clone()]).unwrap();

        engine.discard_files(tmp.path(), &[abs]).unwrap();

        // File reverts to HEAD content and the working tree is clean.
        let content = std::fs::read_to_string(tmp.path().join("a.txt")).unwrap();
        assert_eq!(content, "original\n");
        let statuses = engine.file_statuses(tmp.path()).unwrap();
        assert!(!statuses.iter().any(|s| s.path.ends_with("a.txt")));
    }

    // ---- commit graph lane layout (pure, no git needed) ----

    fn graph_line(id: &str, parents: &[&str], decoration: &str) -> String {
        format!(
            "{id}\u{1f}{}\u{1f}msg {id}\u{1f}Author\u{1f}1700000000\u{1f}{decoration}",
            parents.join(" ")
        )
    }

    #[test]
    fn layout_lanes_linear_history_single_column() {
        let log = [
            graph_line("c3", &["c2"], ""),
            graph_line("c2", &["c1"], ""),
            graph_line("c1", &[], ""),
        ]
        .join("\n");
        let rows = GitEngine::layout_lanes(&log);
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|r| r.column == 0));
        // Each non-root row continues its lane straight down.
        assert!(rows[0].edges.contains(&GraphEdge { from_col: 0, to_col: 0 }));
        // Root commit has no parent edge.
        assert!(rows[2].edges.is_empty());
    }

    #[test]
    fn layout_lanes_merge_branches_and_converges() {
        // M merges A and B; both descend from base.
        let log = [
            graph_line("M", &["A", "B"], ""),
            graph_line("A", &["base"], ""),
            graph_line("B", &["base"], ""),
            graph_line("base", &[], ""),
        ]
        .join("\n");
        let rows = GitEngine::layout_lanes(&log);
        assert_eq!(rows.len(), 4);
        let col = |id: &str| rows.iter().find(|r| r.id == id).unwrap().column;
        assert_eq!(col("M"), 0);
        assert_eq!(col("A"), 0);
        // B is pushed to a second lane by the merge.
        assert_eq!(col("B"), 1);
        // base reunites the lanes back to column 0.
        assert_eq!(col("base"), 0);
        // The merge commit emits an edge out to B's new lane.
        let m = rows.iter().find(|r| r.id == "M").unwrap();
        assert!(m.edges.contains(&GraphEdge { from_col: 0, to_col: 1 }));
        // base draws a merge edge from lane 1 back into lane 0.
        let base = rows.iter().find(|r| r.id == "base").unwrap();
        assert!(base.edges.contains(&GraphEdge { from_col: 1, to_col: 0 }));
    }

    #[test]
    fn parse_refs_classifies_head_branch_remote_and_tag() {
        let refs = GitEngine::parse_refs("HEAD -> main, origin/main, tag: v1.0, feature");
        assert_eq!(refs[0].kind, "head");
        assert_eq!(refs[1].name, "main");
        assert_eq!(refs[1].kind, "localBranch");
        assert!(refs.iter().any(|r| r.name == "origin/main" && r.kind == "remoteBranch"));
        assert!(refs.iter().any(|r| r.name == "v1.0" && r.kind == "tag"));
        assert!(refs.iter().any(|r| r.name == "feature" && r.kind == "localBranch"));
    }

    #[test]
    fn commit_graph_reports_refs_and_columns() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_a_file(tmp.path());
        let rows = engine.commit_graph(tmp.path(), 50).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].column, 0);
        assert!(rows[0].refs.iter().any(|r| r.kind == "head"));
        assert!(rows[0].refs.iter().any(|r| r.name == "main"));
    }

    #[test]
    fn commit_line_matches_hash_summary_author_and_refs() {
        // graph_line builds id\x1fparents\x1f"msg {id}"\x1f"Author"\x1fts\x1f{refs}.
        let line = graph_line("abc123", &["p"], "origin/feature");
        assert!(GitEngine::commit_line_matches(&line, "abc")); // hash
        assert!(GitEngine::commit_line_matches(&line, "msg")); // summary
        assert!(GitEngine::commit_line_matches(&line, "author")); // author, case-insensitive
        assert!(GitEngine::commit_line_matches(&line, "feature")); // ref name
        assert!(!GitEngine::commit_line_matches(&line, "zzz")); // no match
    }

    #[test]
    fn search_commits_finds_old_commit_beyond_a_page() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        for i in 0..5 {
            std::fs::write(tmp.path().join("a.txt"), format!("v{i}")).unwrap();
            Command::new("git").args(["add", "a.txt"]).current_dir(tmp.path()).status().ok();
            let msg = if i == 0 { "introduce widgets" } else { "routine change" };
            Command::new("git").args(["commit", "-m", msg]).current_dir(tmp.path()).status().ok();
        }
        // The oldest commit's unique message is still found by search...
        let hits = engine.search_commits(tmp.path(), "widgets", 100).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].summary, "introduce widgets");
        // ...a non-matching query returns nothing, and an empty query is a no-op.
        assert!(engine.search_commits(tmp.path(), "nonexistent", 100).unwrap().is_empty());
        assert!(engine.search_commits(tmp.path(), "   ", 100).unwrap().is_empty());
    }

    // ---- fetch / pull / conflict resolution ----

    /// Set up a local merge conflict on `f.txt` (no remote) by branching,
    /// diverging both sides, and merging. Leaves the repo mid-merge.
    fn setup_local_conflict(tmp: &std::path::Path) {
        std::fs::write(tmp.join("f.txt"), "base\n").unwrap();
        Command::new("git").args(["add", "f.txt"]).current_dir(tmp).status().ok();
        Command::new("git").args(["commit", "-m", "base"]).current_dir(tmp).status().ok();
        Command::new("git").args(["checkout", "-b", "feature"]).current_dir(tmp).status().ok();
        std::fs::write(tmp.join("f.txt"), "theirs\n").unwrap();
        Command::new("git").args(["commit", "-am", "theirs"]).current_dir(tmp).status().ok();
        Command::new("git").args(["checkout", "main"]).current_dir(tmp).status().ok();
        std::fs::write(tmp.join("f.txt"), "ours\n").unwrap();
        Command::new("git").args(["commit", "-am", "ours"]).current_dir(tmp).status().ok();
        // Conflicting merge; exit code ignored (conflict expected).
        Command::new("git")
            .args(["merge", "--no-edit", "feature"])
            .current_dir(tmp)
            .status()
            .ok();
    }

    #[test]
    fn merge_state_and_conflict_versions_report_conflict() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        setup_local_conflict(tmp.path());

        let state = engine.merge_state(tmp.path()).unwrap();
        assert!(state.in_progress);
        assert_eq!(state.kind, "merge");
        assert_eq!(state.conflicted.len(), 1);
        assert!(state.conflicted[0].ends_with("f.txt"));

        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();
        let versions = engine.conflict_versions(tmp.path(), &abs).unwrap();
        assert_eq!(versions.base.as_deref(), Some("base\n"));
        assert_eq!(versions.ours, "ours\n");
        assert_eq!(versions.theirs, "theirs\n");
        assert!(versions.merged.contains("<<<<<<<"));
    }

    #[test]
    fn resolve_theirs_then_continue_finishes_merge() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        setup_local_conflict(tmp.path());
        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();

        engine.resolve_theirs(tmp.path(), &abs).unwrap();
        assert!(engine.conflicted_files(tmp.path()).unwrap().is_empty());
        assert_eq!(std::fs::read_to_string(canon.join("f.txt")).unwrap(), "theirs\n");

        engine.merge_continue(tmp.path()).unwrap();
        let state = engine.merge_state(tmp.path()).unwrap();
        assert!(!state.in_progress);
    }

    #[test]
    fn write_resolved_then_continue_uses_custom_content() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        setup_local_conflict(tmp.path());
        let canon = tmp.path().canonicalize().unwrap();
        let abs = canon.join("f.txt").to_string_lossy().to_string();

        engine.write_resolved(tmp.path(), &abs, "merged-by-hand\n").unwrap();
        assert!(engine.conflicted_files(tmp.path()).unwrap().is_empty());
        engine.merge_continue(tmp.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(canon.join("f.txt")).unwrap(),
            "merged-by-hand\n"
        );
    }

    #[test]
    fn merge_abort_restores_clean_state() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        setup_local_conflict(tmp.path());
        assert!(engine.merge_state(tmp.path()).unwrap().in_progress);
        engine.merge_abort(tmp.path()).unwrap();
        let state = engine.merge_state(tmp.path()).unwrap();
        assert!(!state.in_progress);
        // Our side is restored.
        let canon = tmp.path().canonicalize().unwrap();
        assert_eq!(std::fs::read_to_string(canon.join("f.txt")).unwrap(), "ours\n");
    }

    #[test]
    fn merge_continue_refuses_with_unresolved_conflicts() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        setup_local_conflict(tmp.path());
        let err = engine.merge_continue(tmp.path()).unwrap_err();
        match err {
            GitError::Gix(msg) => assert!(msg.contains("conflicts remain")),
            other => panic!("expected unresolved-conflict error, got {other:?}"),
        }
    }

    #[test]
    fn fetch_without_remote_errors() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_a_file(tmp.path());
        let err = engine.fetch(tmp.path()).unwrap_err();
        match err {
            GitError::Gix(msg) => assert!(msg.contains("no remote configured")),
            other => panic!("expected no-remote error, got {other:?}"),
        }
    }

    #[test]
    fn fetch_updates_remote_tracking_ref() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_a_file(tmp.path());
        let _remote = add_bare_remote(tmp.path());
        engine.push(tmp.path()).expect("seed push");
        // Fetch succeeds against the published remote.
        engine.fetch(tmp.path()).expect("fetch should succeed");
    }

    #[test]
    fn pull_merge_surfaces_conflicts() {
        let engine = GitEngine::new();
        if !system_git_available() {
            eprintln!("skipping: system git unavailable");
            return;
        }
        // Shared bare remote with a base commit, cloned into two repos.
        let remote = tempfile::tempdir().unwrap();
        Command::new("git")
            .args(["init", "--bare", "-b", "main"])
            .current_dir(remote.path())
            .status()
            .ok();
        let a = tempfile::tempdir().unwrap();
        clone_into(remote.path(), a.path());
        config_user(a.path());
        std::fs::write(a.path().join("f.txt"), "base\n").unwrap();
        Command::new("git").args(["add", "f.txt"]).current_dir(a.path()).status().ok();
        Command::new("git").args(["commit", "-m", "base"]).current_dir(a.path()).status().ok();
        Command::new("git").args(["push", "-u", "origin", "main"]).current_dir(a.path()).status().ok();

        // Repo B diverges and pushes first.
        let b = tempfile::tempdir().unwrap();
        clone_into(remote.path(), b.path());
        config_user(b.path());
        std::fs::write(b.path().join("f.txt"), "theirs\n").unwrap();
        Command::new("git").args(["commit", "-am", "theirs"]).current_dir(b.path()).status().ok();
        Command::new("git").args(["push"]).current_dir(b.path()).status().ok();

        // Repo A makes a conflicting commit, then pulls -> conflict.
        std::fs::write(a.path().join("f.txt"), "ours\n").unwrap();
        Command::new("git").args(["commit", "-am", "ours"]).current_dir(a.path()).status().ok();

        let result = engine.pull(a.path(), PullMode::Merge).unwrap();
        assert_eq!(result.conflicted.len(), 1);
        assert!(result.conflicted[0].ends_with("f.txt"));
        assert!(engine.merge_state(a.path()).unwrap().in_progress);
    }

    #[test]
    fn push_to_publishes_named_branch() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_a_file(tmp.path());
        let _remote = add_bare_remote(tmp.path());
        let branch = engine.current_branch(tmp.path()).unwrap().unwrap();
        engine
            .push_to(tmp.path(), "origin", &branch)
            .expect("push_to should succeed");
        // The bare remote now advertises the pushed branch.
        let ls = Command::new("git")
            .args(["ls-remote", "--heads", "origin", &branch])
            .current_dir(tmp.path())
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&ls.stdout).contains(&format!("refs/heads/{branch}")));
    }

    #[test]
    fn force_push_without_upstream_errors() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_a_file(tmp.path());
        // Remote present but the branch has no upstream tracking ref yet.
        let _remote = add_bare_remote(tmp.path());
        let err = engine.force_push(tmp.path()).unwrap_err();
        match err {
            GitError::Gix(msg) => assert!(msg.contains("no upstream")),
            other => panic!("expected no-upstream error, got {other:?}"),
        }
    }

    #[test]
    fn force_push_overwrites_remote_history() {
        let engine = GitEngine::new();
        if !system_git_available() {
            eprintln!("skipping: system git unavailable");
            return;
        }
        let remote = tempfile::tempdir().unwrap();
        Command::new("git")
            .args(["init", "--bare", "-b", "main"])
            .current_dir(remote.path())
            .status()
            .ok();
        let a = tempfile::tempdir().unwrap();
        clone_into(remote.path(), a.path());
        config_user(a.path());
        std::fs::write(a.path().join("f.txt"), "v1\n").unwrap();
        Command::new("git").args(["add", "f.txt"]).current_dir(a.path()).status().ok();
        Command::new("git").args(["commit", "-m", "v1"]).current_dir(a.path()).status().ok();
        Command::new("git").args(["push", "-u", "origin", "main"]).current_dir(a.path()).status().ok();
        // Amend the tip so local history diverges from the remote, then
        // force-push. `--force-with-lease` allows it since our remote-tracking
        // ref still matches the remote (we haven't fetched a competing update).
        std::fs::write(a.path().join("f.txt"), "v2\n").unwrap();
        Command::new("git").args(["commit", "-am", "v2", "--amend"]).current_dir(a.path()).status().ok();
        engine.force_push(a.path()).expect("force-push should overwrite remote");
    }

    #[test]
    fn pull_from_merges_explicit_branch() {
        let engine = GitEngine::new();
        if !system_git_available() {
            eprintln!("skipping: system git unavailable");
            return;
        }
        let remote = tempfile::tempdir().unwrap();
        Command::new("git")
            .args(["init", "--bare", "-b", "main"])
            .current_dir(remote.path())
            .status()
            .ok();
        let a = tempfile::tempdir().unwrap();
        clone_into(remote.path(), a.path());
        config_user(a.path());
        std::fs::write(a.path().join("f.txt"), "base\n").unwrap();
        Command::new("git").args(["add", "f.txt"]).current_dir(a.path()).status().ok();
        Command::new("git").args(["commit", "-m", "base"]).current_dir(a.path()).status().ok();
        Command::new("git").args(["push", "-u", "origin", "main"]).current_dir(a.path()).status().ok();
        // Repo B adds a non-conflicting file and pushes.
        let b = tempfile::tempdir().unwrap();
        clone_into(remote.path(), b.path());
        config_user(b.path());
        std::fs::write(b.path().join("g.txt"), "from-b\n").unwrap();
        Command::new("git").args(["add", "g.txt"]).current_dir(b.path()).status().ok();
        Command::new("git").args(["commit", "-m", "add g"]).current_dir(b.path()).status().ok();
        Command::new("git").args(["push"]).current_dir(b.path()).status().ok();
        // Repo A pulls the explicit remote/branch: a clean merge, no conflicts.
        let result = engine
            .pull_from(a.path(), "origin", "main", PullMode::Merge)
            .unwrap();
        assert!(result.conflicted.is_empty());
        assert!(a.path().join("g.txt").exists());
    }

    fn system_git_available() -> bool {
        Command::new("git").arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
    }

    fn clone_into(remote: &std::path::Path, dest: &std::path::Path) {
        Command::new("git")
            .arg("clone")
            .arg(remote)
            .arg(dest)
            .status()
            .ok();
    }

    fn config_user(repo: &std::path::Path) {
        Command::new("git").args(["config", "user.email", "test@test.com"]).current_dir(repo).status().ok();
        Command::new("git").args(["config", "user.name", "Test"]).current_dir(repo).status().ok();
    }

    #[test]
    fn delete_branch_removes_a_merged_branch() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_a_file(tmp.path());
        // `feature` points at the same commit as `main`, so it is fully merged.
        Command::new("git")
            .args(["branch", "feature"])
            .current_dir(tmp.path())
            .status()
            .ok();
        assert!(engine
            .list_branches(tmp.path())
            .unwrap()
            .iter()
            .any(|b| b.name == "feature"));

        engine.delete_branch(tmp.path(), "feature", false).unwrap();

        assert!(engine
            .list_branches(tmp.path())
            .unwrap()
            .iter()
            .all(|b| b.name != "feature"));
    }

    #[test]
    fn delete_branch_refuses_unmerged_until_forced() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_a_file(tmp.path());
        // Build `feature` with a commit that never reaches `main`.
        Command::new("git")
            .args(["checkout", "-b", "feature"])
            .current_dir(tmp.path())
            .status()
            .ok();
        std::fs::write(tmp.path().join("b.txt"), "world").unwrap();
        Command::new("git")
            .args(["add", "b.txt"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["commit", "-m", "feature work"])
            .current_dir(tmp.path())
            .status()
            .ok();
        Command::new("git")
            .args(["checkout", "main"])
            .current_dir(tmp.path())
            .status()
            .ok();

        // Safe delete is rejected because the branch is not fully merged.
        assert!(engine.delete_branch(tmp.path(), "feature", false).is_err());
        assert!(engine
            .list_branches(tmp.path())
            .unwrap()
            .iter()
            .any(|b| b.name == "feature"));

        // Forced delete succeeds.
        engine.delete_branch(tmp.path(), "feature", true).unwrap();
        assert!(engine
            .list_branches(tmp.path())
            .unwrap()
            .iter()
            .all(|b| b.name != "feature"));
    }

    #[test]
    fn remove_worktree_detaches_a_linked_worktree() {
        let engine = GitEngine::new();
        let tmp = tempfile::tempdir().unwrap();
        if !init_repo(tmp.path()) {
            eprintln!("skipping: system git unavailable");
            return;
        }
        commit_a_file(tmp.path());
        let wt = tempfile::tempdir().unwrap();
        let wt_path = wt.path().join("linked");
        Command::new("git")
            .args(["worktree", "add", "-b", "wt-branch"])
            .arg(&wt_path)
            .current_dir(tmp.path())
            .status()
            .ok();
        assert_eq!(engine.worktree_list(tmp.path()).unwrap().len(), 2);

        engine
            .remove_worktree(tmp.path(), wt_path.to_str().unwrap(), false)
            .unwrap();

        let after = engine.worktree_list(tmp.path()).unwrap();
        assert_eq!(after.len(), 1);
        assert!(after.iter().all(|w| !w.path.contains("linked")));
    }
}
