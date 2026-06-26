//! Live filesystem watcher for the active project root.
//!
//! Without this the file tree and git changes pane only refresh when the OS
//! window regains focus (frontend `useAppFocusRefresh`), so external edits,
//! file creation/deletion, and git operations are invisible until the user
//! clicks away and back. The watcher emits a debounced `fs:changed` event so
//! the frontend can refresh in real time.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_full::notify::{RecommendedWatcher, RecursiveMode, Result as NotifyResult};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

/// Coalesce bursts of filesystem events (an editor save or a git operation
/// touches many files at once) into a single notification.
const DEBOUNCE: Duration = Duration::from_millis(250);

type ProjectDebouncer = Debouncer<RecommendedWatcher, RecommendedCache>;

/// Directories whose churn must never drive a refresh: `.git` (git rewrites its
/// index on every status read) and `.arris` (our own project-data dir, where the
/// frontend persists console/notebook tabs on each refresh). Reacting to either
/// loops forever: refresh -> write -> event -> refresh (see `start`).
const IGNORED_DIRS: [&str; 2] = [".git", ".arris"];

/// Whether a path lives inside one of the `IGNORED_DIRS`.
fn is_internal_churn(path: &Path) -> bool {
    path.components().any(|component| {
        IGNORED_DIRS
            .iter()
            .any(|dir| component.as_os_str() == *dir)
    })
}

/// Managed Tauri state holding the debouncer for the currently open project.
/// Dropping the debouncer (via `stop`, or by replacing it in `start`) tears
/// down the underlying OS watch.
#[derive(Default)]
pub struct ProjectWatcher {
    debouncer: Mutex<Option<ProjectDebouncer>>,
}

impl ProjectWatcher {
    /// Watch `root` recursively. A later `start` replaces any previous watch.
    /// `on_change` fires (debounced) whenever anything under `root` changes.
    pub fn start<F>(&self, root: &Path, on_change: F) -> NotifyResult<()>
    where
        F: Fn() + Send + 'static,
    {
        let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
            // Fire only when something outside the internal-churn dirs changed
            // (see `IGNORED_DIRS`). Both `.git` and `.arris` are rewritten as a
            // side effect of the refresh itself, so reacting to them loops
            // forever: refresh -> write -> event -> refresh. Working-tree changes
            // (the actual edits/creates/deletes users care about) fire outside
            // those dirs, so they still refresh in real time.
            if let Ok(events) = result {
                let relevant = events
                    .iter()
                    .flat_map(|event| event.paths.iter())
                    .any(|path| !is_internal_churn(path));
                if relevant {
                    on_change();
                }
            }
        })?;
        debouncer.watch(root, RecursiveMode::Recursive)?;
        *self.debouncer.lock().unwrap() = Some(debouncer);
        Ok(())
    }

    /// Stop watching (drops the debouncer and its OS watch). Safe to call when
    /// nothing is being watched.
    pub fn stop(&self) {
        *self.debouncer.lock().unwrap() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Instant;

    fn unique_dir(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("arris-watch-{}-{tag}", std::process::id()))
    }

    fn wait_for(hits: &Arc<AtomicUsize>, target: usize) -> bool {
        let start = Instant::now();
        while hits.load(Ordering::SeqCst) < target && start.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(50));
        }
        hits.load(Ordering::SeqCst) >= target
    }

    #[test]
    fn fires_on_file_create_and_modify() {
        let dir = unique_dir("create");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let hits = Arc::new(AtomicUsize::new(0));
        let watcher = ProjectWatcher::default();
        let cb = hits.clone();
        watcher
            .start(&dir, move || {
                cb.fetch_add(1, Ordering::SeqCst);
            })
            .unwrap();

        // Let the OS watch register before mutating.
        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(dir.join("new.txt"), "hello").unwrap();

        assert!(
            wait_for(&hits, 1),
            "watcher did not fire on file create/modify"
        );

        watcher.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classifies_internal_churn_paths() {
        assert!(is_internal_churn(Path::new("/repo/.git/index")));
        assert!(is_internal_churn(Path::new("/repo/.git/refs/heads/main")));
        assert!(is_internal_churn(Path::new("/repo/.git/objects/ab/cdef")));
        assert!(is_internal_churn(Path::new("/repo/.arris/console_tabs.json")));
        assert!(is_internal_churn(Path::new("/repo/.arris/files/abc.sql")));
        assert!(!is_internal_churn(Path::new("/repo/src/main.rs")));
        assert!(!is_internal_churn(Path::new("/repo/Cargo.toml")));
        // `.gitignore` is a real tracked file, not internal git state.
        assert!(!is_internal_churn(Path::new("/repo/.gitignore")));
    }

    #[test]
    fn ignores_internal_churn_but_fires_on_worktree_changes() {
        let dir = unique_dir("churn");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::create_dir_all(dir.join(".arris")).unwrap();

        let hits = Arc::new(AtomicUsize::new(0));
        let watcher = ProjectWatcher::default();
        let cb = hits.clone();
        watcher
            .start(&dir, move || {
                cb.fetch_add(1, Ordering::SeqCst);
            })
            .unwrap();
        std::thread::sleep(Duration::from_millis(300));

        // Both loop sources: the git-status stat-cache rewrite of `.git/index`
        // and the frontend's tab persistence into `.arris`. Neither may fire.
        std::fs::write(dir.join(".git").join("index"), "x").unwrap();
        std::fs::write(dir.join(".arris").join("console_tabs.json"), "[]").unwrap();
        std::thread::sleep(Duration::from_millis(800));
        assert_eq!(
            hits.load(Ordering::SeqCst),
            0,
            "internal churn (.git / .arris) must not trigger a refresh"
        );

        // A real working-tree change still fires.
        std::fs::write(dir.join("Cargo.toml"), "edited").unwrap();
        assert!(
            wait_for(&hits, 1),
            "worktree change did not trigger a refresh"
        );

        watcher.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stop_after_start_releases_watch_without_panic() {
        let dir = unique_dir("stop");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let watcher = ProjectWatcher::default();
        watcher.start(&dir, || {}).unwrap();
        assert!(watcher.debouncer.lock().unwrap().is_some());

        watcher.stop();
        assert!(watcher.debouncer.lock().unwrap().is_none());

        // Stopping again is a no-op.
        watcher.stop();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
