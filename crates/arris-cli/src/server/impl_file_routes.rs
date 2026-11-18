use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use arris_engines::search::{ContentMatch, FileMatch};
use arris_engines::{AppEnvironment, FileTreeEntry, SystemClipboard};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};

use super::impl_api_routes::{ApiResult, ApiState, Body};
use super::{
    ApiError, ApiRoutes, CLIPBOARD_FILE_PATHS_ROUTE, CONTENT_SEARCH_ROUTE, ENTRY_COPY_ROUTE,
    ENTRY_DELETE_ROUTE, ENTRY_DUPLICATE_ROUTE, ENTRY_MOVE_ROUTE, ENTRY_RENAME_ROUTE, EmptyResponse,
    FILE_CREATE_ROUTE, FILE_INDEX_CLOSE_ROUTE, FILE_INDEX_OPEN_ROUTE, FILE_OPEN_DEFAULT_ROUTE,
    FILE_READ_BASE64_ROUTE, FILE_READ_ROUTE, FILE_SEARCH_ROUTE, FILE_TREE_ROUTE, FILE_WRITE_ROUTE,
    FOLDER_CREATE_ROUTE, FileMoveRequest, FilePathRequest, FileSearchRequest, FileTreeRequest,
    FileWriteRequest, OPEN_DEFAULT_COMMAND, ServerState, TAB_MOVE_TO_PROJECT_ROUTE,
    TAB_MOVE_TO_SCRATCH_ROUTE, TabIdRequest,
};

/// The desktop file tree's commands over HTTP, each path confined to the project root.
pub struct FileRoutes;

impl FileRoutes {
    pub fn router() -> Router<Arc<ServerState>> {
        Router::new()
            .route(FILE_TREE_ROUTE, post(Self::file_tree))
            .route(FILE_READ_ROUTE, post(Self::file_read))
            .route(FILE_READ_BASE64_ROUTE, post(Self::file_read_base64))
            .route(FILE_WRITE_ROUTE, post(Self::file_write))
            .route(FILE_CREATE_ROUTE, post(Self::file_create))
            .route(FOLDER_CREATE_ROUTE, post(Self::folder_create))
            .route(ENTRY_RENAME_ROUTE, post(Self::entry_rename))
            .route(ENTRY_DELETE_ROUTE, post(Self::entry_delete))
            .route(ENTRY_COPY_ROUTE, post(Self::entry_copy))
            .route(ENTRY_MOVE_ROUTE, post(Self::entry_move))
            .route(ENTRY_DUPLICATE_ROUTE, post(Self::entry_duplicate))
            .route(FILE_OPEN_DEFAULT_ROUTE, post(Self::file_open_default))
            .route(CLIPBOARD_FILE_PATHS_ROUTE, post(Self::clipboard_file_paths))
            .route(FILE_INDEX_OPEN_ROUTE, post(Self::file_index_open))
            .route(FILE_INDEX_CLOSE_ROUTE, post(Self::file_index_close))
            .route(FILE_SEARCH_ROUTE, post(Self::file_search))
            .route(CONTENT_SEARCH_ROUTE, post(Self::content_search))
            .route(TAB_MOVE_TO_PROJECT_ROUTE, post(Self::tab_move_to_project))
            .route(TAB_MOVE_TO_SCRATCH_ROUTE, post(Self::tab_move_to_scratch))
    }

    /// Refuses `path` unless it resolves inside `root`; a missing leaf resolves via its parent.
    fn confine(root: &Path, path: &Path) -> Result<(), ApiError> {
        let outside = || ApiError::PathOutsideProject(path.display().to_string());
        let root = root.canonicalize().map_err(|_| outside())?;
        let resolved = match path.canonicalize() {
            Ok(resolved) => resolved,
            Err(_) => {
                let parent = path.parent().ok_or_else(outside)?;
                let name = path.file_name().ok_or_else(outside)?;
                parent.canonicalize().map_err(|_| outside())?.join(name)
            }
        };
        if resolved.starts_with(&root) {
            Ok(())
        } else {
            Err(outside())
        }
    }

    /// The project root after checking every path in `paths` against it.
    async fn root_for(
        state: &ServerState,
        headers: &HeaderMap,
        paths: &[&Path],
    ) -> Result<PathBuf, ApiError> {
        let root = ApiRoutes::project_root(state, headers).await?;
        for path in paths {
            Self::confine(&root, path)?;
        }
        Ok(root)
    }

