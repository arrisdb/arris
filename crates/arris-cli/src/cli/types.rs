use std::path::PathBuf;

use arris_engines::ColumnSpec;
use clap::{ArgGroup, Parser, Subcommand};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use arris_engines::{ToolKind, ToolRunSummary};

use super::VERSION_STRING;
use crate::server::{AnalyticsLineageResponse, QUERY_DEFAULT_LIMIT};

#[derive(Debug, Parser)]
#[command(name = "arris", version = VERSION_STRING, about = "Arris local data workbench")]
pub struct Cli {
    /// Project root sent with every command; defaults to the current directory.
    #[arg(long, global = true)]
    pub project: Option<PathBuf>,
    /// Pretty-print JSON output.
    #[arg(long, global = true)]
    pub pretty: bool,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Run the local Arris server.
    Serve {
        /// Port to listen on; the OS picks one when omitted.
        #[arg(long)]
        port: Option<u16>,
        /// Open the UI in a browser once listening.
        #[arg(long)]
        open: bool,
        /// Auto-started mode: log a token-free line instead of the login URL.
        #[arg(long, hide = true)]
        background: bool,
    },
    /// Manage saved connections.
    #[command(subcommand)]
    Connection(ConnectionCommand),
    /// List schemas and tables of a connection.
    Schema {
        connection: String,
        #[arg(long)]
        schema: Option<String>,
    },
    /// Run SQL against a connection.
    #[command(group(ArgGroup::new("source").required(true).args(["sql", "file"])))]
    Query {
        connection: String,
        #[arg(long)]
        sql: Option<String>,
        /// Read SQL from this file.
        #[arg(long)]
        file: Option<PathBuf>,
        #[arg(long, default_value_t = QUERY_DEFAULT_LIMIT)]
        limit: u32,
        /// Show the query in an Arris console tab. Writes wait there for the user to press Run.
        #[arg(long)]
        open: bool,
    },
    /// List recent query runs, newest first.
    History {
        #[arg(long)]
        limit: Option<usize>,
    },
    /// Pin a run from history.
    Pin {
        run_id: String,
        #[arg(long)]
        title: Option<String>,
    },
    /// Remove a pin.
    Unpin { id: String },
    /// List pins.
    Pins,
    /// Manage canvases (boards of queries and charts).
    #[command(subcommand)]
    Canvas(CanvasCommand),
    /// dbt models and lineage in this project.
    #[command(subcommand)]
    Dbt(AnalyticsCommand),
    /// sqlmesh models and lineage in this project.
    #[command(subcommand)]
    Sqlmesh(AnalyticsCommand),
    /// Print the UI URL.
    Ui {
        #[arg(long)]
        open: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum ConnectionCommand {
    List,
    /// Open a browser form and wait until it is saved or cancelled.
    New {
        #[arg(long, conflicts_with = "url")]
        kind: Option<String>,
        /// Prefill the form from a connection URI; any password in it is dropped.
        #[arg(long)]
        url: Option<String>,
        /// Print the form URL without opening a browser.
        #[arg(long)]
        no_open: bool,
    },
    Test {
        connection: String,
    },
    Remove {
        connection: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum AnalyticsCommand {
    /// List models (summaries only, no SQL).
    Models {
        /// Tool project folder, relative to the project root.
        #[arg(long)]
        dir: Option<String>,
    },
    /// One model's SQL, columns and neighbors.
    Model {
        name: String,
        #[arg(long)]
        dir: Option<String>,
    },
    /// Lineage of the whole project, or of one model and its neighbors.
    Lineage {
        name: Option<String>,
        /// Trace which upstream columns feed this column of the model.
        #[arg(long, requires = "name")]
        column: Option<String>,
        #[arg(long)]
        dir: Option<String>,
    },
    /// Create a connection from the dbt profile target or sqlmesh gateway, or reuse it by name.
    Sync {
        #[arg(long)]
        dir: Option<String>,
        /// dbt target or sqlmesh gateway; defaults to the project's own default.
        #[arg(long, visible_alias = "gateway")]
        target: Option<String>,
        /// Print the form URL without opening a browser.
        #[arg(long)]
        no_open: bool,
    },
    /// Run a native command, e.g. `cli -- run --select orders`; the run is logged for the UI.
    Cli {
        #[arg(long)]
        dir: Option<String>,
        #[arg(last = true)]
        args: Vec<String>,
    },
}

/// Routes and pages of one analytics tool, so dbt and sqlmesh share the CLI code.
#[derive(Debug, Clone, Copy)]
pub struct AnalyticsTool {
    pub kind: ToolKind,
    pub executable: &'static str,
    /// Env var overriding the executable path.
    pub bin_env: &'static str,
    pub runs_page_prefix: &'static str,
    pub models_route: &'static str,
    pub model_route: &'static str,
    pub lineage_route: &'static str,
    pub lineage_page: &'static str,
    pub lineage_page_prefix: &'static str,
}

/// Last stdout line of `arris <tool> cli`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRunOutput {
    pub run_id: String,
    pub exit_code: Option<i32>,
    pub summary: Option<ToolRunSummary>,
    pub ui_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineageOutput {
    #[serde(flatten)]
    pub lineage: AnalyticsLineageResponse,
    pub ui_url: String,
}

#[derive(Debug, Subcommand)]
pub enum CanvasCommand {
    New {
        title: String,
    },
    List,
    /// Print a canvas's objects without layout.
    Show {
        /// Canvas id or exact title.
        canvas: String,
    },
    /// Add a query object (and optionally a chart bound to it).
    #[command(group(ArgGroup::new("from").required(true).args(["run", "sql"])))]
    Add {
        /// Canvas id or exact title.
        canvas: String,
        /// Copy SQL and connection from this run.
        #[arg(long)]
        run: Option<String>,
        #[arg(long, requires = "connection")]
        sql: Option<String>,
        #[arg(long, requires = "sql")]
        connection: Option<String>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        chart: bool,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNewOutput {
    pub id: String,
    pub title: String,
    pub ui_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasAddOutput {
    pub canvas_id: String,
    pub query_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_id: Option<String>,
    pub ui_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CanvasShowOutput {
    pub id: String,
    pub title: String,
    pub revision: u64,
    pub components: Vec<CanvasShowComponent>,
}

/// One object's identity and query fields; extra doc fields are dropped.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasShowComponent {
    pub id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sql: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
}

/// The part of a canvas doc `canvas show` reads.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct CanvasShowDoc {
    #[serde(default)]
    pub components: Vec<CanvasShowComponent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOutput {
    pub run_id: String,
    pub columns: Vec<ColumnSpec>,
    /// Plain JSON cells; the API keeps the tagged `QueryValue` form.
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: u64,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_url: Option<String>,
}

/// `query --open` output; no URL, so the login token stays out of the transcript.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOpenOutput {
    pub awaiting_run: bool,
    #[serde(flatten)]
    pub query: Option<QueryOutput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionNewOutput {
    pub connection_id: Uuid,
    pub name: String,
}

/// Result of `arris <tool> sync`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutput {
    pub connection_id: Uuid,
    pub name: String,
    pub reused: bool,
}

/// The fields `sync` reads from `connection_list` to find a same-named connection.
#[derive(Debug, Clone, Deserialize)]
pub struct ConnectionListEntry {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UrlOutput {
    pub url: String,
}

/// Client-side error in the same `{ error: { code, message } }` shape as the server's.
#[derive(Debug, Clone, Serialize)]
pub struct CliErrorBody {
    pub error: CliErrorDetail,
}

#[derive(Debug, Clone, Serialize)]
pub struct CliErrorDetail {
    pub code: &'static str,
    pub message: String,
}
