//! The agent engine: a stateless orchestrator for agentic SQL sessions.
//!
//! Each turn builds a self-contained prompt (role + schema + the user's request),
//! spawns the selected provider's CLI (`codex` or `claude`) in a read-only mode,
//! and streams its parsed events as [`AgentEvent`]s. The [`AgentProfile`] selects
//! the prompt: write/explain SQL, or design canvas objects. Either way the agent
//! needs no live database access, so there is no MCP server: the schema is
//! inlined into the prompt and the CLI runs with file writes and tools disabled.

use std::fmt::Write as _;
use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};

use super::constants::SCHEMA_PROMPT_MAX_BYTES;
use super::errors::AgentError;
use super::types::{AgentEvent, AgentProfile, AgentProvider};
use crate::{DatabaseKind, Engine, SchemaNode, SchemaNodeKind};

/// Orchestrates agentic SQL sessions for writing and explaining queries.
/// Stateless: each turn spawns the selected provider's CLI (`codex` or `claude`)
/// with a self-contained prompt (no live database access, no MCP server).
pub struct AgentEngine;

impl AgentEngine {
    pub fn new() -> Self {
        Self
    }

    // ── agent process ────────────────────────────────────────────────────────

    /// Start one agent turn with `provider`'s CLI. Spawns it with a
    /// self-contained prompt (the `dialect` schema DDL plus the user's request)
    /// and streams parsed events. `resume_session` continues an existing
    /// conversation (the session id must come from the same provider).
    ///
    /// The CLI runs read-only so it cannot touch the filesystem, and project
    /// docs are disabled so the user's repo/global instructions can't derail a
    /// query-writing turn.
    pub async fn send(
        &self,
        provider: AgentProvider,
        profile: AgentProfile,
        dialect: Option<DatabaseKind>,
        schema_ddl: String,
        user_prompt: String,
        board_context: Option<String>,
        resume_session: Option<String>,
        cancel: oneshot::Receiver<()>,
    ) -> Result<mpsc::Receiver<AgentEvent>, AgentError> {
        let (tx, rx) = mpsc::channel(64);
        let prompt = Self::build_prompt(
            profile,
            dialect,
            &schema_ddl,
            &user_prompt,
            board_context.as_deref().unwrap_or(""),
        );
        let cwd = Self::working_dir()?;
        let cli = provider.cli();
        let binary = cli.binary();

        let mut cmd = Command::new(binary);
        cmd.current_dir(&cwd);
        cli.configure(&mut cmd, &prompt, resume_session.as_deref());
        // The CLI may drain stdin for extra input; an inherited GUI stdin never
        // reaches EOF and blocks forever, so close it explicitly.
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => AgentError::CliNotFound(provider),
            _ => AgentError::Io(e),
        })?;
        let stdout = child.stdout.take().expect("stdout piped");
        let stderr = child.stderr.take().expect("stderr piped");

        // Drain stderr concurrently — an unread pipe fills its OS buffer and
        // deadlocks the CLI mid-write. Echo it to the dev console and keep the
        // tail to surface the real reason if the CLI exits non-zero.
        let stderr_task = tokio::spawn(async move {
            let mut buf = String::new();
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[agent:{binary}] {line}");
                buf.push_str(&line);
                buf.push('\n');
            }
            buf
        });

        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            let mut cancel = cancel;
            // True when the user pressed Stop: kill the CLI and report a clean
            // finish instead of the non-zero "killed" exit as an error.
            let mut cancelled = false;
            loop {
                tokio::select! {
                    _ = &mut cancel => {
                        let _ = child.kill().await;
                        cancelled = true;
                        break;
                    }
                    line = lines.next_line() => {
                        match line {
                            Ok(Some(line)) => {
                                if let Some(event) = cli.parse_line(&line) {
                                    if tx.send(event).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            _ => break,
                        }
                    }
                }
            }
            let status = child.wait().await;
            let stderr_out = stderr_task.await.unwrap_or_default();
            if !cancelled {
                if let Ok(status) = status {
                    if !status.success() {
                        let code = status.code().unwrap_or(-1);
                        let detail = stderr_out.trim();
                        // Scan the whole stderr for an auth signature — the 401
                        // can be a few lines above the tail (cf-ray etc.).
                        let friendly = cli.friendly_error(detail);
                        let message = if !friendly.is_empty() && friendly != detail {
                            friendly
                        } else if detail.is_empty() {
                            format!("{binary} exited with status {code}")
                        } else {
                            format!(
                                "{binary} exited with status {code}: {}",
                                detail.lines().last().unwrap_or(detail)
                            )
                        };
                        let _ = tx.send(AgentEvent::Error { message }).await;
                    }
                }
            }
            let _ = tx.send(AgentEvent::Done).await;
        });

        Ok(rx)
    }

    /// A throwaway, empty working directory for the CLI. Kept empty so the CLI
    /// has nothing local to scan; everything it needs is in the prompt.
    fn working_dir() -> Result<PathBuf, AgentError> {
        let dir = std::env::temp_dir().join("arris-agent");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }
}

