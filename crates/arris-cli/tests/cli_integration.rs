use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command as StdCommand, Stdio};
use std::thread;

use arris_cli::cli::{
    ENV_DATA_DIR, ENV_DBT_BIN, ENV_TEST_SECRETS, EXIT_API_ERROR, EXIT_CANCELLED,
    EXIT_TOOL_NOT_FOUND, SERVER_LISTENING_PREFIX, SERVER_LOG_FILE, TEST_SECRETS_MEMORY,
    TOOL_RUN_OUTPUT_TAIL_BYTES,
};
use arris_cli::server::{
    BEARER_PREFIX, CANVASES_PAGE_PREFIX, CONNECTION_NEW_PAGE, CONNECTION_REQUEST_CANCEL_ROUTE,
    CONNECTION_REQUEST_GET_ROUTE,
    CONNECTION_SAVE_ROUTE, DBT_LINEAGE_PAGE_PREFIX, DBT_RUNS_PAGE_PREFIX, LOOPBACK_HOST,
    PROJECT_HEADER, PROJECT_QUERY_PARAM, REQUEST_QUERY_PARAM, ROOT_ROUTE, RUNS_PAGE_PREFIX,
    SERVER_INFO_FILE, SERVER_VERSION, ServerInfo, TOOL_RUN_GET_ROUTE, TOOL_RUN_LIST_ROUTE,
    URL_SCHEME,
};
use arris_engines::{ConnectionConfig, DatabaseKind};
use assert_cmd::Command;
use reqwest::header::AUTHORIZATION;
use serde_json::{Value, json};
use tempfile::TempDir;

const BIN: &str = env!("CARGO_BIN_EXE_arris");
const DEAD_PID: u32 = 999_999;
const BOGUS_PORT: u16 = 1;
const BOGUS_TOKEN: &str = "bogus";
const LOG_MODE_MASK: u32 = 0o777;
const LOG_MODE: u32 = 0o600;
const CONN_NAME: &str = "local";
const ENV_DBT_PROFILES_DIR: &str = "DBT_PROFILES_DIR";
const DBT_PROJECT_YML: &str = "name: shop\nprofile: shop\n";
const DBT_PROFILES_YML: &str = "shop:\n  target: dev\n  outputs:\n    dev:\n      type: duckdb\n      path: ./w.duckdb\n      password: hunter2\n";
const SYNC_NAME: &str = "shop-dev";

/// Per-test data dir and project; kills any server it started on drop.
struct TestEnv {
    data: TempDir,
    project: TempDir,
}

impl TestEnv {
    fn new() -> Self {
        Self {
            data: TempDir::new().unwrap(),
            project: TempDir::new().unwrap(),
        }
    }

    fn cmd(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(BIN);
        cmd.env(ENV_DATA_DIR, self.data.path())
            .env(ENV_TEST_SECRETS, TEST_SECRETS_MEMORY)
            .env_remove(ENV_DBT_PROFILES_DIR)
            .arg("--project")
            .arg(self.project.path())
            .args(args);
        cmd
    }

    fn ok(&self, args: &[&str]) -> Value {
        let out = self
            .cmd(args)
            .assert()
            .success()
            .get_output()
            .stdout
            .clone();
        serde_json::from_slice(&out).unwrap()
    }

    fn info(&self) -> ServerInfo {
        let raw = std::fs::read(self.data.path().join(SERVER_INFO_FILE)).unwrap();
        serde_json::from_slice(&raw).unwrap()
    }

    fn alive(pid: u32) -> bool {
        StdCommand::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .unwrap()
            .success()
    }

    async fn save_sqlite(&self) {
        let mut cfg = ConnectionConfig::new(CONN_NAME, DatabaseKind::Sqlite);
        cfg.file_path = Some(self.project.path().join("t.db").to_string_lossy().into());
        self.post(CONNECTION_SAVE_ROUTE, json!({ "config": cfg }))
            .await;
    }

    async fn post(&self, route: &str, body: Value) -> Value {
        let info = self.info();
        let resp = reqwest::Client::new()
            .post(format!(
                "{URL_SCHEME}://{LOOPBACK_HOST}:{}{route}",
                info.port
            ))
            .header(AUTHORIZATION, format!("{BEARER_PREFIX}{}", info.token))
            .header(PROJECT_HEADER, self.project.path().to_str().unwrap())
            .json(&body)
            .send()
            .await
            .unwrap();
        let status = resp.status();
        let text = resp.text().await.unwrap();
        assert!(status.is_success(), "{text}");
        serde_json::from_str(&text).unwrap()
    }

