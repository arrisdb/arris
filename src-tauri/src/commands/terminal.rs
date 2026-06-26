use std::path::Path;

use arris_engines::{IpcError, TerminalEngine};

#[tauri::command]
pub async fn cmd_terminal_list_shells() -> Result<Vec<String>, IpcError> {
    Ok(TerminalEngine::collect_shells(
        std::env::var("SHELL").ok(),
        |path| Path::new(path).exists(),
    ))
}
