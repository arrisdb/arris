//! The agent engine: a stateless orchestrator for agentic SQL sessions.
//!
//! Each turn builds a self-contained prompt (role + schema + the user's request),
//! spawns the selected provider's CLI (`codex` or `claude`) in a read-only mode,
//! and streams its parsed events as [`AgentEvent`]s. The [`AgentProfile`] selects
//! the prompt: write/explain SQL, or design canvas objects. Either way the agent
//! needs no live database access, so there is no MCP server: the schema is
//! inlined into the prompt and the CLI runs with file writes and tools disabled.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};

use super::constants::SCHEMA_PROMPT_MAX_BYTES;
use super::errors::AgentError;
use super::impl_cli_resolver::CliResolver;
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
        // Resolve to an absolute path over the user's real PATH: a GUI launch
        // inherits a minimal PATH that omits where the CLI is installed.
        let program = CliResolver::resolve(binary).ok_or(AgentError::CliNotFound(provider))?;

        let mut cmd = Command::new(&program);
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
        let syntax_note = Self::dialect_syntax_note(dialect);
        match profile {
            AgentProfile::Sql => Self::build_sql_prompt(name, &schema, syntax_note, user_prompt),
            AgentProfile::Canvas => {
                Self::build_canvas_prompt(name, &schema, syntax_note, board_context, user_prompt)
            }
        }
    }

    /// Dialect-specific syntax guidance appended to the generic "use {name}
    /// syntax" rule. Most SQL databases need none. A non-SQL store whose query
    /// language the model would otherwise get wrong returns a note here. For
    /// MongoDB the driver parses the statement's argument as STRICT JSON, so the
    /// model must double-quote every key (the default mongosh/JS style with
    /// unquoted keys fails with `invalid JSON ... key must be a string`).
    fn dialect_syntax_note(dialect: Option<DatabaseKind>) -> &'static str {
        match dialect {
            Some(DatabaseKind::Mongodb) => {
                "\n- This is MongoDB, not SQL. Write each statement as \
                 `db.<collection>.<verb>(...)` (analytics use \
                 `db.<collection>.aggregate([ ... ])`; also `find`, `insertOne`, \
                 `updateMany`, `deleteMany`). The argument is parsed as STRICT JSON: \
                 EVERY key MUST be double-quoted, including `$`-operators (\"$group\", \
                 \"$match\", \"$sum\", \"$project\", \"$sort\", \"$dateToString\") and \
                 field names (\"_id\", \"category\", \"total_sales\"); string values are \
                 double-quoted too. NEVER use mongosh/JavaScript style with unquoted \
                 keys, and never use shell helpers like ObjectId(...) or ISODate(...). \
                 Example: db.sales.aggregate([{\"$group\":{\"_id\":\"$category\",\"total\":\
                 {\"$sum\":\"$amount\"}}},{\"$sort\":{\"total\":-1}}])."
            }
            _ => "",
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
    fn build_sql_prompt(name: &str, schema: &str, syntax_note: &str, user_prompt: &str) -> String {
        format!(
            "You are a SQL assistant embedded in a database client. You ONLY write \
             or explain SQL queries for the user's {name} database, nothing else. \
             Do not run shell commands, read files, or do unrelated work.\n\n\
             # Database schema ({name})\n\
             {schema}\n\n\
             # Rules\n\
             - Use dialect-appropriate {name} syntax and the tables/columns above.{syntax_note}\n\
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
        syntax_note: &str,
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
             \x20     \"spec\": {{ \"kind\": \"bar\", \"xColumn\": \"<col>\", \"yColumns\": [\"<col>\"], \"seriesColumn\": \"<col?>\", \"aggregation\": \"sum\", \"title\": \"<title>\", \"style\": {{ \"stackMode\": \"stacked\", \"showLegend\": true, \"yMin\": 0, \"yMax\": 100 }} }} }},\n\
             \x20   {{ \"kind\": \"table\", \"id\": \"tb1\", \"sourceQueryId\": \"q1\", \"title\": \"<label>\" }},\n\
             \x20   {{ \"kind\": \"text\", \"id\": \"t1\", \"text\": \"## Heading\\nMarkdown commentary.\" }},\n\
             \x20   {{ \"kind\": \"sticky\", \"id\": \"s1\", \"text\": \"<short note>\", \"color\": \"yellow\" }},\n\
             \x20   {{ \"kind\": \"shape\", \"id\": \"sh1\", \"shape\": \"rect\", \"text\": \"<optional label>\" }}\n\
             \x20 ],\n\
             \x20 \"edges\": [ {{ \"id\": \"e1\", \"source\": \"q1\", \"target\": \"c1\" }} ],\n\
             \x20 \"remove\": []\n\
             }}\n\
             ```\n\n\
             # Rules\n\
             - Use dialect-appropriate {name} syntax and only the tables/columns above.{syntax_note}\n\
             - Each `query` runs against ONE database connection. The schema \
             section above lists every connection available to this board, each \
             under a `## Connection \"<name>\" (id=<id>, <dialect>)` header. When \
             more than one is listed, every `query` MUST include a `connectionId` \
             set to the matching `id`, so the board can run queries against \
             different databases in the same answer. With a single connection you \
             may omit `connectionId` on a NEW query (it defaults to that one).\n\
             - Each existing `query` line in the board summary shows its current \
             `connectionId=<id>`. To MOVE an existing query to a different \
             connection, re-emit it by its `id` with the new `connectionId` set to \
             the `id` of the target `## Connection` header, AND rewrite its `sql` \
             into that connection's dialect when the dialects differ. This applies \
             even when only ONE connection is listed: if a query's current \
             `connectionId` is not that listed connection's `id`, set it to that \
             `id` to move the query onto the board's connection. The client re-runs \
             a query whose `connectionId` changed.\n\
             - BUILD ON EXISTING RESULTS when you can. Each `query` line in the \
             board shows a `table=<name>`: a new query may read ANOTHER query \
             cell's already-computed RESULTS by selecting `FROM <that table name>` \
             (or JOIN), instead of re-querying the database. PREFER this whenever \
             the data you need is derivable from a cell already on the board: to \
             filter it, re-aggregate it, reshape it, or join two cells. A query \
             that reads a cell runs in an in-memory engine (Apache DataFusion), so \
             it has three constraints: (1) use standard ANSI SQL (e.g. `SUM`, \
             `GROUP BY`, `date_trunc`), NOT source-database-specific syntax; (2) it \
             may reference ONLY other cells' `table=` names (and SQL literals), \
             NEVER a live database table in the SAME statement (a query that needs \
             both must read the live data in its own cell first, then a second cell \
             reads that cell); (3) it can only use the columns the upstream cell \
             actually returns (its SELECT list). Re-query the database only when no \
             existing cell has the columns or grain you need (e.g. a weekly-summed \
             cell cannot be split back into days).\n\
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
             - `spec.style` (every field optional) controls appearance, axes, and \
             legend. Supported keys: `colors` (array of hex strings), `lineStyle` \
             (solid|dashed|dotted), `strokeWidth` (number), `showLegend` (bool), \
             `legendPosition` (top|bottom|left|right), `showGrid` (bool), \
             `showDataLabels` (bool), `xMin`/`xMax`/`yMin`/`yMax` (axis bounds, \
             numbers), `xAxisTitle`/`yAxisTitle` (strings), `xLabelAngle`/\
             `yLabelAngle` (numbers), `yScale` (linear|log), `stackMode` \
             (none|stacked|percent), `barOrientation` (vertical|horizontal), \
             `sortOrder` (none|asc|desc), `curveType` (linear|monotone|step|natural), \
             `fillOpacity` (0..1), `donutInnerRadius` (number), `referenceLineY` \
             (number), `xTickInterval` (number). Set only the keys the request asks \
             for. To change one of these on an existing chart, re-`spec` it by id with \
             just the `style` keys you are changing.\n\
             - A `table` previews a query's rows as a grid. It MUST set \
             `sourceQueryId` to the `id` of a `query` (new in this block or already \
             on the board). Prefer a table when the user wants to see the rows; a \
             chart when they want them visualized. A `query` object itself shows no \
             rows, so add a `table` (or `chart`) bound to it to surface results.\n\
             - `sticky.color` is one of yellow, green, blue, pink, purple. \
             `shape.shape` is one of rect, ellipse, line; rect/ellipse may carry \
             optional `text`.\n\
             - Each `query.sql` is exactly one statement, no trailing semicolon, no \
             comments. Prefer a single query that returns tidy rows for charting \
             (e.g. group by the x bucket and the series column).\n\
             - Do not invent ids you have not defined or seen on the board. \
             Positions/sizes are optional (the client lays objects out). Emit \
             nothing after the closing fence.\n\n\
             # Asking the user\n\
             You never receive the ROW DATA a query returned, only the schema and \
             the board summary. If you cannot complete the request without input \
             only the user can give (most commonly those rows), ASK instead of \
             guessing. To ask, reply with ONE fenced block tagged `arris-ask` \
             containing a single JSON object with a `type` field, and emit NO \
             `arris-canvas` block in that turn (you are waiting for the answer). \
             Supported question types:\n\
             ```arris-ask\n\
             {{ \"type\": \"share_results\", \"queryIds\": [\"q1\"], \"reason\": \"<one short sentence>\" }}\n\
             ```\n\
             - `share_results`: request the rows of one or more existing query \
             objects (by their board ids) so you can summarize or build on them. \
             The user approves (the rows arrive in the next message) or declines. \
             Only ask for results you actually need.\n\n\
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

    /// The top-level `list_schemas` is lazy: it returns schema containers with no
    /// relations or columns (those load on expand). For the agent prompt we need
    /// the real tables and columns, so collect the names of the empty schema
    /// containers (up to `max`) and deep-load each via `list_schema`.
    pub fn schema_names_to_hydrate(nodes: &[SchemaNode], max: usize) -> Vec<String> {
        let mut out = Vec::new();
        Self::collect_hydrate_names(nodes, max, &mut out);
        out
    }

    fn collect_hydrate_names(nodes: &[SchemaNode], max: usize, out: &mut Vec<String>) {
        for node in nodes {
            if out.len() >= max {
                return;
            }
            match node.kind {
                SchemaNodeKind::Schema => {
                    if node.children.is_empty() && !out.contains(&node.name) {
                        out.push(node.name.clone());
                    }
                }
                SchemaNodeKind::Database => {
                    // A database-as-schema source (e.g. MySQL) returns top-level
                    // `Database` nodes whose tables load via `list_schema(db)`, with
                    // no intermediate `Schema` node. Hydrate such an empty database
                    // by its own name; otherwise recurse to its `Schema` children
                    // (e.g. Postgres `database > schema > tables`).
                    if node.children.is_empty() {
                        if !out.contains(&node.name) {
                            out.push(node.name.clone());
                        }
                    } else {
                        Self::collect_hydrate_names(&node.children, max, out);
                    }
                }
                _ => {}
            }
        }
    }

    /// Attach the deep-loaded relations/columns onto each empty schema container,
    /// keyed by the schema name. Already-populated schemas are left untouched.
    pub fn attach_schema_children(
        nodes: &mut [SchemaNode],
        loaded: &HashMap<String, Vec<SchemaNode>>,
    ) {
        for node in nodes.iter_mut() {
            match node.kind {
                SchemaNodeKind::Schema => {
                    if node.children.is_empty() {
                        if let Some(children) = Self::loaded_relations(&node.name, loaded) {
                            node.children = children;
                        }
                    }
                }
                SchemaNodeKind::Database => {
                    // Mirror the hydrate-name walk: an empty `Database` is a
                    // database-as-schema container (MySQL, MongoDB) keyed by its own
                    // name; a populated one nests `Schema` children to fill instead.
                    if node.children.is_empty() {
                        if let Some(children) = Self::loaded_relations(&node.name, loaded) {
                            node.children = children;
                        }
                    } else {
                        Self::attach_schema_children(&mut node.children, loaded);
                    }
                }
                _ => {}
            }
        }
    }

    /// The deep `list_schema(name)` of several drivers (MySQL, MongoDB) returns
    /// its relations re-wrapped in a single container node carrying the same name
    /// as the schema being filled. Splicing that wrapper in verbatim would nest a
    /// duplicate `-- Database:`/`-- Schema:` header above the real relations, so
    /// unwrap one level when the sole loaded node is that same-named container;
    /// drivers that already return bare relations (Postgres) pass through as-is.
    fn loaded_relations(
        name: &str,
        loaded: &HashMap<String, Vec<SchemaNode>>,
    ) -> Option<Vec<SchemaNode>> {
        let nodes = loaded.get(name)?;
        if let [only] = nodes.as_slice() {
            if only.name == name
                && matches!(only.kind, SchemaNodeKind::Database | SchemaNodeKind::Schema)
            {
                return Some(only.children.clone());
            }
        }
        Some(nodes.clone())
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
                // A schemaless store (MongoDB) has no declared columns; the driver
                // samples documents and attaches the inferred fields as `Column`
                // children. Render them like a table so the agent sees the real
                // field names and types, not just the collection name.
                let qualified = Self::qualified_name(parent_names, &node.name);
                let columns = Self::collect_columns(&node.children);
                if columns.is_empty() {
                    let _ = writeln!(out, "-- Collection: {} (no sampled fields)\n", qualified);
                } else {
                    let _ = writeln!(out, "-- Collection (sampled fields): {}", qualified);
                    let _ = writeln!(out, "CREATE TABLE {} (", qualified);
                    for (i, (name, typ)) in columns.iter().enumerate() {
                        let comma = if i + 1 < columns.len() { "," } else { "" };
                        let _ = writeln!(out, "    {} {}{}", name, typ, comma);
                    }
                    let _ = writeln!(out, ");\n");
                }
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
        // All six object kinds are offered, plus the modify/remove affordances.
        assert!(prompt.contains("\"kind\": \"table\""));
        assert!(prompt.contains("\"kind\": \"sticky\""));
        assert!(prompt.contains("\"kind\": \"shape\""));
        assert!(prompt.contains("\"remove\""));
        // The full chart-style contract is advertised so the agent knows it can set
        // axis bounds and toggle the legend instead of refusing for lack of a field.
        assert!(prompt.contains("yMin"));
        assert!(prompt.contains("yMax"));
        assert!(prompt.contains("showLegend"));
        assert!(prompt.contains("legendPosition"));
        assert!(prompt.contains("yScale"));
        // The per-query connection rule lets the agent target several databases in
        // one answer (canvas multi-connection support).
        assert!(prompt.contains("connectionId"));
        assert!(prompt.contains("## Connection"));
        // The agent is explicitly told it may move an existing query to another
        // connection by re-emitting it by id with a new connectionId, AND that this
        // works even when the board lists only one connection (the common case of
        // moving a stray cell onto the board's connection).
        assert!(prompt.contains("MOVE an existing query"));
        assert!(prompt.contains("even when only ONE connection is listed"));
        // The agent is taught to chain off an existing cell's results (read it by
        // its `table=` name in the in-memory engine) instead of always re-querying
        // the source database.
        assert!(prompt.contains("BUILD ON EXISTING RESULTS"));
        assert!(prompt.contains("table=<name>"));
        assert!(prompt.contains("DataFusion"));
        assert!(prompt.contains("ANSI SQL"));
        // The agent can ASK the user for data it cannot see (the question
        // abstraction), with share_results as the first question type.
        assert!(prompt.contains("arris-ask"));
        assert!(prompt.contains("share_results"));
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

    #[test]
    fn mongo_prompt_demands_strict_json_keys() {
        // The MongoDB driver parses each statement's argument as strict JSON, so
        // both profiles must tell the model to double-quote every key (otherwise it
        // emits mongosh/JS unquoted keys that the driver rejects).
        for profile in [AgentProfile::Canvas, AgentProfile::Sql] {
            let prompt = AgentEngine::build_prompt(
                profile,
                Some(DatabaseKind::Mongodb),
                "sales_transactions: { amount, category, sale_date }",
                "monthly sales by category",
                "",
            );
            assert!(prompt.contains("MongoDB, not SQL"));
            assert!(prompt.contains("STRICT JSON"));
            assert!(prompt.contains("double-quoted"));
            assert!(prompt.contains("aggregate"));
        }
        // A SQL database gets no MongoDB note.
        let pg = AgentEngine::build_prompt(
            AgentProfile::Canvas,
            Some(DatabaseKind::Postgres),
            "CREATE TABLE t (id INT);",
            "x",
            "",
        );
        assert!(!pg.contains("STRICT JSON"));
    }

    fn schema(name: &str) -> SchemaNode {
        SchemaNode::new(name, SchemaNodeKind::Schema, name)
    }

    fn database(name: &str, schemas: Vec<SchemaNode>) -> SchemaNode {
        SchemaNode::new(name, SchemaNodeKind::Database, name).with_children(schemas)
    }

    #[test]
    fn schema_names_to_hydrate_collects_empty_containers_under_a_database() {
        let tree = vec![database("postgres", vec![schema("public"), schema("analytics")])];
        let names = AgentEngine::schema_names_to_hydrate(&tree, 10);
        assert_eq!(names, vec!["public".to_string(), "analytics".to_string()]);
    }

    #[test]
    fn schema_names_to_hydrate_skips_populated_schemas_and_respects_the_cap() {
        let populated = SchemaNode::new("public", SchemaNodeKind::Schema, "public")
            .with_children(vec![SchemaNode::new("t", SchemaNodeKind::Table, "public.t")]);
        let tree = vec![database(
            "db",
            vec![populated, schema("a"), schema("b"), schema("c")],
        )];
        // The populated "public" is skipped; the cap of 2 trims "c".
        let names = AgentEngine::schema_names_to_hydrate(&tree, 2);
        assert_eq!(names, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn attach_schema_children_fills_empty_schemas_so_ddl_has_real_tables() {
        let mut tree = vec![database("db", vec![schema("public"), schema("analytics")])];
        let mut loaded = HashMap::new();
        loaded.insert(
            "public".to_string(),
            vec![SchemaNode::new("customers", SchemaNodeKind::Table, "public.customers")
                .with_children(vec![SchemaNode::new(
                    "id",
                    SchemaNodeKind::Column,
                    "public.customers.id",
                )])],
        );
        AgentEngine::attach_schema_children(&mut tree, &loaded);
        let ddl = AgentEngine::new().schema_ddl(&tree);
        // The deep-loaded table (and its column) now appear in the prompt DDL.
        assert!(ddl.contains("CREATE TABLE public.customers"));
        assert!(ddl.contains("id"));
        // A schema with no loaded entry stays empty (no fabricated tables).
        assert!(!ddl.contains("CREATE TABLE analytics"));
    }

    #[test]
    fn schema_names_to_hydrate_collects_empty_databases_as_schema_containers() {
        // MySQL-style: top-level `Database` nodes with no `Schema` child; their
        // tables load via `list_schema(db)`. The database name itself is the
        // hydrate key.
        let tree = vec![database("shop", vec![]), database("analytics", vec![])];
        let names = AgentEngine::schema_names_to_hydrate(&tree, 10);
        assert_eq!(names, vec!["shop".to_string(), "analytics".to_string()]);
    }

    #[test]
    fn attach_schema_children_fills_a_database_as_schema_so_ddl_has_real_tables() {
        // MySQL's `list_schema(db)` re-wraps its tables in a single same-named
        // `Database` node (see drivers/mysql/mod.rs). Feed that realistic shape.
        let mut tree = vec![database("shop", vec![])];
        let mut loaded = HashMap::new();
        loaded.insert(
            "shop".to_string(),
            vec![database(
                "shop",
                vec![SchemaNode::new("orders", SchemaNodeKind::Table, "shop.orders")
                    .with_children(vec![SchemaNode::new(
                        "id",
                        SchemaNodeKind::Column,
                        "shop.orders.id",
                    )])],
            )],
        );
        AgentEngine::attach_schema_children(&mut tree, &loaded);
        let ddl = AgentEngine::new().schema_ddl(&tree);
        // The MySQL database's deep-loaded table reaches the agent prompt.
        assert!(ddl.contains("CREATE TABLE shop.orders"));
        assert!(ddl.contains("id"));
        // The same-named wrapper is unwrapped: the database header appears once,
        // not nested as `-- Database: shop` twice.
        assert_eq!(ddl.matches("-- Database: shop").count(), 1);
    }

    #[test]
    fn attach_schema_children_renders_mongo_collection_fields_without_a_duplicate_database() {
        // MongoDB's `list_schema(db)` returns the collections (with sampled field
        // columns) re-wrapped in a same-named `Database` node.
        let mut tree = vec![database("appdb", vec![])];
        let mut loaded = HashMap::new();
        loaded.insert(
            "appdb".to_string(),
            vec![database(
                "appdb",
                vec![
                    SchemaNode::new("customers", SchemaNodeKind::Collection, "appdb.customers")
                        .with_children(vec![
                            SchemaNode::new("_id", SchemaNodeKind::Column, "appdb.customers._id")
                                .with_detail("objectId"),
                            SchemaNode::new("name", SchemaNodeKind::Column, "appdb.customers.name")
                                .with_detail("string"),
                        ]),
                ],
            )],
        );
        AgentEngine::attach_schema_children(&mut tree, &loaded);
        let ddl = AgentEngine::new().schema_ddl(&tree);
        // The sampled fields reach the agent (previously the Collection arm dropped
        // all children and emitted only the collection name).
        assert!(ddl.contains("CREATE TABLE appdb.customers"));
        assert!(ddl.contains("_id objectId"));
        assert!(ddl.contains("name string"));
        assert!(ddl.contains("-- Collection (sampled fields): appdb.customers"));
        // No nested duplicate database header.
        assert_eq!(ddl.matches("-- Database: appdb").count(), 1);
    }
}