    /// Parses a login `next` path so its query params can be asserted.
    fn next_page(&self, next: &str) -> reqwest::Url {
        reqwest::Url::parse(&format!("{URL_SCHEME}://{LOOPBACK_HOST}{next}")).unwrap()
    }

    /// A UI link logs in with `token` and lands on `path` pinned to this project.
    fn assert_project_ui_url(&self, url: &Value, token: &str, path: &str) {
        let url = reqwest::Url::parse(url.as_str().unwrap()).unwrap();
        let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(query["token"], token);
        let next = self.next_page(&query["next"]);
        assert_eq!(next.path(), path);
        let pairs: HashMap<_, _> = next.query_pairs().into_owned().collect();
        assert_eq!(pairs[PROJECT_QUERY_PARAM], self.project_root());
    }

    fn project_root(&self) -> String {
        self.project
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into()
    }

    /// Starts `connection new --no-open`; returns the child and the request id from its URL.
    fn connection_new(&self) -> (Child, String) {
        self.form_request(&["connection", "new", "--kind", "sqlite", "--no-open"])
    }

    /// Starts a command that opens a connection form; returns it and the form's request id.
    fn form_request(&self, args: &[&str]) -> (Child, String) {
        let mut child = StdCommand::new(BIN)
            .env(ENV_DATA_DIR, self.data.path())
            .env(ENV_TEST_SECRETS, TEST_SECRETS_MEMORY)
            .env_remove(ENV_DBT_PROFILES_DIR)
            .arg("--project")
            .arg(self.project.path())
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stderr.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let out: Value = serde_json::from_str(&line).unwrap();
        let url = reqwest::Url::parse(out["url"].as_str().unwrap()).unwrap();
        let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(query["token"], self.info().token);
        let next = self.next_page(&query["next"]);
        assert_eq!(next.path(), CONNECTION_NEW_PAGE);
        let pairs: HashMap<_, _> = next.query_pairs().into_owned().collect();
        assert_eq!(pairs[PROJECT_QUERY_PARAM], self.project_root());
        let id = pairs[REQUEST_QUERY_PARAM].clone();
        (child, id)
    }
}

impl TestEnv {
    fn write_dbt_project(&self) {
        std::fs::write(self.project.path().join("dbt_project.yml"), DBT_PROJECT_YML).unwrap();
        std::fs::write(self.project.path().join("profiles.yml"), DBT_PROFILES_YML).unwrap();
    }
}

impl Drop for TestEnv {
    fn drop(&mut self) {
        let path = self.data.path().join(SERVER_INFO_FILE);
        let Ok(raw) = std::fs::read(path) else { return };
        if let Ok(info) = serde_json::from_slice::<ServerInfo>(&raw) {
            let _ = StdCommand::new("kill")
                .args(["-TERM", &info.pid.to_string()])
                .status();
        }
    }
}

#[tokio::test]
async fn query_autostarts_server_and_records_history() {
    let env = TestEnv::new();
    assert_eq!(env.ok(&["connection", "list"]), json!([]));
    env.save_sqlite().await;
    env.ok(&["query", CONN_NAME, "--sql", "CREATE TABLE t (x INTEGER)"]);
    env.ok(&[
        "query",
        CONN_NAME,
        "--sql",
        "INSERT INTO t VALUES (1), (2), (3)",
    ]);

    let sql_file = env.project.path().join("q.sql");
    std::fs::write(&sql_file, "SELECT x FROM t ORDER BY x").unwrap();
    let out = env.ok(&[
        "query",
        CONN_NAME,
        "--file",
        sql_file.to_str().unwrap(),
        "--limit",
        "2",
    ]);
    assert_eq!(out["rows"], json!([[1], [2]]));
    assert_eq!(out["truncated"], true);
    assert_eq!(out["columns"][0]["name"], "x");
    let run_id = out["runId"].as_str().unwrap().to_owned();
    let token = env.info().token;
    env.assert_project_ui_url(
        &out["uiUrl"],
        &token,
        &format!("{RUNS_PAGE_PREFIX}{run_id}"),
    );

    let full = env.ok(&["query", CONN_NAME, "--sql", "SELECT x FROM t"]);
    assert_eq!(full["rowCount"], 3);
    assert_eq!(full["truncated"], false);

    let history = env.ok(&["history", "--limit", "10"]);
    let ids: Vec<&str> = history
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&run_id.as_str()));

    let pin = env.ok(&["pin", &run_id, "--title", "first two"]);
    assert_eq!(pin["name"], "first two");
    assert_eq!(env.ok(&["pins"]).as_array().unwrap().len(), 1);
    env.ok(&["unpin", pin["id"].as_str().unwrap()]);
    assert_eq!(env.ok(&["pins"]), json!([]));

    let ui = env.ok(&["ui"]);
    env.assert_project_ui_url(&ui["url"], &token, ROOT_ROUTE);

    let log_path = env.data.path().join(SERVER_LOG_FILE);
    let log = std::fs::read_to_string(&log_path).unwrap();
    assert!(!log.contains(&token), "{log}");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&log_path).unwrap().permissions().mode();
        assert_eq!(mode & LOG_MODE_MASK, LOG_MODE);
    }
}

