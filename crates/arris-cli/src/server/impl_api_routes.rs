use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use arris_engines::persistence::ProjectManifest;
use arris_engines::query::QueryError;
use arris_engines::{
    CONNECTION_SCOPE_LOCAL, ConnectionConfig, JsonCollectionStore, JsonSingletonStore,
    PersistedConsoleTab, PersistedPinnedQuery, ProjectState, QueryEngine, QueryLanguage,
    QueryRequest, QueryResult, RUN_PREVIEW_MAX_ROWS, RunPreview, RunRecord, RunSource, RunStatus,
    SchemaNode, ScopedConnection, StoreError,
};
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use chrono::Utc;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::{
    AnalyticsRoutes, ApiError, CONNECTION_LIST_ROUTE, CONNECTION_NEW_PAGE, CONNECTION_REMOVE_ROUTE,
    CONNECTION_REQUEST_CANCEL_ROUTE, CONNECTION_REQUEST_CREATE_ROUTE, CONNECTION_REQUEST_GET_ROUTE,
    CONNECTION_REQUEST_WAIT_ROUTE, CONNECTION_REQUEST_WAIT_SECS, CONNECTION_SAVE_ROUTE,
    CONNECTION_TEST_ROUTE, CanvasRoutes, CanvasRunRoutes, ConnectionRefRequest, ConnectionRequest,
    ConnectionRequestCreateRequest, ConnectionRequestCreateResponse, ConnectionRequestIdRequest,
    ConnectionRequestResolvedPayload, ConnectionRequestStatus, ConnectionSaveRequest,
    ConnectionTestRequest, DEFAULT_TAB_TYPE, EmptyResponse, FileRoutes, HISTORY_DEFAULT_LIMIT,
    HISTORY_LIST_ROUTE, HandoffTarget, HistoryListRequest, OBJECT_DEFINITION_ROUTE,
    ObjectDefinitionRequest, OkResponse, PIN_ADD_ROUTE, PIN_LIST_ROUTE, PIN_REMOVE_ROUTE,
    PIN_RENAME_ROUTE, PIN_SAVE_ROUTE, PROJECT_HEADER, PROJECT_LIST_ROUTE, PROJECT_QUERY_PARAM,
    PinAddRequest, PinRemoveRequest, PinRenameRequest, PinSaveRequest, QUERY_DEFAULT_LIMIT,
    QUERY_DEFAULT_SOURCE, QUERY_FIRST_PAGE, QUERY_HANDOFF_TAKE_ROUTE, QUERY_OPEN_POLL_MS,
    QUERY_OPEN_ROUTE, QUERY_OPEN_WAIT_MS, QUERY_PAGE_ROUTE, QUERY_RUN_ROUTE, QueryHandoff,
    QueryOpenRequest, QueryOpenResponse, QueryPageRequest, QueryRunRequest, QueryRunResponse,
    REQUEST_QUERY_PARAM, RUN_GET_ROUTE, RUN_PAGE_MAX_LIMIT, RUN_PAGE_ROUTE, RUN_RESULTS_BOARD,
    RunGetResponse, RunIdRequest, RunPageRequest, SCHEMA_LIST_ROUTE, SchemaListRequest, Server,
    ServerEvent, ServerEventKind, ServerState, TAB_CLOSE_ROUTE, TAB_LIST_ROUTE,
    TABLE_BROWSE_DEFAULT_LIMIT, TABLE_BROWSE_QUERY_ROUTE, TabCloseRequest, TabCloseResponse,
    TabSummary, TableBrowseQueryRequest, ToolRunRoutes, UI_CONTEXT_ROUTE, UI_CONTEXT_SAVE_ROUTE,
    UiContext, UiContextResponse, WORKSPACE_LAYOUT_SAVE_ROUTE, WORKSPACE_LOAD_ROUTE,
    WORKSPACE_TABS_SAVE_ROUTE, WorkspaceLayoutSaveRequest, WorkspaceResponse,
    WorkspaceTabsSaveRequest,
};

pub(super) type ApiState = State<Arc<ServerState>>;
pub(super) type Body<T> = Result<Json<T>, JsonRejection>;
pub(super) type ApiResult<T> = Result<Json<T>, ApiError>;

/// `POST /api/<cmd>` handlers; every command but `project_list` reads `PROJECT_HEADER`.
pub struct ApiRoutes;

impl ApiRoutes {
    pub fn router() -> Router<Arc<ServerState>> {
        Router::new()
            .route(CONNECTION_LIST_ROUTE, post(Self::connection_list))
            .route(CONNECTION_SAVE_ROUTE, post(Self::connection_save))
            .route(CONNECTION_TEST_ROUTE, post(Self::connection_test))
            .route(CONNECTION_REMOVE_ROUTE, post(Self::connection_remove))
            .route(SCHEMA_LIST_ROUTE, post(Self::schema_list))
            .route(OBJECT_DEFINITION_ROUTE, post(Self::object_definition))
            .route(TABLE_BROWSE_QUERY_ROUTE, post(Self::table_browse_query))
            .route(QUERY_RUN_ROUTE, post(Self::query_run))
            .route(QUERY_PAGE_ROUTE, post(Self::query_page))
            .route(QUERY_OPEN_ROUTE, post(Self::query_open))
            .route(QUERY_HANDOFF_TAKE_ROUTE, post(Self::query_handoff_take))
            .route(TAB_LIST_ROUTE, post(Self::tab_list))
            .route(TAB_CLOSE_ROUTE, post(Self::tab_close))
            .route(UI_CONTEXT_SAVE_ROUTE, post(Self::ui_context_save))
            .route(UI_CONTEXT_ROUTE, post(Self::ui_context))
            .route(HISTORY_LIST_ROUTE, post(Self::history_list))
            .route(RUN_GET_ROUTE, post(Self::run_get))
            .route(RUN_PAGE_ROUTE, post(Self::run_page))
            .route(PIN_RENAME_ROUTE, post(Self::pin_rename))
            .route(PIN_ADD_ROUTE, post(Self::pin_add))
            .route(PIN_REMOVE_ROUTE, post(Self::pin_remove))
            .route(PIN_SAVE_ROUTE, post(Self::pin_save))
            .route(WORKSPACE_LOAD_ROUTE, post(Self::workspace_load))
            .route(WORKSPACE_TABS_SAVE_ROUTE, post(Self::workspace_tabs_save))
            .route(
                WORKSPACE_LAYOUT_SAVE_ROUTE,
                post(Self::workspace_layout_save),
            )
            .route(PIN_LIST_ROUTE, post(Self::pin_list))
            .route(PROJECT_LIST_ROUTE, post(Self::project_list))
            .merge(CanvasRoutes::router())
            .merge(CanvasRunRoutes::router())
            .merge(AnalyticsRoutes::router())
            .merge(ToolRunRoutes::router())
            .merge(FileRoutes::router())
            .route(
                CONNECTION_REQUEST_CREATE_ROUTE,
                post(Self::connection_request_create),
            )
            .route(
                CONNECTION_REQUEST_GET_ROUTE,
                post(Self::connection_request_get),
            )
            .route(
                CONNECTION_REQUEST_WAIT_ROUTE,
                post(Self::connection_request_wait),
            )
            .route(
                CONNECTION_REQUEST_CANCEL_ROUTE,
                post(Self::connection_request_cancel),
            )
    }
}

// Request resolution helpers.
impl ApiRoutes {
    pub(super) async fn project(
        state: &ServerState,
        headers: &HeaderMap,
    ) -> Result<Arc<RwLock<ProjectState>>, ApiError> {
        let root = headers
            .get(PROJECT_HEADER)
            .and_then(|v| v.to_str().ok())
            .ok_or(ApiError::MissingProject)?;
        Ok(state.env.project(Path::new(root)).await?)
    }

    pub(super) async fn project_root(
        state: &ServerState,
        headers: &HeaderMap,
    ) -> Result<PathBuf, ApiError> {
        let project = Self::project(state, headers).await?;
        Ok(project.read().await.root.clone())
    }

    fn emit_resolved(
        state: &ServerState,
        project: &ProjectState,
        id: String,
        status: ConnectionRequestStatus,
    ) {
        let payload = ConnectionRequestResolvedPayload { id, status };
        Self::emit(
            state,
            ServerEventKind::ConnectionRequestResolved,
            project,
            payload,
        );
    }

