use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;

use super::errors::*;
use super::types::*;

pub(crate) struct DbtCliRunner {
    pub project_root: PathBuf,
    pub dbt_executable: String,
}

impl DbtCliRunner {
    pub fn new(project_root: PathBuf) -> Self {
        Self {
            project_root,
            dbt_executable: "dbt".to_string(),
        }
    }

    pub fn with_executable(mut self, exe: String) -> Self {
        self.dbt_executable = exe;
        self
    }

    pub fn check_cli(&self) -> Result<String, DbtCliError> {
        let output = Command::new(&self.dbt_executable)
            .arg("--version")
            .current_dir(&self.project_root)
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    DbtCliError::NotFound
                } else {
                    DbtCliError::Io(e)
                }
            })?;

        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(Self::extract_version(&raw))
        } else {
            let exit_code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(DbtCliError::CommandFailed { exit_code, stderr })
        }
    }

    pub fn run_command(&self, args: &[&str]) -> Result<DbtCommandResult, DbtCliError> {
        let start = Instant::now();
        let output = Command::new(&self.dbt_executable)
            .args(args)
            .current_dir(&self.project_root)
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    DbtCliError::NotFound
                } else {
                    DbtCliError::Io(e)
                }
            })?;

        let duration_ms = start.elapsed().as_millis() as u64;

        Ok(DbtCommandResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            duration_ms,
        })
    }

    pub fn run_model(
        &self,
        select: &str,
        extra_args: &[String],
    ) -> Result<DbtCommandResult, DbtCliError> {
        self.run_selected("run", select, extra_args)
    }

    pub fn test_model(
        &self,
        select: &str,
        extra_args: &[String],
    ) -> Result<DbtCommandResult, DbtCliError> {
        self.run_selected("test", select, extra_args)
    }

    pub fn build_model(
        &self,
        select: &str,
        extra_args: &[String],
    ) -> Result<DbtCommandResult, DbtCliError> {
        self.run_selected("build", select, extra_args)
    }

    /// Validate the project's profile/connection config via `dbt debug`. Unlike
    /// run/test/build this is project-wide and takes no `--select`.
    pub fn debug(&self, extra_args: &[String]) -> Result<DbtCommandResult, DbtCliError> {
        let mut args = vec!["debug"];
        let extra: Vec<&str> = extra_args.iter().map(|s| s.as_str()).collect();
        args.extend(extra);
        self.run_command(&args)
    }

    // Run a `run`/`test`/`build` subcommand against a selector. An empty selector
    // omits `--select` entirely so dbt operates on the whole project.
    fn run_selected(
        &self,
        subcommand: &str,
        select: &str,
        extra_args: &[String],
    ) -> Result<DbtCommandResult, DbtCliError> {
        let mut args = vec![subcommand];
        if !select.trim().is_empty() {
            args.push("--select");
            args.push(select);
        }
        let extra: Vec<&str> = extra_args.iter().map(|s| s.as_str()).collect();
        args.extend(extra);
        self.run_command(&args)
    }

    pub fn compile_model(
        &self,
        select: &str,
        project_name: &str,
    ) -> Result<DbtCompileResult, DbtCliError> {
        let result = self.run_command(&["compile", "--select", select])?;
        // Prefer the canonical compiled file under target/compiled/, but fall back
        // to parsing the SQL dbt prints to stdout ("Compiled node '<m>' is:") when
        // the file can't be located — newer dbt versions / project-name path
        // divergence otherwise leave a successful compile with no visible SQL.
        let compiled_sql = if result.exit_code == 0 {
            self.find_compiled_sql(project_name, select)
                .ok()
                .or_else(|| Self::parse_compiled_from_stdout(&result.stdout, select))
        } else {
            None
        };
        Ok(DbtCompileResult {
            model_name: select.to_string(),
            compiled_sql,
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: result.exit_code,
        })
    }

    pub fn compile_models(&self, models: &[String]) -> Result<DbtCommandResult, DbtCliError> {
        let select = models.join(" ");
        self.run_command(&["compile", "--select", &select])
    }

    /// Run `dbt docs generate` for the whole project, producing
    /// `target/manifest.json` + `target/catalog.json`.
    pub fn docs_generate(&self, extra_args: &[String]) -> Result<DbtCommandResult, DbtCliError> {
        let mut args = vec!["docs", "generate"];
        let extra: Vec<&str> = extra_args.iter().map(|s| s.as_str()).collect();
        args.extend(extra);
        self.run_command(&args)
    }

    pub fn find_all_compiled_sql(
        &self,
        project_name: &str,
        model_names: &[String],
    ) -> std::collections::HashMap<String, String> {
        let compiled_dir = self
            .project_root
            .join("target")
            .join("compiled")
            .join(project_name)
            .join("models");

        let mut result = std::collections::HashMap::new();
        let targets: std::collections::HashSet<String> = model_names
            .iter()
            .map(|name| format!("{}.sql", name))
            .collect();

        for entry in Self::walkdir(&compiled_dir) {
            if let Ok(e) = entry {
                let path = e.path();
                if path.is_file() {
                    if let Some(fname) = path.file_name().and_then(|f| f.to_str()) {
                        if targets.contains(fname) {
                            if let Ok(sql) = std::fs::read_to_string(&path) {
                                let model_name = fname.strip_suffix(".sql").unwrap_or(fname);
                                result.insert(model_name.to_string(), sql);
                            }
                        }
                    }
                }
            }
        }
        result
    }

    pub fn list_profiles(&self) -> Result<Vec<DbtProfileInfo>, DbtCliError> {
        let local_profiles = self.project_root.join("profiles.yml");
        let home_profiles = dirs::home_dir().map(|h| h.join(".dbt").join("profiles.yml"));

        let profiles_path = if local_profiles.exists() {
            local_profiles
        } else if let Some(ref hp) = home_profiles {
            if hp.exists() {
                hp.clone()
            } else {
                return Ok(Vec::new());
            }
        } else {
            return Ok(Vec::new());
        };

        let text = std::fs::read_to_string(&profiles_path)?;
        Self::parse_profiles_yaml(&text)
    }

    pub(crate) fn parse_profiles_yaml(
        text: &str,
    ) -> Result<Vec<DbtProfileInfo>, DbtCliError> {
        let root: serde_yml::Value = serde_yml::from_str(text).map_err(|e| {
            DbtCliError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                e.to_string(),
            ))
        })?;

        let mapping = match root.as_mapping() {
            Some(m) => m,
            None => return Ok(Vec::new()),
        };

        let mut profiles = Vec::new();
        for (key, value) in mapping {
            let name = match key.as_str() {
                Some(s) => s,
                None => continue,
            };
            if name == "config" {
                continue;
            }
            let obj = match value.as_mapping() {
                Some(m) => m,
                None => continue,
            };
            let default_target = obj
                .get(&serde_yml::Value::String("target".into()))
                .and_then(|v| v.as_str())
                .unwrap_or("dev")
                .to_string();
            let targets: Vec<String> = obj
                .get(&serde_yml::Value::String("outputs".into()))
                .and_then(|v| v.as_mapping())
                .map(|m| {
                    m.keys()
                        .filter_map(|k| k.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            profiles.push(DbtProfileInfo {
                name: name.to_string(),
                default_target,
                targets,
            });
        }
        Ok(profiles)
    }
}

impl DbtCliRunner {
    fn walkdir(dir: &std::path::Path) -> Vec<Result<std::fs::DirEntry, std::io::Error>> {
        let mut entries = Vec::new();
        let read = match std::fs::read_dir(dir) {
            Ok(r) => r,
            Err(e) => {
                entries.push(Err(e));
                return entries;
            }
        };
        for entry in read {
            match entry {
                Ok(e) => {
                    let path = e.path();
                    entries.push(Ok(e));
                    if path.is_dir() {
                        entries.extend(Self::walkdir(&path));
                    }
                }
                Err(e) => entries.push(Err(e)),
            }
        }
        entries
    }

    fn find_compiled_sql(
        &self,
        project_name: &str,
        model_name: &str,
    ) -> Result<String, DbtCliError> {
        let compiled_dir = self
            .project_root
            .join("target")
            .join("compiled")
            .join(project_name)
            .join("models");

        let target_filename = format!("{}.sql", model_name);

        for entry in Self::walkdir(&compiled_dir) {
            if let Ok(e) = entry {
                let path = e.path();
                if path.is_file() {
                    if let Some(fname) = path.file_name() {
                        if fname == target_filename.as_str() {
                            return std::fs::read_to_string(&path).map_err(DbtCliError::Io);
                        }
                    }
                }
            }
        }

        Err(DbtCliError::CompiledNotFound)
    }

    /// Extract the compiled SQL dbt prints to stdout. dbt emits a single
    /// selected node as `Compiled node '<model>' is:` followed by a blank line
    /// and the SQL body. Returns `None` when the marker is absent.
    fn parse_compiled_from_stdout(stdout: &str, model_name: &str) -> Option<String> {
        let needle = format!("Compiled node '{}' is:", model_name);
        let lines: Vec<&str> = stdout.lines().collect();
        let marker = lines.iter().position(|l| l.contains(&needle))?;
        let body = lines[marker + 1..].join("\n");
        let trimmed = body.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }

    fn extract_version(raw: &str) -> String {
        for line in raw.lines() {
            let trimmed = line.trim().trim_start_matches('-').trim();
            if let Some(rest) = trimmed.strip_prefix("installed:") {
                let ver = rest.trim();
                if !ver.is_empty() {
                    return ver.to_string();
                }
            }
        }
        for line in raw.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("dbt, version") {
                let ver = rest.trim();
                if !ver.is_empty() {
                    return ver.to_string();
                }
            }
        }
        for word in raw.split_whitespace() {
            if word.chars().next().map_or(false, |c| c.is_ascii_digit()) && word.contains('.') {
                return word.to_string();
            }
        }
        raw.lines().next().unwrap_or(raw).trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn check_cli_returns_not_found_for_bogus_exe() {
        let runner = DbtCliRunner::new(temp_dir())
            .with_executable("dbt_does_not_exist_xyz_bogus".to_string());
        let result = runner.check_cli();
        assert!(matches!(result, Err(DbtCliError::NotFound)));
    }

    #[test]
    fn run_command_captures_stdout_and_exit_code() {
        let runner = DbtCliRunner::new(temp_dir()).with_executable("echo".to_string());
        let result = runner
            .run_command(&["hello_dbt"])
            .expect("run_command failed");
        assert_eq!(result.exit_code, 0);
        assert!(
            result.stdout.contains("hello_dbt"),
            "stdout was: {}",
            result.stdout
        );
    }

    #[test]
    fn run_command_captures_nonzero_exit() {
        let runner = DbtCliRunner::new(temp_dir()).with_executable("false".to_string());
        let result = runner.run_command(&[]).expect("run_command failed");
        assert_ne!(result.exit_code, 0);
    }

    #[test]
    fn find_compiled_sql_reads_from_target() {
        let dir = tempfile::tempdir().expect("tempdir");
        let compiled_path = dir
            .path()
            .join("target")
            .join("compiled")
            .join("my_proj")
            .join("models");
        std::fs::create_dir_all(&compiled_path).expect("create dirs");
        std::fs::write(compiled_path.join("orders.sql"), "SELECT 1").expect("write sql");

        let runner = DbtCliRunner::new(dir.path().to_path_buf());
        let sql = runner
            .find_compiled_sql("my_proj", "orders")
            .expect("find sql");
        assert_eq!(sql, "SELECT 1");
    }

    #[test]
    fn find_compiled_sql_errors_when_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = DbtCliRunner::new(dir.path().to_path_buf());
        let result = runner.find_compiled_sql("my_proj", "orders");
        assert!(matches!(result, Err(DbtCliError::CompiledNotFound)));
    }

    #[test]
    fn list_profiles_returns_ok_when_no_local_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = DbtCliRunner::new(dir.path().to_path_buf());
        let _profiles = runner
            .list_profiles()
            .expect("list_profiles should not error");
    }

    #[test]
    fn list_profiles_reads_local_profiles_yml() {
        let dir = tempfile::tempdir().expect("tempdir");
        let yaml = r#"
shop:
  target: staging
  outputs:
    staging:
      type: postgres
    production:
      type: postgres
"#;
        std::fs::write(dir.path().join("profiles.yml"), yaml).expect("write");
        let runner = DbtCliRunner::new(dir.path().to_path_buf());
        let profiles = runner.list_profiles().expect("list_profiles");
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "shop");
        assert_eq!(profiles[0].default_target, "staging");
        assert_eq!(profiles[0].targets.len(), 2);
    }

    #[test]
    fn compile_model_returns_stdout_on_nonzero_exit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let script = dir.path().join("fake_dbt");
        std::fs::write(
            &script,
            "#!/bin/sh\necho 'Database Error'\necho '  connection refused' >&2\nexit 2\n",
        )
        .expect("write script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
                .expect("chmod");
        }
        let runner = DbtCliRunner::new(dir.path().to_path_buf())
            .with_executable(script.to_string_lossy().to_string());
        let result = runner
            .compile_model("orders", "my_proj")
            .expect("should return Ok");
        assert_eq!(result.exit_code, 2);
        assert!(result.compiled_sql.is_none());
        assert!(result.stdout.contains("Database Error"));
        assert!(result.stderr.contains("connection refused"));
    }

    #[test]
    fn parse_compiled_from_stdout_extracts_sql_after_marker() {
        let stdout = "07:08:53  Running with dbt=1.11\nCompiled node 'dim_customers' is:\n\nWITH x AS (\n  SELECT 1\n)\nSELECT * FROM x";
        let sql = DbtCliRunner::parse_compiled_from_stdout(stdout, "dim_customers")
            .expect("should extract sql");
        assert_eq!(sql, "WITH x AS (\n  SELECT 1\n)\nSELECT * FROM x");
    }

    #[test]
    fn parse_compiled_from_stdout_none_when_marker_absent() {
        let stdout = "07:08:53  Running with dbt=1.11\nNothing compiled here";
        assert!(DbtCliRunner::parse_compiled_from_stdout(stdout, "orders").is_none());
    }

    #[test]
    fn compile_model_falls_back_to_stdout_when_target_file_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let script = dir.path().join("fake_dbt");
        std::fs::write(
            &script,
            "#!/bin/sh\nprintf \"Running with dbt=1.11\\nCompiled node 'orders' is:\\n\\nSELECT 1 AS id\\n\"\nexit 0\n",
        )
        .expect("write script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
                .expect("chmod");
        }
        let runner = DbtCliRunner::new(dir.path().to_path_buf())
            .with_executable(script.to_string_lossy().to_string());
        // No target/compiled file exists, so the SQL must come from stdout.
        let result = runner.compile_model("orders", "my_proj").expect("should return Ok");
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.compiled_sql.as_deref(), Some("SELECT 1 AS id"));
    }

    #[test]
    fn extract_version_modern_format() {
        let raw = "Core:\n  - installed: 1.9.4\n  - latest:    1.9.4 - Up to date!\n\nPlugins:\n  - postgres: 1.9.0\n\nhttps://docs.getdbt.com/docs/installation";
        assert_eq!(DbtCliRunner::extract_version(raw), "1.9.4");
    }

    #[test]
    fn extract_version_legacy_format() {
        let raw = "dbt, version 1.0.0";
        assert_eq!(DbtCliRunner::extract_version(raw), "1.0.0");
    }

    #[test]
    fn extract_version_semver_fallback() {
        let raw = "some tool 2.3.1";
        assert_eq!(DbtCliRunner::extract_version(raw), "2.3.1");
    }

    #[test]
    fn extract_version_first_line_fallback() {
        let raw = "unknown output";
        assert_eq!(DbtCliRunner::extract_version(raw), "unknown output");
    }

    #[test]
    fn docs_generate_builds_docs_generate_args() {
        let runner = DbtCliRunner::new(temp_dir()).with_executable("echo".to_string());
        let result = runner.docs_generate(&[]).expect("docs_generate failed");
        assert_eq!(result.exit_code, 0);
        assert!(
            result.stdout.contains("docs generate"),
            "stdout was: {}",
            result.stdout
        );
    }

    #[test]
    fn docs_generate_appends_extra_args() {
        let runner = DbtCliRunner::new(temp_dir()).with_executable("echo".to_string());
        let result = runner
            .docs_generate(&["--no-compile".to_string()])
            .expect("docs_generate failed");
        assert!(
            result.stdout.contains("docs generate --no-compile"),
            "stdout was: {}",
            result.stdout
        );
    }

    #[test]
    fn run_model_with_selector_adds_select_flag() {
        let runner = DbtCliRunner::new(temp_dir()).with_executable("echo".to_string());
        let result = runner.run_model("stg_orders", &[]).expect("run_model failed");
        assert!(
            result.stdout.contains("run --select stg_orders"),
            "stdout was: {}",
            result.stdout
        );
    }

    #[test]
    fn run_model_with_empty_selector_omits_select_flag() {
        let runner = DbtCliRunner::new(temp_dir()).with_executable("echo".to_string());
        let result = runner.run_model("", &[]).expect("run_model failed");
        assert!(result.stdout.contains("run"), "stdout was: {}", result.stdout);
        assert!(
            !result.stdout.contains("--select"),
            "stdout was: {}",
            result.stdout
        );
    }

    #[test]
    fn build_model_with_blank_selector_omits_select_flag() {
        let runner = DbtCliRunner::new(temp_dir()).with_executable("echo".to_string());
        let result = runner.build_model("   ", &[]).expect("build_model failed");
        assert!(
            !result.stdout.contains("--select"),
            "stdout was: {}",
            result.stdout
        );
    }

    #[test]
    fn debug_builds_debug_subcommand_without_select() {
        let runner = DbtCliRunner::new(temp_dir()).with_executable("echo".to_string());
        let result = runner.debug(&[]).expect("debug failed");
        assert!(result.stdout.contains("debug"), "stdout was: {}", result.stdout);
        assert!(
            !result.stdout.contains("--select"),
            "stdout was: {}",
            result.stdout
        );
    }

    #[test]
    fn debug_appends_extra_args() {
        let runner = DbtCliRunner::new(temp_dir()).with_executable("echo".to_string());
        let result = runner
            .debug(&["--config-dir".to_string()])
            .expect("debug failed");
        assert!(
            result.stdout.contains("debug --config-dir"),
            "stdout was: {}",
            result.stdout
        );
    }

    #[test]
    fn find_all_compiled_sql_returns_matching_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let compiled_path = dir
            .path()
            .join("target")
            .join("compiled")
            .join("my_proj")
            .join("models");
        std::fs::create_dir_all(&compiled_path).expect("create dirs");
        std::fs::write(compiled_path.join("users.sql"), "SELECT id, name FROM raw_users")
            .expect("write");
        std::fs::write(compiled_path.join("orders.sql"), "SELECT * FROM raw_orders")
            .expect("write");

        let runner = DbtCliRunner::new(dir.path().to_path_buf());
        let models = vec!["users".to_string(), "orders".to_string()];
        let result = runner.find_all_compiled_sql("my_proj", &models);
        assert_eq!(result.len(), 2);
        assert_eq!(result["users"], "SELECT id, name FROM raw_users");
        assert_eq!(result["orders"], "SELECT * FROM raw_orders");
    }

    #[test]
    fn find_all_compiled_sql_returns_empty_for_no_matches() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = DbtCliRunner::new(dir.path().to_path_buf());
        let models = vec!["nonexistent".to_string()];
        let result = runner.find_all_compiled_sql("my_proj", &models);
        assert!(result.is_empty());
    }

    #[test]
    fn find_all_compiled_sql_handles_nested_directories() {
        let dir = tempfile::tempdir().expect("tempdir");
        let staging = dir
            .path()
            .join("target")
            .join("compiled")
            .join("proj")
            .join("models")
            .join("staging");
        std::fs::create_dir_all(&staging).expect("create dirs");
        std::fs::write(staging.join("stg_users.sql"), "SELECT 1").expect("write");

        let runner = DbtCliRunner::new(dir.path().to_path_buf());
        let models = vec!["stg_users".to_string()];
        let result = runner.find_all_compiled_sql("proj", &models);
        assert_eq!(result.len(), 1);
        assert_eq!(result["stg_users"], "SELECT 1");
    }
}
