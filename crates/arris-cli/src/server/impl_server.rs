use std::fs::{File, OpenOptions, TryLockError};
use std::io::Write;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use arris_engines::AppEnvironment;
use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::get;
use axum::{Json, Router, middleware};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

use super::{
    ApiRoutes, AuthGuard, CANVASES_PAGE_PREFIX, ConnectionRequests, DIR_QUERY_PARAM,
    EVENTS_CHANNEL_CAPACITY, EVENTS_ROUTE, HEALTH_ROUTE, HealthResponse, LOOPBACK_HOST, NEXT_PARAM,
    OS_ASSIGNED_PORT, PROJECT_QUERY_PARAM, QueryHandoffs, ROOT_ROUTE, RUNS_PAGE_PREFIX,
    SERVER_INFO_FILE, SERVER_INFO_TMP_EXTENSION, SERVER_LOCK_FILE, SERVER_VERSION, ServerError,
    ServerInfo, ServerState, StaticAssets, TOKEN_BYTES, TOKEN_PARAM, URL_SCHEME,
};

pub struct Server {
    state: Arc<ServerState>,
    listener: TcpListener,
    info_path: PathBuf,
    // Exclusive lock held for the server lifetime; released when the fd closes.
    _lock: File,
}

impl Server {
    pub fn bind(env: Arc<AppEnvironment>, port: Option<u16>) -> Result<Self, ServerError> {
        let lock = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(env.data_dir.join(SERVER_LOCK_FILE))?;
        match lock.try_lock() {
            Ok(()) => {}
            Err(TryLockError::WouldBlock) => return Err(ServerError::AlreadyRunning),
            Err(TryLockError::Error(e)) => return Err(e.into()),
        }
        let listener = TcpListener::bind((LOOPBACK_HOST, port.unwrap_or(OS_ASSIGNED_PORT)))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let token = Self::generate_token();
        let info_path = env.data_dir.join(SERVER_INFO_FILE);
        Self::write_info(
            &info_path,
            &ServerInfo {
                pid: std::process::id(),
                port,
                token: token.clone(),
                version: SERVER_VERSION.into(),
            },
        )?;
        let (events, _) = broadcast::channel(EVENTS_CHANNEL_CAPACITY);
        let state = Arc::new(ServerState {
            env,
            token,
            port,
            events,
            connection_requests: ConnectionRequests::default(),
            query_handoffs: QueryHandoffs::default(),
        });
        Ok(Self {
            state,
            listener,
            info_path,
            _lock: lock,
        })
    }

    pub fn state(&self) -> Arc<ServerState> {
        self.state.clone()
    }

    /// Login link that lands on the root page pinned to `project`.
    pub fn login_url(&self, project: &Path) -> String {
        let next = Self::project_page(project);
        let query = Self::page_path(
            ROOT_ROUTE,
            &[(TOKEN_PARAM, &self.state.token), (NEXT_PARAM, &next)],
        );
        format!("{URL_SCHEME}://{LOOPBACK_HOST}:{}{query}", self.state.port)
    }

    /// Same-origin page path with url-encoded query pairs.
    pub fn page_path(path: &str, pairs: &[(&str, &str)]) -> String {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        query.extend_pairs(pairs);
        format!("{path}?{}", query.finish())
    }

    /// Root page pinned to `project`, so the web UI loads it without stored state.
    pub fn project_page(project: &Path) -> String {
        Self::page_path(
            ROOT_ROUTE,
            &[(PROJECT_QUERY_PARAM, &project.to_string_lossy())],
        )
    }

    /// Result page of one run, pinned to `project`.
    pub fn run_page(project: &Path, run_id: &str) -> String {
        Self::page_path(
            &format!("{RUNS_PAGE_PREFIX}{run_id}"),
            &[(PROJECT_QUERY_PARAM, &project.to_string_lossy())],
        )
    }

    /// Board page of one canvas, pinned to `project`.
    pub fn canvas_page(project: &Path, canvas_id: &str) -> String {
        Self::page_path(
            &format!("{CANVASES_PAGE_PREFIX}{canvas_id}"),
            &[(PROJECT_QUERY_PARAM, &project.to_string_lossy())],
        )
    }

