use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use crate::Engine;
use super::constants::*;
use super::impl_sqlmesh_cli_runner::SqlMeshCliRunner;
use super::*;

pub struct SqlMeshEngine;

impl SqlMeshEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn parse_config_yaml(&self, text: &str) -> Result<SqlMeshConfig, SqlMeshError> {
        Self::parse_config_yaml_inner(text)
    }

    pub fn parse_model_block(&self, sql: &str) -> Option<SqlMeshModel> {
        Self::parse_model_block_inner(sql)
    }

    pub fn scan_project(&self, root: &Path) -> Result<ScannedSqlMeshProject, SqlMeshError> {
        let cfg = root.join("config.yaml");
        let cfg_alt = root.join("config.yml");
        let cfg_path = if cfg.exists() {
            cfg
        } else if cfg_alt.exists() {
            cfg_alt
        } else {
            return Err(SqlMeshError::ConfigMissing(cfg));
        };
        let cfg_text = fs::read_to_string(&cfg_path)?;
        Self::parse_config_yaml_inner(&cfg_text)?;
        // A `config.yaml` that merely parses as YAML is not enough — any generic
        // app config would pass. Require at least one SQLMesh-distinctive key so a
        // plain project (e.g. a Python tool's `config.yaml`) is not mistaken for a
        // SQLMesh project and surfaced as the SQLMesh tab.
        if !Self::config_has_sqlmesh_markers(&cfg_text) {
            return Err(SqlMeshError::NotSqlMeshProject(cfg_path));
        }

        let mut models = Vec::new();
        let dir = root.join("models");
        if dir.exists() {
            Self::scan_dir(&dir, &mut models)?;
        }
        models.sort_by(|a, b| a.name.cmp(&b.name));

        let mut tests = Vec::new();
        let tests_dir = root.join("tests");
        if tests_dir.exists() {
            Self::scan_tests_dir(&tests_dir, &mut tests);
        }
        tests.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(ScannedSqlMeshProject {
            root_path: root.display().to_string(),
            models,
            tests,
        })
    }

    pub fn parse_gateways_yaml(
        &self,
        text: &str,
    ) -> Result<Vec<SqlMeshGatewayInfo>, SqlMeshCliError> {
        SqlMeshCliRunner::parse_gateways_yaml(text)
    }

    pub fn check_cli(
        &self,
        root: PathBuf,
        binary: Option<String>,
    ) -> Result<String, SqlMeshCliError> {
        Self::make_runner(root, binary).check_cli()
    }

    pub fn plan_model(
        &self,
        root: PathBuf,
        select: String,
        environment: Option<String>,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        Self::make_runner(root, binary).plan_model(&select, environment.as_deref(), &args)
    }

    pub fn promote_environment(
        &self,
        root: PathBuf,
        target: String,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        Self::make_runner(root, binary).promote_environment(&target, &args)
    }

    pub fn test_model(
        &self,
        root: PathBuf,
        select: String,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        Self::make_runner(root, binary).test_model(&select, &args)
    }

    pub fn test_target(
        &self,
        root: PathBuf,
        target: String,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        Self::make_runner(root, binary).test_target(&target, &args)
    }

    pub fn run_models(
        &self,
        root: PathBuf,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        Self::make_runner(root, binary).run_models(&args)
    }

    pub fn lint_model(
        &self,
        root: PathBuf,
        select: String,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        Self::make_runner(root, binary).lint_model(&select, &args)
    }

    pub fn audit_model(
        &self,
        root: PathBuf,
        select: String,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<SqlMeshCommandResult, SqlMeshCliError> {
        Self::make_runner(root, binary).audit_model(&select, &args)
    }

    pub fn render_model(
        &self,
        root: PathBuf,
        model_name: String,
        binary: Option<String>,
    ) -> Result<SqlMeshRenderResult, SqlMeshCliError> {
        Self::make_runner(root, binary).render_model(&model_name)
    }

    pub fn list_gateways(
        &self,
        root: PathBuf,
    ) -> Result<Vec<SqlMeshGatewayInfo>, SqlMeshCliError> {
        Self::make_runner(root, None).list_gateways()
    }

    pub fn list_environments(
        &self,
        root: PathBuf,
        binary: Option<String>,
    ) -> Result<Vec<SqlMeshEnvironmentInfo>, SqlMeshCliError> {
        Self::make_runner(root, binary).list_environments()
    }

    /// Compute column-level lineage for the given models. Renders each model via
    /// the SQLmesh CLI, parses the rendered SQL, and resolves column references
    /// against the scanned model dependencies. SQLmesh has no dbt-style `source`
    /// nodes, so every scanned model's known columns seed the resolver — this lets
    /// wildcard (`SELECT *`) and bare-identifier references resolve to upstream
    /// models. Rendering is best-effort; models that fail to render are skipped.
    pub fn column_lineage(
        &self,
        root: PathBuf,
        model_names: Vec<String>,
        binary: Option<String>,
        models: &[ScannedSqlMeshModel],
    ) -> ColumnLineageGraph {
        let runner = Self::make_runner(root, binary);
        let rendered = runner.render_all_models(&model_names);

        let model_deps: Vec<(String, Vec<String>)> = models
            .iter()
            .filter(|m| model_names.contains(&m.name))
            .map(|m| (m.name.clone(), m.depends_on.clone()))
            .collect();

        let source_columns: std::collections::HashMap<String, Vec<String>> = models
            .iter()
            .map(|m| {
                (
                    m.name.clone(),
                    m.columns.iter().map(|c| c.name.clone()).collect(),
                )
            })
            .collect();

        let mut extractor = crate::dbt::ColumnLineageExtractor::new();
        extractor.extract(&rendered, &model_deps, &source_columns)
    }
}

