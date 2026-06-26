#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod clipboard;
mod commands;
mod helpers;
mod watcher;

use std::sync::Arc;

use arris_engines::{AppEnvironment, DebugLogging};
use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use commands::*;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let env = tauri::async_runtime::block_on(async {
                AppEnvironment::init().await.expect("init AppEnvironment")
            });
            if let Err(err) = DebugLogging::install(&env.debug_log) {
                eprintln!("failed to initialize logging: {err}");
            }
            app.manage(env);
            app.manage(AgentRuns::default());
            app.manage(watcher::ProjectWatcher::default());

            let about = AboutMetadataBuilder::new()
                .name(Some("Arris".to_string()))
                .build();
            let settings_item = MenuItemBuilder::with_id("menu_open_settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            let app_submenu = SubmenuBuilder::new(app, "Arris")
                .about(Some(about))
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let new_project_item =
                MenuItemBuilder::with_id("menu_new_project", "New Project...")
                    .accelerator("CmdOrCtrl+Shift+N")
                    .build(app)?;
            let open_project_item = MenuItemBuilder::with_id("menu_open_project", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save_file_item = MenuItemBuilder::with_id("menu_save_file", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let close_editor_item =
                MenuItemBuilder::with_id("menu_close_editor", "Close Editor")
                    .accelerator("CmdOrCtrl+W")
                    .build(app)?;
            let file_submenu = SubmenuBuilder::new(app, "File")
                .item(&new_project_item)
                .item(&open_project_item)
                .separator()
                .item(&save_file_item)
                .separator()
                .item(&close_editor_item)
                .build()?;
            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let view_submenu = SubmenuBuilder::new(app, "View").fullscreen().build()?;
            let show_debug_logs_item =
                MenuItemBuilder::with_id("menu_show_debug_logs", "Show Debug Logs in Finder")
                    .build(app)?;
            let show_license_rust_item =
                MenuItemBuilder::with_id("menu_show_license_rust", "Show License (Rust)")
                    .build(app)?;
            let show_license_js_item =
                MenuItemBuilder::with_id("menu_show_license_js", "Show License (JavaScript)")
                    .build(app)?;
            let help_submenu = SubmenuBuilder::new(app, "Help")
                .item(&show_debug_logs_item)
                .separator()
                .item(&show_license_rust_item)
                .item(&show_license_js_item)
                .build()?;
            let menu = MenuBuilder::new(app)
                .items(&[
                    &app_submenu,
                    &file_submenu,
                    &edit_submenu,
                    &view_submenu,
                    &help_submenu,
                ])
                .build()?;
            app.set_menu(menu)?;
            app.on_menu_event(move |handle, event| {
                let id = event.id().as_ref();
                if id == "menu_open_settings" {
                    let _ = handle.emit("menu:open-settings", ());
                } else if id == "menu_new_project" {
                    let _ = handle.emit("menu:new-project", ());
                } else if id == "menu_open_project" {
                    let _ = handle.emit("menu:open-project", ());
                } else if id == "menu_save_file" {
                    let _ = handle.emit("menu:save-file", ());
                } else if id == "menu_close_editor" {
                    let _ = handle.emit("menu:close-editor", ());
                } else if id == "menu_show_debug_logs" {
                    if let Some(env) = handle.try_state::<Arc<AppEnvironment>>() {
                        let dir = env.debug_log.logs_dir().to_path_buf();
                        // Create the dir so Finder always has a folder to open,
                        // even before debug mode has written its first line.
                        let _ = std::fs::create_dir_all(&dir);
                        let _ = handle
                            .opener()
                            .open_path(dir.to_string_lossy().to_string(), None::<&str>);
                    }
                } else if id == "menu_show_license_rust" {
                    let _ = handle.emit("menu:show-license-rust", ());
                } else if id == "menu_show_license_js" {
                    let _ = handle.emit("menu:show-license-js", ());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_terminal_list_shells,
            cmd_list_connections,
            cmd_save_connection,
            cmd_reorder_connections,
            cmd_delete_connection,
            cmd_promote_connection,
            cmd_import_connection,
            cmd_connect,
            cmd_disconnect,
            cmd_test_connection,
            cmd_list_schemas,
            cmd_list_schema,
            cmd_run_query,
            cmd_cancel_query,
            cmd_run_federation_query,
            cmd_explain_query,
            cmd_primary_key,
            cmd_object_definition,
            cmd_table_browse_query,
            cmd_apply_mutations,
            cmd_set_transaction_config,
            cmd_commit_transaction,
            cmd_rollback_transaction,
            cmd_git_clone,
            cmd_git_checkout,
            cmd_git_delete_branch,
            cmd_git_remove_worktree,

            cmd_load_console_tabs,
            cmd_save_console_tabs,
            cmd_move_tab_to_project,
            cmd_move_tab_to_scratch,
            cmd_app_preferences_load,
            cmd_app_preferences_save,
            cmd_list_editor_fonts,
            cmd_open_project,
            cmd_close_project,
            cmd_scan_dbt_project,
            cmd_dbt_check_cli,
            cmd_dbt_run,
            cmd_dbt_test,
            cmd_dbt_build,
            cmd_dbt_debug,
            cmd_dbt_compile,
            cmd_dbt_docs_generate,
            cmd_dbt_docs_load,
            cmd_dbt_read_run_results,
            cmd_dbt_list_profiles,
            cmd_dbt_column_lineage,
            cmd_dbt_slim_diff,
            cmd_scan_sqlmesh_project,
            cmd_sqlmesh_check_cli,
            cmd_sqlmesh_plan,
            cmd_sqlmesh_promote,
            cmd_sqlmesh_test,
            cmd_sqlmesh_test_target,
            cmd_sqlmesh_run,
            cmd_sqlmesh_lint,
            cmd_sqlmesh_audit,
            cmd_sqlmesh_render,
            cmd_sqlmesh_column_lineage,
            cmd_sqlmesh_list_gateways,
            cmd_sqlmesh_list_environments,
            cmd_git_worktree_list,
            cmd_git_worktree_name,
            cmd_git_current_branch,
            cmd_git_file_statuses,
            cmd_git_file_diff_hunks,
            cmd_git_stage_hunk,
            cmd_git_restore_hunk,
            cmd_git_stage_files,
            cmd_git_unstage_files,
            cmd_git_discard_files,
            cmd_git_stage_all,
            cmd_git_unstage_all,
            cmd_git_commit,
            cmd_git_push,
            cmd_git_push_state,
            cmd_git_last_commit,
            cmd_git_ahead_behind,
            cmd_git_file_diff_stats,
            cmd_git_list_branches,
            cmd_git_list_remotes,
            cmd_git_set_remote_url,
            cmd_git_fetch,
            cmd_git_pull,
            cmd_git_pull_from,
            cmd_git_push_to,
            cmd_git_force_push,
            cmd_git_merge_state,
            cmd_git_conflict_versions,
            cmd_git_resolve_ours,
            cmd_git_resolve_theirs,
            cmd_git_write_resolved,
            cmd_git_merge_continue,
            cmd_git_merge_abort,
            cmd_git_commit_graph,
            cmd_git_search_commits,
            cmd_git_commit_detail,
            cmd_git_commit_diff,
            cmd_load_pinned_queries,
            cmd_save_pinned_queries,
            cmd_load_run_history,
            cmd_save_run_history,
            cmd_load_federation_tabs,
            cmd_save_federation_tabs,
            cmd_parse_federation_refs,
            cmd_list_folder_tree,
            cmd_write_text_file,
            cmd_read_text_file,
            cmd_read_file_base64,
            cmd_read_clipboard_file_paths,
            cmd_open_in_default_app,
            cmd_create_file,
            cmd_create_folder,
            cmd_rename_entry,
            cmd_delete_entry,
            cmd_copy_entry,
            cmd_move_entry,
            cmd_duplicate_entry,
            cmd_open_file_index,
            cmd_close_file_index,
            cmd_search_files,
            cmd_search_content,
            cmd_agent_send,
            cmd_agent_check,
            cmd_agent_cancel,
            cmd_python_list_interpreters,
            cmd_python_add_interpreter,
            cmd_python_create_venv,
            cmd_python_ensure_kernel,
            cmd_python_start_kernel,
            cmd_python_execute,
            cmd_python_complete,
            cmd_python_interrupt,
            cmd_python_shutdown,
            cmd_notebook_run_sql,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