// ── prompt construction ──────────────────────────────────────────────────────

impl AgentEngine {
    /// Build the full prompt for `profile`: role, schema snapshot, rules, and the
    /// user's request. Self-contained so the turn needs no tools or file access.
    pub(super) fn build_prompt(
        profile: AgentProfile,
        dialect: Option<DatabaseKind>,
        schema_ddl: &str,
        user_prompt: &str,
        board_context: &str,
    ) -> String {
        let name = dialect.map(Self::dialect_name).unwrap_or("SQL");
        let schema = Self::clamp_schema(schema_ddl);
        match profile {
            AgentProfile::Sql => Self::build_sql_prompt(name, &schema, user_prompt),
            AgentProfile::Canvas => {
                Self::build_canvas_prompt(name, &schema, board_context, user_prompt)
            }
        }
    }

    /// Trim the inlined schema DDL to [`SCHEMA_PROMPT_MAX_BYTES`] so a large
    /// database cannot blow the model's context window.
    fn clamp_schema(schema_ddl: &str) -> String {
        if schema_ddl.len() > SCHEMA_PROMPT_MAX_BYTES {
            let mut truncated: String = schema_ddl.chars().take(SCHEMA_PROMPT_MAX_BYTES).collect();
            truncated.push_str("\n-- (schema truncated)\n");
            truncated
        } else {
            schema_ddl.to_string()
        }
    }

    /// The query-assistant prompt: write or explain one SQL block.
    fn build_sql_prompt(name: &str, schema: &str, user_prompt: &str) -> String {
        format!(
            "You are a SQL assistant embedded in a database client. You ONLY write \
             or explain SQL queries for the user's {name} database — nothing else. \
             Do not run shell commands, read files, or do unrelated work.\n\n\
             # Database schema ({name})\n\
             {schema}\n\n\
             # Rules\n\
             - Use dialect-appropriate {name} syntax and the tables/columns above.\n\
             - When you write a query, return exactly one ```sql fenced block, then \
             one short sentence describing it. The user reviews and applies it.\n\
             - When asked to explain a query, describe what it does in plain prose; \
             include SQL only if you are proposing a revision.\n\
             - You cannot execute anything — never claim you ran a query.\n\n\
             # Request\n\
             {user_prompt}\n",
        )
    }

