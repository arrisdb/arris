use std::path::Path;
use std::sync::{Arc, Mutex};

use arris_engines::{AppEnvironment, IpcError, ProjectOpenResult};
use tauri::{Emitter, State};

use crate::commands::constants::{ARGV_PROGRAM_SKIP, ARG_FLAG_PREFIX};
use crate::helpers::ipc_err;
use crate::watcher::ProjectWatcher;

/// A project path handed to this process on launch (by "open in new window"),
/// consumed once by the frontend on startup. Each OS process owns exactly one.
pub struct PendingLaunch(Mutex<Option<String>>);

impl PendingLaunch {
    /// Read the launch project path from process args: the first positional
    /// argument after the program name, skipping OS/CLI flags.
    pub fn from_args<I: IntoIterator<Item = String>>(args: I) -> Self {
        let path = args
            .into_iter()
            .skip(ARGV_PROGRAM_SKIP)
            .find(|arg| !arg.starts_with(ARG_FLAG_PREFIX));
        Self(Mutex::new(path))
    }

    fn take(&self) -> Option<String> {
        self.0.lock().expect("PendingLaunch mutex poisoned").take()
    }
}

#[tauri::command]
pub async fn cmd_open_project(
    app: tauri::AppHandle,
    env: State<'_, Arc<AppEnvironment>>,
    watcher: State<'_, ProjectWatcher>,
    root: String,
) -> Result<ProjectOpenResult, IpcError> {
    let result = env.open_project(root.clone()).await.map_err(ipc_err)?;

    // Watch the project root so the file tree and git changes pane refresh live,
    // instead of only when the window regains focus.
    let app_handle = app.clone();
    if let Err(err) = watcher.start(Path::new(&root), move || {
        let _ = app_handle.emit("fs:changed", ());
    }) {
        tracing::warn!("failed to start filesystem watcher for {root}: {err}");
    }

    Ok(result)
}

#[tauri::command]
pub async fn cmd_close_project(
    env: State<'_, Arc<AppEnvironment>>,
    watcher: State<'_, ProjectWatcher>,
) -> Result<(), IpcError> {
    watcher.stop();
    env.close_project().await;
    Ok(())
}

/// Open a project in a NEW window by spawning a fresh instance of this app with
/// the folder path as a launch arg. The new process gets its own isolated
/// `AppEnvironment`, leaving this window's project untouched.
#[tauri::command]
pub fn cmd_open_project_in_new_window(path: String) -> Result<(), IpcError> {
    let exe = std::env::current_exe().map_err(ipc_err)?;
    std::process::Command::new(exe)
        .arg(path)
        .spawn()
        .map_err(ipc_err)?;
    Ok(())
}

/// Return this process's launch project path once, clearing it so a later
/// reload does not reopen it.
#[tauri::command]
pub fn cmd_take_pending_launch(pending: State<'_, PendingLaunch>) -> Option<String> {
    pending.take()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn from_args_picks_first_positional_after_program() {
        let pending = PendingLaunch::from_args(args(&["/bin/arris", "/home/me/proj"]));
        assert_eq!(pending.take(), Some("/home/me/proj".to_string()));
    }

    #[test]
    fn from_args_skips_leading_flags() {
        let pending = PendingLaunch::from_args(args(&["/bin/arris", "-psn_0_123", "/home/me/proj"]));
        assert_eq!(pending.take(), Some("/home/me/proj".to_string()));
    }

    #[test]
    fn from_args_is_none_without_a_path() {
        let pending = PendingLaunch::from_args(args(&["/bin/arris"]));
        assert_eq!(pending.take(), None);
    }

    #[test]
    fn take_clears_after_first_call() {
        let pending = PendingLaunch::from_args(args(&["/bin/arris", "/proj"]));
        assert_eq!(pending.take(), Some("/proj".to_string()));
        assert_eq!(pending.take(), None);
    }
}