impl SqlMeshEngine {
    fn make_runner(root: PathBuf, binary: Option<String>) -> SqlMeshCliRunner {
        let runner = SqlMeshCliRunner::new(root);
        match binary {
            Some(bin) if !bin.is_empty() => runner.with_executable(Self::expand_tilde(&bin)),
            _ => runner,
        }
    }

    fn expand_tilde(path: &str) -> String {
        if let Some(rest) = path.strip_prefix("~/") {
            if let Some(home) = dirs::home_dir() {
                return home.join(rest).to_string_lossy().into_owned();
            }
        }
        path.to_string()
    }

    fn parse_config_yaml_inner(text: &str) -> Result<SqlMeshConfig, SqlMeshError> {
        // SQLMesh does not require a top-level `project` field — `gateways` +
        // `model_defaults.dialect` are the essentials, and `sqlmesh init` emits
        // configs without `project`. So we only require the YAML to parse; an
        // absent `project` is fine (the pane labels projects by directory name).
        let cfg: SqlMeshConfig = serde_yml::from_str(text.trim())?;
        Ok(cfg)
    }

    /// True when the config's top-level mapping declares at least one
    /// SQLMesh-distinctive key (see `SQLMESH_CONFIG_MARKER_KEYS`). Non-mapping or
    /// unparseable YAML is treated as not-a-SQLMesh-config.
    fn config_has_sqlmesh_markers(text: &str) -> bool {
        let Ok(value) = serde_yml::from_str::<serde_yml::Value>(text.trim()) else {
            return false;
        };
        let Some(map) = value.as_mapping() else {
            return false;
        };
        SQLMESH_CONFIG_MARKER_KEYS
            .iter()
            .any(|key| map.contains_key(serde_yml::Value::from(*key)))
    }

    fn parse_model_block_inner(sql: &str) -> Option<SqlMeshModel> {
        let upper = sql.to_uppercase();
        let model_idx = upper.find("MODEL (").or_else(|| upper.find("MODEL("))?;
        let after = &sql[model_idx..];
        let lparen = after.find('(')?;
        let mut depth = 1i32;
        let mut end = lparen + 1;
        let bytes = after.as_bytes();
        while end < bytes.len() && depth > 0 {
            match bytes[end] as char {
                '(' => depth += 1,
                ')' => depth -= 1,
                _ => {}
            }
            end += 1;
        }
        let body = &after[lparen + 1..end - 1];

        let mut model = SqlMeshModel {
            raw_sql: sql.to_owned(),
            ..SqlMeshModel::default()
        };

        for line in body.split(',') {
            let line = line.trim();
            if let Some(name) = line.strip_prefix("name").map(|s| {
                s.trim_start_matches([' ', '=', ':'])
                    .trim_matches(['\'', '"'])
            }) {
                if !name.is_empty() && model.name.is_empty() {
                    model.name = name.trim().to_owned();
                }
            } else if let Some(kind) = line.strip_prefix("kind") {
                model.kind = kind
                    .trim_start_matches([' ', '=', ':'])
                    .trim()
                    .trim_matches(['\'', '"'])
                    .to_owned();
            }
        }

        let post = &sql[model_idx + end..];
        let mut tokens = post.split_whitespace().peekable();
        while let Some(t) = tokens.next() {
            let upper = t.to_uppercase();
            if upper == "FROM" || upper == "JOIN" {
                if let Some(next) = tokens.next() {
                    let cleaned = next.trim_end_matches([',', ';']).to_owned();
                    model.depends_on.push(cleaned);
                }
            }
        }

        Some(model)
    }