    /// Lineage page of the whole project (`page`) or one model (`prefix` + model).
    pub fn lineage_page(
        page: &str,
        prefix: &str,
        project: &Path,
        dir: Option<&str>,
        model: Option<&str>,
    ) -> String {
        let path = model.map_or_else(|| page.to_owned(), |m| format!("{prefix}{m}"));
        Self::analytics_page(&path, project, dir)
    }

    /// One logged tool run, under the tool's runs page.
    pub fn tool_run_page(prefix: &str, project: &Path, dir: Option<&str>, run_id: &str) -> String {
        Self::analytics_page(&format!("{prefix}{run_id}"), project, dir)
    }

    /// A dbt / SQLMesh page; `dir` keeps a subfolder project selected in the UI.
    fn analytics_page(path: &str, project: &Path, dir: Option<&str>) -> String {
        let project = project.to_string_lossy();
        let mut pairs = vec![(PROJECT_QUERY_PARAM, project.as_ref())];
        pairs.extend(dir.map(|d| (DIR_QUERY_PARAM, d)));
        Self::page_path(path, &pairs)
    }

    pub fn router(state: Arc<ServerState>) -> Router {
        Router::new()
            .route(HEALTH_ROUTE, get(Self::health))
            .route(EVENTS_ROUTE, get(Self::events))
            .merge(ApiRoutes::router())
            .fallback(get(StaticAssets::handler))
            .layer(middleware::from_fn_with_state(
                state.clone(),
                AuthGuard::layer,
            ))
            .with_state(state)
    }