#[test]
fn two_concurrent_invocations_start_one_server() {
    let env = TestEnv::new();
    thread::scope(|s| {
        let a = s.spawn(|| env.ok(&["connection", "list"]));
        let b = s.spawn(|| env.ok(&["connection", "list"]));
        assert_eq!(a.join().unwrap(), json!([]));
        assert_eq!(b.join().unwrap(), json!([]));
    });
    assert!(TestEnv::alive(env.info().pid));
    let log = std::fs::read_to_string(env.data.path().join(SERVER_LOG_FILE)).unwrap();
    assert_eq!(log.matches(SERVER_LISTENING_PREFIX).count(), 1, "{log}");
}

#[test]
fn stale_server_info_is_replaced() {
    let env = TestEnv::new();
    let stale = ServerInfo {
        pid: DEAD_PID,
        port: BOGUS_PORT,
        token: BOGUS_TOKEN.into(),
        version: SERVER_VERSION.into(),
    };
    let path = env.data.path().join(SERVER_INFO_FILE);
    std::fs::write(&path, serde_json::to_vec(&stale).unwrap()).unwrap();
    assert_eq!(env.ok(&["pins"]), json!([]));
    let fresh = env.info();
    assert_ne!(fresh.token, BOGUS_TOKEN);
    assert!(TestEnv::alive(fresh.pid));
}

#[test]
fn api_error_exits_1_with_json_error() {
    let env = TestEnv::new();
    let out = env
        .cmd(&["query", "missing", "--sql", "SELECT 1"])
        .assert()
        .code(i32::from(EXIT_API_ERROR))
        .get_output()
        .stdout
        .clone();
    let body: Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(body["error"]["code"], "connection_not_found");
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("missing")
    );
}

#[tokio::test]
async fn connection_new_prints_saved_connection() {
    let env = TestEnv::new();
    let (child, id) = env.connection_new();
    let mut cfg = ConnectionConfig::new(CONN_NAME, DatabaseKind::Sqlite);
    cfg.file_path = Some(env.project.path().join("t.db").to_string_lossy().into());
    let saved = env
        .post(
            CONNECTION_SAVE_ROUTE,
            json!({ "config": cfg, "requestId": id }),
        )
        .await;
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success());
    let body: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        body,
        json!({ "connectionId": saved["id"], "name": CONN_NAME })
    );
}

#[tokio::test]
async fn connection_new_cancelled_exits_3() {
    let env = TestEnv::new();
    let (child, id) = env.connection_new();
    env.post(CONNECTION_REQUEST_CANCEL_ROUTE, json!({ "id": id }))
        .await;
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(i32::from(EXIT_CANCELLED)));
    let body: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(body["error"]["code"], "cancelled");
}

#[tokio::test]
async fn canvas_new_add_show_round_trip() {
    let env = TestEnv::new();
    let made = env.ok(&["canvas", "new", "Revenue"]);
    let id = made["id"].as_str().unwrap().to_owned();
    assert_eq!(made["title"], "Revenue");
    let token = env.info().token;
    let page = format!("{CANVASES_PAGE_PREFIX}{id}");
    env.assert_project_ui_url(&made["uiUrl"], &token, &page);

    env.save_sqlite().await;
    let run = env.ok(&["query", CONN_NAME, "--sql", "SELECT 2 AS n"]);
    let run_id = run["runId"].as_str().unwrap();
    let from_run = env.ok(&["canvas", "add", &id, "--run", run_id]);
    assert_eq!(from_run["canvasId"], id.as_str());
    assert!(from_run.get("chartId").is_none());
    env.assert_project_ui_url(&from_run["uiUrl"], &token, &page);
    let manual = env.ok(&[
        "canvas",
        "add",
        "Revenue",
        "--sql",
        "SELECT 1",
        "--connection",
        CONN_NAME,
        "--title",
        "One",
        "--chart",
        "bar",
        "--x",
        "k",
        "--y",
        "n",
    ]);

    let shown = env.ok(&["canvas", "show", "Revenue"]);
    assert_eq!(shown["id"], id.as_str());
    assert_eq!(shown["revision"], 2);
    let comps = shown["components"].as_array().unwrap();
    assert_eq!(comps.len(), 3);
    assert_eq!(comps[0]["id"], from_run["queryId"]);
    assert_eq!(comps[0]["sql"], "SELECT 2 AS n");
    assert_eq!(comps[1]["title"], "One");
    assert_eq!(comps[2]["id"], manual["chartId"]);
    assert_eq!(comps[2]["kind"], "chart");
    assert!(comps[0].get("x").is_none(), "show drops layout");
    let listed = env.ok(&["canvas", "list"]);
    assert_eq!(listed[0]["componentCount"], 3);
}

