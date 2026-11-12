use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::{Duration, Instant};

use arris_engines::persistence::{DataPaths, Keychain, SecretStore};
use arris_engines::{
    AppEnvironment, AppEnvironmentError, CanvasRecord, ConnectionPrefill, DatabaseKind,
    GatewayConnectionMapper, ProfileConnectionMapper, QueryResult, QueryValue, ToolKind,
};
use clap::Parser;
use serde_json::Value;

use super::{
    AnalyticsCommand, AnalyticsTool, CONNECTION_NEW_RETRY_MS, CONNECTION_NEW_TIMEOUT_SECS,
    CURRENT_DIR_LABEL, CanvasAddOutput, CanvasCommand, CanvasNewOutput, CanvasShowDoc,
    CanvasShowOutput, Cli, CliError, Command, ConnectionCommand, ConnectionListEntry,
    ConnectionNewOutput, DBT_TOOL, ENV_DATA_DIR, EXIT_API_ERROR, KIND_LIST_SEPARATOR,
    LineageOutput, QueryOpenOutput, QueryOutput, SERVER_LISTENING_PREFIX, SQLMESH_TOOL,
    ServerClient, SyncOutput, ToolRunOutput, ToolRunner, UrlOutput,
};
use crate::server::{
    AnalyticsDirRequest, AnalyticsLineageRequest, AnalyticsLineageResponse, AnalyticsModelRequest,
    AnalyticsRoutes, CANVAS_ADD_ROUTE, CANVAS_CREATE_ROUTE, CANVAS_GET_ROUTE, CANVAS_LIST_ROUTE,
    CONNECTION_LIST_ROUTE, CONNECTION_REMOVE_ROUTE, CONNECTION_REQUEST_CANCEL_ROUTE,
    CONNECTION_REQUEST_CREATE_ROUTE, CONNECTION_REQUEST_WAIT_ROUTE, CONNECTION_TEST_ROUTE,
    CanvasAddRequest, CanvasAddResponse, CanvasAddSource, CanvasCreateRequest, CanvasRefRequest,
    ChartSpecDoc, ConnectionRefRequest, ConnectionRequestCreateRequest,
    ConnectionRequestCreateResponse, ConnectionRequestIdRequest, ConnectionRequestStatus,
    ConnectionTestRequest, EmptyResponse, HISTORY_LIST_ROUTE, HistoryListRequest, PIN_ADD_ROUTE,
    PIN_LIST_ROUTE, PIN_REMOVE_ROUTE, PinAddRequest, PinRemoveRequest, QUERY_OPEN_ROUTE,
    QUERY_RUN_ROUTE, QueryOpenRequest, QueryOpenResponse, QueryRunRequest, QueryRunResponse,
    SCHEMA_LIST_ROUTE, SchemaListRequest, Server, TOOL_RUN_RECORD_ROUTE, ToolRunIdPayload,
    ToolRunRecordRequest,
};

impl Cli {
    /// Prints the command's JSON (or a JSON error) to stdout and maps errors to exit codes.
    pub async fn run() -> ExitCode {
        let cli = Self::parse();
        match cli.execute().await {
            Ok(Some(out)) => {
                cli.print(&out);
                ExitCode::SUCCESS
            }
            Ok(None) => ExitCode::SUCCESS,
            Err(e) => {
                cli.print(&e.body());
                ExitCode::from(e.exit_code())
            }
        }
    }