    /// The canvas prompt: design analytics objects and emit them as one
    /// `arris-canvas` JSON block. The client parses the block, creates the
    /// objects, runs each query object, and binds charts to their source query's
    /// results. The contract mirrors the frontend `CanvasComponent` union.
    fn build_canvas_prompt(
        name: &str,
        schema: &str,
        board_context: &str,
        user_prompt: &str,
    ) -> String {
        let board = if board_context.trim().is_empty() {
            "The board is empty.".to_string()
        } else {
            board_context.trim().to_string()
        };
        format!(
            "You design analytics objects on a visual canvas inside a database \
             client, for the user's {name} database. You do not chat at length and \
             you cannot run shell commands, read files, or execute queries.\n\n\
             # Database schema ({name})\n\
             {schema}\n\n\
             # Current board\n\
             These objects already exist on the canvas. Reference them by id to \
             reuse, modify, or remove them.\n\
             {board}\n\n\
             # Output contract\n\
             Reply with ONE fenced code block tagged `arris-canvas` containing a \
             single JSON object, optionally preceded by one short sentence of \
             prose. The JSON has this shape:\n\
             ```arris-canvas\n\
             {{\n\
             \x20 \"components\": [\n\
             \x20   {{ \"kind\": \"query\", \"id\": \"q1\", \"title\": \"<label>\", \"sql\": \"<one {name} statement>\" }},\n\
             \x20   {{ \"kind\": \"chart\", \"id\": \"c1\", \"sourceQueryId\": \"q1\",\n\
             \x20     \"spec\": {{ \"kind\": \"bar\", \"xColumn\": \"<col>\", \"yColumns\": [\"<col>\"], \"seriesColumn\": \"<col?>\", \"aggregation\": \"sum\", \"title\": \"<title>\", \"style\": {{ \"stackMode\": \"stacked\" }} }} }},\n\
             \x20   {{ \"kind\": \"text\", \"id\": \"t1\", \"text\": \"## Heading\\nMarkdown commentary.\" }},\n\
             \x20   {{ \"kind\": \"sticky\", \"id\": \"s1\", \"text\": \"<short note>\", \"color\": \"yellow\" }},\n\
             \x20   {{ \"kind\": \"shape\", \"id\": \"sh1\", \"shape\": \"rect\", \"text\": \"<optional label>\" }}\n\
             \x20 ],\n\
             \x20 \"edges\": [ {{ \"id\": \"e1\", \"source\": \"q1\", \"target\": \"c1\" }} ],\n\
             \x20 \"remove\": []\n\
             }}\n\
             ```\n\n\
             # Rules\n\
             - Use dialect-appropriate {name} syntax and only the tables/columns above.\n\
             - To ADD an object, use a new `id`. To MODIFY an object already on the \
             board, return a component whose `id` matches the existing one and \
             include only the fields you are changing (the client merges them). To \
             REMOVE objects, list their ids in `remove`.\n\
             - You may reference any id on the current board: e.g. point a new \
             `chart`'s `sourceQueryId` at an existing `query`, or re-`spec` an \
             existing chart by its id.\n\
             - Every `chart` MUST set `sourceQueryId` to the `id` of a `query` (new \
             in this block or already on the board); `xColumn`/`yColumns`/\
             `seriesColumn` MUST be columns that query returns. `spec.kind` is one of \
             bar, line, area, pie, scatter, combo, donut, radar, treemap, funnel, \
             kpi. Omit `seriesColumn` and `style` when not needed; `aggregation` is \
             one of none, sum, avg, min, max, count.\n\
             - `sticky.color` is one of yellow, green, blue, pink, purple. \
             `shape.shape` is one of rect, ellipse, line; rect/ellipse may carry \
             optional `text`.\n\
             - Each `query.sql` is exactly one statement, no trailing semicolon, no \
             comments. Prefer a single query that returns tidy rows for charting \
             (e.g. group by the x bucket and the series column).\n\
             - Do not invent ids you have not defined or seen on the board. \
             Positions/sizes are optional (the client lays objects out). Emit \
             nothing after the closing fence.\n\n\
             # Request\n\
             {user_prompt}\n",
        )
    }

