use std::sync::Arc;

use arris_engines::{
    AppEnvironment, AppPreferences, IpcError, JsonCollectionStore, JsonSingletonStore,
    PersistedConsoleTab, PersistedPinnedQuery, PersistedRunHistoryEntry,
};
use tauri::State;

use crate::helpers::{ipc_err, list_editor_fonts};

#[tauri::command]
pub async fn cmd_load_console_tabs(
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<Vec<PersistedConsoleTab>, IpcError> {
    let proj = env.project.read().await;
    let proj = proj.as_ref().ok_or_else(|| ipc_err("no project open"))?;
    proj.tabs_store.load().await.map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_save_console_tabs(
    env: State<'_, Arc<AppEnvironment>>,
    tabs: Vec<PersistedConsoleTab>,
) -> Result<(), IpcError> {
    let proj = env.project.read().await;
    let proj = proj.as_ref().ok_or_else(|| ipc_err("no project open"))?;
    proj.tabs_store.save(&tabs).await.map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_move_tab_to_project(
    env: State<'_, Arc<AppEnvironment>>,
    id: String,
) -> Result<String, IpcError> {
    let proj = env.project.read().await;
    let proj = proj.as_ref().ok_or_else(|| ipc_err("no project open"))?;
    proj.tabs_store.move_to_project(&id).await.map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_move_tab_to_scratch(
    env: State<'_, Arc<AppEnvironment>>,
    id: String,
) -> Result<(), IpcError> {
    let proj = env.project.read().await;
    let proj = proj.as_ref().ok_or_else(|| ipc_err("no project open"))?;
    proj.tabs_store.move_to_scratch(&id).await.map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_app_preferences_load(
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<AppPreferences, IpcError> {
    env.preferences_store.load().await.map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_app_preferences_save(
    env: State<'_, Arc<AppEnvironment>>,
    prefs: AppPreferences,
) -> Result<(), IpcError> {
    // Toggle debug-log collection live so the change takes effect without a restart.
    env.debug_log.set_enabled(prefs.debug_mode);
    env.preferences_store.save(&prefs).await.map_err(ipc_err)?;
    *env.preferences.write().await = prefs;
    Ok(())
}

#[tauri::command]
pub async fn cmd_list_editor_fonts() -> Result<Vec<String>, IpcError> {
    list_editor_fonts().await.map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_load_pinned_queries(
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<Vec<PersistedPinnedQuery>, IpcError> {
    let proj = env.project.read().await;
    let proj = proj.as_ref().ok_or_else(|| ipc_err("no project open"))?;
    proj.pinned_queries_store.load().await.map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_save_pinned_queries(
    env: State<'_, Arc<AppEnvironment>>,
    queries: Vec<PersistedPinnedQuery>,
) -> Result<(), IpcError> {
    let proj = env.project.read().await;
    let proj = proj.as_ref().ok_or_else(|| ipc_err("no project open"))?;
    proj.pinned_queries_store
        .save(&queries)
        .await
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_load_run_history(
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<Vec<PersistedRunHistoryEntry>, IpcError> {
    let proj = env.project.read().await;
    let proj = proj.as_ref().ok_or_else(|| ipc_err("no project open"))?;
    proj.run_history_store.load().await.map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_save_run_history(
    env: State<'_, Arc<AppEnvironment>>,
    runs: Vec<PersistedRunHistoryEntry>,
) -> Result<(), IpcError> {
    let proj = env.project.read().await;
    let proj = proj.as_ref().ok_or_else(|| ipc_err("no project open"))?;
    proj.run_history_store.save(&runs).await.map_err(ipc_err)
}

#[cfg(test)]
mod tests {
    use crate::helpers::list_editor_fonts;

    #[tokio::test]
    async fn list_editor_fonts_returns_sorted_list() {
        let fonts = list_editor_fonts().await.unwrap();
        let mut sorted = fonts.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(fonts, sorted);
    }
}