    async fn execute(&self) -> Result<Option<Value>, CliError> {
        let data_dir = Self::data_dir()?;
        let empty = EmptyResponse {};
        let out = match &self.command {
            Command::Serve {
                port,
                open,
                background,
            } => {
                Self::serve(data_dir, &self.project_root()?, *port, *open, *background).await?;
                return Ok(None);
            }
            Command::Connection(ConnectionCommand::New { kind, url, no_open }) => {
                let kind = kind.as_deref().map(Self::parse_kind).transpose()?;
                let prefill = url
                    .as_deref()
                    .map(ConnectionPrefill::from_url)
                    .transpose()?;
                let (client, project) = self.connect(&data_dir).await?;
                let out =
                    Self::connection_new(&data_dir, client, &project, kind, prefill, *no_open)
                        .await?;
                serde_json::to_value(out)?
            }
            Command::Connection(ConnectionCommand::List) => {
                let (client, project) = self.connect(&data_dir).await?;
                client.call(CONNECTION_LIST_ROUTE, &project, &empty).await?
            }
            Command::Connection(ConnectionCommand::Test { connection }) => {
                let (client, project) = self.connect(&data_dir).await?;
                let body = ConnectionTestRequest {
                    config: None,
                    connection: Some(connection.clone()),
                };
                client.call(CONNECTION_TEST_ROUTE, &project, &body).await?
            }
            Command::Connection(ConnectionCommand::Remove { connection }) => {
                let (client, project) = self.connect(&data_dir).await?;
                let body = ConnectionRefRequest {
                    connection: connection.clone(),
                };
                client
                    .call(CONNECTION_REMOVE_ROUTE, &project, &body)
                    .await?
            }
            Command::Schema { connection, schema } => {
                let (client, project) = self.connect(&data_dir).await?;
                let body = SchemaListRequest {
                    connection: connection.clone(),
                    schema: schema.clone(),
                };
                client.call(SCHEMA_LIST_ROUTE, &project, &body).await?
            }
            Command::Query {
                connection,
                sql,
                file,
                limit,
                open,
                new_tab,
            } => {
                // clap's `source` group guarantees exactly one of `--sql` / `--file`.
                let sql = match file {
                    Some(path) => std::fs::read_to_string(path)?,
                    None => sql.clone().unwrap_or_default(),
                };
                let (client, project) = self.connect(&data_dir).await?;
                if *open {
                    let body = QueryOpenRequest {
                        connection: connection.clone(),
                        sql,
                        limit: Some(*limit),
                        new_tab: *new_tab,
                    };
                    let resp: QueryOpenResponse =
                        client.call(QUERY_OPEN_ROUTE, &project, &body).await?;
                    if resp.launch_browser {
                        Self::open_browser(&client.ui_url(&Server::project_page(&project)))?;
                    }
                    let out = QueryOpenOutput {
                        awaiting_run: resp.run.is_none(),
                        query: resp.run.map(|run| {
                            let mut out = Self::query_output(run, *limit, String::new());
                            out.ui_url = None;
                            out
                        }),
                    };
                    return Ok(Some(serde_json::to_value(out)?));
                }
                let body = QueryRunRequest {
                    connection: connection.clone(),
                    sql,
                    limit: Some(*limit),
                    source: None,
                    language: None,
                    query_id: None,
                };
                let resp: QueryRunResponse = client.call(QUERY_RUN_ROUTE, &project, &body).await?;
                let ui_url = client.ui_url(&Server::run_page(&project, &resp.run.id));
                let out = Self::query_output(resp, *limit, ui_url);
                serde_json::to_value(out)?
            }
            Command::History { limit } => {
                let (client, project) = self.connect(&data_dir).await?;
                let body = HistoryListRequest { limit: *limit };
                client.call(HISTORY_LIST_ROUTE, &project, &body).await?
            }
            Command::Pin { run_id, title } => {
                let (client, project) = self.connect(&data_dir).await?;
                let body = PinAddRequest::FromRun {
                    run_id: run_id.clone(),
                    title: title.clone(),
                };
                client.call(PIN_ADD_ROUTE, &project, &body).await?
            }
            Command::Unpin { id } => {
                let (client, project) = self.connect(&data_dir).await?;
                let body = PinRemoveRequest { id: id.clone() };
                client.call(PIN_REMOVE_ROUTE, &project, &body).await?
            }
            Command::Pins => {
                let (client, project) = self.connect(&data_dir).await?;
                client.call(PIN_LIST_ROUTE, &project, &empty).await?
            }
            Command::Canvas(cmd) => {
                let (client, project) = self.connect(&data_dir).await?;
                Self::canvas(&client, &project, cmd).await?
            }
            Command::Dbt(cmd) => {
                let (client, project) = self.connect(&data_dir).await?;
                Self::analytics(&data_dir, client, &project, &DBT_TOOL, cmd).await?
            }
            Command::Sqlmesh(cmd) => {
                let (client, project) = self.connect(&data_dir).await?;
                Self::analytics(&data_dir, client, &project, &SQLMESH_TOOL, cmd).await?
            }
            Command::Ui { open } => {
                let (client, project) = self.connect(&data_dir).await?;
                let url = client.ui_url(&Server::project_page(&project));
                if *open {
                    Self::open_browser(&url)?;
                }
                serde_json::to_value(UrlOutput { url })?
            }
        };
        Ok(Some(out))
    }