    /// UUID match first, then case-insensitive name.
    pub(super) async fn resolve_connection(
        state: &ServerState,
        project: &ProjectState,
        connection: &str,
    ) -> Result<ConnectionConfig, ApiError> {
        let by_id = match Uuid::parse_str(connection) {
            Ok(id) => {
                state
                    .env
                    .connection
                    .find_connection(id, Some(project))
                    .await
            }
            Err(_) => None,
        };
        match by_id {
            Some(cfg) => Ok(cfg),
            None => state
                .env
                .connection
                .find_connection_by_name(connection, Some(project))
                .await
                .ok_or_else(|| ApiError::ConnectionNotFound(connection.to_owned())),
        }
    }

    /// Global and project connections with secrets cleared for the browser.
    async fn scrubbed_connections(
        state: &ServerState,
        project: &ProjectState,
    ) -> Vec<ScopedConnection> {
        state
            .env
            .connection
            .all_connections(Some(project))
            .await
            .into_iter()
            .map(ScopedConnection::scrubbed)
            .collect()
    }

    pub(super) fn emit(
        state: &ServerState,
        kind: ServerEventKind,
        project: &ProjectState,
        payload: impl serde::Serialize,
    ) {
        state.emit(ServerEvent {
            kind,
            project: Some(project.root.clone()),
            payload: serde_json::to_value(payload).unwrap_or_default(),
        });
    }

    fn finish_run(run: &mut RunRecord, outcome: &Result<QueryResult, QueryError>) {
        run.finished_at = Some(Utc::now());
        match outcome {
            Ok(result) => {
                run.status = RunStatus::Success;
                // DML returns no rows; its affected count is the meaningful size.
                run.row_count = Some(match result.rows_affected {
                    Some(n) if result.rows.is_empty() => n.max(0) as u64,
                    _ => result.rows.len() as u64,
                });
                run.preview = Some(RunPreview {
                    columns: result.columns.clone(),
                    rows: result
                        .rows
                        .iter()
                        .take(RUN_PREVIEW_MAX_ROWS)
                        .cloned()
                        .collect(),
                    truncated: result.rows.len() > RUN_PREVIEW_MAX_ROWS
                        || result.has_more == Some(true),
                });
            }
            Err(e) => {
                run.status = RunStatus::Error;
                run.error = Some(e.to_string());
            }
        }
    }
}

// Connection and schema commands.
impl ApiRoutes {
    async fn connection_list(
        State(state): ApiState,
        headers: HeaderMap,
    ) -> ApiResult<Vec<ScopedConnection>> {
        let project = Self::project(&state, &headers).await?;
        let project = project.read().await;
        Ok(Json(Self::scrubbed_connections(&state, &project).await))
    }

    async fn connection_save(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<ConnectionSaveRequest>,
    ) -> ApiResult<ScopedConnection> {
        let Json(ConnectionSaveRequest {
            mut config,
            request_id,
        }) = body?;
        let project = Self::project(&state, &headers).await?;
        let mut project = project.write().await;
        // Reject a foreign, unknown or settled request before anything is written.
        if let Some(id) = &request_id {
            let request = state.connection_requests.get(id, &project.root)?;
            if request.status != ConnectionRequestStatus::Pending {
                return Err(ApiError::Conflict(id.clone()));
            }
        }
        // Unknown ids get a fresh one so a save cannot clobber another project's secrets or driver.
        if !project.connections.iter().any(|c| c.id == config.id) {
            config.id = Uuid::new_v4();
        }
        let id = config.id;
        // Clients only see scrubbed configs, so an empty secret on an edit means "unchanged".
        state
            .env
            .connection
            .fill_stored_secrets(&mut config, Some(&project))
            .await;
        state
            .env
            .connection
            .save_connection(config, CONNECTION_SCOPE_LOCAL, Some(&mut project))
            .await?;
        let summary = Self::scrubbed_connections(&state, &project)
            .await
            .into_iter()
            .find(|c| c.config.id == id)
            .ok_or_else(|| ApiError::ConnectionNotFound(id.to_string()))?;
        Self::emit(
            &state,
            ServerEventKind::ConnectionsChanged,
            &project,
            &summary,
        );
        if let Some(request_id) = request_id {
            let saved = ConnectionRequestStatus::Saved {
                connection_id: id,
                name: summary.config.name.clone(),
            };
            let changed =
                state
                    .connection_requests
                    .resolve(&request_id, &project.root, saved.clone())?;
            if changed {
                Self::emit_resolved(&state, &project, request_id, saved);
            }
        }
        Ok(Json(summary))
    }

    async fn connection_test(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<ConnectionTestRequest>,
    ) -> ApiResult<OkResponse> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let project = project.read().await;
        let config = match (req.config, req.connection) {
            (Some(mut config), _) => {
                state
                    .env
                    .connection
                    .fill_stored_secrets(&mut config, Some(&project))
                    .await;
                config
            }
            (None, Some(connection)) => {
                Self::resolve_connection(&state, &project, &connection).await?
            }
            (None, None) => return Err(ApiError::MissingTestTarget),
        };
        drop(project);
        state.env.connection.test_connection(&config).await?;
        Ok(Json(OkResponse { ok: true }))
    }

    async fn connection_remove(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<ConnectionRefRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let mut project = project.write().await;
        let config = Self::resolve_connection(&state, &project, &req.connection).await?;
        state
            .env
            .connection
            .delete_connection(config.id, Some(&mut project))
            .await?;
        Self::emit(
            &state,
            ServerEventKind::ConnectionsChanged,
            &project,
            config.id,
        );
        Ok(Json(EmptyResponse {}))
    }

    async fn schema_list(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<SchemaListRequest>,
    ) -> ApiResult<Vec<SchemaNode>> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let config =
            Self::resolve_connection(&state, &*project.read().await, &req.connection).await?;
        // Connect unlocked so a slow driver cannot stall writers on this project.
        let driver = state.env.connection.open_connection(&config).await?;
        let query = &state.env.query;
        let nodes = match req.schema {
            Some(schema) => query.list_schema_on(driver, &schema).await?,
            None => query.list_schemas_on(driver).await?,
        };
        Ok(Json(nodes))
    }

    async fn table_browse_query(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<TableBrowseQueryRequest>,
    ) -> ApiResult<String> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let guard = project.read().await;
        let config = Self::resolve_connection(&state, &guard, &req.connection).await?;
        let limit = req.limit.unwrap_or(TABLE_BROWSE_DEFAULT_LIMIT);
        let sql = QueryEngine::table_browse_query(
            config.id,
            &state.env.connection,
            Some(&guard),
            &req.table,
            limit,
        )
        .await?;
        Ok(Json(sql))
    }

    async fn object_definition(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<ObjectDefinitionRequest>,
    ) -> ApiResult<String> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let config =
            Self::resolve_connection(&state, &*project.read().await, &req.connection).await?;
        let driver = state.env.connection.open_connection(&config).await?;
        Ok(Json(
            driver
                .object_definition(&req.object)
                .await
                .map_err(QueryError::from)?,
        ))
    }
}

// Browser connection-request commands.
impl ApiRoutes {
    async fn connection_request_create(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<ConnectionRequestCreateRequest>,
    ) -> ApiResult<ConnectionRequestCreateResponse> {
        let Json(req) = body?;
        let handle = Self::project(&state, &headers).await?;
        let guard = handle.read().await;
        let root = guard.root.clone();
        let project = root.to_string_lossy().into_owned();
        // The form only ever sees the scrubbed copy; an empty secret saves as "unchanged".
        let editing = match &req.connection {
            Some(connection) => {
                let id = Self::resolve_connection(&state, &guard, connection)
                    .await?
                    .id;
                Self::scrubbed_connections(&state, &guard)
                    .await
                    .into_iter()
                    .find(|c| c.config.id == id)
                    .map(|c| c.config)
            }
            None => None,
        };
        drop(guard);
        let request = state
            .connection_requests
            .create(root, req.kind, req.prefill, editing);
        let url = Server::page_path(
            CONNECTION_NEW_PAGE,
            &[
                (REQUEST_QUERY_PARAM, &request.id),
                (PROJECT_QUERY_PARAM, &project),
            ],
        );
        Ok(Json(ConnectionRequestCreateResponse {
            id: request.id,
            url,
        }))
    }