    fn extract_model_columns(sql: &str) -> Vec<SqlMeshColumnDoc> {
        let upper = sql.to_uppercase();
        let model_idx = match upper.find("MODEL (").or_else(|| upper.find("MODEL(")) {
            Some(i) => i,
            None => return Vec::new(),
        };
        let after = &sql[model_idx..];
        let lparen = match after.find('(') {
            Some(i) => i,
            None => return Vec::new(),
        };
        let mut depth = 1i32;
        let mut end = lparen + 1;
        let bytes = after.as_bytes();
        while end < bytes.len() && depth > 0 {
            match bytes[end] as char {
                '(' => depth += 1,
                ')' => depth -= 1,
                _ => {}
            }
            end += 1;
        }
        let body = &after[lparen + 1..end - 1];

        let body_upper = body.to_uppercase();
        let col_idx = match body_upper.find("COLUMNS (").or_else(|| body_upper.find("COLUMNS(")) {
            Some(i) => i,
            None => return Vec::new(),
        };
        let col_after = &body[col_idx..];
        let col_lparen = match col_after.find('(') {
            Some(i) => i,
            None => return Vec::new(),
        };
        let mut col_depth = 1i32;
        let mut col_end = col_lparen + 1;
        let col_bytes = col_after.as_bytes();
        while col_end < col_bytes.len() && col_depth > 0 {
            match col_bytes[col_end] as char {
                '(' => col_depth += 1,
                ')' => col_depth -= 1,
                _ => {}
            }
            col_end += 1;
        }
        let cols_body = &col_after[col_lparen + 1..col_end - 1];

        let mut columns = Vec::new();
        for part in cols_body.split(',') {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                continue;
            }
            let mut tokens = trimmed.split_whitespace();
            if let Some(name) = tokens.next() {
                columns.push(SqlMeshColumnDoc {
                    name: name.to_owned(),
                    description: None,
                    r#type: tokens.next().map(|t| t.to_owned()),
                });
            }
        }
        columns
    }

    fn extract_select_columns(sql: &str) -> Vec<SqlMeshColumnDoc> {
        let upper = sql.to_uppercase();
        let model_end = match upper.find("MODEL") {
            Some(i) => {
                let after = &sql[i..];
                let lparen = match after.find('(') {
                    Some(p) => p,
                    None => return Vec::new(),
                };
                let mut depth = 1i32;
                let mut end = lparen + 1;
                let bytes = after.as_bytes();
                while end < bytes.len() && depth > 0 {
                    match bytes[end] as char {
                        '(' => depth += 1,
                        ')' => depth -= 1,
                        _ => {}
                    }
                    end += 1;
                }
                i + end
            }
            None => 0,
        };

        let post = &sql[model_end..];
        let post_upper = post.to_uppercase();
        let select_idx = match post_upper.find("SELECT") {
            Some(i) => i,
            None => return Vec::new(),
        };
        let after_select = &post_upper[select_idx + 6..];
        let from_offset = match after_select.find("\nFROM ").or_else(|| after_select.find("\nFROM\n")) {
            Some(i) => i,
            None => match after_select.find(" FROM ") {
                Some(i) => i,
                None => return Vec::new(),
            },
        };
        let select_body = post[select_idx + 6..select_idx + 6 + from_offset].trim();

        let mut parts = Vec::new();
        let mut depth = 0i32;
        let mut start = 0;
        for (i, ch) in select_body.char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => depth -= 1,
                ',' if depth == 0 => {
                    parts.push(&select_body[start..i]);
                    start = i + 1;
                }
                _ => {}
            }
        }
        parts.push(&select_body[start..]);

        let mut columns = Vec::new();
        for part in parts {
            let trimmed = part.trim();
            if trimmed.is_empty() || trimmed == "*" {
                continue;
            }
            let upper_part = trimmed.to_uppercase();
            if let Some(as_idx) = upper_part.rfind(" AS ") {
                let alias = trimmed[as_idx + 4..].trim();
                if !alias.is_empty() {
                    columns.push(SqlMeshColumnDoc {
                        name: alias.to_owned(),
                        description: None,
                        r#type: None,
                    });
                    continue;
                }
            }
            if let Some(dot_idx) = trimmed.rfind('.') {
                let col = &trimmed[dot_idx + 1..];
                if !col.is_empty() && col.chars().all(|c| c.is_alphanumeric() || c == '_') {
                    columns.push(SqlMeshColumnDoc {
                        name: col.to_owned(),
                        description: None,
                        r#type: None,
                    });
                    continue;
                }
            }
            if trimmed.chars().all(|c| c.is_alphanumeric() || c == '_') {
                columns.push(SqlMeshColumnDoc {
                    name: trimmed.to_owned(),
                    description: None,
                    r#type: None,
                });
            }
        }
        columns
    }

    fn scan_dir(dir: &Path, models: &mut Vec<ScannedSqlMeshModel>) -> io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let ft = entry.file_type()?;
            if ft.is_dir() {
                Self::scan_dir(&path, models)?;
            } else if ft.is_file() {
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let body = match fs::read_to_string(&path) {
                    Ok(b) => b,
                    Err(_) => continue,
                };
                let scanned = match ext.as_str() {
                    "sql" => Self::scan_sql_model(&body, &path),
                    "py" => Self::scan_python_model(&body, &path),
                    _ => continue,
                };
                if let Some(model) = scanned {
                    models.push(model);
                }
            }
        }
        Ok(())
    }

    fn scan_sql_model(body: &str, path: &Path) -> Option<ScannedSqlMeshModel> {
        let parsed = Self::parse_model_block_inner(body)?;
        let mut columns = Self::extract_model_columns(body);
        if columns.is_empty() {
            columns = Self::extract_select_columns(body);
        }
        Some(ScannedSqlMeshModel {
            name: parsed.name,
            kind: Self::map_model_kind(&parsed.kind),
            file_path: path.display().to_string(),
            cron: None,
            owner: None,
            description: None,
            depends_on: parsed.depends_on,
            columns,
        })
    }

    fn scan_python_model(body: &str, path: &Path) -> Option<ScannedSqlMeshModel> {
        let (name, _raw_kind) = Self::parse_python_model_decorator(body)?;
        if name.is_empty() {
            return None;
        }
        Some(ScannedSqlMeshModel {
            name,
            // Python models have no renderable SQL, so tag them with a dedicated
            // `python` kind (rather than their declared materialization kind) so
            // the UI can group them and disable render-only actions like Preview.
            kind: "python".to_string(),
            file_path: path.display().to_string(),
            cron: None,
            owner: None,
            description: None,
            depends_on: Vec::new(),
            columns: Vec::new(),
        })
    }

    fn map_model_kind(raw: &str) -> String {
        match raw.to_uppercase().as_str() {
            k if k.contains("INCREMENTAL") => "incremental",
            k if k.contains("SCD") => "scd",
            k if k.contains("VIEW") => "view",
            k if k.contains("EXTERNAL") => "external",
            k if k.contains("SEED") => "seed",
            k if k.contains("FULL") => "full",
            _ => "full",
        }
        .to_owned()
    }

    /// Parse the `@model("name", kind=..., ...)` decorator from a Python model
    /// file, returning the positional name and the raw `kind` keyword value.
    fn parse_python_model_decorator(src: &str) -> Option<(String, String)> {
        let at = src.find("@model")?;
        let after = &src[at..];
        let lparen = after.find('(')?;
        let bytes = after.as_bytes();
        let mut depth = 1i32;
        let mut end = lparen + 1;
        while end < bytes.len() && depth > 0 {
            match bytes[end] as char {
                '(' => depth += 1,
                ')' => depth -= 1,
                _ => {}
            }
            end += 1;
        }
        let inner = &after[lparen + 1..end - 1];
        let name = Self::first_string_literal(inner).unwrap_or_default();
        let kind = Self::python_kwarg_value(inner, "kind").unwrap_or_default();
        Some((name, kind))
    }

    fn first_string_literal(s: &str) -> Option<String> {
        let bytes = s.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            let c = bytes[i] as char;
            if c == '"' || c == '\'' {
                let start = i + 1;
                let mut j = start;
                while j < bytes.len() && bytes[j] as char != c {
                    j += 1;
                }
                return Some(s[start..j].to_owned());
            }
            i += 1;
        }
        None
    }

    /// Extract the value of a `key=...` keyword argument from a Python call's
    /// argument body. Returns the value with surrounding quotes stripped.
    fn python_kwarg_value(s: &str, key: &str) -> Option<String> {
        let upper = s.to_uppercase();
        let key_upper = key.to_uppercase();
        let mut search = 0;
        while let Some(rel) = upper[search..].find(&key_upper) {
            let idx = search + rel;
            let prev_ok = idx == 0 || {
                let prev = s.as_bytes()[idx - 1] as char;
                !prev.is_ascii_alphanumeric() && prev != '_'
            };
            let rest = s[idx + key.len()..].trim_start();
            if prev_ok && rest.starts_with('=') {
                let val = rest[1..].trim_start();
                let bytes = val.as_bytes();
                let mut depth = 0i32;
                let mut end = 0;
                while end < bytes.len() {
                    match bytes[end] as char {
                        '(' | '[' | '{' => depth += 1,
                        ')' | ']' | '}' => depth -= 1,
                        ',' if depth == 0 => break,
                        _ => {}
                    }
                    end += 1;
                }
                return Some(val[..end].trim().trim_matches(['\'', '"']).to_owned());
            }
            search = idx + key.len();
        }
        None
    }

    fn scan_tests_dir(dir: &Path, out: &mut Vec<ScannedSqlMeshTest>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                Self::scan_tests_dir(&path, out);
                continue;
            }
            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
            if ext != "yaml" && ext != "yml" {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                Self::parse_test_file(&content, &path.display().to_string(), out);
            }
        }
    }

    fn parse_test_file(content: &str, file_path: &str, out: &mut Vec<ScannedSqlMeshTest>) {
        let Ok(doc) = serde_yml::from_str::<serde_yml::Value>(content) else {
            return;
        };
        let Some(map) = doc.as_mapping() else {
            return;
        };
        for (key, value) in map {
            let Some(name) = key.as_str() else {
                continue;
            };
            let model = value
                .get("model")
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .to_string();
            out.push(ScannedSqlMeshTest {
                name: name.to_string(),
                model,
                file_path: file_path.to_string(),
            });
        }
    }
}