    async fn connect(&self, data_dir: &Path) -> Result<(ServerClient, PathBuf), CliError> {
        let project = self.project_root()?;
        Ok((ServerClient::connect_or_start(data_dir).await?, project))
    }

    fn project_root(&self) -> Result<PathBuf, CliError> {
        let project = match &self.project {
            Some(path) => path.clone(),
            None => std::env::current_dir()?,
        };
        Ok(project.canonicalize()?)
    }

    fn print(&self, value: &Value) {
        let text = if self.pretty {
            serde_json::to_string_pretty(value)
        } else {
            serde_json::to_string(value)
        };
        println!("{}", text.unwrap_or_default());
    }

    fn query_output(resp: QueryRunResponse, limit: u32, ui_url: String) -> QueryOutput {
        let limit = limit as usize;
        let QueryResult {
            columns,
            mut rows,
            has_more,
            ..
        } = resp.result;
        let truncated = rows.len() > limit || has_more == Some(true);
        rows.truncate(limit);
        QueryOutput {
            run_id: resp.run.id,
            row_count: resp.run.row_count.unwrap_or(rows.len() as u64),
            columns,
            rows: rows
                .into_iter()
                .map(|row| row.into_iter().map(Self::plain_value).collect())
                .collect(),
            truncated,
            ui_url: Some(ui_url),
        }
    }
}

// Canvas commands.
impl Cli {
    async fn analytics(
        data_dir: &Path,
        client: ServerClient,
        project: &Path,
        tool: &AnalyticsTool,
        cmd: &AnalyticsCommand,
    ) -> Result<Value, CliError> {
        Ok(match cmd {
            AnalyticsCommand::Models { dir } => {
                let body = AnalyticsDirRequest { dir: dir.clone() };
                client.call(tool.models_route, project, &body).await?
            }
            AnalyticsCommand::Model { name, dir } => {
                let body = AnalyticsModelRequest {
                    dir: dir.clone(),
                    name: name.clone(),
                };
                client.call(tool.model_route, project, &body).await?
            }
            AnalyticsCommand::Lineage { name, column, dir } => {
                let body = AnalyticsLineageRequest {
                    dir: dir.clone(),
                    name: name.clone(),
                    column: column.clone(),
                };
                let lineage: AnalyticsLineageResponse =
                    client.call(tool.lineage_route, project, &body).await?;
                let page = Server::lineage_page(
                    tool.lineage_page,
                    tool.lineage_page_prefix,
                    project,
                    dir.as_deref(),
                    name.as_deref(),
                );
                serde_json::to_value(LineageOutput {
                    lineage,
                    ui_url: client.ui_url(&page),
                })?
            }
            AnalyticsCommand::Sync {
                dir,
                target,
                no_open,
            } => {
                let resolved = AnalyticsRoutes::resolve_dir(project, dir.as_deref())?;
                let out = Self::sync(data_dir, client, project, tool, &resolved, target, *no_open);
                serde_json::to_value(out.await?)?
            }
            AnalyticsCommand::Cli { dir, args } => {
                let resolved = AnalyticsRoutes::resolve_dir(project, dir.as_deref())?;
                let label = dir.clone().unwrap_or_else(|| CURRENT_DIR_LABEL.to_owned());
                let record = ToolRunner::new(*tool, resolved, label, args.clone())
                    .run()
                    .await?;
                let (exit_code, summary) = (record.exit_code, record.summary.clone());
                let made: ToolRunIdPayload = client
                    .call(
                        TOOL_RUN_RECORD_ROUTE,
                        project,
                        &ToolRunRecordRequest { record },
                    )
                    .await?;
                let page =
                    Server::tool_run_page(tool.runs_page_prefix, project, dir.as_deref(), &made.id);
                let output = serde_json::to_value(ToolRunOutput {
                    run_id: made.id,
                    exit_code,
                    summary,
                    ui_url: client.ui_url(&page),
                })?;
                if exit_code != Some(0) {
                    let code = exit_code.and_then(|c| u8::try_from(c).ok());
                    return Err(CliError::ToolExit {
                        output,
                        code: code.unwrap_or(EXIT_API_ERROR),
                    });
                }
                output
            }
        })
    }