    async fn connection_request_get(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<ConnectionRequestIdRequest>,
    ) -> ApiResult<ConnectionRequest> {
        let Json(req) = body?;
        let root = Self::project_root(&state, &headers).await?;
        Ok(Json(state.connection_requests.get(&req.id, &root)?))
    }

    /// Long-poll: `pending` after `CONNECTION_REQUEST_WAIT_SECS` without a resolution.
    async fn connection_request_wait(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<ConnectionRequestIdRequest>,
    ) -> ApiResult<ConnectionRequestStatus> {
        let Json(req) = body?;
        let root = Self::project_root(&state, &headers).await?;
        let timeout = Duration::from_secs(CONNECTION_REQUEST_WAIT_SECS);
        let status = state
            .connection_requests
            .wait(&req.id, &root, timeout)
            .await?;
        Ok(Json(status))
    }

    async fn connection_request_cancel(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<ConnectionRequestIdRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let project = project.read().await;
        let cancelled = ConnectionRequestStatus::Cancelled;
        let changed =
            state
                .connection_requests
                .resolve(&req.id, &project.root, cancelled.clone())?;
        if changed {
            Self::emit_resolved(&state, &project, req.id, cancelled);
        }
        Ok(Json(EmptyResponse {}))
    }
}

// Query, history and pin commands.
impl ApiRoutes {
    async fn query_run(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<QueryRunRequest>,
    ) -> ApiResult<QueryRunResponse> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        Ok(Json(Self::run_and_record(&state, &project, req).await?))
    }

    async fn run_and_record(
        state: &ServerState,
        project: &RwLock<ProjectState>,
        req: QueryRunRequest,
    ) -> Result<QueryRunResponse, ApiError> {
        // Project lock only brackets setup and the final update; the query itself runs unlocked.
        let guard = project.read().await;
        let config = Self::resolve_connection(state, &guard, &req.connection).await?;
        let mut run = RunRecord {
            id: Uuid::new_v4().to_string(),
            connection_id: config.id,
            sql: req.sql.clone(),
            source: req.source.unwrap_or(QUERY_DEFAULT_SOURCE),
            started_at: Utc::now(),
            finished_at: None,
            status: RunStatus::Running,
            row_count: None,
            error: None,
            preview: None,
        };
        guard.query_run_store.append(run.clone()).await?;
        drop(guard);
        let request = QueryRequest {
            sql: req.sql,
            params: Vec::new(),
            language: req.language,
            page_size: Some(req.limit.unwrap_or(QUERY_DEFAULT_LIMIT)),
            page: Some(QUERY_FIRST_PAGE),
            query_id: Some(req.query_id.unwrap_or_else(|| run.id.clone())),
        };
        let outcome = Self::execute(state, &config, request).await;
        Self::finish_run(&mut run, &outcome);
        if let Ok(result) = &outcome
            && let Err(e) = state
                .env
                .canvas
                .cache_result(RUN_RESULTS_BOARD, &run.id, result)
        {
            eprintln!("could not cache result of run {}: {e}", run.id);
        }
        let guard = project.read().await;
        let recorded = guard.query_run_store.update(run.clone()).await;
        Self::emit(state, ServerEventKind::HistoryChanged, &guard, &run);
        recorded?;
        Ok(QueryRunResponse {
            run,
            result: outcome?,
        })
    }

    /// Queues SQL for a console tab. Reads (and allowed writes) run here once, so the
    /// tab shows the result without running it again.
    async fn query_open(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<QueryOpenRequest>,
    ) -> ApiResult<QueryOpenResponse> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let (config, root) = {
            let guard = project.read().await;
            let config = Self::resolve_connection(&state, &guard, &req.connection).await?;
            (config, guard.root.clone())
        };
        let driver = state.env.connection.open_connection(&config).await?;
        let run = if req.allow_write || driver.is_read_only(&req.sql, QueryLanguage::default()) {
            let run_req = QueryRunRequest {
                connection: config.id.to_string(),
                sql: req.sql.clone(),
                limit: req.limit,
                source: Some(RunSource::Ui),
                language: None,
                query_id: None,
            };
            Some(Self::run_and_record(&state, &project, run_req).await?)
        } else {
            None
        };
        let handoff = QueryHandoff {
            id: Uuid::new_v4().to_string(),
            target: HandoffTarget::Query {
                connection_id: config.id.to_string(),
                sql: req.sql,
                run_id: run.as_ref().map(|r| r.run.id.clone()),
                new_tab: req.new_tab,
                note: req.note,
                session: req.session,
            },
        };
        let (opened, launch_browser) = Self::hand_off(&state, &project, &root, handoff).await;
        Ok(Json(QueryOpenResponse {
            opened,
            launch_browser,
            run,
        }))
    }

    /// Queues a handoff and waits briefly for an open tab to take it.
    async fn deliver(
        state: &ServerState,
        project: &RwLock<ProjectState>,
        root: &Path,
        handoff: QueryHandoff,
    ) -> bool {
        let id = handoff.id.clone();
        state.query_handoffs.push(root, handoff);
        Self::emit(
            state,
            ServerEventKind::QueryOpenRequested,
            &*project.read().await,
            EmptyResponse {},
        );
        let mut waited = 0;
        while state.query_handoffs.is_pending(root, &id) && waited < QUERY_OPEN_WAIT_MS {
            tokio::time::sleep(Duration::from_millis(QUERY_OPEN_POLL_MS)).await;
            waited += QUERY_OPEN_POLL_MS;
        }
        !state.query_handoffs.is_pending(root, &id)
    }

    /// Delivers a handoff: (taken, caller should launch a browser).
    pub(super) async fn hand_off(
        state: &ServerState,
        project: &RwLock<ProjectState>,
        root: &Path,
        handoff: QueryHandoff,
    ) -> (bool, bool) {
        let opened = Self::deliver(state, project, root, handoff).await;
        (opened, !opened && state.query_handoffs.claim_launch(root))
    }

    fn open_tabs(tabs: Vec<PersistedConsoleTab>) -> Vec<TabSummary> {
        tabs.into_iter()
            .filter(|t| t.closed != Some(true))
            .map(|t| TabSummary {
                id: t.id,
                title: t.title,
                tab_type: t.tab_type.unwrap_or_else(|| DEFAULT_TAB_TYPE.into()),
                connection_id: t.connection_id,
                created_at: t.created_at,
            })
            .collect()
    }

    async fn tab_list(State(state): ApiState, headers: HeaderMap) -> ApiResult<Vec<TabSummary>> {
        let project = Self::project(&state, &headers).await?;
        let tabs = project.read().await.tabs_store.load().await?;
        Ok(Json(Self::open_tabs(tabs)))
    }

    async fn ui_context_save(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<UiContext>,
    ) -> ApiResult<EmptyResponse> {
        let Json(mut context) = body?;
        let project = Self::project(&state, &headers).await?;
        let root = project.read().await.root.clone();
        context.updated_at = Some(Utc::now().to_rfc3339());
        state.ui_contexts.lock().unwrap().insert(root, context);
        Ok(Json(EmptyResponse {}))
    }

    async fn ui_context(
        State(state): ApiState,
        headers: HeaderMap,
    ) -> ApiResult<UiContextResponse> {
        let project = Self::project(&state, &headers).await?;
        let root = project.read().await.root.clone();
        let context = state.ui_contexts.lock().unwrap().get(&root).cloned();
        Ok(Json(UiContextResponse { context }))
    }

    async fn tab_close(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<TabCloseRequest>,
    ) -> ApiResult<TabCloseResponse> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let (open, root) = {
            let guard = project.read().await;
            (
                Self::open_tabs(guard.tabs_store.load().await?),
                guard.root.clone(),
            )
        };
        if let Some(id) = req.ids.iter().find(|id| !open.iter().any(|t| &t.id == *id)) {
            return Err(ApiError::TabNotFound(id.clone()));
        }
        let applied = req.ids.is_empty() || {
            let handoff = QueryHandoff {
                id: Uuid::new_v4().to_string(),
                target: HandoffTarget::CloseTabs {
                    tab_ids: req.ids.clone(),
                },
            };
            Self::deliver(&state, &project, &root, handoff).await
        };
        Ok(Json(TabCloseResponse {
            closed: req.ids,
            applied,
        }))
    }

    async fn query_handoff_take(
        State(state): ApiState,
        headers: HeaderMap,
    ) -> ApiResult<Vec<QueryHandoff>> {
        let project = Self::project(&state, &headers).await?;
        let root = project.read().await.root.clone();
        Ok(Json(state.query_handoffs.take(&root)))
    }

    async fn query_page(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<QueryPageRequest>,
    ) -> ApiResult<QueryResult> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let config =
            Self::resolve_connection(&state, &*project.read().await, &req.connection).await?;
        let request = QueryRequest {
            sql: req.sql,
            params: Vec::new(),
            language: req.language,
            page_size: req.page_size,
            page: req.page,
            query_id: None,
        };
        Ok(Json(Self::execute(&state, &config, request).await?))
    }

    async fn execute(
        state: &ServerState,
        config: &ConnectionConfig,
        request: QueryRequest,
    ) -> Result<QueryResult, QueryError> {
        let driver = state.env.connection.open_connection(config).await?;
        let tx = state.env.connection.transaction_config(config.id).await;
        state.env.query.run_query_on(driver, tx, request).await
    }

    async fn history_list(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<HistoryListRequest>,
    ) -> ApiResult<Vec<RunRecord>> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let all = project.read().await.query_run_store.load().await?;
        let limit = req.limit.unwrap_or(HISTORY_DEFAULT_LIMIT);
        Ok(Json(all.into_iter().rev().take(limit).collect()))
    }

    /// Header-project history lookup; the isolation check for run commands.
    async fn find_run(
        project: &RwLock<ProjectState>,
        run_id: String,
    ) -> Result<RunRecord, ApiError> {
        let run = project.read().await.query_run_store.get(&run_id).await?;
        run.ok_or(ApiError::RunNotFound(run_id))
    }

    async fn run_get(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<RunIdRequest>,
    ) -> ApiResult<RunGetResponse> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let run = Self::find_run(&project, req.run_id).await?;
        let cached = state.env.canvas.has_result(RUN_RESULTS_BOARD, &run.id);
        Ok(Json(RunGetResponse { run, cached }))
    }

    async fn run_page(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<RunPageRequest>,
    ) -> ApiResult<QueryResult> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let run = Self::find_run(&project, req.run_id).await?;
        let limit = req.limit.min(RUN_PAGE_MAX_LIMIT);
        let page = state
            .env
            .canvas
            .fetch_page(RUN_RESULTS_BOARD, &run.id, req.offset, limit)?;
        page.map(Json).ok_or(ApiError::ResultNotCached(run.id))
    }

    async fn pin_rename(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<PinRenameRequest>,
    ) -> ApiResult<PersistedPinnedQuery> {
        let Json(req) = body?;
        if req.title.trim().is_empty() {
            return Err(ApiError::EmptyTitle);
        }
        let project = Self::project(&state, &headers).await?;
        let project = project.write().await;
        let pin = project
            .pinned_queries_store
            .rename(&req.id, req.title)
            .await
            .map_err(|e| match e {
                StoreError::NotFound(id) => ApiError::PinNotFound(id),
                other => other.into(),
            })?;
        Self::emit(&state, ServerEventKind::PinsChanged, &project, &pin);
        Ok(Json(pin))
    }

    async fn pin_add(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<PinAddRequest>,
    ) -> ApiResult<PersistedPinnedQuery> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let project = project.write().await;
        let (name, text, connection) = match req {
            PinAddRequest::FromRun { run_id, title } => {
                let run = project
                    .query_run_store
                    .get(&run_id)
                    .await?
                    .ok_or(ApiError::RunNotFound(run_id))?;
                let title = title.unwrap_or_else(|| run.sql.clone());
                (title, run.sql, run.connection_id.to_string())
            }
            PinAddRequest::Manual {
                title,
                sql,
                connection,
            } => (title, sql, connection),
        };
        let config = Self::resolve_connection(&state, &project, &connection).await?;
        let pin = PersistedPinnedQuery {
            id: Uuid::new_v4().to_string(),
            name,
            text,
            connection_id: Some(config.id.to_string()),
            // Same lowercase kind the desktop app stores on its pins.
            kind: serde_json::to_value(config.kind)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default(),
        };
        let mut pins = project.pinned_queries_store.load().await?;
        pins.push(pin.clone());
        project.pinned_queries_store.save(&pins).await?;
        Self::emit(&state, ServerEventKind::PinsChanged, &project, &pin);
        Ok(Json(pin))
    }

    async fn pin_remove(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<PinRemoveRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let project = project.write().await;
        let mut pins = project.pinned_queries_store.load().await?;
        let before = pins.len();
        pins.retain(|p| p.id != req.id);
        if pins.len() == before {
            return Err(ApiError::PinNotFound(req.id));
        }
        project.pinned_queries_store.save(&pins).await?;
        Self::emit(&state, ServerEventKind::PinsChanged, &project, &req.id);
        Ok(Json(EmptyResponse {}))
    }

    async fn workspace_load(
        State(state): ApiState,
        headers: HeaderMap,
    ) -> ApiResult<WorkspaceResponse> {
        let project = Self::project(&state, &headers).await?;
        let guard = project.read().await;
        Ok(Json(WorkspaceResponse {
            tabs: guard.tabs_store.load().await?,
            pane_layout: guard.pane_layout_store.load().await?,
        }))
    }

    async fn workspace_tabs_save(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<WorkspaceTabsSaveRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        project.read().await.tabs_store.save(&req.tabs).await?;
        Ok(Json(EmptyResponse {}))
    }

    async fn workspace_layout_save(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<WorkspaceLayoutSaveRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        project
            .read()
            .await
            .pane_layout_store
            .save(&req.layout)
            .await?;
        Ok(Json(EmptyResponse {}))
    }

    async fn pin_save(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<PinSaveRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        let project = Self::project(&state, &headers).await?;
        let project = project.write().await;
        project.pinned_queries_store.save(&req.queries).await?;
        Self::emit(&state, ServerEventKind::PinsChanged, &project, &req.queries);
        Ok(Json(EmptyResponse {}))
    }

    async fn pin_list(
        State(state): ApiState,
        headers: HeaderMap,
    ) -> ApiResult<Vec<PersistedPinnedQuery>> {
        let project = Self::project(&state, &headers).await?;
        Ok(Json(
            project.read().await.pinned_queries_store.load().await?,
        ))
    }

    async fn project_list(State(state): ApiState) -> Json<Vec<ProjectManifest>> {
        Json(state.env.list_projects())
    }
}