    /// Runs blocking file work off the async runtime with the shared environment.
    async fn blocking<T, E>(
        state: &ServerState,
        work: impl FnOnce(&AppEnvironment) -> Result<T, E> + Send + 'static,
    ) -> Result<T, ApiError>
    where
        T: Send + 'static,
        E: Into<ApiError> + Send + 'static,
    {
        let env = state.env.clone();
        tokio::task::spawn_blocking(move || work(&env))
            .await
            .map_err(|e| ApiError::Task(e.to_string()))?
            .map_err(Into::into)
    }

    async fn file_tree(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FileTreeRequest>,
    ) -> ApiResult<FileTreeEntry> {
        let Json(req) = body?;
        Self::root_for(&state, &headers, &[&req.root]).await?;
        let tree = Self::blocking(&state, move |env| {
            env.file.list_folder_tree(req.root, &req.skip_dirs)
        })
        .await?;
        Ok(Json(tree))
    }

    async fn file_read(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FilePathRequest>,
    ) -> ApiResult<String> {
        let Json(req) = body?;
        Self::root_for(&state, &headers, &[&req.path]).await?;
        let text = Self::blocking(&state, move |env| env.file.read_text_file(req.path)).await?;
        Ok(Json(text))
    }

    async fn file_read_base64(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FilePathRequest>,
    ) -> ApiResult<String> {
        let Json(req) = body?;
        Self::root_for(&state, &headers, &[&req.path]).await?;
        let data = Self::blocking(&state, move |env| env.file.read_file_base64(req.path)).await?;
        Ok(Json(data))
    }

    async fn file_write(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FileWriteRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        Self::root_for(&state, &headers, &[&req.path]).await?;
        Self::blocking(&state, move |env| {
            env.file.write_text_file(req.path, req.content)
        })
        .await?;
        Ok(Json(EmptyResponse {}))
    }

    async fn file_create(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FilePathRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        Self::root_for(&state, &headers, &[&req.path]).await?;
        Self::blocking(&state, move |env| env.file.create_file(req.path)).await?;
        Ok(Json(EmptyResponse {}))
    }

    async fn folder_create(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FilePathRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        Self::root_for(&state, &headers, &[&req.path]).await?;
        Self::blocking(&state, move |env| env.file.create_folder(req.path)).await?;
        Ok(Json(EmptyResponse {}))
    }

    async fn entry_rename(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FileMoveRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        Self::root_for(&state, &headers, &[&req.from, &req.to]).await?;
        Self::blocking(&state, move |env| env.file.rename_entry(req.from, req.to)).await?;
        Ok(Json(EmptyResponse {}))
    }

    async fn entry_delete(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FilePathRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        let root = Self::root_for(&state, &headers, &[&req.path]).await?;
        if req.path.canonicalize().ok() == root.canonicalize().ok() {
            return Err(ApiError::PathOutsideProject(req.path.display().to_string()));
        }
        Self::blocking(&state, move |env| env.file.delete_entry(req.path)).await?;
        Ok(Json(EmptyResponse {}))
    }

    /// The source may also be a file copied in Finder, which pastes it into the project.
    async fn entry_copy(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FileMoveRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        let root = Self::root_for(&state, &headers, &[&req.to]).await?;
        if Self::confine(&root, &req.from).is_err() {
            let on_clipboard = SystemClipboard::file_paths()
                .iter()
                .any(|p| Path::new(p) == req.from);
            if !on_clipboard {
                return Err(ApiError::PathOutsideProject(req.from.display().to_string()));
            }
        }
        Self::blocking(&state, move |env| env.file.copy_entry(req.from, req.to)).await?;
        Ok(Json(EmptyResponse {}))
    }

    async fn entry_move(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FileMoveRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        Self::root_for(&state, &headers, &[&req.from, &req.to]).await?;
        Self::blocking(&state, move |env| env.file.move_entry(req.from, req.to)).await?;
        Ok(Json(EmptyResponse {}))
    }

    async fn entry_duplicate(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FilePathRequest>,
    ) -> ApiResult<PathBuf> {
        let Json(req) = body?;
        Self::root_for(&state, &headers, &[&req.path]).await?;
        let copy = Self::blocking(&state, move |env| env.file.duplicate_entry(req.path)).await?;
        Ok(Json(copy))
    }

    /// The server runs on the user's machine, so the OS opens the file there.
    async fn file_open_default(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FilePathRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        Self::root_for(&state, &headers, &[&req.path]).await?;
        Command::new(OPEN_DEFAULT_COMMAND)
            .arg(&req.path)
            .spawn()
            .map_err(arris_engines::file::FileError::from)?;
        Ok(Json(EmptyResponse {}))
    }