    fn dialect_name(kind: DatabaseKind) -> &'static str {
        match kind {
            DatabaseKind::Postgres => "PostgreSQL",
            DatabaseKind::Mysql => "MySQL",
            DatabaseKind::Mariadb => "MariaDB",
            DatabaseKind::Sqlite => "SQLite",
            DatabaseKind::Mssql => "SQL Server (T-SQL)",
            DatabaseKind::Oracle => "Oracle",
            DatabaseKind::Bigquery => "BigQuery",
            DatabaseKind::Redshift => "Redshift",
            DatabaseKind::Snowflake => "Snowflake",
            DatabaseKind::Clickhouse => "ClickHouse",
            DatabaseKind::Duckdb => "DuckDB",
            DatabaseKind::Redis => "Redis",
            DatabaseKind::Kafka => "Kafka",
            DatabaseKind::Mongodb => "MongoDB",
            DatabaseKind::Mixpanel => "Mixpanel",
            DatabaseKind::Elasticsearch => "Elasticsearch",
            DatabaseKind::Trino => "Trino",
            DatabaseKind::Dynamodb => "DynamoDB",
            DatabaseKind::Starrocks => "StarRocks",
        }
    }

    /// Render a schema node tree as commented DDL for the prompt.
    pub fn schema_ddl(&self, nodes: &[SchemaNode]) -> String {
        let mut out = String::new();
        for node in nodes {
            Self::write_ddl_node(&mut out, node, &[]);
        }
        out
    }

    fn write_ddl_node(out: &mut String, node: &SchemaNode, parent_names: &[&str]) {
        match node.kind {
            SchemaNodeKind::Database | SchemaNodeKind::Schema => {
                let label = if node.kind == SchemaNodeKind::Database {
                    "Database"
                } else {
                    "Schema"
                };
                let _ = writeln!(out, "-- {}: {}", label, node.name);
                let names: Vec<&str> = parent_names
                    .iter()
                    .copied()
                    .chain(std::iter::once(node.name.as_str()))
                    .collect();
                for child in &node.children {
                    Self::write_ddl_node(out, child, &names);
                }
            }
            SchemaNodeKind::Table | SchemaNodeKind::ForeignTable => {
                let qualified = Self::qualified_name(parent_names, &node.name);
                let columns = Self::collect_columns(&node.children);
                if columns.is_empty() {
                    let _ = writeln!(out, "CREATE TABLE {} ();\n", qualified);
                } else {
                    let _ = writeln!(out, "CREATE TABLE {} (", qualified);
                    for (i, (name, typ)) in columns.iter().enumerate() {
                        let comma = if i + 1 < columns.len() { "," } else { "" };
                        let _ = writeln!(out, "    {} {}{}", name, typ, comma);
                    }
                    let _ = writeln!(out, ");\n");
                }
            }
            SchemaNodeKind::View | SchemaNodeKind::MaterializedView => {
                let qualified = Self::qualified_name(parent_names, &node.name);
                let kind_label = if node.kind == SchemaNodeKind::MaterializedView {
                    "Materialized View"
                } else {
                    "View"
                };
                let _ = writeln!(out, "-- {}: {}", kind_label, qualified);
                let columns = Self::collect_columns(&node.children);
                if !columns.is_empty() {
                    let _ = writeln!(out, "-- Columns:");
                    for (name, typ) in &columns {
                        let _ = writeln!(out, "--   {} {}", name, typ);
                    }
                }
                let _ = writeln!(out);
            }
            SchemaNodeKind::Collection => {
                let _ = writeln!(out, "-- Collection: {}\n", node.name);
            }
            _ => {}
        }
    }

    fn collect_columns(children: &[SchemaNode]) -> Vec<(&str, String)> {
        children
            .iter()
            .filter(|c| c.kind == SchemaNodeKind::Column)
            .map(|c| {
                let typ = c.detail.as_deref().unwrap_or("UNKNOWN").to_string();
                (c.name.as_str(), typ)
            })
            .collect()
    }

    fn qualified_name(parents: &[&str], name: &str) -> String {
        match parents.last().copied() {
            Some(s) => format!("{}.{}", s, name),
            None => name.to_string(),
        }
    }
}