    pub async fn serve(self) -> Result<(), ServerError> {
        let listener = tokio::net::TcpListener::from_std(self.listener)?;
        let served = axum::serve(listener, Self::router(self.state))
            .with_graceful_shutdown(async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await;
        let _ = std::fs::remove_file(&self.info_path);
        Ok(served?)
    }

    fn generate_token() -> String {
        let bytes: [u8; TOKEN_BYTES] = rand::random();
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn write_info(path: &Path, info: &ServerInfo) -> Result<(), ServerError> {
        // Fresh 0600 temp file then rename, so readers never see a partial or wider-mode file.
        let tmp = path.with_extension(SERVER_INFO_TMP_EXTENSION);
        let _ = std::fs::remove_file(&tmp);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(super::SERVER_INFO_FILE_MODE);
        }
        options.open(&tmp)?.write_all(&serde_json::to_vec(info)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}

// Route handlers.
impl Server {
    async fn health() -> Json<HealthResponse> {
        Json(HealthResponse {
            version: SERVER_VERSION.into(),
            token_ok: true,
        })
    }

    async fn events(
        State(state): State<Arc<ServerState>>,
    ) -> Sse<impl Stream<Item = Result<Event, axum::Error>>> {
        // Lagged receivers skip dropped events; clients refetch state on the next one.
        let stream = BroadcastStream::new(state.events.subscribe())
            .filter_map(Result::ok)
            .map(|event| Event::default().json_data(event));
        Sse::new(stream).keep_alive(KeepAlive::default())
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use arris_engines::AppEnvironment;
    use arris_engines::persistence::MemorySecretStore;
    use reqwest::StatusCode;
    use reqwest::header::{AUTHORIZATION, CACHE_CONTROL, COOKIE, HOST, LOCATION, SET_COOKIE};
    use tempfile::TempDir;

    use super::*;
    use crate::server::{
        ARRIS_TOKEN_COOKIE, EVENTS_ROUTE, HEALTH_ROUTE, HealthResponse, SERVER_INFO_FILE,
        ServerEvent, ServerEventKind, ServerInfo,
    };

    struct Harness {
        _tmp: TempDir,
        state: Arc<ServerState>,
        base: String,
        client: reqwest::Client,
    }

    impl Harness {
        async fn env(tmp: &TempDir) -> Arc<AppEnvironment> {
            AppEnvironment::init_at(tmp.path().into(), Arc::new(MemorySecretStore::new()))
                .await
                .unwrap()
        }

        async fn start() -> Self {
            let tmp = TempDir::new().unwrap();
            let server = Server::bind(Self::env(&tmp).await, Some(0)).unwrap();
            let state = server.state();
            tokio::spawn(server.serve());
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap();
            let base = format!("http://127.0.0.1:{}", state.port);
            Self {
                _tmp: tmp,
                state,
                base,
                client,
            }
        }

        fn bearer(&self) -> String {
            format!("Bearer {}", self.state.token)
        }
    }

    #[tokio::test]
    async fn health_requires_token() {
        let h = Harness::start().await;
        let url = format!("{}{HEALTH_ROUTE}", h.base);
        let anon = h.client.get(&url).send().await.unwrap();
        assert_eq!(anon.status(), StatusCode::FORBIDDEN);
        let wrong = h
            .client
            .get(&url)
            .header(AUTHORIZATION, "Bearer nope")
            .send()
            .await
            .unwrap();
        assert_eq!(wrong.status(), StatusCode::FORBIDDEN);

        let ok = h
            .client
            .get(&url)
            .header(AUTHORIZATION, h.bearer())
            .send()
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
        let body: HealthResponse = ok.json().await.unwrap();
        assert!(body.token_ok);
        assert_eq!(body.version, env!("CARGO_PKG_VERSION"));
    }

    #[tokio::test]
    async fn rejects_foreign_host_header() {
        let h = Harness::start().await;
        let url = format!("{}{HEALTH_ROUTE}", h.base);
        for host in ["evil.example", "127.0.0.1", "localhost:1"] {
            let resp = h
                .client
                .get(&url)
                .header(AUTHORIZATION, h.bearer())
                .header(HOST, host)
                .send()
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::FORBIDDEN, "host {host}");
        }
        let localhost = h
            .client
            .get(&url)
            .header(AUTHORIZATION, h.bearer())
            .header(HOST, format!("localhost:{}", h.state.port))
            .send()
            .await
            .unwrap();
        assert_eq!(localhost.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn token_query_sets_cookie_and_redirects() {
        let h = Harness::start().await;
        let bad = h
            .client
            .get(format!("{}/?token=nope", h.base))
            .send()
            .await
            .unwrap();
        assert_eq!(bad.status(), StatusCode::FORBIDDEN);
        assert!(bad.headers().get(SET_COOKIE).is_none());

        let resp = h
            .client
            .get(format!("{}/?token={}", h.base, h.state.token))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FOUND);
        assert_eq!(resp.headers()[LOCATION], "/");
        assert_eq!(resp.headers()[CACHE_CONTROL], "no-store");
        let cookie = resp.headers()[SET_COOKIE].to_str().unwrap().to_owned();
        assert!(cookie.starts_with(&format!("{ARRIS_TOKEN_COOKIE}={}", h.state.token)));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Strict"));

        let pair = cookie.split(';').next().unwrap();
        let authed = h
            .client
            .get(format!("{}{HEALTH_ROUTE}", h.base))
            .header(COOKIE, format!("other=1; {pair}"))
            .send()
            .await
            .unwrap();
        assert_eq!(authed.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn token_login_redirects_only_to_safe_next() {
        let h = Harness::start().await;
        let cases = [
            (
                "%2Fconnections%2Fnew%3Frequest%3Dabc",
                "/connections/new?request=abc",
            ),
            (
                "%2Fconnections%2Fnew%3Frequest%3Dabc%26project%3D%252Ftmp%252Fp",
                "/connections/new?request=abc&project=%2Ftmp%2Fp",
            ),
            ("%2F%2Fevil.example", "/"),
            ("https%3A%2F%2Fevil.example", "/"),
            ("%2F%5Cevil.example", "/"),
            ("%2F%09%2Fevil.example", "/"),
            ("", "/"),
        ];
        for (next, location) in cases {
            let resp = h
                .client
                .get(format!("{}/?token={}&next={next}", h.base, h.state.token))
                .send()
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::FOUND, "next {next}");
            assert_eq!(resp.headers()[LOCATION], location, "next {next}");
        }
    }

    #[test]
    fn analytics_pages_carry_dir_only_when_given() {
        let project = Path::new("/tmp/proj");
        assert_eq!(
            Server::lineage_page(
                "/dbt/lineage",
                "/dbt/lineage/",
                project,
                None,
                Some("orders")
            ),
            "/dbt/lineage/orders?project=%2Ftmp%2Fproj"
        );
        assert_eq!(
            Server::tool_run_page("/dbt/runs/", project, Some("transform/dbt"), "r1"),
            "/dbt/runs/r1?project=%2Ftmp%2Fproj&dir=transform%2Fdbt"
        );
    }

    #[tokio::test]
    async fn login_url_lands_on_the_project_page() {
        let tmp = TempDir::new().unwrap();
        let server = Server::bind(Harness::env(&tmp).await, Some(0)).unwrap();
        let url = server.login_url(Path::new("/tmp/proj"));
        tokio::spawn(server.serve());
        let resp = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap()
            .get(url)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FOUND);
        assert_eq!(resp.headers()[LOCATION], "/?project=%2Ftmp%2Fproj");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn server_info_written_with_0600() {
        use std::os::unix::fs::PermissionsExt;
        let h = Harness::start().await;
        let path: PathBuf = h.state.env.data_dir.join(SERVER_INFO_FILE);
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let info: ServerInfo = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(info.port, h.state.port);
        assert_eq!(info.token, h.state.token);
        assert_eq!(info.pid, std::process::id());
    }

    #[tokio::test]
    async fn token_query_login_is_get_only() {
        let h = Harness::start().await;
        let resp = h
            .client
            .post(format!("{}/?token={}", h.base, h.state.token))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        assert!(resp.headers().get(SET_COOKIE).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn write_info_replaces_stale_file_atomically() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(SERVER_INFO_FILE);
        std::fs::write(&path, b"stale").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let info = ServerInfo {
            pid: 1,
            port: 2,
            token: "t".into(),
            version: "v".into(),
        };
        Server::write_info(&path, &info).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let read: ServerInfo = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(read, info);
        let leftovers: Vec<_> = std::fs::read_dir(tmp.path()).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "temp file must be renamed away");
    }

    #[test]
    fn server_info_debug_redacts_token() {
        let info = ServerInfo {
            pid: 1,
            port: 2,
            token: "supersecrettoken".into(),
            version: "v".into(),
        };
        assert!(!format!("{info:?}").contains("supersecrettoken"));
    }

    /// A child another test forks can briefly hold an inherited copy of the lock fd.
    const REBIND_ATTEMPTS: usize = 50;
    const REBIND_WAIT: std::time::Duration = std::time::Duration::from_millis(20);

    #[tokio::test]
    async fn second_bind_fails_already_running() {
        let tmp = TempDir::new().unwrap();
        let env = Harness::env(&tmp).await;
        let first = Server::bind(env.clone(), Some(0)).unwrap();
        assert!(matches!(
            Server::bind(env.clone(), Some(0)),
            Err(ServerError::AlreadyRunning)
        ));
        drop(first);
        let rebound = (0..REBIND_ATTEMPTS).any(|_| {
            let ok = Server::bind(env.clone(), Some(0)).is_ok();
            if !ok {
                std::thread::sleep(REBIND_WAIT);
            }
            ok
        });
        assert!(rebound, "the lock frees once the first server drops");
    }

    #[tokio::test]
    async fn events_stream_delivers_emitted_event() {
        let h = Harness::start().await;
        let url = format!("{}{EVENTS_ROUTE}", h.base);
        let anon = h.client.get(&url).send().await.unwrap();
        assert_eq!(anon.status(), StatusCode::FORBIDDEN);

        let mut resp = h
            .client
            .get(&url)
            .header(AUTHORIZATION, h.bearer())
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let event = ServerEvent {
            kind: ServerEventKind::HistoryChanged,
            project: Some(PathBuf::from("/tmp/p")),
            payload: serde_json::json!({ "run": 1 }),
        };
        h.state.emit(event.clone());
        let chunk = resp.chunk().await.unwrap().unwrap();
        let text = String::from_utf8(chunk.to_vec()).unwrap();
        let data = text.trim().strip_prefix("data:").unwrap().trim();
        assert_eq!(serde_json::from_str::<ServerEvent>(data).unwrap(), event);
    }
}
