use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use super::errors::*;
use super::types::*;

pub(crate) struct SqlMeshCliRunner {
    pub project_root: PathBuf,
    pub sqlmesh_executable: String,
}

impl SqlMeshCliRunner {
    pub fn new(project_root: PathBuf) -> Self {
        Self {
            project_root,
            sqlmesh_executable: "sqlmesh".to_string(),
        }
    }

    pub fn with_executable(mut self, exe: String) -> Self {
        self.sqlmesh_executable = exe;
        self
    }

    pub fn check_cli(&self) -> Result<String, SqlMeshCliError> {
        let output = Command::new(&self.sqlmesh_executable)
            .arg("--version")
            .current_dir(&self.project_root)
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    SqlMeshCliError::NotFound
                } else {
                    SqlMeshCliError::Io(e)
                }
            })?;

        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(Self::extract_version(&raw))
        } else {
            Ok("installed".to_string())
        }
    }

    fn extract_version(raw: &str) -> String {
        for line in raw.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("sqlmesh, version") {
                let v = rest.trim();
                if !v.is_empty() {
                    return v.to_string();
                }
            }
        }
        for word in raw.split_whitespace() {
            if word.chars().next().map_or(false, |c| c.is_ascii_digit()) && word.contains('.') {
                return word.to_string();
            }
        }
        if raw.is_empty() {
            "installed".to_string()
        } else {
            raw.lines().next().unwrap_or("installed").trim().to_string()
        }
    }

    pub fn run_command(&self, args: &[&str]) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        let start = Instant::now();
        let output = Command::new(&self.sqlmesh_executable)
            .args(args)
            .current_dir(&self.project_root)
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    SqlMeshCliError::NotFound
                } else {
                    SqlMeshCliError::Io(e)
                }
            })?;

        let duration_ms = start.elapsed().as_millis() as u64;

        Ok(SqlMeshCommandResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            duration_ms,
        })
    }

    pub fn plan_model(
        &self,
        select: &str,
        environment: Option<&str>,
        extra_args: &[String],
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        // `sqlmesh plan [ENVIRONMENT]` takes the target virtual environment as a
        // leading positional. When omitted, sqlmesh plans against `prod`.
        let mut args = vec!["plan"];
        if let Some(env) = environment.filter(|e| !e.is_empty()) {
            args.push(env);
        }
        // An empty `select` means a whole-project plan (the run-bar Plan action),
        // so `--select-model` is omitted entirely — passing it empty makes
        // sqlmesh select nothing.
        if !select.is_empty() {
            args.extend(["--select-model", select]);
        }
        args.extend(["--auto-apply", "--no-prompts"]);
        let extra: Vec<&str> = extra_args.iter().map(|s| s.as_str()).collect();
        args.extend(extra);
        self.run_command(&args)
    }

    /// Promote a virtual environment by planning + applying against the target
    /// (e.g. `prod`). The changes already validated in a dev environment are
    /// applied to `target` via `sqlmesh plan <target> --auto-apply --no-prompts`.
    pub fn promote_environment(
        &self,
        target: &str,
        extra_args: &[String],
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        let mut args = vec!["plan", target, "--auto-apply", "--no-prompts"];
        let extra: Vec<&str> = extra_args.iter().map(|s| s.as_str()).collect();
        args.extend(extra);
        self.run_command(&args)
    }

    /// List SQLMesh virtual environments via `sqlmesh environments`. Unlike
    /// `list_gateways` (which reads `config.yaml`), this spawns the CLI because
    /// environments live in SQLMesh state, not the config file. Returns an error
    /// when the CLI is missing or fails so the caller can degrade gracefully.
    pub fn list_environments(&self) -> Result<Vec<SqlMeshEnvironmentInfo>, SqlMeshCliError> {
        let result = self.run_command(&["environments"])?;
        if result.exit_code != 0 {
            return Err(SqlMeshCliError::Io(std::io::Error::other(
                result.stderr.trim().to_string(),
            )));
        }
        Ok(Self::parse_environments_output(&result.stdout))
    }

    /// Parse the line-based output of `sqlmesh environments`. Each environment is
    /// printed as `<name> - <expiry>` (expiry may read "No Expiry"); a leading
    /// summary line such as "Number of SQLMesh environments are: N" is skipped.
    /// Parsing tolerates format drift: a bare line with no ` - ` is treated as a
    /// name with no expiry.
    pub(crate) fn parse_environments_output(stdout: &str) -> Vec<SqlMeshEnvironmentInfo> {
        let mut envs = Vec::new();
        for raw in stdout.lines() {
            let line = raw.trim();
            if line.is_empty() {
                continue;
            }
            let lower = line.to_lowercase();
            if lower.contains("environments are") || lower.starts_with("number of") {
                continue;
            }
            let (name, expiry) = match line.split_once(" - ") {
                Some((n, e)) => {
                    let exp = e.trim();
                    let expiry = if exp.is_empty() || exp.eq_ignore_ascii_case("no expiry") {
                        None
                    } else {
                        Some(exp.to_string())
                    };
                    (n.trim().to_string(), expiry)
                }
                None => (line.to_string(), None),
            };
            if !name.is_empty() {
                envs.push(SqlMeshEnvironmentInfo { name, expiry });
            }
        }
        envs
    }

    pub fn test_model(
        &self,
        select: &str,
        extra_args: &[String],
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        // An empty selector means "test the whole project" (fired from the
        // project run-bar). `sqlmesh test` with no positionals runs every unit
        // test, so pass only the extra args.
        if select.is_empty() {
            let mut args: Vec<&str> = vec!["test"];
            args.extend(extra_args.iter().map(|s| s.as_str()));
            return self.run_command(&args);
        }

        // `sqlmesh test` has no model selector — its positionals are test file
        // paths and `-k` matches test names. Resolve the model's test files by
        // scanning `tests/` for blocks whose `model:` equals `select`, then pass
        // their absolute paths (relative paths are not honored by the CLI).
        let test_files = self.test_files_for_model(select);
        if test_files.is_empty() {
            return Ok(SqlMeshCommandResult {
                exit_code: 0,
                stdout: format!("No unit tests found for model {select}.\n"),
                stderr: String::new(),
                duration_ms: 0,
            });
        }
        let mut args: Vec<&str> = vec!["test"];
        args.extend(test_files.iter().map(|s| s.as_str()));
        args.extend(extra_args.iter().map(|s| s.as_str()));
        self.run_command(&args)
    }

    pub fn test_target(
        &self,
        target: &str,
        extra_args: &[String],
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        // `target` is an absolute test-file path, optionally suffixed with
        // `::<test_name>` to run a single test within that suite (sqlmesh
        // mirrors pytest node-id syntax). Without the suffix every test in the
        // file runs.
        let mut args: Vec<&str> = vec!["test", target];
        args.extend(extra_args.iter().map(|s| s.as_str()));
        self.run_command(&args)
    }

    fn test_files_for_model(&self, model: &str) -> Vec<String> {
        let mut out = Vec::new();
        Self::collect_test_files(&self.project_root.join("tests"), model, &mut out);
        out.sort();
        out.dedup();
        out
    }

    fn collect_test_files(dir: &Path, model: &str, out: &mut Vec<String>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                Self::collect_test_files(&path, model, out);
                continue;
            }
            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
            if ext != "yaml" && ext != "yml" {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                if Self::yaml_targets_model(&content, model) {
                    out.push(path.display().to_string());
                }
            }
        }
    }

    fn yaml_targets_model(content: &str, model: &str) -> bool {
        content.lines().any(|line| {
            line.trim_start()
                .strip_prefix("model:")
                .map(|rest| rest.trim().trim_matches(|c| c == '"' || c == '\'') == model)
                .unwrap_or(false)
        })
    }

    pub fn run_models(
        &self,
        extra_args: &[String],
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        let mut args = vec!["run"];
        let extra: Vec<&str> = extra_args.iter().map(|s| s.as_str()).collect();
        args.extend(extra);
        self.run_command(&args)
    }

    /// `sqlmesh lint [--model <name>]`. An empty `select` lints every model
    /// (the CLI default when `--model` is omitted); a non-empty `select` lints
    /// just that model. `lint` takes `--model`, not `--select-model`.
    pub fn lint_model(
        &self,
        select: &str,
        extra_args: &[String],
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        let mut args = vec!["lint"];
        if !select.is_empty() {
            args.extend(["--model", select]);
        }
        let extra: Vec<&str> = extra_args.iter().map(|s| s.as_str()).collect();
        args.extend(extra);
        self.run_command(&args)
    }

    /// `sqlmesh audit [--model <name>]`. SQLMesh's model-validation command —
    /// runs the audits declared on the target model(s). An empty `select`
    /// audits every model; a non-empty `select` audits just that model.
    pub fn audit_model(
        &self,
        select: &str,
        extra_args: &[String],
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        let mut args = vec!["audit"];
        if !select.is_empty() {
            args.extend(["--model", select]);
        }
        let extra: Vec<&str> = extra_args.iter().map(|s| s.as_str()).collect();
        args.extend(extra);
        self.run_command(&args)
    }

    pub fn render_model(
        &self,
        model_name: &str,
    ) -> Result<SqlMeshRenderResult, SqlMeshCliError> {
        // `--no-format` disables sqlmesh's fixed-width pretty printing, which
        // otherwise hard-wraps long quoted identifiers mid-token. Those embedded
        // newlines corrupt the rendered SQL when it is executed (e.g. Preview),
        // producing `relation "...\n" does not exist` errors.
        //
        // `--start`/`--end` span a deliberately wide interval so time-filtered
        // models (e.g. INCREMENTAL_BY_TIME_RANGE, which expand `@start_date`/
        // `@end_date` into a `WHERE` range) render with a window that covers all
        // rows. Without an interval sqlmesh defaults both bounds to the epoch
        // (`1970-01-01`), yielding an empty `BETWEEN` that returns no data.
        let result = self.run_command(&[
            "render",
            "--no-format",
            "--start",
            "1970-01-01",
            "--end",
            "2999-12-31",
            model_name,
        ])?;
        let rendered_sql = if result.exit_code == 0 {
            Self::extract_rendered_sql(&result.stdout)
        } else {
            None
        };
        Ok(SqlMeshRenderResult {
            model_name: model_name.to_string(),
            rendered_sql,
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: result.exit_code,
        })
    }

    /// Pull the SQL statement out of `sqlmesh render` stdout.
    ///
    /// sqlmesh prefixes render output with status notices — "Initializing new
    /// project state...", state-migration lines, plan/audit warnings — that are
    /// not SQL. Feeding the whole stdout downstream lets a single leading notice
    /// break everything that parses or executes the rendered SQL: the column
    /// lineage extractor rejects the statement (no column edges), Preview fails
    /// to run it, and the Rendered SQL pane shows the notice. When a SQL
    /// statement is present, drop everything before it; otherwise keep the raw
    /// output (callers that only inspect the CLI invocation still see it).
    fn extract_rendered_sql(stdout: &str) -> Option<String> {
        if stdout.trim().is_empty() {
            return None;
        }
        let lines: Vec<&str> = stdout.lines().collect();
        let sql_start = lines.iter().position(|line| {
            let trimmed = line.trim_start();
            let upper = trimmed.to_uppercase();
            upper.starts_with("SELECT")
                || upper.starts_with("WITH ")
                || upper.starts_with("WITH\t")
                || upper == "WITH"
                || trimmed.starts_with('(')
        });
        match sql_start {
            Some(index) => Some(lines[index..].join("\n")),
            None => Some(stdout.to_string()),
        }
    }

    /// Render every requested model and collect the rendered SQL, keyed by the
    /// model's short name (last `.`-separated segment) to match how the column
    /// lineage extractor looks up compiled SQL. Best-effort: models that fail to
    /// render or produce no SQL are skipped.
    ///
    /// Each `render_model` spawns a fresh `sqlmesh` process (~2s of Python
    /// startup), so rendering N models sequentially is the dominant cost of
    /// loading lineage columns. The renders are independent, so they run in
    /// parallel, bounded by the available parallelism to avoid spawning an
    /// unbounded number of heavyweight processes.
    pub fn render_all_models(&self, model_names: &[String]) -> HashMap<String, String> {
        let max_concurrency = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .min(model_names.len().max(1));

        let mut result = HashMap::new();
        std::thread::scope(|scope| {
            for chunk in model_names.chunks(max_concurrency) {
                let handles: Vec<_> = chunk
                    .iter()
                    .map(|name| scope.spawn(move || (name, self.render_model(name))))
                    .collect();
                for handle in handles {
                    if let Ok((name, Ok(rendered))) = handle.join() {
                        if let Some(sql) = rendered.rendered_sql {
                            let short = name.rsplit('.').next().unwrap_or(name).to_string();
                            result.insert(short, sql);
                        }
                    }
                }
            }
        });
        result
    }

    pub fn list_gateways(&self) -> Result<Vec<SqlMeshGatewayInfo>, SqlMeshCliError> {
        let cfg_path = self.project_root.join("config.yaml");
        let cfg_alt = self.project_root.join("config.yml");
        let path = if cfg_path.exists() {
            cfg_path
        } else if cfg_alt.exists() {
            cfg_alt
        } else {
            return Ok(Vec::new());
        };

        let text = std::fs::read_to_string(&path)?;
        Self::parse_gateways_yaml(&text)
    }

    pub(crate) fn parse_gateways_yaml(
        text: &str,
    ) -> Result<Vec<SqlMeshGatewayInfo>, SqlMeshCliError> {
        let doc: serde_yml::Value = serde_yml::from_str(text.trim()).map_err(|e| {
            SqlMeshCliError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                e.to_string(),
            ))
        })?;

        let mut gateways = Vec::new();

        if let Some(gw_map) = doc.get("gateways").and_then(|v| v.as_mapping()) {
            for (key, val) in gw_map {
                let name = key.as_str().unwrap_or("").to_string();
                if name.is_empty() {
                    continue;
                }
                let connection_type = val
                    .get("connection")
                    .and_then(|c| c.get("type"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                gateways.push(SqlMeshGatewayInfo {
                    name,
                    connection_type,
                });
            }
        }

        if gateways.is_empty() {
            if let Some(conn) = doc.get("gateway").and_then(|g| g.get("connection")) {
                let connection_type = conn
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                gateways.push(SqlMeshGatewayInfo {
                    name: "default".to_string(),
                    connection_type,
                });
            }
        }

        Ok(gateways)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_cli_returns_not_found_for_bogus_exe() {
        let runner = SqlMeshCliRunner::new(PathBuf::from("."))
            .with_executable("__nonexistent_sqlmesh_binary__".into());
        let err = runner.check_cli().unwrap_err();
        assert!(matches!(err, SqlMeshCliError::NotFound));
    }

    #[test]
    fn run_command_captures_stdout_and_exit_code() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.run_command(&["hello", "world"]).unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("hello world"));
    }

    #[test]
    fn run_command_captures_nonzero_exit() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("false".into());
        let result = runner.run_command(&[]).unwrap();
        assert_ne!(result.exit_code, 0);
    }

    #[test]
    fn run_command_returns_not_found_for_missing_binary() {
        let runner = SqlMeshCliRunner::new(PathBuf::from("."))
            .with_executable("__nonexistent_binary__".into());
        let err = runner.run_command(&[]).unwrap_err();
        assert!(matches!(err, SqlMeshCliError::NotFound));
    }

    #[test]
    fn render_model_captures_stdout_as_rendered_sql() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.render_model("my_model").unwrap();
        assert_eq!(result.model_name, "my_model");
        assert!(result.rendered_sql.is_some());
        assert!(result.rendered_sql.unwrap().contains("my_model"));
    }

    #[test]
    fn render_model_returns_none_on_failure() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("false".into());
        let result = runner.render_model("my_model").unwrap();
        assert!(result.rendered_sql.is_none());
        assert_ne!(result.exit_code, 0);
    }

    #[test]
    fn render_model_passes_no_format_flag() {
        // `echo` re-emits its args, so the captured stdout reveals the exact CLI
        // invocation. `--no-format` must be present to stop sqlmesh from
        // hard-wrapping long quoted identifiers across lines.
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.render_model("analytics_shop.fct_orders").unwrap();
        let rendered = result.rendered_sql.unwrap();
        assert!(rendered.contains("render"));
        assert!(rendered.contains("--no-format"));
        assert!(rendered.contains("analytics_shop.fct_orders"));
    }

    #[test]
    fn render_model_passes_wide_time_interval() {
        // `echo` re-emits its args, exposing the interval flags. A wide
        // --start/--end keeps time-filtered models from rendering an empty
        // epoch window that would return no rows.
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.render_model("analytics_shop.fct_orders").unwrap();
        let rendered = result.rendered_sql.unwrap();
        assert!(rendered.contains("--start"));
        assert!(rendered.contains("1970-01-01"));
        assert!(rendered.contains("--end"));
        assert!(rendered.contains("2999-12-31"));
    }

    #[test]
    fn extract_rendered_sql_strips_leading_notice() {
        // sqlmesh prints "Initializing new project state..." (and similar state
        // notices) to stdout before the SQL. The notice must be dropped or the
        // SQL parser rejects the whole statement and column lineage shows nothing.
        let stdout = "Initializing new project state...\nSELECT a, b\nFROM t";
        let sql = SqlMeshCliRunner::extract_rendered_sql(stdout).unwrap();
        assert!(sql.starts_with("SELECT a, b"));
        assert!(!sql.contains("Initializing"));
    }

    #[test]
    fn extract_rendered_sql_keeps_with_cte_start() {
        let stdout = "Updating state...\nWITH x AS (SELECT 1)\nSELECT * FROM x";
        let sql = SqlMeshCliRunner::extract_rendered_sql(stdout).unwrap();
        assert!(sql.starts_with("WITH x AS"));
    }

    #[test]
    fn extract_rendered_sql_keeps_raw_when_no_sql_present() {
        // No SQL keyword (e.g. the echo-based CLI-arg tests) — keep the output so
        // callers inspecting the invocation still see it.
        let stdout = "render --no-format my_model";
        let sql = SqlMeshCliRunner::extract_rendered_sql(stdout).unwrap();
        assert_eq!(sql, "render --no-format my_model");
    }

    #[test]
    fn extract_rendered_sql_none_when_empty() {
        assert!(SqlMeshCliRunner::extract_rendered_sql("   \n  ").is_none());
    }

    #[test]
    fn check_cli_returns_ok_when_version_flag_unsupported() {
        let runner =
            SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("false".into());
        let result = runner.check_cli();
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "installed");
    }

    #[test]
    fn extract_version_sqlmesh_format() {
        let raw = "sqlmesh, version 0.144.1";
        assert_eq!(SqlMeshCliRunner::extract_version(raw), "0.144.1");
    }

    #[test]
    fn extract_version_bare_semver() {
        assert_eq!(SqlMeshCliRunner::extract_version("0.144.1"), "0.144.1");
    }

    #[test]
    fn extract_version_multiline_with_semver() {
        let raw = "some header\n0.144.1\nextra";
        assert_eq!(SqlMeshCliRunner::extract_version(raw), "0.144.1");
    }

    #[test]
    fn extract_version_empty_returns_installed() {
        assert_eq!(SqlMeshCliRunner::extract_version(""), "installed");
    }

    #[test]
    fn extract_version_unknown_output_returns_first_line() {
        assert_eq!(
            SqlMeshCliRunner::extract_version("unknown output"),
            "unknown output"
        );
    }

    #[test]
    fn render_all_models_keys_by_short_name() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let rendered = runner.render_all_models(&[
            "analytics_shop.dim_customers".to_string(),
            "bare_model".to_string(),
        ]);
        assert_eq!(rendered.len(), 2);
        assert!(rendered.contains_key("dim_customers"));
        assert!(rendered.contains_key("bare_model"));
        // echo echoes the model name back, so the rendered SQL contains it
        assert!(rendered["dim_customers"].contains("analytics_shop.dim_customers"));
    }

    #[test]
    fn render_all_models_renders_all_concurrently() {
        // Renders run in parallel across threads; every model must still land in
        // the result map keyed by its short name, with no lost or duplicated work.
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let names: Vec<String> = (0..20).map(|i| format!("schema.model_{i}")).collect();
        let rendered = runner.render_all_models(&names);
        assert_eq!(rendered.len(), 20);
        for i in 0..20 {
            let key = format!("model_{i}");
            assert!(rendered.contains_key(&key), "missing {key}");
            assert!(rendered[&key].contains(&format!("schema.model_{i}")));
        }
    }

    #[test]
    fn render_all_models_skips_failures() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("false".into());
        let rendered = runner.render_all_models(&["a.b".to_string()]);
        assert!(rendered.is_empty());
    }

    #[test]
    fn list_gateways_returns_empty_when_no_config() {
        let tmp = tempfile::tempdir().unwrap();
        let runner = SqlMeshCliRunner::new(tmp.path().to_path_buf());
        let gateways = runner.list_gateways().unwrap();
        assert!(gateways.is_empty());
    }

    #[test]
    fn list_gateways_reads_config_yaml() {
        let tmp = tempfile::tempdir().unwrap();
        let cfg = r#"
project: test
gateways:
  dev:
    connection:
      type: duckdb
"#;
        std::fs::write(tmp.path().join("config.yaml"), cfg).unwrap();
        let runner = SqlMeshCliRunner::new(tmp.path().to_path_buf());
        let gateways = runner.list_gateways().unwrap();
        assert_eq!(gateways.len(), 1);
        assert_eq!(gateways[0].name, "dev");
        assert_eq!(gateways[0].connection_type, "duckdb");
    }

    #[test]
    fn yaml_targets_model_matches_exact_name() {
        let yaml = "test_a:\n  model: analytics_shop.stg_orders\n  inputs: {}\n";
        assert!(SqlMeshCliRunner::yaml_targets_model(yaml, "analytics_shop.stg_orders"));
        assert!(!SqlMeshCliRunner::yaml_targets_model(yaml, "analytics_shop.stg_customers"));
    }

    #[test]
    fn yaml_targets_model_handles_quotes() {
        let yaml = "test_a:\n  model: \"analytics_shop.dim_customers\"\n";
        assert!(SqlMeshCliRunner::yaml_targets_model(yaml, "analytics_shop.dim_customers"));
    }

    #[test]
    fn test_files_for_model_finds_matching_files_recursively() {
        let tmp = tempfile::tempdir().unwrap();
        let tests = tmp.path().join("tests");
        std::fs::create_dir_all(tests.join("nested")).unwrap();
        std::fs::write(
            tests.join("test_orders.yaml"),
            "t1:\n  model: analytics_shop.stg_orders\n",
        )
        .unwrap();
        std::fs::write(
            tests.join("nested").join("test_customers.yml"),
            "t2:\n  model: analytics_shop.stg_customers\n",
        )
        .unwrap();
        let runner = SqlMeshCliRunner::new(tmp.path().to_path_buf());

        let orders = runner.test_files_for_model("analytics_shop.stg_orders");
        assert_eq!(orders.len(), 1);
        assert!(orders[0].ends_with("test_orders.yaml"));

        let customers = runner.test_files_for_model("analytics_shop.stg_customers");
        assert_eq!(customers.len(), 1);
        assert!(customers[0].ends_with("test_customers.yml"));

        assert!(runner.test_files_for_model("analytics_shop.unknown").is_empty());
    }

    #[test]
    fn test_model_reports_when_no_tests_exist() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("tests")).unwrap();
        let runner = SqlMeshCliRunner::new(tmp.path().to_path_buf());
        let result = runner.test_model("analytics_shop.stg_orders", &[]).unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("No unit tests found"));
    }

    #[test]
    fn test_model_with_empty_select_runs_all_tests() {
        // Empty selector = whole-project test from the run-bar. `echo` re-emits
        // the args: it must be a bare `test` with no positional file paths.
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.test_model("", &[]).unwrap();
        assert_eq!(result.stdout.trim(), "test");
        assert!(!result.stdout.contains("No unit tests found"));
    }

    #[test]
    fn test_target_runs_single_test_node() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner
            .test_target("/p/tests/test_orders.yaml::test_dim_orders", &[])
            .unwrap();
        assert!(result.stdout.contains("test /p/tests/test_orders.yaml::test_dim_orders"));
    }

    #[test]
    fn test_target_runs_whole_file_without_node() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.test_target("/p/tests/test_orders.yaml", &[]).unwrap();
        assert!(result.stdout.contains("test /p/tests/test_orders.yaml"));
        assert!(!result.stdout.contains("::"));
    }

    // -- Environment tests ----------------------------------------------------

    #[test]
    fn plan_model_inserts_environment_positional() {
        // `echo` re-emits its args, exposing the exact CLI invocation. The target
        // environment must appear as a positional right after `plan`.
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner
            .plan_model("app.orders", Some("dev"), &[])
            .unwrap();
        assert!(result.stdout.contains("plan dev --select-model app.orders"));
    }

    #[test]
    fn plan_model_omits_environment_when_none() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.plan_model("app.orders", None, &[]).unwrap();
        assert!(result.stdout.contains("plan --select-model app.orders"));
        assert!(!result.stdout.contains("plan  --select-model"));
    }

    #[test]
    fn plan_model_treats_empty_environment_as_none() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.plan_model("app.orders", Some(""), &[]).unwrap();
        assert!(result.stdout.contains("plan --select-model app.orders"));
    }

    #[test]
    fn plan_model_omits_select_for_whole_project() {
        // An empty selector is the run-bar's whole-project Plan: `--select-model`
        // must be dropped so sqlmesh plans every model, not nothing.
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.plan_model("", None, &[]).unwrap();
        assert!(result.stdout.contains("plan --auto-apply --no-prompts"));
        assert!(!result.stdout.contains("--select-model"));
    }

    #[test]
    fn promote_environment_builds_plan_against_target() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.promote_environment("prod", &[]).unwrap();
        assert!(result.stdout.contains("plan prod --auto-apply --no-prompts"));
    }

    #[test]
    fn lint_model_targets_model_with_model_flag() {
        // `echo` re-emits the args. lint takes `--model`, not `--select-model`.
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.lint_model("app.orders", &[]).unwrap();
        assert!(result.stdout.contains("lint --model app.orders"));
        assert!(!result.stdout.contains("--select-model"));
    }

    #[test]
    fn lint_model_lints_whole_project_when_empty() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.lint_model("", &[]).unwrap();
        assert_eq!(result.stdout.trim(), "lint");
        assert!(!result.stdout.contains("--model"));
    }

    #[test]
    fn audit_model_targets_model_with_model_flag() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.audit_model("app.orders", &[]).unwrap();
        assert!(result.stdout.contains("audit --model app.orders"));
    }

    #[test]
    fn audit_model_audits_whole_project_when_empty() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("echo".into());
        let result = runner.audit_model("", &[]).unwrap();
        assert_eq!(result.stdout.trim(), "audit");
    }

    #[test]
    fn parse_environments_output_extracts_names_and_expiry() {
        let stdout = "Number of SQLMesh environments are: 2\nprod - No Expiry\ndev - 2026-06-01 12:00:00\n";
        let envs = SqlMeshCliRunner::parse_environments_output(stdout);
        assert_eq!(envs.len(), 2);
        assert_eq!(envs[0].name, "prod");
        assert_eq!(envs[0].expiry, None);
        assert_eq!(envs[1].name, "dev");
        assert_eq!(envs[1].expiry.as_deref(), Some("2026-06-01 12:00:00"));
    }

    #[test]
    fn parse_environments_output_handles_bare_names() {
        let envs = SqlMeshCliRunner::parse_environments_output("prod\ndev\n");
        assert_eq!(envs.len(), 2);
        assert_eq!(envs[0].name, "prod");
        assert!(envs[0].expiry.is_none());
    }

    #[test]
    fn parse_environments_output_empty_when_blank() {
        assert!(SqlMeshCliRunner::parse_environments_output("\n  \n").is_empty());
    }

    #[test]
    fn list_environments_errors_when_cli_fails() {
        let runner = SqlMeshCliRunner::new(PathBuf::from(".")).with_executable("false".into());
        assert!(runner.list_environments().is_err());
    }

    #[test]
    fn list_environments_returns_not_found_for_missing_binary() {
        let runner = SqlMeshCliRunner::new(PathBuf::from("."))
            .with_executable("__nonexistent_sqlmesh__".into());
        let err = runner.list_environments().unwrap_err();
        assert!(matches!(err, SqlMeshCliError::NotFound));
    }
}