    async fn canvas(
        client: &ServerClient,
        project: &Path,
        cmd: &CanvasCommand,
    ) -> Result<Value, CliError> {
        Ok(match cmd {
            CanvasCommand::New { title } => {
                let body = CanvasCreateRequest {
                    title: title.clone(),
                };
                let made: CanvasRecord = client.call(CANVAS_CREATE_ROUTE, project, &body).await?;
                serde_json::to_value(CanvasNewOutput {
                    ui_url: client.ui_url(&Server::canvas_page(project, &made.id)),
                    id: made.id,
                    title: made.title,
                })?
            }
            CanvasCommand::List => {
                client
                    .call(CANVAS_LIST_ROUTE, project, &EmptyResponse {})
                    .await?
            }
            CanvasCommand::Show { canvas } => {
                let body = CanvasRefRequest {
                    canvas: canvas.clone(),
                };
                let record: CanvasRecord = client.call(CANVAS_GET_ROUTE, project, &body).await?;
                let doc: CanvasShowDoc = serde_json::from_value(record.doc).unwrap_or_default();
                serde_json::to_value(CanvasShowOutput {
                    id: record.id,
                    title: record.title,
                    revision: record.revision,
                    components: doc.components,
                })?
            }
            CanvasCommand::Add {
                canvas,
                run,
                sql,
                connection,
                title,
                chart,
                x,
                y,
            } => {
                // clap's `from` group guarantees `--run` or `--sql` with `--connection`.
                let source = match (run, sql, connection) {
                    (Some(run_id), _, _) => CanvasAddSource::FromRun {
                        run_id: run_id.clone(),
                    },
                    (None, sql, connection) => CanvasAddSource::Manual {
                        sql: sql.clone().unwrap_or_default(),
                        connection: connection.clone().unwrap_or_default(),
                    },
                };
                let body = CanvasAddRequest {
                    canvas: canvas.clone(),
                    source,
                    title: title.clone(),
                    // clap requires --x and --y with --chart.
                    chart: chart.map(|kind| ChartSpecDoc {
                        kind,
                        x_column: x.clone().unwrap_or_default(),
                        y_columns: y.clone(),
                    }),
                };
                let added: CanvasAddResponse =
                    client.call(CANVAS_ADD_ROUTE, project, &body).await?;
                let ui_url = client.ui_url(&Server::canvas_page(project, &added.canvas.id));
                if added.launch_browser {
                    Self::open_browser(&ui_url)?;
                }
                serde_json::to_value(CanvasAddOutput {
                    ui_url,
                    canvas_id: added.canvas.id,
                    query_id: added.query_id,
                    chart_id: added.chart_id,
                })?
            }
        })
    }
}

// Browser connection flow.
impl Cli {
    /// Reuses `DatabaseKind`'s serde names so the CLI accepts exactly what the API does.
    fn parse_kind(kind: &str) -> Result<DatabaseKind, CliError> {
        serde_json::from_value(Value::String(kind.to_owned())).map_err(|_| {
            let valid: Vec<String> = DatabaseKind::ALL
                .iter()
                .filter_map(|k| serde_json::to_value(k).ok())
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect();
            CliError::InvalidKind(kind.to_owned(), valid.join(KIND_LIST_SEPARATOR))
        })
    }

    /// Reuses a connection with the prefill's name, else opens the prefilled form.
    async fn sync(
        data_dir: &Path,
        client: ServerClient,
        project: &Path,
        tool: &AnalyticsTool,
        dir: &Path,
        target: &Option<String>,
        no_open: bool,
    ) -> Result<SyncOutput, CliError> {
        let prefill = match tool.kind {
            ToolKind::Dbt => ProfileConnectionMapper::from_project(dir, target.as_deref())?,
            ToolKind::Sqlmesh => GatewayConnectionMapper::from_project(dir, target.as_deref())?,
        };
        let existing: Vec<ConnectionListEntry> = client
            .call(CONNECTION_LIST_ROUTE, project, &EmptyResponse {})
            .await?;
        if let Some(found) = existing.into_iter().find(|c| c.name == prefill.name) {
            return Ok(SyncOutput {
                connection_id: found.id,
                name: found.name,
                reused: true,
            });
        }
        let kind = Some(prefill.kind);
        let made =
            Self::connection_new(data_dir, client, project, kind, Some(prefill), no_open).await?;
        Ok(SyncOutput {
            connection_id: made.connection_id,
            name: made.name,
            reused: false,
        })
    }