    async fn clipboard_file_paths(
        State(state): ApiState,
        headers: HeaderMap,
    ) -> ApiResult<Vec<String>> {
        ApiRoutes::project_root(&state, &headers).await?;
        Ok(Json(SystemClipboard::file_paths()))
    }

    // shortcut: one search index per server, so two projects open at once share the last opened.
    async fn file_index_open(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FilePathRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        Self::root_for(&state, &headers, &[&req.path]).await?;
        Self::blocking(&state, move |env| env.search.open_index(req.path)).await?;
        Ok(Json(EmptyResponse {}))
    }

    async fn file_index_close(
        State(state): ApiState,
        headers: HeaderMap,
    ) -> ApiResult<EmptyResponse> {
        ApiRoutes::project_root(&state, &headers).await?;
        Self::blocking(&state, |env| env.search.close_index()).await?;
        Ok(Json(EmptyResponse {}))
    }

    async fn file_search(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FileSearchRequest>,
    ) -> ApiResult<Vec<FileMatch>> {
        let Json(req) = body?;
        ApiRoutes::project_root(&state, &headers).await?;
        let found = Self::blocking(&state, move |env| {
            env.search.search_files(&req.query, req.limit)
        })
        .await?;
        Ok(Json(found))
    }

    async fn content_search(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<FileSearchRequest>,
    ) -> ApiResult<Vec<ContentMatch>> {
        let Json(req) = body?;
        ApiRoutes::project_root(&state, &headers).await?;
        let found = Self::blocking(&state, move |env| {
            env.search.search_content(&req.query, req.limit)
        })
        .await?;
        Ok(Json(found))
    }

    async fn tab_move_to_project(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<TabIdRequest>,
    ) -> ApiResult<String> {
        let Json(req) = body?;
        let project = ApiRoutes::project(&state, &headers).await?;
        let path = project
            .read()
            .await
            .tabs_store
            .move_to_project(&req.id)
            .await?;
        Ok(Json(path))
    }

    async fn tab_move_to_scratch(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<TabIdRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        let project = ApiRoutes::project(&state, &headers).await?;
        project
            .read()
            .await
            .tabs_store
            .move_to_scratch(&req.id)
            .await?;
        Ok(Json(EmptyResponse {}))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use axum::http::StatusCode;
    use serde_json::json;

    use super::*;
    use crate::server::impl_api_routes::tests::Harness;

    fn path_in(h: &Harness, name: &str) -> String {
        h.project.path().join(name).to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn tree_write_read_rename_and_delete_round_trip() {
        let h = Harness::start().await;
        let root = h.project.path().to_string_lossy().into_owned();
        let a = path_in(&h, "a.sql");
        let b = path_in(&h, "b.sql");
        h.ok("file_create", json!({ "path": a })).await;
        h.ok("file_write", json!({ "path": a, "content": "select 1" }))
            .await;
        assert_eq!(
            h.ok("file_read", json!({ "path": a })).await,
            json!("select 1")
        );
        h.ok("entry_rename", json!({ "from": a, "to": b })).await;
        let tree = h
            .ok("file_tree", json!({ "root": root, "skipDirs": [] }))
            .await;
        let names: Vec<&str> = tree["children"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|c| c["name"].as_str())
            .collect();
        assert!(
            names.contains(&"b.sql") && !names.contains(&"a.sql"),
            "{names:?}"
        );
        h.ok("entry_delete", json!({ "path": b })).await;
        assert!(!h.project.path().join("b.sql").exists());
    }

    #[tokio::test]
    async fn paths_outside_the_project_are_refused() {
        let h = Harness::start().await;
        let outside = tempfile::TempDir::new().unwrap();
        let secret = outside.path().join("secret.txt");
        fs::write(&secret, "x").unwrap();
        let escape = h.project.path().join("..").join("escape.txt");
        let root = h.project.path().to_string_lossy().into_owned();
        for (cmd, body) in [
            ("file_read", json!({ "path": secret })),
            ("file_write", json!({ "path": escape, "content": "x" })),
            (
                "entry_copy",
                json!({ "from": secret, "to": path_in(&h, "s.txt") }),
            ),
            ("entry_delete", json!({ "path": root })),
        ] {
            let resp = h.call(cmd, body).await;
            assert_eq!(resp.status(), StatusCode::FORBIDDEN, "{cmd}");
        }
        assert!(!h.project.path().join("s.txt").exists());
    }

    #[test]
    fn confine_resolves_a_missing_leaf_through_its_parent() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(FileRoutes::confine(dir.path(), &dir.path().join("new.sql")).is_ok());
        assert!(FileRoutes::confine(dir.path(), &dir.path().join("no/such/new.sql")).is_err());
    }
}