#[tokio::test]
async fn canvas_add_ambiguous_title_exits_1() {
    let env = TestEnv::new();
    let a = env.ok(&["canvas", "new", "Dup"]);
    let b = env.ok(&["canvas", "new", "Dup"]);
    env.save_sqlite().await;
    let out = env
        .cmd(&[
            "canvas",
            "add",
            "Dup",
            "--sql",
            "SELECT 1",
            "--connection",
            CONN_NAME,
        ])
        .assert()
        .code(i32::from(EXIT_API_ERROR))
        .get_output()
        .stdout
        .clone();
    let body: Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(body["error"]["code"], "ambiguous");
    let message = body["error"]["message"].as_str().unwrap();
    for made in [a, b] {
        assert!(message.contains(made["id"].as_str().unwrap()), "{message}");
    }
}

#[tokio::test]
async fn dbt_models_cli_prints_json() {
    let env = TestEnv::new();
    let dbt = env.project.path().join("analytics");
    std::fs::create_dir_all(dbt.join("models")).unwrap();
    std::fs::write(
        dbt.join("dbt_project.yml"),
        "name: shop\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\n",
    )
    .unwrap();
    std::fs::write(dbt.join("models/orders.sql"), "SELECT 1 AS id").unwrap();

    let missing = env
        .cmd(&["dbt", "models"])
        .assert()
        .code(i32::from(EXIT_API_ERROR));
    let body: Value = serde_json::from_slice(&missing.get_output().stdout).unwrap();
    assert_eq!(body["error"]["code"], "dbt_project_not_found");

    let models = env.ok(&["dbt", "models", "--dir", "analytics"]);
    assert_eq!(models["models"][0]["name"], "orders");
    let lineage = env.ok(&["dbt", "lineage", "orders", "--dir", "analytics"]);
    assert_eq!(lineage["graph"]["nodes"][0]["id"], "model.shop.orders");
    let page = format!("{DBT_LINEAGE_PAGE_PREFIX}orders");
    env.assert_project_ui_url(&lineage["uiUrl"], &env.info().token, &page);
}

const RUN_RESULTS_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../arris-engines/src/dbt/test_fixtures/run_results.json"
);

/// Executable shell script standing in for `dbt`, kept alive by the returned dir.
fn fake_tool(body: &str) -> (TempDir, std::path::PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("dbt");
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    (dir, path)
}

/// The JSON summary `arris dbt cli` prints as its last stdout line.
fn last_json_line(stdout: &[u8]) -> Value {
    let text = String::from_utf8_lossy(stdout);
    serde_json::from_str(text.lines().last().unwrap()).unwrap()
}

#[tokio::test]
async fn dbt_cli_passes_exit_code_and_records_summary() {
    let env = TestEnv::new();
    let (_bin, tool) = fake_tool(&format!(
        "echo \"hello $1\"\necho warned >&2\nmkdir -p target\ncp {RUN_RESULTS_FIXTURE} target/run_results.json\nexit 1"
    ));
    let out = env
        .cmd(&["dbt", "cli", "--", "run", "--select", "orders"])
        .env(ENV_DBT_BIN, &tool)
        .assert()
        .code(1);
    let output = out.get_output();
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("hello run\n"));
    assert!(String::from_utf8_lossy(&output.stderr).contains("warned"));
    let summary = last_json_line(&output.stdout);
    assert_eq!(summary["exitCode"], 1);
    assert_eq!(summary["summary"]["error"], 2);
    assert_eq!(summary["summary"]["success"], 2);
    let id = summary["runId"].as_str().unwrap();
    let page = format!("{DBT_RUNS_PAGE_PREFIX}{id}");
    env.assert_project_ui_url(&summary["uiUrl"], &env.info().token, &page);

    let record = env.post(TOOL_RUN_GET_ROUTE, json!({ "id": id })).await;
    assert_eq!(record["args"], json!(["run", "--select", "orders"]));
    assert_eq!(record["dir"], ".");
    let tail = record["outputTail"].as_str().unwrap();
    assert!(
        tail.contains("hello run") && tail.contains("warned"),
        "{tail}"
    );
}