impl Engine for SqlMeshEngine {
    fn name(&self) -> &str {
        "sqlmesh"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn engine() -> SqlMeshEngine {
        SqlMeshEngine::new()
    }

    #[test]
    fn parses_config_yaml() {
        let e = engine();
        let cfg = e
            .parse_config_yaml("project: warehouse\ndefault_gateway: prod")
            .unwrap();
        assert_eq!(cfg.project, "warehouse");
        assert_eq!(cfg.default_gateway, "prod");
    }

    #[test]
    fn parses_config_yaml_without_project_field() {
        // The scaffolded config (gateways + default_gateway + model_defaults)
        // has no top-level `project` — SQLMesh does not require one, so parsing
        // must succeed rather than error.
        let e = engine();
        let cfg = e
            .parse_config_yaml(
                "gateways:\n  local:\n    connection:\n      type: duckdb\ndefault_gateway: local\nmodel_defaults:\n  dialect: duckdb",
            )
            .unwrap();
        assert!(cfg.project.is_empty());
        assert_eq!(cfg.default_gateway, "local");
    }

    #[test]
    fn parses_model_name_and_kind() {
        let e = engine();
        let sql = "MODEL (\n  name app.users,\n  kind FULL\n);\n\nSELECT * FROM raw.users";
        let m = e.parse_model_block(sql).unwrap();
        assert_eq!(m.name, "app.users");
        assert_eq!(m.kind, "FULL");
        assert_eq!(m.depends_on, vec!["raw.users".to_string()]);
    }

    #[test]
    fn parses_join_dependency() {
        let e = engine();
        let sql = "MODEL (name x);\nSELECT * FROM a JOIN b ON 1=1";
        let m = e.parse_model_block(sql).unwrap();
        assert_eq!(m.depends_on, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn returns_none_when_no_model_block() {
        let e = engine();
        assert!(e.parse_model_block("SELECT 1").is_none());
    }

    fn write_file(p: &std::path::Path, content: &str) {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, content).unwrap();
    }

    #[test]
    fn scan_project_returns_error_when_config_missing() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let err = e.scan_project(tmp.path()).unwrap_err();
        assert!(matches!(err, SqlMeshError::ConfigMissing(_)));
    }

    #[test]
    fn scan_project_picks_up_model_files() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("config.yaml"),
            "project: warehouse\ndefault_gateway: prod\n",
        );
        write_file(
            &tmp.path().join("models").join("orders.sql"),
            "MODEL (name app.orders, kind INCREMENTAL_BY_TIME_RANGE);\nSELECT * FROM raw.events",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        assert_eq!(p.models.len(), 1);
        assert_eq!(p.models[0].name, "app.orders");
        assert_eq!(p.models[0].kind, "incremental");
        assert_eq!(p.models[0].depends_on, vec!["raw.events".to_string()]);
    }