#[cfg(test)]
pub(super) mod tests {
    use std::path::Path;
    use std::sync::Arc;
    use std::time::Duration;

    use arris_engines::persistence::MemorySecretStore;
    use arris_engines::{AppEnvironment, CanvasEngine, ConnectionConfig, DatabaseKind};
    use reqwest::StatusCode;
    use reqwest::header::AUTHORIZATION;
    use serde_json::{Value, json};
    use tempfile::TempDir;

    use crate::server::{
        CONNECTION_NEW_PAGE, PROJECT_HEADER, PROJECT_QUERY_PARAM, REQUEST_QUERY_PARAM,
        RUN_PAGE_MAX_LIMIT, RUN_RESULTS_BOARD, Server, ServerEvent, ServerEventKind, ServerState,
        TABLE_BROWSE_DEFAULT_LIMIT,
    };

    const EVENT_TIMEOUT: Duration = Duration::from_secs(5);
    const POLL_INTERVAL: Duration = Duration::from_millis(10);
    const LOOPBACK_ANY_PORT: &str = "127.0.0.1:0";
    // Recursive CTE sized to run for about a second in a debug build.
    pub(in crate::server) const SLOW_SQL: &str = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 3000000) SELECT count(*) FROM c";

    pub(in crate::server) struct Harness {
        _data: TempDir,
        pub(in crate::server) project: TempDir,
        pub(in crate::server) state: Arc<ServerState>,
        base: String,
        client: reqwest::Client,
    }

    impl Harness {
        pub(in crate::server) async fn start() -> Self {
            let data = TempDir::new().unwrap();
            let env =
                AppEnvironment::init_at(data.path().into(), Arc::new(MemorySecretStore::new()))
                    .await
                    .unwrap();
            let server = Server::bind(env, Some(0)).unwrap();
            let state = server.state();
            tokio::spawn(server.serve());
            let base = format!("http://127.0.0.1:{}", state.port);
            Self {
                _data: data,
                project: TempDir::new().unwrap(),
                state,
                base,
                client: reqwest::Client::new(),
            }
        }

        fn request(&self, cmd: &str, body: Value) -> reqwest::RequestBuilder {
            self.client
                .post(format!("{}/api/{cmd}", self.base))
                .header(AUTHORIZATION, format!("Bearer {}", self.state.token))
                .json(&body)
        }

        pub(in crate::server) async fn call(&self, cmd: &str, body: Value) -> reqwest::Response {
            self.call_at(self.project.path(), cmd, body).await
        }

        pub(in crate::server) async fn call_at(
            &self,
            project: &Path,
            cmd: &str,
            body: Value,
        ) -> reqwest::Response {
            self.request(cmd, body)
                .header(PROJECT_HEADER, project.to_str().unwrap())
                .send()
                .await
                .unwrap()
        }

        pub(in crate::server) async fn ok(&self, cmd: &str, body: Value) -> Value {
            let resp = self.call(cmd, body).await;
            let status = resp.status();
            let text = resp.text().await.unwrap();
            assert_eq!(status, StatusCode::OK, "{cmd}: {text}");
            serde_json::from_str(&text).unwrap()
        }

        fn sqlite_config(&self, name: &str) -> ConnectionConfig {
            let mut cfg = ConnectionConfig::new(name, DatabaseKind::Sqlite);
            cfg.file_path = Some(self.project.path().join("t.db").to_string_lossy().into());
            cfg
        }

        /// Returns the config under its server-assigned id.
        pub(in crate::server) async fn save_sqlite(&self, name: &str) -> ConnectionConfig {
            let mut cfg = self.sqlite_config(name);
            let saved = self.ok("connection_save", json!({ "config": cfg })).await;
            cfg.id = saved["id"].as_str().unwrap().parse().unwrap();
            cfg
        }

        pub(in crate::server) async fn seed_rows(&self, cfg: &ConnectionConfig, n: usize) {
            let id = cfg.id.to_string();
            self.ok(
                "query_run",
                json!({ "connection": id, "sql": "CREATE TABLE t (x INTEGER)" }),
            )
            .await;
            let insert = format!(
                "INSERT INTO t WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < {n}) SELECT x FROM c"
            );
            self.ok("query_run", json!({ "connection": id, "sql": insert }))
                .await;
        }
    }

    #[tokio::test]
    async fn connection_save_and_list_scrubs_password() {
        let h = Harness::start().await;
        let mut cfg = h.sqlite_config("local");
        // Distinctive so a random temp path can never contain it.
        let secret = "s3cret-Zq9-never-echoed";
        cfg.password = secret.into();
        cfg.ssh_password = Some(secret.into());
        let saved = h.call("connection_save", json!({ "config": cfg })).await;
        assert_eq!(saved.status(), StatusCode::OK);
        let saved_text = saved.text().await.unwrap();
        assert!(!saved_text.contains(secret), "{saved_text}");
        let saved: Value = serde_json::from_str(&saved_text).unwrap();

        let list = h.call("connection_list", json!({})).await;
        let list_text = list.text().await.unwrap();
        assert!(!list_text.contains(secret), "{list_text}");
        let list: Value = serde_json::from_str(&list_text).unwrap();
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["name"], "local");
        assert_eq!(list[0]["id"], saved["id"]);
    }

    #[tokio::test]
    async fn save_with_foreign_id_assigns_new_id() {
        let h = Harness::start().await;
        let cfg = h.sqlite_config("local");
        let first = h.ok("connection_save", json!({ "config": cfg })).await;
        assert_ne!(first["id"], cfg.id.to_string());

        let mut resaved = cfg.clone();
        resaved.id = first["id"].as_str().unwrap().parse().unwrap();
        let again = h.ok("connection_save", json!({ "config": resaved })).await;
        assert_eq!(again["id"], first["id"]);

        let other = TempDir::new().unwrap();
        let foreign = h
            .call_at(
                other.path(),
                "connection_save",
                json!({ "config": resaved }),
            )
            .await;
        let foreign: Value = foreign.json().await.unwrap();
        assert_ne!(foreign["id"], first["id"]);
        let list = h.ok("connection_list", json!({})).await;
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["id"], first["id"]);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn slow_query_does_not_block_other_commands() {
        let h = Arc::new(Harness::start().await);
        let cfg = h.save_sqlite("local").await;
        let slow = {
            let h = h.clone();
            let body = json!({ "connection": cfg.id.to_string(), "sql": SLOW_SQL });
            tokio::spawn(async move { h.ok("query_run", body).await })
        };
        tokio::time::timeout(EVENT_TIMEOUT, async {
            loop {
                let runs = h.ok("history_list", json!({})).await;
                if runs
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|r| r["status"] == "running")
                {
                    break;
                }
                tokio::time::sleep(POLL_INTERVAL).await;
            }
        })
        .await
        .unwrap();
        h.ok(
            "connection_save",
            json!({ "config": h.sqlite_config("other") }),
        )
        .await;
        h.ok("connection_list", json!({})).await;
        assert!(!slow.is_finished(), "save/list waited for the slow query");
        assert_eq!(slow.await.unwrap()["run"]["status"], "success");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn hung_driver_connect_does_not_block_other_commands() {
        let h = Arc::new(Harness::start().await);
        // Accepts TCP but never speaks the protocol, so the driver connect hangs.
        let listener = tokio::net::TcpListener::bind(LOOPBACK_ANY_PORT)
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        let mut cfg = ConnectionConfig::new("hung", DatabaseKind::Postgres);
        cfg.host = addr.ip().to_string();
        cfg.port = addr.port();
        let saved = h.ok("connection_save", json!({ "config": cfg })).await;
        let id = saved["id"].as_str().unwrap().to_owned();
        let commands = [
            ("query_run", json!({ "connection": id, "sql": "SELECT 1" })),
            ("schema_list", json!({ "connection": id })),
        ];
        for (cmd, body) in commands {
            let pending = {
                let h = h.clone();
                tokio::spawn(async move { h.call(cmd, body).await })
            };
            let (_socket, _) = tokio::time::timeout(EVENT_TIMEOUT, listener.accept())
                .await
                .unwrap()
                .unwrap();
            let other = json!({ "config": h.sqlite_config("other") });
            tokio::time::timeout(EVENT_TIMEOUT, h.ok("connection_save", other))
                .await
                .unwrap_or_else(|_| panic!("connection_save waited for {cmd} connect"));
            h.ok("connection_list", json!({})).await;
            assert!(!pending.is_finished(), "{cmd} connect did not hang");
            pending.abort();
        }
    }

    #[tokio::test]
    async fn missing_project_header_is_400() {
        let h = Harness::start().await;
        let resp = h
            .request("connection_list", json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let body: Value = resp.json().await.unwrap();
        assert_eq!(body["error"]["code"], "missing_project");
        assert!(body["error"]["message"].is_string());
    }

    #[tokio::test]
    async fn query_run_records_success_with_preview() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        h.seed_rows(&cfg, 60).await;
        let out = h
            .ok(
                "query_run",
                json!({ "connection": cfg.id.to_string(), "sql": "SELECT x FROM t ORDER BY x" }),
            )
            .await;
        let run = &out["run"];
        assert_eq!(run["status"], "success");
        assert_eq!(run["rowCount"], 60);
        assert_eq!(run["preview"]["rows"].as_array().unwrap().len(), 50);
        assert_eq!(run["preview"]["truncated"], true);
        assert!(run["finishedAt"].is_string());
        assert_eq!(out["result"]["rows"].as_array().unwrap().len(), 60);
    }

    #[tokio::test]
    async fn query_run_bad_sql_records_error() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        let resp = h
            .call(
                "query_run",
                json!({ "connection": cfg.id.to_string(), "sql": "SELEC nope" }),
            )
            .await;
        assert!(resp.status().is_client_error(), "{}", resp.status());
        let body: Value = resp.json().await.unwrap();
        assert_eq!(body["error"]["code"], "query_failed");
        assert!(!body["error"]["message"].as_str().unwrap().is_empty());

        let history = h.ok("history_list", json!({})).await;
        assert_eq!(history[0]["status"], "error");
        assert!(!history[0]["error"].as_str().unwrap().is_empty());
        assert_eq!(history[0]["sql"], "SELEC nope");
    }

    #[tokio::test]
    async fn query_page_skips_history_and_pages() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        h.seed_rows(&cfg, 3).await;
        let before = h.ok("history_list", json!({})).await;
        let body = json!({
            "connection": cfg.id.to_string(),
            "sql": "SELECT x FROM t ORDER BY x",
            "pageSize": 1,
            "page": 1,
        });
        let page = h.ok("query_page", body).await;
        assert_eq!(page["rows"].as_array().unwrap().len(), 1);
        assert_eq!(page["has_more"], json!(true));
        assert_eq!(h.ok("history_list", json!({})).await, before);
    }

    #[tokio::test]
    async fn query_open_runs_reads_and_allowed_writes_and_leaves_other_writes_to_the_user() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        h.seed_rows(&cfg, 2).await;
        let id = cfg.id.to_string();

        let read = json!({ "connection": id, "sql": "SELECT x FROM t" });
        let opened = h.ok("query_open", read).await;
        assert_eq!(opened["opened"], json!(false));
        let run_id = opened["run"]["run"]["id"].clone();

        let write = json!({ "connection": id, "sql": "DELETE FROM t" });
        assert!(h.ok("query_open", write).await["run"].is_null());

        let taken = h.ok("query_handoff_take", json!({})).await;
        assert_eq!(taken[0]["runId"], run_id);
        assert_eq!(taken[0]["connectionId"], json!(id));
        assert!(taken[1]["runId"].is_null());
        assert_eq!(h.ok("query_handoff_take", json!({})).await, json!([]));

        let count = json!({ "connection": id, "sql": "SELECT count(*) FROM t" });
        let rows = h.ok("query_run", count.clone()).await;
        assert_eq!(rows["result"]["rows"][0][0]["value"], json!(2));

        let allowed = json!({ "connection": id, "sql": "DELETE FROM t", "allow_write": true });
        assert!(h.ok("query_open", allowed).await["run"]["run"]["id"].is_string());
        let rows = h.ok("query_run", count).await;
        assert_eq!(rows["result"]["rows"][0][0]["value"], json!(0));
    }

    #[tokio::test]
    async fn workspace_round_trips_console_text_across_a_restart_of_the_page() {
        let h = Harness::start().await;
        let tab = json!({
            "id": "t1", "title": "Console 1", "text": "SELECT 1", "kind": "sql", "cursor": 0,
        });
        h.ok("workspace_tabs_save", json!({ "tabs": [tab] })).await;
        let layout = json!({ "layout": null, "focusedPaneGroupId": "g1" });
        h.ok("workspace_layout_save", json!({ "layout": layout }))
            .await;

        let loaded = h.ok("workspace_load", json!({})).await;
        assert_eq!(loaded["tabs"][0]["text"], json!("SELECT 1"));
        assert_eq!(loaded["paneLayout"]["focusedPaneGroupId"], json!("g1"));
    }

    #[tokio::test]
    async fn ui_context_round_trips_the_pushed_tab_and_selection() {
        let h = Harness::start().await;
        assert_eq!(
            h.ok("ui_context", json!({})).await,
            json!({ "context": null })
        );
        let tab = json!({
            "id": "t1", "title": "Console", "tabType": "console", "text": "SELECT 1",
            "selection": { "from": 0, "to": 6, "text": "SELECT" },
        });
        h.ok("ui_context_save", json!({ "tab": tab })).await;
        let got = h.ok("ui_context", json!({})).await["context"].clone();
        assert_eq!(got["tab"]["selection"]["text"], json!("SELECT"));
        assert!(got["updatedAt"].is_string());
    }

    #[tokio::test]
    async fn tab_close_queues_open_tabs_and_rejects_unknown_ones() {
        let h = Harness::start().await;
        let tab = |id: &str, closed: bool| json!({ "id": id, "title": id, "text": "", "kind": "sql", "closed": closed });
        let tabs = json!([tab("a", false), tab("b", true), tab("c", false)]);
        h.ok("workspace_tabs_save", json!({ "tabs": tabs })).await;

        let listed = h.ok("tab_list", json!({})).await;
        assert_eq!(listed[0]["tabType"], json!(super::DEFAULT_TAB_TYPE));
        assert_eq!(listed.as_array().unwrap().len(), 2);

        let closed_already = h.call("tab_close", json!({ "ids": ["b"] })).await;
        assert_eq!(closed_already.status(), StatusCode::NOT_FOUND);

        let out = h.ok("tab_close", json!({ "ids": ["a"] })).await;
        assert_eq!(out, json!({ "closed": ["a"], "applied": false }));
        let taken = h.ok("query_handoff_take", json!({})).await;
        assert_eq!(taken[0]["kind"], json!("closeTabs"));
        assert_eq!(taken[0]["tabIds"], json!(["a"]));
    }

    #[tokio::test]
    async fn query_run_by_connection_name() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("Local DB").await;
        let out = h
            .ok(
                "query_run",
                json!({ "connection": "local db", "sql": "SELECT 1 AS one" }),
            )
            .await;
        assert_eq!(out["run"]["connectionId"], cfg.id.to_string());
        assert_eq!(out["run"]["status"], "success");
        let missing = h
            .call(
                "query_run",
                json!({ "connection": "nope", "sql": "SELECT 1" }),
            )
            .await;
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn history_list_newest_first() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        for sql in ["SELECT 1", "SELECT 2", "SELECT 3"] {
            h.ok(
                "query_run",
                json!({ "connection": cfg.id.to_string(), "sql": sql }),
            )
            .await;
        }
        let all = h.ok("history_list", json!({})).await;
        let sqls: Vec<&str> = all
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["sql"].as_str().unwrap())
            .collect();
        assert_eq!(sqls, ["SELECT 3", "SELECT 2", "SELECT 1"]);
        let limited = h.ok("history_list", json!({ "limit": 2 })).await;
        assert_eq!(limited.as_array().unwrap().len(), 2);
        assert_eq!(limited[0]["sql"], "SELECT 3");
    }

    #[tokio::test]
    async fn pin_add_from_run_copies_sql_and_connection() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        let out = h
            .ok(
                "query_run",
                json!({ "connection": cfg.id.to_string(), "sql": "SELECT 42" }),
            )
            .await;
        let run_id = out["run"]["id"].as_str().unwrap();
        let pin = h.ok("pin_add", json!({ "runId": run_id })).await;
        assert_eq!(pin["text"], "SELECT 42");
        assert_eq!(pin["name"], "SELECT 42");
        assert_eq!(pin["connectionId"], cfg.id.to_string());
        assert_eq!(pin["kind"], "sqlite");
        let titled = h
            .ok("pin_add", json!({ "runId": run_id, "title": "answer" }))
            .await;
        assert_eq!(titled["name"], "answer");
        h.ok("pin_remove", json!({ "id": titled["id"] })).await;
        assert_eq!(pin["connectionId"], cfg.id.to_string());

        let manual = h
            .ok(
                "pin_add",
                json!({ "title": "t", "sql": "SELECT 7", "connection": "local" }),
            )
            .await;
        assert_eq!(manual["connectionId"], cfg.id.to_string());
        assert_eq!(
            h.ok("pin_list", json!({})).await.as_array().unwrap().len(),
            2
        );
        h.ok("pin_remove", json!({ "id": pin["id"] })).await;
        assert_eq!(
            h.ok("pin_list", json!({})).await.as_array().unwrap().len(),
            1
        );
        let gone = h.call("pin_remove", json!({ "id": pin["id"] })).await;
        assert_eq!(gone.status(), StatusCode::NOT_FOUND);
        let unknown_run = h.call("pin_add", json!({ "runId": "nope" })).await;
        assert_eq!(unknown_run.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn history_changed_event_emitted_on_query() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        let mut events = h.state.events.subscribe();
        let out = h
            .ok(
                "query_run",
                json!({ "connection": cfg.id.to_string(), "sql": "SELECT 1" }),
            )
            .await;
        let event: ServerEvent = tokio::time::timeout(EVENT_TIMEOUT, events.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(event.kind, ServerEventKind::HistoryChanged);
        assert_eq!(event.payload["id"], out["run"]["id"]);
        assert_eq!(
            event.project.unwrap(),
            h.project.path().canonicalize().unwrap()
        );
    }

    pub(in crate::server) async fn run_id_of(
        h: &Harness,
        cfg: &ConnectionConfig,
        sql: &str,
        limit: usize,
    ) -> String {
        let out = h
            .ok(
                "query_run",
                json!({ "connection": cfg.id.to_string(), "sql": sql, "limit": limit }),
            )
            .await;
        out["run"]["id"].as_str().unwrap().to_owned()
    }

    pub(in crate::server) async fn error_code(resp: reqwest::Response) -> (StatusCode, String) {
        let status = resp.status();
        let body: Value = resp.json().await.unwrap();
        (status, body["error"]["code"].as_str().unwrap().to_owned())
    }

    #[tokio::test]
    async fn run_page_returns_cached_rows_after_query_run() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        h.seed_rows(&cfg, 60).await;
        let run_id = run_id_of(&h, &cfg, "SELECT x FROM t ORDER BY x", 100).await;
        let page = h
            .ok(
                "run_page",
                json!({ "runId": run_id, "offset": 50, "limit": 20 }),
            )
            .await;
        assert_eq!(page["rows"].as_array().unwrap().len(), 10);
        let got = h.ok("run_get", json!({ "runId": run_id })).await;
        assert_eq!(got["run"]["id"], run_id);
        assert_eq!(got["cached"], true);
    }

    #[tokio::test]
    async fn run_get_reports_cached_false_after_cache_removed() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        let run_id = run_id_of(&h, &cfg, "SELECT 1", 10).await;
        let key = CanvasEngine::key(RUN_RESULTS_BOARD, &run_id);
        h.state.env.canvas.cache().remove(&key);
        let got = h.ok("run_get", json!({ "runId": run_id })).await;
        assert_eq!(got["cached"], false);
        let page = h
            .call(
                "run_page",
                json!({ "runId": run_id, "offset": 0, "limit": 10 }),
            )
            .await;
        assert_eq!(
            error_code(page).await,
            (StatusCode::NOT_FOUND, "result_not_cached".into())
        );
    }

    #[tokio::test]
    async fn run_from_other_project_is_404() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        let run_id = run_id_of(&h, &cfg, "SELECT 1", 10).await;
        let other = TempDir::new().unwrap();
        let get = h
            .call_at(other.path(), "run_get", json!({ "runId": run_id }))
            .await;
        assert_eq!(
            error_code(get).await,
            (StatusCode::NOT_FOUND, "run_not_found".into())
        );
        let page = h
            .call_at(
                other.path(),
                "run_page",
                json!({ "runId": run_id, "offset": 0, "limit": 10 }),
            )
            .await;
        assert_eq!(
            error_code(page).await,
            (StatusCode::NOT_FOUND, "run_not_found".into())
        );
    }

    #[tokio::test]
    async fn run_page_clamps_limit() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        h.seed_rows(&cfg, 1200).await;
        let run_id = run_id_of(&h, &cfg, "SELECT x FROM t", 1200).await;
        let page = h
            .ok(
                "run_page",
                json!({ "runId": run_id, "offset": 0, "limit": 5000 }),
            )
            .await;
        assert_eq!(page["rows"].as_array().unwrap().len(), RUN_PAGE_MAX_LIMIT);
    }

    #[tokio::test]
    async fn failed_query_is_not_cached() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        let failed = h
            .call(
                "query_run",
                json!({ "connection": cfg.id.to_string(), "sql": "SELEC nope" }),
            )
            .await;
        assert_eq!(failed.status(), StatusCode::BAD_REQUEST);
        let history = h.ok("history_list", json!({})).await;
        let run_id = history[0]["id"].as_str().unwrap();
        let got = h.ok("run_get", json!({ "runId": run_id })).await;
        assert_eq!(got["run"]["status"], "error");
        assert_eq!(got["cached"], false);
    }

    pub(in crate::server) async fn next_kind(
        events: &mut tokio::sync::broadcast::Receiver<ServerEvent>,
    ) -> ServerEvent {
        tokio::time::timeout(EVENT_TIMEOUT, events.recv())
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn pin_save_replaces_the_list_and_emits_pins_changed() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        let first = h
            .ok(
                "pin_add",
                json!({ "title": "a", "sql": "SELECT 1", "connection": cfg.id.to_string() }),
            )
            .await;
        let mut events = h.state.events.subscribe();
        let mut edited = first.clone();
        edited["text"] = json!("SELECT 2");
        h.ok("pin_save", json!({ "queries": [edited] })).await;
        let list = h.ok("pin_list", json!({})).await;
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["text"], "SELECT 2");
        assert_eq!(
            next_kind(&mut events).await.kind,
            ServerEventKind::PinsChanged
        );
        h.ok("pin_save", json!({ "queries": [] })).await;
        assert!(
            h.ok("pin_list", json!({}))
                .await
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn pin_rename_updates_title_and_emits_pins_changed() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        let pin = h
            .ok(
                "pin_add",
                json!({ "title": "t", "sql": "SELECT 7", "connection": cfg.id.to_string() }),
            )
            .await;
        let mut events = h.state.events.subscribe();
        let renamed = h
            .ok("pin_rename", json!({ "id": pin["id"], "title": "better" }))
            .await;
        assert_eq!(renamed["name"], "better");
        assert_eq!(h.ok("pin_list", json!({})).await[0]["name"], "better");
        let event = next_kind(&mut events).await;
        assert_eq!(event.kind, ServerEventKind::PinsChanged);
        assert_eq!(event.payload["name"], "better");
        let unknown = h
            .call("pin_rename", json!({ "id": "nope", "title": "x" }))
            .await;
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
        let blank = h
            .call("pin_rename", json!({ "id": pin["id"], "title": "  " }))
            .await;
        assert_eq!(blank.status(), StatusCode::BAD_REQUEST);
        assert_eq!(h.ok("pin_list", json!({})).await[0]["name"], "better");
    }

    #[tokio::test]
    async fn pin_add_and_remove_emit_pins_changed() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        let mut events = h.state.events.subscribe();
        let pin = h
            .ok(
                "pin_add",
                json!({ "title": "t", "sql": "SELECT 7", "connection": cfg.id.to_string() }),
            )
            .await;
        assert_eq!(
            next_kind(&mut events).await.kind,
            ServerEventKind::PinsChanged
        );
        h.ok("pin_remove", json!({ "id": pin["id"] })).await;
        assert_eq!(
            next_kind(&mut events).await.kind,
            ServerEventKind::PinsChanged
        );
    }

    #[tokio::test]
    async fn table_browse_query_selects_the_table() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        h.seed_rows(&cfg, 1).await;
        let sql = h
            .ok(
                "table_browse_query",
                json!({ "connection": "local", "table": { "name": "t" } }),
            )
            .await;
        let sql = sql.as_str().unwrap();
        assert!(sql.contains("t") && sql.contains(&TABLE_BROWSE_DEFAULT_LIMIT.to_string()));
    }

    #[tokio::test]
    async fn object_definition_returns_the_table_ddl() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        h.seed_rows(&cfg, 1).await;
        let object = json!({ "kind": "table", "name": "t" });
        let ddl = h
            .ok(
                "object_definition",
                json!({ "connection": "local", "object": object }),
            )
            .await;
        assert!(ddl.as_str().unwrap().contains("CREATE TABLE"));
    }

    #[tokio::test]
    async fn connection_test_remove_schema_and_projects() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        h.seed_rows(&cfg, 1).await;
        let unsaved = h.sqlite_config("draft");
        let headerless = h
            .request("connection_test", json!({ "config": unsaved }))
            .send()
            .await
            .unwrap();
        assert_eq!(headerless.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            h.ok("connection_test", json!({ "config": unsaved })).await["ok"],
            true
        );
        assert_eq!(
            h.ok("connection_test", json!({ "connection": "local" }))
                .await["ok"],
            true
        );
        let neither = h.call("connection_test", json!({})).await;
        assert_eq!(neither.status(), StatusCode::BAD_REQUEST);

        let schema = h.ok("schema_list", json!({ "connection": "local" })).await;
        assert!(!schema.as_array().unwrap().is_empty());

        let projects = h.request("project_list", json!({})).send().await.unwrap();
        assert_eq!(projects.status(), StatusCode::OK);
        let projects: Value = projects.json().await.unwrap();
        assert_eq!(projects.as_array().unwrap().len(), 1);

        h.ok("connection_remove", json!({ "connection": "local" }))
            .await;
        assert!(
            h.ok("connection_list", json!({}))
                .await
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn wait_returns_saved_after_save_with_request_id() {
        let h = Arc::new(Harness::start().await);
        let created = h
            .ok("connection_request_create", json!({ "kind": "sqlite" }))
            .await;
        let id = created["id"].as_str().unwrap().to_owned();
        let page =
            url::Url::parse(&format!("{}{}", h.base, created["url"].as_str().unwrap())).unwrap();
        assert_eq!(page.path(), CONNECTION_NEW_PAGE);
        let query: std::collections::HashMap<_, _> = page.query_pairs().into_owned().collect();
        assert_eq!(query[REQUEST_QUERY_PARAM], id);
        let root = h.project.path().canonicalize().unwrap();
        assert_eq!(query[PROJECT_QUERY_PARAM], root.to_string_lossy());
        let got = h.ok("connection_request_get", json!({ "id": id })).await;
        assert_eq!(got["kind"], "sqlite");
        assert_eq!(got["status"]["status"], "pending");

        let mut events = h.state.events.subscribe();
        let waiter = {
            let h = h.clone();
            let id = id.clone();
            tokio::spawn(async move { h.ok("connection_request_wait", json!({ "id": id })).await })
        };
        let saved = h
            .ok(
                "connection_save",
                json!({ "config": h.sqlite_config("browser"), "requestId": id }),
            )
            .await;
        let status = tokio::time::timeout(EVENT_TIMEOUT, waiter)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(status["status"], "saved");
        assert_eq!(status["connectionId"], saved["id"]);
        assert_eq!(status["name"], "browser");

        let mut kinds = Vec::new();
        while let Ok(event) = events.try_recv() {
            if event.kind == ServerEventKind::ConnectionRequestResolved {
                assert_eq!(event.payload["id"], id.as_str());
                assert_eq!(event.payload["status"]["status"], "saved");
                assert!(event.payload.get("config").is_none());
            }
            kinds.push(event.kind);
        }
        assert!(kinds.contains(&ServerEventKind::ConnectionRequestResolved));
        assert!(kinds.contains(&ServerEventKind::ConnectionsChanged));
        let gone = h.call("connection_request_get", json!({ "id": id })).await;
        assert_eq!(gone.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn prefill_is_scrubbed_on_create() {
        let h = Harness::start().await;
        let mut fields = ConnectionConfig::new("shop-dev", DatabaseKind::Postgres);
        fields.host = "db.local".into();
        fields.password = "hunter2".into();
        fields.ssh_password = Some("hunter3".into());
        let prefill = json!({ "name": "shop-dev", "kind": "postgres", "fields": fields });
        let created = h
            .ok("connection_request_create", json!({ "prefill": prefill }))
            .await;
        let got = h
            .call("connection_request_get", json!({ "id": created["id"] }))
            .await;
        let text = got.text().await.unwrap();
        assert!(!text.contains("hunter"), "{text}");
        let got: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(got["kind"], "postgres");
        assert_eq!(got["prefill"]["fields"]["host"], "db.local");
    }

    #[tokio::test]
    async fn edit_request_carries_the_scrubbed_saved_connection() {
        let h = Harness::start().await;
        let mut cfg = h.sqlite_config("local");
        cfg.password = "s3cret-edit-never-echoed".into();
        h.ok("connection_save", json!({ "config": cfg })).await;
        let created = h
            .ok(
                "connection_request_create",
                json!({ "connection": "local" }),
            )
            .await;
        let got = h
            .ok("connection_request_get", json!({ "id": created["id"] }))
            .await;
        assert_eq!(got["editing"]["name"], "local");
        assert_eq!(got["kind"], "sqlite");
        assert!(!got.to_string().contains("s3cret-edit-never-echoed"));
        let unknown = json!({ "connection": "nope" });
        let resp = h.call("connection_request_create", unknown).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn cancel_resolves_cancelled() {
        let h = Harness::start().await;
        let created = h.ok("connection_request_create", json!({})).await;
        let id = created["id"].as_str().unwrap();
        h.ok("connection_request_cancel", json!({ "id": id })).await;
        let got = h.ok("connection_request_get", json!({ "id": id })).await;
        assert_eq!(got["status"]["status"], "cancelled");
        let status = h.ok("connection_request_wait", json!({ "id": id })).await;
        assert_eq!(status["status"], "cancelled");
    }

    #[tokio::test]
    async fn save_with_cancelled_request_is_conflict_and_writes_nothing() {
        let h = Harness::start().await;
        let created = h.ok("connection_request_create", json!({})).await;
        let id = created["id"].as_str().unwrap();
        h.ok("connection_request_cancel", json!({ "id": id })).await;
        let body = json!({ "config": h.sqlite_config("late"), "requestId": id });
        let resp = h.call("connection_save", body).await;
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        let resp: Value = resp.json().await.unwrap();
        assert_eq!(resp["error"]["code"], "conflict");
        assert_eq!(h.ok("connection_list", json!({})).await, json!([]));
    }

    #[tokio::test]
    async fn cancel_after_save_does_not_emit_second_resolved() {
        let h = Harness::start().await;
        let created = h.ok("connection_request_create", json!({})).await;
        let id = created["id"].as_str().unwrap();
        let mut events = h.state.events.subscribe();
        h.ok(
            "connection_save",
            json!({ "config": h.sqlite_config("browser"), "requestId": id }),
        )
        .await;
        h.ok("connection_request_cancel", json!({ "id": id })).await;
        let mut resolved = Vec::new();
        while let Ok(event) = events.try_recv() {
            if event.kind == ServerEventKind::ConnectionRequestResolved {
                resolved.push(event.payload);
            }
        }
        assert_eq!(resolved.len(), 1, "{resolved:?}");
        assert_eq!(resolved[0]["status"]["status"], "saved");
        let got = h.ok("connection_request_get", json!({ "id": id })).await;
        assert_eq!(got["status"]["status"], "saved");
    }

    #[tokio::test]
    async fn request_from_other_project_cannot_be_saved() {
        let h = Harness::start().await;
        let created = h.ok("connection_request_create", json!({})).await;
        let id = created["id"].as_str().unwrap();
        let other = TempDir::new().unwrap();
        let body = json!({ "config": h.sqlite_config("x"), "requestId": id });
        let resp = h.call_at(other.path(), "connection_save", body).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        let resp: Value = resp.json().await.unwrap();
        assert_eq!(resp["error"]["code"], "forbidden");
        for cmd in [
            "connection_request_get",
            "connection_request_wait",
            "connection_request_cancel",
        ] {
            let resp = h.call_at(other.path(), cmd, json!({ "id": id })).await;
            assert_eq!(resp.status(), StatusCode::FORBIDDEN, "{cmd}");
        }
        let list = h
            .call_at(other.path(), "connection_list", json!({}))
            .await
            .json::<Value>()
            .await
            .unwrap();
        assert_eq!(list, json!([]));
        let got = h.ok("connection_request_get", json!({ "id": id })).await;
        assert_eq!(got["status"]["status"], "pending");
    }

    #[tokio::test]
    async fn malformed_body_uses_error_shape() {
        let h = Harness::start().await;
        let resp = h.call("query_run", json!({ "sql": 1 })).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let body: Value = resp.json().await.unwrap();
        assert_eq!(body["error"]["code"], "invalid_request");
    }
}
