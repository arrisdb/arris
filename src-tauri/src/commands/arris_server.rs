//! Bridge to the local arris server so the CLI (and an external agent) can drive this app.

use std::sync::Arc;
use std::time::Duration;

use arris_engines::AppEnvironment;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

use super::constants::{
    ARRIS_SERVER_API_PREFIX, ARRIS_SERVER_BAD_ROUTE_MESSAGE, ARRIS_SERVER_CONNECTED_KIND,
    ARRIS_SERVER_DOWN_MESSAGE, ARRIS_SERVER_EVENT, ARRIS_SERVER_EVENTS_PATH, ARRIS_SERVER_HOST,
    ARRIS_SERVER_INFO_FILE, ARRIS_SERVER_PROJECT_HEADER, ARRIS_SERVER_RETRY_MS, SSE_DATA_PREFIX,
    SSE_FRAME_END,
};

/// The fields of the server's discovery file this bridge needs.
#[derive(Deserialize)]
struct ServerInfo {
    port: u16,
    token: String,
}

pub struct ArrisServer;

impl ArrisServer {
    fn info(env: &AppEnvironment) -> Option<ServerInfo> {
        let text = std::fs::read_to_string(env.data_dir.join(ARRIS_SERVER_INFO_FILE)).ok()?;
        serde_json::from_str(&text).ok()
    }

    fn url(info: &ServerInfo, path: &str) -> String {
        format!("http://{ARRIS_SERVER_HOST}:{}{path}", info.port)
    }

    /// Pulls complete SSE frames off `buf` and returns their JSON payloads.
    fn drain_frames(buf: &mut String) -> Vec<Value> {
        let mut events = Vec::new();
        while let Some(end) = buf.find(SSE_FRAME_END) {
            let frame: String = buf.drain(..end + SSE_FRAME_END.len()).collect();
            for line in frame.lines() {
                let data = line.strip_prefix(SSE_DATA_PREFIX).map(str::trim_start);
                if let Some(event) = data.and_then(|d| serde_json::from_str(d).ok()) {
                    events.push(event);
                }
            }
        }
        events
    }

    /// Re-emits the server's events to the windows until the stream ends.
    async fn follow(app: &AppHandle, client: &reqwest::Client, info: &ServerInfo) {
        let request = client
            .get(Self::url(info, ARRIS_SERVER_EVENTS_PATH))
            .bearer_auth(&info.token);
        let Ok(response) = request.send().await.and_then(|r| r.error_for_status()) else {
            return;
        };
        let _ = app.emit(
            ARRIS_SERVER_EVENT,
            json!({ "kind": ARRIS_SERVER_CONNECTED_KIND }),
        );
        let mut stream = response.bytes_stream();
        let mut buf = String::new();
        while let Some(Ok(chunk)) = stream.next().await {
            buf.push_str(&String::from_utf8_lossy(&chunk));
            for event in Self::drain_frames(&mut buf) {
                let _ = app.emit(ARRIS_SERVER_EVENT, event);
            }
        }
    }

    /// Follows the server for the app's lifetime, reconnecting when it (re)starts.
    pub fn spawn(app: AppHandle) {
        tauri::async_runtime::spawn(async move {
            let client = reqwest::Client::new();
            loop {
                let info = Self::info(&app.state::<Arc<AppEnvironment>>());
                if let Some(info) = info {
                    Self::follow(&app, &client, &info).await;
                }
                tokio::time::sleep(Duration::from_millis(ARRIS_SERVER_RETRY_MS)).await;
            }
        });
    }
}

/// POSTs to the arris server's `/api/<cmd>`; an error carries the server's `{ error }` body.
#[tauri::command]
pub async fn cmd_arris_api(
    env: State<'_, Arc<AppEnvironment>>,
    project: Option<String>,
    cmd: String,
    args: Value,
) -> Result<Value, Value> {
    if !cmd.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
        return Err(json!(ARRIS_SERVER_BAD_ROUTE_MESSAGE));
    }
    let info = ArrisServer::info(&env).ok_or_else(|| json!(ARRIS_SERVER_DOWN_MESSAGE))?;
    let path = format!("{ARRIS_SERVER_API_PREFIX}{cmd}");
    let mut request = reqwest::Client::new()
        .post(ArrisServer::url(&info, &path))
        .bearer_auth(&info.token)
        .json(&args);
    if let Some(project) = project {
        request = request.header(ARRIS_SERVER_PROJECT_HEADER, project);
    }
    let response = request.send().await.map_err(|e| json!(e.to_string()))?;
    let ok = response.status().is_success();
    let body: Value = response.json().await.map_err(|e| json!(e.to_string()))?;
    if ok { Ok(body) } else { Err(body) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drain_frames_keeps_a_partial_frame_for_the_next_chunk() {
        let mut buf = String::from("data: {\"kind\":\"a\"}\n\n: keep-alive\n\ndata: {\"ki");
        let events = ArrisServer::drain_frames(&mut buf);
        assert_eq!(events, vec![json!({ "kind": "a" })]);
        assert_eq!(buf, "data: {\"ki");
        buf.push_str("nd\":\"b\"}\n\n");
        assert_eq!(
            ArrisServer::drain_frames(&mut buf),
            vec![json!({ "kind": "b" })]
        );
    }
}