    #[test]
    fn scan_project_collects_tests() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("config.yaml"),
            "project: warehouse\ndefault_gateway: prod\n",
        );
        write_file(
            &tmp.path().join("models").join("orders.sql"),
            "MODEL (name app.orders, kind FULL);\nSELECT 1",
        );
        write_file(
            &tmp.path().join("tests").join("test_orders.yaml"),
            "test_orders_basic:\n  model: app.orders\n  inputs: {}\n",
        );
        write_file(
            &tmp.path().join("tests").join("nested").join("test_more.yml"),
            "test_orders_edge:\n  model: app.orders\n",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        assert_eq!(p.tests.len(), 2);
        assert_eq!(p.tests[0].name, "test_orders_basic");
        assert_eq!(p.tests[0].model, "app.orders");
        assert!(p.tests[0].file_path.ends_with("test_orders.yaml"));
        assert_eq!(p.tests[1].name, "test_orders_edge");
    }

    #[test]
    fn scan_project_accepts_yml_extension_for_config() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("config.yml"),
            "project: x\nmodel_defaults:\n  dialect: duckdb\n",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        assert!(p.models.is_empty());
    }

    #[test]
    fn scan_project_rejects_config_without_sqlmesh_markers() {
        // A generic `config.yaml` (e.g. a Python tool's config) is valid YAML but
        // declares none of the SQLMesh marker keys, so it must NOT be treated as a
        // SQLMesh project.
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("config.yaml"),
            "project: reddit-scout\nsubreddits:\n  - rust\noutput_dir: ./output\n",
        );
        let err = e.scan_project(tmp.path()).unwrap_err();
        assert!(matches!(err, SqlMeshError::NotSqlMeshProject(_)));
    }

    #[test]
    fn scan_project_accepts_config_with_only_model_defaults() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("config.yaml"),
            "model_defaults:\n  dialect: postgres\n",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        assert!(p.models.is_empty());
    }

    #[test]
    fn scan_project_parses_example_sqlmesh_project() {
        let e = engine();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("fixtures")
            .join("sample_sqlmesh_project");

        let p = e.scan_project(&root).unwrap();
        let mut names = p.models.iter().map(|m| m.name.as_str()).collect::<Vec<_>>();
        names.sort_unstable();

        assert_eq!(
            names,
            vec![
                "analytics_shop.country_codes",
                "analytics_shop.customer_scd",
                "analytics_shop.customer_segments",
                "analytics_shop.dim_customers",
                "analytics_shop.dim_products",
                "analytics_shop.fct_orders",
                "analytics_shop.raw_customers",
                "analytics_shop.raw_order_items",
                "analytics_shop.raw_orders",
                "analytics_shop.raw_products",
                "analytics_shop.stg_customers",
                "analytics_shop.stg_order_items",
                "analytics_shop.stg_orders",
                "analytics_shop.stg_products",
            ]
        );

        // Tests are scanned from `tests/` and mapped to their target model.
        assert!(!p.tests.is_empty());
        assert!(p.tests.iter().all(|t| !t.model.is_empty()));
        assert!(p
            .tests
            .iter()
            .any(|t| t.model == "analytics_shop.stg_orders"));

        let dim_customers = p
            .models
            .iter()
            .find(|m| m.name == "analytics_shop.dim_customers")
            .unwrap();
        assert_eq!(dim_customers.kind, "full");
        assert_eq!(
            dim_customers.depends_on,
            vec![
                "analytics_shop.stg_customers".to_string(),
                "analytics_shop.stg_orders".to_string(),
                "analytics_shop.country_codes".to_string(),
            ]
        );

        let stg_orders = p
            .models
            .iter()
            .find(|m| m.name == "analytics_shop.stg_orders")
            .unwrap();
        assert_eq!(stg_orders.kind, "incremental");
        assert_eq!(
            stg_orders.depends_on,
            vec!["analytics_shop.raw_orders".to_string()]
        );

        // SCD_TYPE_2_BY_TIME model is grouped under "scd", not "full".
        let customer_scd = p
            .models
            .iter()
            .find(|m| m.name == "analytics_shop.customer_scd")
            .unwrap();
        assert_eq!(customer_scd.kind, "scd");

        // Python `@model` decorated file is scanned with its name and kind.
        let customer_segments = p
            .models
            .iter()
            .find(|m| m.name == "analytics_shop.customer_segments")
            .unwrap();
        assert_eq!(customer_segments.kind, "python");
        assert!(customer_segments.file_path.ends_with("customer_segments.py"));
    }

    #[test]
    fn parse_python_model_decorator_extracts_name_and_kind() {
        let src = r#"
from sqlmesh import model

@model(
    "analytics_shop.customer_segments",
    kind="FULL",
    columns={"customer_id": "int"},
)
def execute(context):
    pass
"#;
        let (name, kind) = SqlMeshEngine::parse_python_model_decorator(src).unwrap();
        assert_eq!(name, "analytics_shop.customer_segments");
        assert_eq!(kind, "FULL");
        assert_eq!(SqlMeshEngine::map_model_kind(&kind), "full");
    }

    #[test]
    fn parse_python_model_decorator_handles_constructor_kind() {
        let src = r#"@model("app.events", kind=IncrementalByTimeRange(time_column="ts"))"#;
        let (name, kind) = SqlMeshEngine::parse_python_model_decorator(src).unwrap();
        assert_eq!(name, "app.events");
        assert_eq!(SqlMeshEngine::map_model_kind(&kind), "incremental");
    }

    #[test]
    fn parse_python_model_decorator_returns_none_without_decorator() {
        assert!(SqlMeshEngine::parse_python_model_decorator("def execute(): pass").is_none());
    }

    #[test]
    fn map_model_kind_maps_scd_and_known_kinds() {
        assert_eq!(SqlMeshEngine::map_model_kind("SCD_TYPE_2_BY_TIME"), "scd");
        assert_eq!(SqlMeshEngine::map_model_kind("SCD_TYPE_2_BY_COLUMN"), "scd");
        assert_eq!(
            SqlMeshEngine::map_model_kind("INCREMENTAL_BY_TIME_RANGE"),
            "incremental"
        );
        assert_eq!(SqlMeshEngine::map_model_kind("VIEW"), "view");
        assert_eq!(SqlMeshEngine::map_model_kind("SEED"), "seed");
        assert_eq!(SqlMeshEngine::map_model_kind("EXTERNAL"), "external");
        assert_eq!(SqlMeshEngine::map_model_kind("FULL"), "full");
        assert_eq!(SqlMeshEngine::map_model_kind("MYSTERY"), "full");
    }

    // -- Gateway YAML tests ---------------------------------------------------

    #[test]
    fn parse_gateways_yaml_extracts_gateways() {
        let e = engine();
        let yaml = r#"
gateways:
  local:
    connection:
      type: duckdb
      database: db.duckdb
  prod:
    connection:
      type: postgres
      host: localhost
project: warehouse
"#;
        let gateways = e.parse_gateways_yaml(yaml).unwrap();
        assert_eq!(gateways.len(), 2);
        assert_eq!(gateways[0].name, "local");
        assert_eq!(gateways[0].connection_type, "duckdb");
        assert_eq!(gateways[1].name, "prod");
        assert_eq!(gateways[1].connection_type, "postgres");
    }

    #[test]
    fn parse_gateways_yaml_handles_no_gateways() {
        let e = engine();
        let yaml = "project: warehouse\n";
        let gateways = e.parse_gateways_yaml(yaml).unwrap();
        assert!(gateways.is_empty());
    }

    #[test]
    fn parse_gateways_yaml_handles_single_gateway() {
        let e = engine();
        let yaml = r#"
gateway:
  connection:
    type: bigquery
project: warehouse
"#;
        let gateways = e.parse_gateways_yaml(yaml).unwrap();
        assert_eq!(gateways.len(), 1);
        assert_eq!(gateways[0].name, "default");
        assert_eq!(gateways[0].connection_type, "bigquery");
    }

    #[test]
    fn expand_tilde_replaces_home_prefix() {
        let expanded = SqlMeshEngine::expand_tilde("~/bin/sqlmesh");
        let home = dirs::home_dir().unwrap();
        assert_eq!(expanded, home.join("bin/sqlmesh").to_string_lossy());
    }

    #[test]
    fn expand_tilde_leaves_absolute_paths_unchanged() {
        assert_eq!(SqlMeshEngine::expand_tilde("/usr/bin/sqlmesh"), "/usr/bin/sqlmesh");
    }

    #[test]
    fn expand_tilde_leaves_bare_name_unchanged() {
        assert_eq!(SqlMeshEngine::expand_tilde("sqlmesh"), "sqlmesh");
    }

    #[test]
    fn extract_model_columns_from_seed() {
        let sql = r#"MODEL (
    name analytics_shop.raw_customers,
    kind SEED (
        path '$root/seeds/raw_customers.csv'
    ),
    columns (
        customer_id INTEGER,
        first_name TEXT,
        last_name TEXT
    ),
    grain customer_id
);"#;
        let cols = SqlMeshEngine::extract_model_columns(sql);
        assert_eq!(cols.len(), 3);
        assert_eq!(cols[0].name, "customer_id");
        assert_eq!(cols[0].r#type.as_deref(), Some("INTEGER"));
        assert_eq!(cols[1].name, "first_name");
        assert_eq!(cols[1].r#type.as_deref(), Some("TEXT"));
        assert_eq!(cols[2].name, "last_name");
        assert_eq!(cols[2].r#type.as_deref(), Some("TEXT"));
    }

    #[test]
    fn extract_model_columns_returns_empty_without_columns_block() {
        let sql = "MODEL (\n    name app.orders,\n    kind FULL\n);\nSELECT id FROM t;";
        let cols = SqlMeshEngine::extract_model_columns(sql);
        assert!(cols.is_empty());
    }

    #[test]
    fn extract_select_columns_simple() {
        let sql = r#"MODEL (
    name analytics_shop.dim_customers,
    kind FULL
);

SELECT
    c.customer_id,
    c.first_name,
    COUNT(o.order_id) AS order_count,
    COALESCE(SUM(o.amount), 0) AS lifetime_value
FROM analytics_shop.stg_customers AS c
LEFT JOIN analytics_shop.stg_orders AS o ON c.customer_id = o.customer_id;"#;
        let cols = SqlMeshEngine::extract_select_columns(sql);
        assert_eq!(cols.len(), 4);
        assert_eq!(cols[0].name, "customer_id");
        assert_eq!(cols[1].name, "first_name");
        assert_eq!(cols[2].name, "order_count");
        assert_eq!(cols[3].name, "lifetime_value");
    }

    #[test]
    fn extract_select_columns_returns_empty_without_select() {
        let sql = "MODEL (\n    name app.seed,\n    kind SEED\n);";
        let cols = SqlMeshEngine::extract_select_columns(sql);
        assert!(cols.is_empty());
    }

    fn model_with_columns(
        name: &str,
        depends_on: &[&str],
        columns: &[&str],
    ) -> ScannedSqlMeshModel {
        ScannedSqlMeshModel {
            name: name.to_owned(),
            kind: "full".to_owned(),
            file_path: format!("models/{name}.sql"),
            cron: None,
            owner: None,
            description: None,
            depends_on: depends_on.iter().map(|s| s.to_string()).collect(),
            columns: columns
                .iter()
                .map(|c| SqlMeshColumnDoc {
                    name: c.to_string(),
                    description: None,
                    r#type: None,
                })
                .collect(),
        }
    }

    #[test]
    fn column_lineage_seeds_nodes_from_scanned_columns() {
        // No real sqlmesh CLI available (binary "false" makes render fail), so the
        // graph is built purely from the seeded scanned columns. This verifies the
        // wiring: every requested model becomes a node carrying its known columns.
        let e = engine();
        let models = vec![
            model_with_columns(
                "analytics_shop.raw_customers",
                &[],
                &["customer_id", "first_name"],
            ),
            model_with_columns(
                "analytics_shop.stg_customers",
                &["analytics_shop.raw_customers"],
                &["customer_id", "first_name"],
            ),
        ];
        let model_names = models.iter().map(|m| m.name.clone()).collect();

        let graph =
            e.column_lineage(PathBuf::from("."), model_names, Some("false".into()), &models);

        let stg = graph
            .nodes
            .iter()
            .find(|n| n.model_id == "analytics_shop.stg_customers")
            .expect("stg_customers node present");
        assert_eq!(stg.columns, vec!["customer_id", "first_name"]);
        assert!(graph
            .nodes
            .iter()
            .any(|n| n.model_id == "analytics_shop.raw_customers"));
    }
}