#[tokio::test]
async fn output_tail_is_bounded() {
    let env = TestEnv::new();
    let (_bin, tool) = fake_tool(
        "i=0; while [ $i -lt 2000 ]; do printf '%0100d\\n' $i; i=$((i+1)); done; echo THE-END",
    );
    let out = env
        .cmd(&["dbt", "cli", "--", "run"])
        .env(ENV_DBT_BIN, &tool)
        .assert()
        .success();
    let id = last_json_line(&out.get_output().stdout)["runId"]
        .as_str()
        .unwrap()
        .to_owned();
    let record = env.post(TOOL_RUN_GET_ROUTE, json!({ "id": id })).await;
    let tail = record["outputTail"].as_str().unwrap();
    assert!(tail.len() <= TOOL_RUN_OUTPUT_TAIL_BYTES, "{}", tail.len());
    assert!(tail.ends_with("THE-END\n"));
}

#[tokio::test]
async fn missing_tool_exits_127_without_record() {
    let env = TestEnv::new();
    let out = env
        .cmd(&["dbt", "cli", "--", "run"])
        .env(ENV_DBT_BIN, "/nonexistent/arris-test/dbt")
        .assert()
        .code(i32::from(EXIT_TOOL_NOT_FOUND));
    let body: Value = serde_json::from_slice(&out.get_output().stdout).unwrap();
    assert_eq!(body["error"]["code"], "tool_not_found");
    assert_eq!(env.post(TOOL_RUN_LIST_ROUTE, json!({})).await, json!([]));
}

#[tokio::test]
async fn stale_run_results_not_attached() {
    let env = TestEnv::new();
    let target = env.project.path().join("target");
    std::fs::create_dir_all(&target).unwrap();
    std::fs::copy(RUN_RESULTS_FIXTURE, target.join("run_results.json")).unwrap();
    let (_bin, tool) = fake_tool("echo ok");
    let out = env
        .cmd(&["dbt", "cli", "--", "--version"])
        .env(ENV_DBT_BIN, &tool)
        .assert()
        .success();
    let summary = last_json_line(&out.get_output().stdout);
    assert_eq!(summary["exitCode"], 0);
    assert!(summary["summary"].is_null());
}

#[tokio::test]
async fn sync_reuses_existing_connection() {
    let env = TestEnv::new();
    env.write_dbt_project();
    env.ok(&["connection", "list"]);
    let cfg = ConnectionConfig::new(SYNC_NAME, DatabaseKind::Duckdb);
    let saved = env.post(CONNECTION_SAVE_ROUTE, json!({ "config": cfg })).await;
    let body = env.ok(&["dbt", "sync"]);
    assert_eq!(
        body,
        json!({ "connectionId": saved["id"], "name": SYNC_NAME, "reused": true })
    );
}

#[tokio::test]
async fn sync_opens_form_with_scrubbed_prefill() {
    let env = TestEnv::new();
    env.write_dbt_project();
    let (child, id) = env.form_request(&["dbt", "sync", "--no-open"]);
    let got = env
        .post(CONNECTION_REQUEST_GET_ROUTE, json!({ "id": id }))
        .await;
    assert!(!got.to_string().contains("hunter2"), "{got}");
    assert_eq!(got["kind"], "duckdb");
    assert_eq!(got["prefill"]["name"], SYNC_NAME);
    assert_eq!(got["prefill"]["fields"]["filePath"], "./w.duckdb");
    env.post(CONNECTION_REQUEST_CANCEL_ROUTE, json!({ "id": id }))
        .await;
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(i32::from(EXIT_CANCELLED)));
}

#[test]
fn sync_unsupported_adapter_exits_1() {
    let env = TestEnv::new();
    std::fs::write(env.project.path().join("dbt_project.yml"), DBT_PROJECT_YML).unwrap();
    let profiles = DBT_PROFILES_YML.replace("duckdb", "spark");
    std::fs::write(env.project.path().join("profiles.yml"), profiles).unwrap();
    let out = env.cmd(&["dbt", "sync"]).assert().code(i32::from(EXIT_API_ERROR));
    let body: Value = serde_json::from_slice(&out.get_output().stdout).unwrap();
    assert_eq!(body["error"]["code"], "unsupported_adapter");
}