    /// Prints the form URL to stderr, then long-polls until the form resolves.
    async fn connection_new(
        data_dir: &Path,
        mut client: ServerClient,
        project: &Path,
        kind: Option<DatabaseKind>,
        prefill: Option<ConnectionPrefill>,
        no_open: bool,
    ) -> Result<ConnectionNewOutput, CliError> {
        let body = ConnectionRequestCreateRequest { kind, prefill };
        let created: ConnectionRequestCreateResponse = client
            .call(CONNECTION_REQUEST_CREATE_ROUTE, project, &body)
            .await?;
        let url = client.ui_url(&created.url);
        eprintln!(
            "{}",
            serde_json::to_string(&UrlOutput { url: url.clone() })?
        );
        if !no_open && let Err(e) = Self::open_browser(&url) {
            eprintln!("{e}");
        }
        let id = ConnectionRequestIdRequest { id: created.id };
        let deadline = Instant::now() + Duration::from_secs(CONNECTION_NEW_TIMEOUT_SECS);
        while Instant::now() < deadline {
            let status = match client
                .call(CONNECTION_REQUEST_WAIT_ROUTE, project, &id)
                .await
            {
                // A restarted server has a new port; reconnect so its 404 reports the lost request.
                Err(CliError::Http(_)) => {
                    tokio::time::sleep(Duration::from_millis(CONNECTION_NEW_RETRY_MS)).await;
                    client = ServerClient::connect_or_start(data_dir).await?;
                    continue;
                }
                other => other?,
            };
            match status {
                ConnectionRequestStatus::Saved {
                    connection_id,
                    name,
                } => {
                    return Ok(ConnectionNewOutput {
                        connection_id,
                        name,
                    });
                }
                ConnectionRequestStatus::Cancelled => return Err(CliError::Cancelled),
                ConnectionRequestStatus::Pending => {}
            }
        }
        // Best effort so an open form learns the CLI gave up.
        let _ = client
            .call::<EmptyResponse>(CONNECTION_REQUEST_CANCEL_ROUTE, project, &id)
            .await;
        Err(CliError::TimedOut)
    }
}

// Plain JSON for agent-facing output.
impl Cli {
    /// Non-finite doubles, decimals and bytes become strings; unparsable JSON stays text.
    fn plain_value(value: QueryValue) -> Value {
        match value {
            QueryValue::Null => Value::Null,
            QueryValue::Bool(b) => Value::Bool(b),
            QueryValue::Int(i) => Value::from(i),
            QueryValue::Double(f) => serde_json::Number::from_f64(f)
                .map(Value::Number)
                .unwrap_or_else(|| Value::String(f.to_string())),
            QueryValue::Text(s) | QueryValue::Decimal(s) => Value::String(s),
            QueryValue::Json(s) => serde_json::from_str(&s).unwrap_or(Value::String(s)),
            data @ QueryValue::Data(_) => Value::String(data.display_string()),
        }
    }
}

// Server process setup.
impl Cli {
    /// `ENV_DATA_DIR` when set, else the platform data dir.
    fn data_dir() -> Result<PathBuf, CliError> {
        match std::env::var_os(ENV_DATA_DIR) {
            Some(dir) => Ok(PathBuf::from(dir)),
            None => Ok(DataPaths::data_dir().map_err(AppEnvironmentError::from)?),
        }
    }

    async fn serve(
        data_dir: PathBuf,
        project: &Path,
        port: Option<u16>,
        open: bool,
        background: bool,
    ) -> Result<(), CliError> {
        std::fs::create_dir_all(&data_dir)?;
        let server = Server::bind(
            AppEnvironment::init_at(data_dir, Self::secrets()).await?,
            port,
        )?;
        let url = server.login_url(project);
        if background {
            println!("{SERVER_LISTENING_PREFIX}{}", server.state().port);
        } else {
            println!("{url}");
        }
        if open && let Err(e) = Self::open_browser(&url) {
            eprintln!("{e}");
        }
        Ok(server.serve().await?)
    }

    fn open_browser(url: &str) -> std::io::Result<()> {
        #[cfg(feature = "test-support")]
        if std::env::var_os(super::ENV_TEST_NO_BROWSER).is_some() {
            return Ok(());
        }
        webbrowser::open(url)
    }

