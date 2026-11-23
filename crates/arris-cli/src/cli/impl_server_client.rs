use std::fs::OpenOptions;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use reqwest::header::AUTHORIZATION;
use serde::Serialize;
use serde::de::DeserializeOwned;

use super::{
    CliError, ENV_DATA_DIR, HEALTH_TIMEOUT_MS, SERVE_BACKGROUND_FLAG, SERVE_SUBCOMMAND,
    SERVER_LOG_FILE, SERVER_START_POLL_MS, SERVER_START_TIMEOUT_MS,
};
use crate::server::{
    ApiErrorBody, BEARER_PREFIX, HEALTH_ROUTE, LOOPBACK_HOST, NEXT_PARAM, PROJECT_HEADER,
    ROOT_ROUTE, SERVER_INFO_FILE, ServerInfo, TOKEN_PARAM, URL_SCHEME,
};

/// Authenticated handle to a live local server.
#[derive(Debug)]
pub struct ServerClient {
    http: reqwest::Client,
    info: ServerInfo,
}

impl ServerClient {
    /// Reuses a healthy server for `data_dir`, else spawns `serve` and waits for it.
    pub async fn connect_or_start(data_dir: &Path) -> Result<Self, CliError> {
        if let Some(client) = Self::connect(data_dir).await {
            return Ok(client);
        }
        Self::spawn_server(data_dir)?;
        // A spawn that loses the lock race exits; the winner's info file shows up here.
        let deadline = Instant::now() + Duration::from_millis(SERVER_START_TIMEOUT_MS);
        while Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(SERVER_START_POLL_MS)).await;
            if let Some(client) = Self::connect(data_dir).await {
                return Ok(client);
            }
        }
        Err(CliError::Unavailable(format!(
            "server did not start; see {}",
            data_dir.join(SERVER_LOG_FILE).display()
        )))
    }

    /// `None` unless the info file parses and its server answers health with our token.
    pub async fn connect(data_dir: &Path) -> Option<Self> {
        let raw = std::fs::read(data_dir.join(SERVER_INFO_FILE)).ok()?;
        let info: ServerInfo = serde_json::from_slice(&raw).ok()?;
        let http = reqwest::Client::new();
        let client = Self { http, info };
        let health = client
            .http
            .get(client.url(HEALTH_ROUTE))
            .header(AUTHORIZATION, client.bearer())
            .timeout(Duration::from_millis(HEALTH_TIMEOUT_MS))
            .send()
            .await
            .ok()?;
        health.status().is_success().then_some(client)
    }

    pub async fn call<T: DeserializeOwned>(
        &self,
        route: &str,
        project: &Path,
        body: &impl Serialize,
    ) -> Result<T, CliError> {
        let resp = self
            .http
            .post(self.url(route))
            .header(AUTHORIZATION, self.bearer())
            .header(PROJECT_HEADER, project.to_string_lossy().as_ref())
            .json(body)
            .send()
            .await?;
        let status = resp.status();
        let bytes = resp.bytes().await?;
        if status.is_success() {
            return Ok(serde_json::from_slice(&bytes)?);
        }
        let err: ApiErrorBody = serde_json::from_slice(&bytes)?;
        Err(CliError::Api(err.error))
    }

    /// Login link that sets the cookie, then redirects to `path`.
    pub fn ui_url(&self, path: &str) -> String {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        query.append_pair(TOKEN_PARAM, &self.info.token);
        if path != ROOT_ROUTE {
            query.append_pair(NEXT_PARAM, path);
        }
        format!("{}?{}", self.url(ROOT_ROUTE), query.finish())
    }

    fn url(&self, path: &str) -> String {
        format!("{URL_SCHEME}://{LOOPBACK_HOST}:{}{path}", self.info.port)
    }

    fn bearer(&self) -> String {
        format!("{BEARER_PREFIX}{}", self.info.token)
    }

    /// Detached `serve` in its own process group so Ctrl-C or CLI exit leaves it running.
    fn spawn_server(data_dir: &Path) -> Result<(), CliError> {
        std::fs::create_dir_all(data_dir)?;
        let log_path = data_dir.join(SERVER_LOG_FILE);
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        // Also tightens a log file left wider by an older build.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::Permissions::from_mode(super::SERVER_LOG_FILE_MODE);
            std::fs::set_permissions(&log_path, mode)?;
        }
        let mut cmd = Command::new(std::env::current_exe()?);
        cmd.args([SERVE_SUBCOMMAND, SERVE_BACKGROUND_FLAG])
            .env(ENV_DATA_DIR, data_dir)
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log);
        #[cfg(unix)]
        Self::isolate(&mut cmd);
        cmd.spawn()?;
        Ok(())
    }

    /// Own process group, and no inherited fds: a stray pipe would keep a caller's stdout open.
    #[cfg(unix)]
    fn isolate(cmd: &mut Command) {
        use std::os::unix::process::CommandExt;
        cmd.process_group(super::OWN_PROCESS_GROUP);
        // sysconf is not async-signal-safe, so the bound is computed before fork.
        // SAFETY: sysconf has no preconditions.
        let open_max = unsafe { libc::sysconf(libc::_SC_OPEN_MAX) };
        let limit = match libc::c_int::try_from(open_max) {
            Ok(n) if n >= 0 => n.min(super::MAX_FD_SCAN),
            _ => super::MAX_FD_SCAN,
        };
        // CLOEXEC rather than close keeps std's own exec-error pipe working.
        // SAFETY: the hook only calls fcntl, which is async-signal-safe.
        unsafe {
            cmd.pre_exec(move || {
                for fd in super::FIRST_INHERITABLE_FD..limit {
                    libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC);
                }
                Ok(())
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    fn client(port: u16, token: &str) -> ServerClient {
        ServerClient {
            http: reqwest::Client::new(),
            info: ServerInfo {
                pid: 1,
                port,
                token: token.into(),
                version: String::new(),
            },
        }
    }

    #[test]
    fn ui_url_carries_token() {
        assert_eq!(
            client(4242, "abc").ui_url("/"),
            "http://127.0.0.1:4242/?token=abc"
        );
        assert_eq!(
            client(4242, "abc").ui_url("/connections/new?request=r&x=1"),
            "http://127.0.0.1:4242/?token=abc&next=%2Fconnections%2Fnew%3Frequest%3Dr%26x%3D1"
        );
    }

    #[cfg(unix)]
    #[test]
    fn isolate_keeps_stray_fds_out_of_the_child() {
        let mut fds = [0; 2];
        // SAFETY: `fds` is a valid two-int buffer; the fds are closed below.
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        let probe = format!("test -e /dev/fd/{}", fds[1]);
        let run = |isolated: bool| {
            let mut cmd = Command::new("sh");
            cmd.args(["-c", &probe]);
            if isolated {
                ServerClient::isolate(&mut cmd);
            }
            cmd.status().unwrap().success()
        };
        let (leaked, isolated) = (run(false), run(true));
        // SAFETY: both fds came from the pipe call above.
        unsafe {
            libc::close(fds[0]);
            libc::close(fds[1]);
        }
        assert!(leaked, "control: a plain spawn inherits the stray fd");
        assert!(!isolated, "isolated spawn must not inherit the stray fd");
    }

    #[tokio::test]
    async fn connect_is_none_without_info_or_live_server() {
        let tmp = TempDir::new().unwrap();
        assert!(ServerClient::connect(tmp.path()).await.is_none());
        let stale = client(1, "bogus").info;
        std::fs::write(
            tmp.path().join(SERVER_INFO_FILE),
            serde_json::to_vec(&stale).unwrap(),
        )
        .unwrap();
        assert!(ServerClient::connect(tmp.path()).await.is_none());
    }
}