impl Default for AgentEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine for AgentEngine {
    fn name(&self) -> &str {
        "agent"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_inlines_schema_and_request() {
        let prompt = AgentEngine::build_prompt(
            AgentProfile::Sql,
            Some(DatabaseKind::Postgres),
            "CREATE TABLE users (id INT);",
            "list all users",
            "",
        );
        assert!(prompt.contains("PostgreSQL"));
        assert!(prompt.contains("CREATE TABLE users (id INT);"));
        assert!(prompt.contains("list all users"));
        assert!(prompt.contains("```sql"));
    }

    #[test]
    fn build_prompt_without_dialect_uses_generic_sql() {
        // No connection selected: the agent still writes/explains generic SQL.
        let prompt = AgentEngine::build_prompt(AgentProfile::Sql, None, "", "write a select", "");
        assert!(prompt.contains("SQL"));
        assert!(!prompt.contains("PostgreSQL"));
        assert!(prompt.contains("write a select"));
    }

    #[test]
    fn build_prompt_truncates_oversized_schema() {
        let huge = "x".repeat(SCHEMA_PROMPT_MAX_BYTES + 1000);
        let prompt = AgentEngine::build_prompt(
            AgentProfile::Sql,
            Some(DatabaseKind::Sqlite),
            &huge,
            "go",
            "",
        );
        assert!(prompt.contains("(schema truncated)"));
    }

    #[test]
    fn canvas_prompt_describes_object_contract() {
        let prompt = AgentEngine::build_prompt(
            AgentProfile::Canvas,
            Some(DatabaseKind::Postgres),
            "CREATE TABLE orders (id INT, ordered_at TIMESTAMP, category TEXT, total NUMERIC);",
            "monthly sales by category",
            "",
        );
        // Schema and request are inlined.
        assert!(prompt.contains("PostgreSQL"));
        assert!(prompt.contains("CREATE TABLE orders"));
        assert!(prompt.contains("monthly sales by category"));
        // The canvas contract markers are present (and it is NOT the SQL prompt).
        assert!(prompt.contains("```arris-canvas"));
        assert!(prompt.contains("sourceQueryId"));
        assert!(prompt.contains("\"kind\": \"query\""));
        assert!(prompt.contains("\"kind\": \"chart\""));
        // All five object kinds are offered, plus the modify/remove affordances.
        assert!(prompt.contains("\"kind\": \"sticky\""));
        assert!(prompt.contains("\"kind\": \"shape\""));
        assert!(prompt.contains("\"remove\""));
        assert!(!prompt.contains("return exactly one ```sql fenced block"));
    }

    #[test]
    fn canvas_prompt_inlines_the_current_board() {
        // With an empty board the prompt says so; with objects, it lists them so
        // the agent can reference, modify, or remove them by id.
        let empty = AgentEngine::build_prompt(
            AgentProfile::Canvas,
            Some(DatabaseKind::Postgres),
            "",
            "add a chart",
            "",
        );
        assert!(empty.contains("# Current board"));
        assert!(empty.contains("The board is empty."));

        let with_board = AgentEngine::build_prompt(
            AgentProfile::Canvas,
            Some(DatabaseKind::Postgres),
            "",
            "make it a line chart",
            "- query id=q1 title=\"Monthly sales\"\n- chart id=c1 source=q1 kind=bar",
        );
        assert!(with_board.contains("query id=q1"));
        assert!(with_board.contains("chart id=c1 source=q1"));
        assert!(!with_board.contains("The board is empty."));
    }

    #[test]
    fn canvas_prompt_truncates_oversized_schema() {
        let huge = "x".repeat(SCHEMA_PROMPT_MAX_BYTES + 1000);
        let prompt = AgentEngine::build_prompt(AgentProfile::Canvas, None, &huge, "go", "");
        assert!(prompt.contains("(schema truncated)"));
    }
}