    fn secrets() -> Arc<dyn SecretStore> {
        #[cfg(feature = "test-support")]
        if std::env::var(super::ENV_TEST_SECRETS).as_deref() == Ok(super::TEST_SECRETS_MEMORY) {
            return Arc::new(arris_engines::persistence::MemorySecretStore::new());
        }
        Arc::new(Keychain::default())
    }
}

#[cfg(test)]
mod tests {
    use arris_engines::{ColumnSpec, QueryValue, RunRecord};
    use serde_json::json;

    use super::*;

    #[test]
    fn version_string_marks_build_kind() {
        use clap::CommandFactory;
        let version = Cli::command().get_version().unwrap().to_owned();
        assert_eq!(version, format!("{} (dev)", env!("CARGO_PKG_VERSION")));
    }

    fn response(rows: usize, has_more: Option<bool>) -> QueryRunResponse {
        let run: RunRecord = serde_json::from_value(json!({
            "id": "r1",
            "connectionId": uuid::Uuid::nil(),
            "sql": "SELECT 1",
            "source": "cli",
            "startedAt": chrono::Utc::now(),
            "status": "success",
            "rowCount": rows,
        }))
        .unwrap();
        let mut result = QueryResult::new(
            vec![ColumnSpec::new("x", "integer")],
            (0..rows).map(|i| vec![QueryValue::Int(i as i64)]).collect(),
        );
        result.has_more = has_more;
        QueryRunResponse { run, result }
    }

    #[test]
    fn query_output_caps_rows_and_flags_truncation() {
        let out = Cli::query_output(response(3, None), 2, "u".into());
        assert_eq!(out.rows.len(), 2);
        assert!(out.truncated);
        assert_eq!(out.run_id, "r1");
        assert_eq!(out.row_count, 3);
        let mut no_count = response(3, None);
        no_count.run.row_count = None;
        assert_eq!(Cli::query_output(no_count, 2, "u".into()).row_count, 2);

        let more = Cli::query_output(response(2, Some(true)), 2, "u".into());
        assert!(more.truncated);
        let fits = Cli::query_output(response(2, Some(false)), 2, "u".into());
        assert!(!fits.truncated);
    }

    #[test]
    fn query_output_ui_url_points_to_run_page() {
        let url = Server::run_page(Path::new("/tmp/proj"), "r1");
        assert_eq!(url, "/runs/r1?project=%2Ftmp%2Fproj");
    }

    #[test]
    fn query_output_rows_are_plain_json() {
        let mut resp = response(0, None);
        resp.result.rows = vec![vec![
            QueryValue::Int(1),
            QueryValue::Text("a".into()),
            QueryValue::Null,
            QueryValue::Bool(true),
            QueryValue::Double(1.5),
            QueryValue::Decimal("12.30".into()),
            QueryValue::Data(vec![0xab]),
            QueryValue::Json(r#"{"k":[1]}"#.into()),
        ]];
        let out = serde_json::to_value(Cli::query_output(resp, 10, "u".into())).unwrap();
        assert_eq!(
            out["rows"],
            json!([[1, "a", null, true, 1.5, "12.30", "0xab", { "k": [1] }]])
        );
    }

    #[test]
    fn parse_kind_uses_serde_names_and_lists_valid_kinds() {
        assert_eq!(Cli::parse_kind("sqlite").unwrap(), DatabaseKind::Sqlite);
        let err = Cli::parse_kind("nope").unwrap_err();
        assert_eq!(err.exit_code(), crate::cli::EXIT_API_ERROR);
        let message = err.body()["error"]["message"].as_str().unwrap().to_owned();
        assert!(
            message.contains("postgres") && message.contains("starrocks"),
            "{message}"
        );
    }

    #[test]
    fn query_needs_exactly_one_sql_source() {
        let parse = |args: &[&str]| Cli::try_parse_from(args).map(|_| ());
        assert!(parse(&["arris", "query", "c"]).is_err());
        assert!(parse(&["arris", "query", "c", "--sql", "x", "--file", "f"]).is_err());
        assert!(parse(&["arris", "query", "c", "--file", "f"]).is_ok());
        assert!(parse(&["arris", "--pretty", "query", "c", "--sql", "x"]).is_ok());
    }
}
