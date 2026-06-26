use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use regex_lite::Regex;
use serde::Deserialize;

use uuid::Uuid;

use super::constants;
use super::errors::*;
use super::impl_column_lineage_extractor::ColumnLineageExtractor;
use super::impl_dbt_cli_runner::DbtCliRunner;
use super::impl_diff_sql_builder::{DiffDialect, DiffSqlBuilder};
use super::types::*;
use crate::persistence::ProjectState;
use crate::{ConnectionEngine, DatabaseKind, Engine, QueryEngine, QueryResult, QueryValue};

pub struct DbtEngine;

impl DbtEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn scan_project(&self, root: &Path) -> Result<ScannedProject, ScanError> {
        let project_yml = root.join("dbt_project.yml");
        if !project_yml.exists() {
            return Err(ScanError::ProjectFileMissing(project_yml));
        }
        let yaml_text = fs::read_to_string(&project_yml)?;
        let project = Self::parse_project_yaml_inner(&yaml_text)?;

        let model_dirs: Vec<PathBuf> = if project.model_paths.is_empty() {
            vec![root.join("models")]
        } else {
            project.model_paths.iter().map(|p| root.join(p)).collect()
        };

        let mut nodes: Vec<ScannedNode> = Vec::new();
        let mut schema_docs: Vec<SchemaDocEntry> = Vec::new();
        let mut macros: Vec<DbtMacroDef> = Vec::new();
        let mut docs: Vec<DbtDocBlock> = Vec::new();

        for dir in &model_dirs {
            if dir.exists() {
                Self::collect_nodes(dir, &project.name, "model", &mut nodes, &mut schema_docs, &mut macros, &mut docs)?;
            }
        }

        for s in &project.seed_paths {
            let dir = root.join(s);
            if dir.exists() {
                Self::collect_nodes(&dir, &project.name, "seed", &mut nodes, &mut schema_docs, &mut macros, &mut docs)?;
            }
        }

        for m in &project.macro_paths {
            let dir = root.join(m);
            if dir.exists() {
                Self::collect_nodes(&dir, &project.name, "macro", &mut nodes, &mut schema_docs, &mut macros, &mut docs)?;
            }
        }

        let test_dirs: Vec<PathBuf> = if project.test_paths.is_empty() {
            vec![root.join("tests")]
        } else {
            project.test_paths.iter().map(|p| root.join(p)).collect()
        };
        for dir in &test_dirs {
            if dir.exists() {
                Self::collect_nodes(dir, &project.name, "test", &mut nodes, &mut schema_docs, &mut macros, &mut docs)?;
            }
        }

        let snapshot_dirs: Vec<PathBuf> = if project.snapshot_paths.is_empty() {
            vec![root.join("snapshots")]
        } else {
            project
                .snapshot_paths
                .iter()
                .map(|p| root.join(p))
                .collect()
        };
        for dir in &snapshot_dirs {
            if dir.exists() {
                Self::collect_nodes(dir, &project.name, "snapshot", &mut nodes, &mut schema_docs, &mut macros, &mut docs)?;
            }
        }

        let analysis_dirs: Vec<PathBuf> = if project.analysis_paths.is_empty() {
            vec![root.join("analyses")]
        } else {
            project
                .analysis_paths
                .iter()
                .map(|p| root.join(p))
                .collect()
        };
        for dir in &analysis_dirs {
            if dir.exists() {
                Self::collect_nodes(
                    dir,
                    &project.name,
                    "analysis",
                    &mut nodes,
                    &mut schema_docs,
                    &mut macros,
                    &mut docs,
                )?;
            }
        }

        for doc in &schema_docs {
            for node in nodes.iter_mut() {
                if node.name == doc.name {
                    if node.description.is_none() {
                        node.description = doc.description.clone();
                    }
                    if node.columns.is_empty() {
                        node.columns = doc.columns.clone();
                    }
                }
            }
        }

        nodes.sort_by(|a, b| a.unique_id.cmp(&b.unique_id));
        macros.sort_by(|a, b| a.name.cmp(&b.name));
        macros.dedup();
        docs.sort_by(|a, b| a.name.cmp(&b.name));
        docs.dedup();

        Ok(ScannedProject {
            root_path: root.display().to_string(),
            name: project.name,
            profile: project.profile,
            nodes,
            macros,
            docs,
        })
    }

    pub fn extract_refs(&self, sql: &str, project_name: &str) -> Vec<String> {
        Self::extract_refs_inner(sql, project_name)
    }

    pub fn parse_project_yaml(&self, text: &str) -> Result<DbtProject, DbtProjectError> {
        Self::parse_project_yaml_inner(text)
    }

    pub fn parse_profiles_yaml(&self, text: &str) -> Result<Vec<DbtProfileInfo>, DbtCliError> {
        DbtCliRunner::parse_profiles_yaml(text)
    }

    pub fn check_cli(
        &self,
        root: PathBuf,
        binary: Option<String>,
    ) -> Result<String, DbtCliError> {
        Self::make_runner(root, binary).check_cli()
    }

    pub fn run_model(
        &self,
        root: PathBuf,
        select: String,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<DbtCommandResult, DbtCliError> {
        Self::make_runner(root, binary).run_model(&select, &args)
    }

    pub fn test_model(
        &self,
        root: PathBuf,
        select: String,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<DbtCommandResult, DbtCliError> {
        Self::make_runner(root, binary).test_model(&select, &args)
    }

    pub fn build_model(
        &self,
        root: PathBuf,
        select: String,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<DbtCommandResult, DbtCliError> {
        Self::make_runner(root, binary).build_model(&select, &args)
    }

    pub fn debug(
        &self,
        root: PathBuf,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<DbtCommandResult, DbtCliError> {
        Self::make_runner(root, binary).debug(&args)
    }

    pub fn compile_model(
        &self,
        root: PathBuf,
        select: String,
        project_name: String,
        binary: Option<String>,
    ) -> Result<DbtCompileResult, DbtCliError> {
        Self::make_runner(root, binary).compile_model(&select, &project_name)
    }

    pub fn list_profiles(&self, root: PathBuf) -> Result<Vec<DbtProfileInfo>, DbtCliError> {
        Self::make_runner(root, None).list_profiles()
    }

    pub fn column_lineage(
        &self,
        root: PathBuf,
        model_ids: Vec<String>,
        project_name: String,
        binary: Option<String>,
        nodes: &[ScannedNode],
    ) -> Result<ColumnLineageGraph, ColumnLineageError> {
        let runner = Self::make_runner(root, binary);

        // Extract short model names from unique_ids for dbt compile --select
        let short_names: Vec<String> = model_ids
            .iter()
            .filter_map(|id| {
                if id.starts_with("source.") {
                    None // sources don't need compilation
                } else {
                    Some(id.rsplit('.').next().unwrap_or(id).to_string())
                }
            })
            .collect();

        // Compile models (best-effort; fall through to read cached compiled SQL on failure)
        if !short_names.is_empty() {
            let _ = runner.compile_models(&short_names);
        }

        // Read compiled SQL
        let compiled_sqls = runner.find_all_compiled_sql(&project_name, &short_names);

        // Build model dependencies and source columns from ScannedNodes
        let model_deps: Vec<(String, Vec<String>)> = nodes
            .iter()
            .filter(|n| model_ids.contains(&n.unique_id))
            .map(|n| (n.unique_id.clone(), n.depends_on.clone()))
            .collect();

        let source_columns: std::collections::HashMap<String, Vec<String>> = nodes
            .iter()
            .filter(|n| n.kind == "source")
            .map(|n| (n.unique_id.clone(), n.columns.iter().map(|c| c.name.clone()).collect()))
            .collect();

        // Extract column lineage
        let mut extractor = ColumnLineageExtractor::new();
        Ok(extractor.extract(&compiled_sqls, &model_deps, &source_columns))
    }

    pub fn docs_generate(
        &self,
        root: PathBuf,
        args: Vec<String>,
        binary: Option<String>,
    ) -> Result<DbtCommandResult, DbtCliError> {
        Self::make_runner(root, binary).docs_generate(&args)
    }

    /// Prepare the two SQL ingredients a slim-CI diff needs: the modified
    /// model's compiled `SELECT` (the "new side") and its current prod relation
    /// reference (the baseline). `dbt compile` also refreshes `manifest.json`,
    /// so the relation is resolved from the manifest produced by the same run.
    pub fn slim_diff_inputs(
        &self,
        root: PathBuf,
        model: String,
        project_name: String,
        kind: DatabaseKind,
        binary: Option<String>,
    ) -> Result<(String, String), SlimDiffError> {
        let dialect =
            DiffDialect::from_kind(kind).ok_or(SlimDiffError::UnsupportedSource(kind))?;
        let runner = Self::make_runner(root.clone(), binary);
        let compiled = runner.compile_model(&model, &project_name)?;
        if compiled.exit_code != 0 {
            let msg = if compiled.stderr.trim().is_empty() {
                compiled.stdout
            } else {
                compiled.stderr
            };
            return Err(SlimDiffError::CompileFailed(msg));
        }
        let compiled_sql = compiled
            .compiled_sql
            .ok_or_else(|| SlimDiffError::CompileFailed("compiled SQL not found".to_string()))?;
        let docs = self.load_docs(root)?;
        let prod_relation = Self::resolve_prod_relation(&docs, &model, dialect)?;
        Ok((compiled_sql, prod_relation))
    }

    /// Run the keyless set-diff against the warehouse and assemble the summary +
    /// samples. For `Materialize` mode the compiled SQL is first written to a
    /// session `TEMP` table (single-connection drivers keep it visible across
    /// the follow-up queries); the table is always dropped before returning.
    #[allow(clippy::too_many_arguments)]
    pub async fn run_slim_diff(
        &self,
        query: &QueryEngine,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
        connection_id: Uuid,
        kind: DatabaseKind,
        mode: SlimDiffMode,
        sample_size: u32,
        key_columns: Vec<String>,
        compiled_sql: String,
        prod_relation: String,
    ) -> Result<SlimDiffResult, SlimDiffError> {
        const TEMP: &str = "slimci_diff";

        let dialect =
            DiffDialect::from_kind(kind).ok_or(SlimDiffError::UnsupportedSource(kind))?;

        // Materialize only when the mode asks for it AND the dialect has a clean
        // session temp table; otherwise diff the compiled SELECT inline. Probes
        // use `WHERE 1 = 0` (not `LIMIT 0`) so they hold on MSSQL/Oracle too.
        let temp = match mode {
            SlimDiffMode::Materialize => Self::temp_table_sql(kind, TEMP, &compiled_sql),
            SlimDiffMode::Inline => None,
        };

        let (effective_mode, new_select, new_probe, drop_temp) = match &temp {
            Some(t) => {
                Self::run_sql(query, connection, project, connection_id, t.create.clone()).await?;
                (
                    SlimDiffMode::Materialize,
                    format!("SELECT * FROM {}", t.reference),
                    format!("SELECT * FROM {} WHERE 1 = 0", t.reference),
                    Some(t.drop.clone()),
                )
            }
            None => (
                SlimDiffMode::Inline,
                compiled_sql.clone(),
                format!("SELECT * FROM (\n{compiled_sql}\n) slimci_probe WHERE 1 = 0"),
                None,
            ),
        };

        let outcome = self
            .slim_diff_core(
                query,
                connection,
                project,
                connection_id,
                dialect,
                effective_mode,
                sample_size,
                &key_columns,
                &prod_relation,
                &new_select,
                &new_probe,
            )
            .await;

        // Always drop the scratch table, even when the diff failed.
        if let Some(drop_sql) = drop_temp {
            let _ = Self::run_sql(query, connection, project, connection_id, drop_sql).await;
        }
        outcome
    }

    /// Read + parse the docs artifacts (`manifest.json` + optional `catalog.json`)
    /// produced by `dbt docs generate`, returning a normalized payload. This is
    /// the single boundary coupled to dbt's artifact schema.
    pub fn load_docs(&self, root: PathBuf) -> Result<DbtDocs, DbtDocsError> {
        let target_path = Self::resolve_target_path(&root)?;
        let target = root.join(&target_path);

        let manifest_path = target.join("manifest.json");
        if !manifest_path.exists() {
            return Err(DbtDocsError::ManifestNotFound(manifest_path));
        }
        let manifest_text = fs::read_to_string(&manifest_path)?;
        let manifest: RawManifest = serde_json::from_str(&manifest_text)
            .map_err(|e| DbtDocsError::ManifestParse(e.to_string()))?;

        // catalog.json is best-effort: it only adds warehouse column types, so a
        // missing or malformed catalog degrades to manifest-only docs.
        let catalog_path = target.join("catalog.json");
        let catalog: Option<RawCatalog> = if catalog_path.exists() {
            fs::read_to_string(&catalog_path)
                .ok()
                .and_then(|t| serde_json::from_str(&t).ok())
        } else {
            None
        };

        Ok(Self::build_docs(manifest, catalog))
    }

    /// Read + parse `run_results.json` (written after every `dbt run`/`test`/
    /// `build`), returning per-node status/timing. Used by the test-results pane.
    pub fn load_run_results(&self, root: PathBuf) -> Result<DbtRunResults, DbtRunResultsError> {
        let target_rel = Self::resolve_target_path(&root).map_err(|e| match e {
            DbtDocsError::Io(io) => DbtRunResultsError::Io(io),
            DbtDocsError::Project(p) => DbtRunResultsError::Project(p),
            other => DbtRunResultsError::Parse(other.to_string()),
        })?;
        let path = root.join(&target_rel).join("run_results.json");
        if !path.exists() {
            return Err(DbtRunResultsError::NotFound(path));
        }
        let text = fs::read_to_string(&path)?;
        let raw: RawRunResults = serde_json::from_str(&text)
            .map_err(|e| DbtRunResultsError::Parse(e.to_string()))?;
        Ok(Self::build_run_results(raw))
    }
}

impl DbtEngine {
    fn build_run_results(raw: RawRunResults) -> DbtRunResults {
        let results = raw
            .results
            .into_iter()
            .map(|r| DbtRunResult {
                unique_id: r.unique_id,
                status: r.status,
                execution_time: r.execution_time,
                message: r.message,
                failures: r.failures,
                rows_affected: r.adapter_response.rows_affected,
            })
            .collect();
        DbtRunResults {
            dbt_version: raw.metadata.dbt_version,
            generated_at: raw.metadata.generated_at,
            elapsed_time: raw.elapsed_time,
            results,
        }
    }

    /// Resolve a model's prod relation reference (`"db"."schema"."name"`) from
    /// the docs manifest. The materialized table name is assumed to match the
    /// model name (dbt default; custom `alias` configs are not yet handled).
    fn resolve_prod_relation(
        docs: &DbtDocs,
        model_name: &str,
        dialect: DiffDialect,
    ) -> Result<String, SlimDiffError> {
        let model = docs
            .models
            .iter()
            .find(|m| {
                matches!(m.resource_type.as_str(), "model" | "seed" | "snapshot")
                    && (m.name == model_name
                        || m.unique_id.rsplit('.').next() == Some(model_name))
            })
            .ok_or_else(|| SlimDiffError::ModelNotFound(model_name.to_string()))?;
        Ok(dialect.qualified_relation(
            model.database.as_deref(),
            model.schema.as_deref(),
            &model.name,
        ))
    }

    /// Dialect-specific SQL for the `Materialize` mode scratch table, or `None`
    /// when the source has no clean session temp table (Oracle, Trino) or quirky
    /// temp-as-select semantics (ClickHouse) — the caller falls back to inline.
    fn temp_table_sql(kind: DatabaseKind, name: &str, select: &str) -> Option<TempTable> {
        use DatabaseKind::*;
        let (create, reference, drop) = match kind {
            Postgres | Duckdb | Sqlite | Redshift | Bigquery => (
                format!("CREATE TEMP TABLE {name} AS\n{select}"),
                name.to_string(),
                format!("DROP TABLE IF EXISTS {name}"),
            ),
            Snowflake => (
                format!("CREATE TEMPORARY TABLE {name} AS\n{select}"),
                name.to_string(),
                format!("DROP TABLE IF EXISTS {name}"),
            ),
            Mysql | Mariadb => (
                format!("CREATE TEMPORARY TABLE {name} AS\n{select}"),
                name.to_string(),
                format!("DROP TEMPORARY TABLE IF EXISTS {name}"),
            ),
            Mssql => (
                format!("SELECT * INTO #{name} FROM (\n{select}\n) src_q"),
                format!("#{name}"),
                format!("DROP TABLE IF EXISTS #{name}"),
            ),
            // StarRocks has no session-scoped temporary tables, so the diff
            // engine falls back to an inline scratch select.
            Oracle | Trino | Clickhouse | Mongodb | Redis | Kafka | Mixpanel | Elasticsearch
            | Dynamodb | Starrocks => return None,
        };
        Some(TempTable {
            create,
            reference,
            drop,
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn slim_diff_core(
        &self,
        query: &QueryEngine,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
        connection_id: Uuid,
        dialect: DiffDialect,
        mode: SlimDiffMode,
        sample_size: u32,
        key_columns: &[String],
        prod_relation: &str,
        new_select: &str,
        new_probe: &str,
    ) -> Result<SlimDiffResult, SlimDiffError> {
        let prod_probe = format!("SELECT * FROM {prod_relation} WHERE 1 = 0");
        let prod_cols =
            Self::column_names(Self::run_sql(query, connection, project, connection_id, prod_probe).await?);
        let new_cols = Self::column_names(
            Self::run_sql(query, connection, project, connection_id, new_probe.to_string()).await?,
        );

        let recon = DiffSqlBuilder::reconcile_columns(&prod_cols, &new_cols);
        if recon.shared.is_empty() {
            return Err(SlimDiffError::NoSharedColumns);
        }

        // Every primary-key column must exist on both sides (i.e. be shared),
        // otherwise the keyed SQL would reference a non-existent column.
        let missing: Vec<String> = key_columns
            .iter()
            .filter(|k| !recon.shared.contains(k))
            .cloned()
            .collect();
        if !missing.is_empty() {
            return Err(SlimDiffError::KeyColumnNotShared(missing.join(", ")));
        }
        let keyed = !key_columns.is_empty();

        let builder = DiffSqlBuilder::new(
            dialect,
            prod_relation.to_string(),
            new_select.to_string(),
            recon.shared.clone(),
            key_columns.to_vec(),
            sample_size,
        );

        let counts_sql = builder.counts_sql();
        let added_sample_sql = builder.added_sample_sql();
        let removed_sample_sql = builder.removed_sample_sql();
        let mut executed_sql = format!(
            "-- row counts\n{counts_sql}\n\n-- added rows (in new, not prod)\n{added_sample_sql}\n\n-- removed rows (in prod, not new)\n{removed_sample_sql}"
        );

        let counts =
            Self::run_sql(query, connection, project, connection_id, counts_sql).await?;
        let empty: Vec<QueryValue> = Vec::new();
        let row = counts.rows.first().unwrap_or(&empty);
        let new_total = DiffSqlBuilder::count_at(row, 0);
        let prod_total = DiffSqlBuilder::count_at(row, 1);
        let added_count = DiffSqlBuilder::count_at(row, 2);
        let removed_count = DiffSqlBuilder::count_at(row, 3);
        let updated_count = DiffSqlBuilder::count_at(row, 4);

        let added_sample =
            Self::run_sql(query, connection, project, connection_id, added_sample_sql).await?;
        let removed_sample =
            Self::run_sql(query, connection, project, connection_id, removed_sample_sql).await?;

        // Updated rows only exist for a keyed diff; pull the aligned old/new
        // samples and append their SQL to the command-log payload.
        let (updated_new_sample, updated_prod_sample) = if keyed {
            let new_sql = builder.updated_new_sample_sql();
            let prod_sql = builder.updated_prod_sample_sql();
            executed_sql.push_str(&format!(
                "\n\n-- updated rows: new side (changed values)\n{new_sql}\n\n-- updated rows: prod side (old values)\n{prod_sql}"
            ));
            let new_sample =
                Self::run_sql(query, connection, project, connection_id, new_sql).await?;
            let prod_sample =
                Self::run_sql(query, connection, project, connection_id, prod_sql).await?;
            (new_sample, prod_sample)
        } else {
            (QueryResult::default(), QueryResult::default())
        };

        Ok(SlimDiffResult {
            mode,
            prod_total,
            new_total,
            added_count,
            removed_count,
            updated_count,
            key_columns: key_columns.to_vec(),
            shared_columns: recon.shared,
            prod_only_columns: recon.prod_only,
            new_only_columns: recon.new_only,
            added_sample,
            removed_sample,
            updated_new_sample,
            updated_prod_sample,
            sql: executed_sql,
        })
    }

    async fn run_sql(
        query: &QueryEngine,
        connection: &ConnectionEngine,
        project: Option<&ProjectState>,
        connection_id: Uuid,
        sql: String,
    ) -> Result<QueryResult, SlimDiffError> {
        query
            .run_query(
                connection_id,
                connection,
                project,
                sql,
                Vec::new(),
                None,
                None,
                None,
                None,
            )
            .await
            .map_err(|e| SlimDiffError::Query(e.to_string()))
    }

    fn column_names(result: QueryResult) -> Vec<String> {
        result.columns.into_iter().map(|c| c.name).collect()
    }

    fn make_runner(root: PathBuf, binary: Option<String>) -> DbtCliRunner {
        let runner = DbtCliRunner::new(root);
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

    /// `target-path` from `dbt_project.yml`, defaulting to `target`.
    fn resolve_target_path(root: &Path) -> Result<String, DbtDocsError> {
        let project_yml = root.join("dbt_project.yml");
        if !project_yml.exists() {
            return Ok("target".to_string());
        }
        let text = fs::read_to_string(&project_yml)?;
        let project = Self::parse_project_yaml_inner(&text)?;
        Ok(if project.target_path.is_empty() {
            "target".to_string()
        } else {
            project.target_path
        })
    }

    fn build_docs(manifest: RawManifest, catalog: Option<RawCatalog>) -> DbtDocs {
        let schema_version = manifest.metadata.dbt_schema_version.clone();
        let schema_version_supported = Self::manifest_schema_supported(schema_version.as_deref());

        let mut models = Vec::new();
        for (id, node) in manifest.nodes {
            // Tests, analyses, operations etc. are not documentable entities.
            if !matches!(node.resource_type.as_str(), "model" | "seed" | "snapshot") {
                continue;
            }
            let cat = catalog.as_ref().and_then(|c| c.nodes.get(&id));
            models.push(Self::build_docs_model(id, node, cat));
        }
        for (id, node) in manifest.sources {
            let cat = catalog.as_ref().and_then(|c| c.sources.get(&id));
            models.push(Self::build_docs_model(id, node, cat));
        }
        models.sort_by(|a, b| a.unique_id.cmp(&b.unique_id));

        DbtDocs {
            schema_version,
            dbt_version: manifest.metadata.dbt_version,
            generated_at: manifest.metadata.generated_at,
            schema_version_supported,
            models,
        }
    }

    /// Merge one manifest node with its catalog counterpart. Manifest supplies
    /// structure + descriptions; catalog supplies warehouse column types and
    /// ordering. Columns are the union of both, ordered by catalog index.
    fn build_docs_model(
        id: String,
        node: RawNode,
        catalog: Option<&RawCatalogNode>,
    ) -> DbtDocsModel {
        // Sources display as `source_name.table_name`; everything else by name.
        let name = match (&node.source_name, node.resource_type.as_str()) {
            (Some(src), "source") => format!("{src}.{}", node.name),
            _ => node.name.clone(),
        };

        let mut columns: Vec<(i64, DbtDocsColumn)> = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for (key, col) in &node.columns {
            seen.insert(key.clone());
            let cat_col = catalog.and_then(|c| c.columns.get(key));
            let r#type = cat_col
                .and_then(|cc| cc.r#type.clone())
                .or_else(|| col.data_type.clone());
            let index = cat_col.and_then(|cc| cc.index).unwrap_or(i64::MAX);
            let col_name = if col.name.is_empty() { key.clone() } else { col.name.clone() };
            columns.push((
                index,
                DbtDocsColumn {
                    name: col_name,
                    description: col.description.clone(),
                    r#type,
                },
            ));
        }
        // Columns present in the warehouse but absent from the docs (yml).
        if let Some(c) = catalog {
            for (key, cc) in &c.columns {
                if seen.contains(key) {
                    continue;
                }
                let col_name = if cc.name.is_empty() { key.clone() } else { cc.name.clone() };
                columns.push((
                    cc.index.unwrap_or(i64::MAX),
                    DbtDocsColumn {
                        name: col_name,
                        description: None,
                        r#type: cc.r#type.clone(),
                    },
                ));
            }
        }
        columns.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.name.cmp(&b.1.name)));

        DbtDocsModel {
            unique_id: id,
            name,
            resource_type: node.resource_type,
            description: node.description,
            schema: node.schema,
            database: node.database,
            materialized: node.config.materialized,
            file_path: node.original_file_path,
            columns: columns.into_iter().map(|(_, c)| c).collect(),
            depends_on: node.depends_on.nodes,
        }
    }

    /// Parse the `vNN` major version out of a `dbt_schema_version` URL and check
    /// it against the tested set. Unknown/garbage versions are unsupported.
    fn manifest_schema_supported(version: Option<&str>) -> bool {
        let Some(url) = version else { return false };
        let parsed = url
            .rsplit('/')
            .next()
            .and_then(|s| s.strip_prefix('v'))
            .and_then(|s| s.strip_suffix(".json"))
            .and_then(|s| s.parse::<u32>().ok());
        match parsed {
            Some(n) => constants::SUPPORTED_MANIFEST_SCHEMA_VERSIONS.contains(&n),
            None => false,
        }
    }

    fn parse_project_yaml_inner(text: &str) -> Result<DbtProject, DbtProjectError> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err(DbtProjectError::Empty);
        }
        let parsed: DbtProject = serde_yml::from_str(trimmed)?;
        if parsed.name.is_empty() {
            return Err(DbtProjectError::MissingField("name"));
        }
        Ok(parsed)
    }

    fn collect_nodes(
        dir: &Path,
        project_name: &str,
        kind: &str,
        nodes: &mut Vec<ScannedNode>,
        schema_docs: &mut Vec<SchemaDocEntry>,
        macros: &mut Vec<DbtMacroDef>,
        docs: &mut Vec<DbtDocBlock>,
    ) -> io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let ft = entry.file_type()?;
            if ft.is_dir() {
                Self::collect_nodes(&path, project_name, kind, nodes, schema_docs, macros, docs)?;
            } else if ft.is_file() {
                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_owned();
                let full_path = path.display().to_string();
                if matches!(kind, "model" | "macro" | "test" | "snapshot" | "analysis")
                    && (ext == "sql" || ext == "SQL")
                {
                    let body = fs::read_to_string(&path)?;
                    // Index every `{% macro name(...) %}` definition by name so
                    // `{{ name() }}` go-to-definition can resolve to this file.
                    if kind == "macro" {
                        for name in Self::extract_macro_names(&body) {
                            macros.push(DbtMacroDef {
                                name,
                                file_path: full_path.clone(),
                            });
                        }
                    }
                    let depends_on = Self::extract_refs_inner(&body, project_name);
                    let unique_id = format!("{kind}.{project_name}.{stem}");
                    let materialized = if kind == "model" {
                        Self::extract_materialized(&body)
                    } else {
                        None
                    };
                    nodes.push(ScannedNode {
                        unique_id,
                        name: stem,
                        kind: kind.to_owned(),
                        file_path: full_path,
                        schema: None,
                        database: None,
                        materialized,
                        description: None,
                        depends_on,
                        columns: Vec::new(),
                    });
                } else if kind == "seed" && (ext == "csv" || ext == "CSV") {
                    let unique_id = format!("seed.{project_name}.{stem}");
                    nodes.push(ScannedNode {
                        unique_id,
                        name: stem,
                        kind: "seed".to_owned(),
                        file_path: full_path,
                        schema: None,
                        database: None,
                        materialized: None,
                        description: None,
                        depends_on: Vec::new(),
                        columns: Vec::new(),
                    });
                } else if ext == "yml" || ext == "yaml" {
                    if let Ok(text) = fs::read_to_string(&path) {
                        let parsed = Self::parse_schema_yaml(&text, project_name, &full_path);
                        schema_docs.extend(parsed.model_docs);
                        nodes.extend(parsed.source_nodes);
                    }
                } else if ext == "md" || ext == "MD" {
                    // Docs blocks (`{% docs name %}`) can live in `.md` files under any
                    // resource path; index them by name for `{{ doc('name') }}` nav.
                    if let Ok(text) = fs::read_to_string(&path) {
                        for name in Self::extract_doc_block_names(&text) {
                            docs.push(DbtDocBlock {
                                name,
                                file_path: full_path.clone(),
                            });
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Extract a model's materialization from an inline
    /// `{{ config(materialized='incremental') }}` (single or double quotes).
    /// Returns `None` when no inline materialized config is present.
    fn extract_materialized(body: &str) -> Option<String> {
        let re = Regex::new(r#"materialized\s*=\s*['"]([A-Za-z_]+)['"]"#).unwrap();
        re.captures(body).map(|c| c[1].to_owned())
    }

    /// Extract macro names from `{% macro name(...) %}` tags (whitespace-control
    /// `{%-` variants included).
    fn extract_macro_names(body: &str) -> Vec<String> {
        let re = Regex::new(r"\{%-?\s*macro\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(").unwrap();
        re.captures_iter(body)
            .map(|c| c[1].to_owned())
            .collect()
    }

    /// Extract docs-block names from `{% docs name %}` tags.
    fn extract_doc_block_names(body: &str) -> Vec<String> {
        let re = Regex::new(r"\{%-?\s*docs\s+([A-Za-z_][A-Za-z0-9_]*)\s*-?%\}").unwrap();
        re.captures_iter(body)
            .map(|c| c[1].to_owned())
            .collect()
    }

    fn parse_schema_yaml(
        text: &str,
        project_name: &str,
        file_path: &str,
    ) -> ParsedSchemaYaml {
        #[derive(Deserialize)]
        struct YColumn {
            name: String,
            #[serde(default)]
            description: Option<String>,
            #[serde(default, rename = "data_type")]
            data_type: Option<String>,
        }
        #[derive(Deserialize)]
        struct YModel {
            name: String,
            #[serde(default)]
            description: Option<String>,
            #[serde(default)]
            columns: Vec<YColumn>,
        }
        #[derive(Deserialize)]
        struct YSourceTable {
            name: String,
            #[serde(default)]
            description: Option<String>,
            #[serde(default)]
            columns: Vec<YColumn>,
        }
        #[derive(Deserialize)]
        struct YSource {
            name: String,
            #[serde(default)]
            schema: Option<String>,
            #[serde(default)]
            database: Option<String>,
            #[serde(default)]
            tables: Vec<YSourceTable>,
        }
        #[derive(Deserialize)]
        struct YDoc {
            #[serde(default)]
            models: Vec<YModel>,
            #[serde(default)]
            seeds: Vec<YModel>,
            #[serde(default)]
            sources: Vec<YSource>,
        }

        let parsed: Result<YDoc, _> = serde_yml::from_str(text);
        let Ok(doc) = parsed else {
            return ParsedSchemaYaml {
                model_docs: Vec::new(),
                source_nodes: Vec::new(),
            };
        };

        let mut model_docs = Vec::new();
        for group in [doc.models, doc.seeds] {
            for m in group {
                let cols = m
                    .columns
                    .into_iter()
                    .map(|c| DbtColumnDoc {
                        name: c.name,
                        description: c.description,
                        r#type: c.data_type,
                    })
                    .collect();
                model_docs.push(SchemaDocEntry {
                    name: m.name,
                    description: m.description,
                    columns: cols,
                });
            }
        }

        let mut source_nodes = Vec::new();
        for src in doc.sources {
            for tbl in src.tables {
                let cols: Vec<DbtColumnDoc> = tbl
                    .columns
                    .into_iter()
                    .map(|c| DbtColumnDoc {
                        name: c.name,
                        description: c.description,
                        r#type: c.data_type,
                    })
                    .collect();
                let schema = src.schema.clone().unwrap_or_else(|| src.name.clone());
                source_nodes.push(ScannedNode {
                    unique_id: format!("source.{project_name}.{}.{}", src.name, tbl.name),
                    name: format!("{}.{}", src.name, tbl.name),
                    kind: "source".to_owned(),
                    file_path: file_path.to_owned(),
                    schema: Some(schema),
                    database: src.database.clone(),
                    materialized: None,
                    description: tbl.description,
                    depends_on: Vec::new(),
                    columns: cols,
                });
            }
        }

        ParsedSchemaYaml {
            model_docs,
            source_nodes,
        }
    }

    fn extract_refs_inner(sql: &str, project_name: &str) -> Vec<String> {
        let mut out = Vec::new();
        let bytes = sql.as_bytes();
        let mut i = 0;
        while i + 1 < bytes.len() {
            if bytes[i] == b'{' && bytes[i + 1] == b'{' {
                let close = sql[i + 2..]
                    .find("}}")
                    .map(|n| i + 2 + n)
                    .unwrap_or(bytes.len());
                let inner = &sql[i + 2..close];
                let trimmed = inner.trim();
                if let Some(args) = trimmed
                    .strip_prefix("ref(")
                    .or_else(|| trimmed.strip_prefix("ref ("))
                {
                    if let Some(name) = Self::first_quoted(args) {
                        out.push(format!("model.{project_name}.{name}"));
                    }
                } else if let Some(args) = trimmed
                    .strip_prefix("source(")
                    .or_else(|| trimmed.strip_prefix("source ("))
                {
                    let parts = Self::split_quoted(args);
                    if parts.len() >= 2 {
                        out.push(format!(
                            "source.{project_name}.{}.{}",
                            parts[0], parts[1]
                        ));
                    }
                }
                i = close + 2;
            } else {
                i += 1;
            }
        }
        out.sort();
        out.dedup();
        out
    }

    fn first_quoted(s: &str) -> Option<String> {
        Self::split_quoted(s).into_iter().next()
    }

    fn split_quoted(s: &str) -> Vec<String> {
        let mut out = Vec::new();
        let bytes = s.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            let c = bytes[i] as char;
            if c == '\'' || c == '"' {
                let quote = c;
                i += 1;
                let start = i;
                while i < bytes.len() && bytes[i] as char != quote {
                    i += 1;
                }
                let v = &s[start..i.min(bytes.len())];
                out.push(v.to_owned());
                if i < bytes.len() {
                    i += 1;
                }
            } else {
                i += 1;
            }
        }
        out
    }
}

impl Engine for DbtEngine {
    fn name(&self) -> &str {
        "dbt"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::write;

    fn engine() -> DbtEngine {
        DbtEngine::new()
    }

    fn write_file(p: &Path, content: &str) {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        write(p, content).unwrap();
    }

    // -- Project YAML tests ---------------------------------------------------

    #[test]
    fn rejects_empty_yaml() {
        let e = engine();
        assert!(matches!(
            e.parse_project_yaml(""),
            Err(DbtProjectError::Empty)
        ));
    }

    #[test]
    fn rejects_missing_name() {
        let e = engine();
        let err = e.parse_project_yaml("version: '1.0.0'").unwrap_err();
        assert!(matches!(err, DbtProjectError::MissingField("name")));
    }

    #[test]
    fn parses_minimal_project() {
        let e = engine();
        let yaml = r#"
name: jaffle_shop
version: '1.0.0'
profile: dev
model-paths: [models]
macro-paths: [macros]
target-path: target
"#;
        let p = e.parse_project_yaml(yaml).unwrap();
        assert_eq!(p.name, "jaffle_shop");
        assert_eq!(p.version, "1.0.0");
        assert_eq!(p.profile, "dev");
        assert_eq!(p.model_paths, vec!["models".to_string()]);
        assert_eq!(p.macro_paths, vec!["macros".to_string()]);
        assert_eq!(p.target_path, "target");
    }

    #[test]
    fn ignores_unknown_top_level_keys() {
        let e = engine();
        let yaml = "name: app\nseeds:\n  app:\n    +schema: raw";
        let p = e.parse_project_yaml(yaml).unwrap();
        assert_eq!(p.name, "app");
    }

    // -- Profiles YAML tests --------------------------------------------------

    #[test]
    fn parse_profiles_yaml_extracts_profiles() {
        let e = engine();
        let yaml = r#"
jaffle_shop:
  target: dev
  outputs:
    dev:
      type: postgres
      host: localhost
    prod:
      type: postgres
      host: prod.example.com
"#;
        let profiles = e.parse_profiles_yaml(yaml).expect("parse");
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "jaffle_shop");
        assert_eq!(profiles[0].default_target, "dev");
        assert!(profiles[0].targets.contains(&"dev".to_string()));
        assert!(profiles[0].targets.contains(&"prod".to_string()));
        assert_eq!(profiles[0].targets.len(), 2);
    }

    #[test]
    fn parse_profiles_yaml_skips_config_key() {
        let e = engine();
        let yaml = r#"
my_project:
  target: dev
  outputs:
    dev:
      type: sqlite
config:
  send_anonymous_usage_stats: false
"#;
        let profiles = e.parse_profiles_yaml(yaml).expect("parse");
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "my_project");
    }

    // -- Ref extraction tests -------------------------------------------------

    #[test]
    fn extracts_ref_calls() {
        let e = engine();
        let sql = "SELECT * FROM {{ ref('users') }} u JOIN {{ ref(\"orders\") }} o ON 1=1";
        let r = e.extract_refs(sql, "app");
        assert_eq!(
            r,
            vec![
                "model.app.orders".to_string(),
                "model.app.users".to_string()
            ]
        );
    }

    #[test]
    fn extracts_source_calls() {
        let e = engine();
        let sql = "SELECT * FROM {{ source('raw', 'events') }}";
        let r = e.extract_refs(sql, "app");
        assert_eq!(r, vec!["source.app.raw.events".to_string()]);
    }

    // -- Scan project tests ---------------------------------------------------

    #[test]
    fn returns_error_when_project_yml_missing() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let err = e.scan_project(tmp.path()).unwrap_err();
        assert!(matches!(err, ScanError::ProjectFileMissing(_)));
    }

    #[test]
    fn scans_minimal_project_with_one_model() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("dbt_project.yml"),
            "name: jaffle\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\n",
        );
        write_file(
            &tmp.path().join("models").join("orders.sql"),
            "SELECT * FROM {{ ref('users') }}",
        );
        write_file(
            &tmp.path().join("models").join("schema.yml"),
            "version: 2\nmodels:\n  - name: orders\n    description: Per-row orders\n    columns:\n      - name: id\n        description: Order id\n        data_type: int\n",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        assert_eq!(p.name, "jaffle");
        assert_eq!(p.profile, "dev");
        assert_eq!(p.nodes.len(), 1);
        let n = &p.nodes[0];
        assert_eq!(n.unique_id, "model.jaffle.orders");
        assert_eq!(n.kind, "model");
        assert_eq!(n.depends_on, vec!["model.jaffle.users"]);
        assert_eq!(n.description.as_deref(), Some("Per-row orders"));
        assert_eq!(n.columns.len(), 1);
        assert_eq!(n.columns[0].name, "id");
        assert_eq!(n.columns[0].r#type.as_deref(), Some("int"));
    }

    #[test]
    fn extract_materialized_reads_inline_config() {
        assert_eq!(
            DbtEngine::extract_materialized("{{ config(materialized='incremental') }}\nSELECT 1"),
            Some("incremental".to_string())
        );
        assert_eq!(
            DbtEngine::extract_materialized(r#"{{ config(materialized="table", schema='marts') }}"#),
            Some("table".to_string())
        );
        assert_eq!(DbtEngine::extract_materialized("SELECT * FROM x"), None);
    }

    #[test]
    fn scan_captures_model_materialization() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("dbt_project.yml"),
            "name: jaffle\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\n",
        );
        write_file(
            &tmp.path().join("models").join("dim_customers.sql"),
            "{{ config(materialized='table') }}\nSELECT 1",
        );
        write_file(
            &tmp.path().join("models").join("fct_events.sql"),
            "{{ config(materialized='incremental') }}\nSELECT 1",
        );
        write_file(
            &tmp.path().join("models").join("stg_orders.sql"),
            "SELECT 1",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        let mat = |name: &str| {
            p.nodes
                .iter()
                .find(|n| n.name == name)
                .unwrap()
                .materialized
                .clone()
        };
        assert_eq!(mat("dim_customers").as_deref(), Some("table"));
        assert_eq!(mat("fct_events").as_deref(), Some("incremental"));
        assert_eq!(mat("stg_orders"), None);
    }

    #[test]
    fn picks_up_any_yaml_filename() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("dbt_project.yml"),
            "name: jaffle\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\n",
        );
        write_file(
            &tmp.path().join("models").join("orders.sql"),
            "SELECT * FROM {{ ref('users') }}",
        );
        write_file(
            &tmp.path().join("models").join("_custom_schema.yml"),
            "version: 2\nmodels:\n  - name: orders\n    description: Custom yaml name\n    columns:\n      - name: order_id\n        data_type: bigint\n",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        let n = p.nodes.iter().find(|n| n.name == "orders").unwrap();
        assert_eq!(n.description.as_deref(), Some("Custom yaml name"));
        assert_eq!(n.columns.len(), 1);
        assert_eq!(n.columns[0].name, "order_id");
    }

    #[test]
    fn scans_source_definitions_from_yaml() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("dbt_project.yml"),
            "name: jaffle\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\n",
        );
        write_file(
            &tmp.path().join("models").join("stg_orders.sql"),
            "SELECT * FROM {{ source('raw', 'orders') }}",
        );
        write_file(
            &tmp.path().join("models").join("_sources.yml"),
            "version: 2\nsources:\n  - name: raw\n    tables:\n      - name: orders\n        description: Raw orders\n        columns:\n          - name: id\n            description: PK\n          - name: amount\n            data_type: numeric\n      - name: customers\n        columns:\n          - name: cust_id\n",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        let src_orders = p
            .nodes
            .iter()
            .find(|n| n.kind == "source" && n.name == "raw.orders")
            .unwrap();
        assert_eq!(src_orders.unique_id, "source.jaffle.raw.orders");
        assert_eq!(src_orders.schema.as_deref(), Some("raw"));
        assert_eq!(src_orders.description.as_deref(), Some("Raw orders"));
        assert_eq!(src_orders.columns.len(), 2);
        assert_eq!(src_orders.columns[0].name, "id");
        assert_eq!(src_orders.columns[1].name, "amount");
        assert_eq!(src_orders.columns[1].r#type.as_deref(), Some("numeric"));

        let src_cust = p
            .nodes
            .iter()
            .find(|n| n.kind == "source" && n.name == "raw.customers")
            .unwrap();
        assert_eq!(src_cust.columns.len(), 1);
        assert_eq!(src_cust.columns[0].name, "cust_id");
    }

    #[test]
    fn source_schema_and_database_overrides() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("dbt_project.yml"),
            "name: app\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\n",
        );
        write_file(&tmp.path().join("models").join("a.sql"), "SELECT 1");
        write_file(
            &tmp.path().join("models").join("_sources.yml"),
            "version: 2\nsources:\n  - name: raw\n    schema: prod_raw\n    database: analytics_db\n    tables:\n      - name: events\n  - name: other\n    tables:\n      - name: users\n",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        let events = p.nodes.iter().find(|n| n.name == "raw.events").unwrap();
        assert_eq!(events.schema.as_deref(), Some("prod_raw"));
        assert_eq!(events.database.as_deref(), Some("analytics_db"));
        let users = p.nodes.iter().find(|n| n.name == "other.users").unwrap();
        assert_eq!(users.schema.as_deref(), Some("other"));
        assert_eq!(users.database, None);
    }

    #[test]
    fn extracts_macro_names_from_jinja() {
        let body = "{% macro cents_to_dollars(col) %}\n  {{ col }} / 100\n{% endmacro %}\n{%- macro upper(x) -%}{% endmacro %}";
        assert_eq!(
            DbtEngine::extract_macro_names(body),
            vec!["cents_to_dollars".to_string(), "upper".to_string()]
        );
    }

    #[test]
    fn extracts_doc_block_names_from_markdown() {
        let body = "{% docs order_status %}\nThe status.\n{% enddocs %}\n{%- docs customer_id -%}id{% enddocs %}";
        assert_eq!(
            DbtEngine::extract_doc_block_names(body),
            vec!["order_status".to_string(), "customer_id".to_string()]
        );
    }

    #[test]
    fn scans_macros_and_docs() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("dbt_project.yml"),
            "name: app\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\nmacro-paths: [macros]\n",
        );
        write_file(&tmp.path().join("models").join("a.sql"), "SELECT 1");
        write_file(
            &tmp.path().join("macros").join("utils.sql"),
            "{% macro to_cents(x) %}{{ x }}*100{% endmacro %}\n{% macro to_dollars(x) %}{{ x }}/100{% endmacro %}",
        );
        write_file(
            &tmp.path().join("models").join("docs.md"),
            "{% docs order_status %}desc{% enddocs %}",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        let to_cents = p.macros.iter().find(|m| m.name == "to_cents").unwrap();
        assert!(to_cents.file_path.ends_with("utils.sql"));
        assert!(p.macros.iter().any(|m| m.name == "to_dollars"));
        let block = p.docs.iter().find(|d| d.name == "order_status").unwrap();
        assert!(block.file_path.ends_with("docs.md"));
    }

    #[test]
    fn source_node_uses_full_file_path() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("dbt_project.yml"),
            "name: app\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\n",
        );
        write_file(
            &tmp.path().join("models").join("_sources.yml"),
            "version: 2\nsources:\n  - name: raw\n    tables:\n      - name: orders\n",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        let src = p.nodes.iter().find(|n| n.name == "raw.orders").unwrap();
        assert!(src.file_path.ends_with("_sources.yml"));
        assert!(src.file_path.contains(&tmp.path().display().to_string()));
    }

    #[test]
    fn scans_seeds_when_seed_paths_set() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("dbt_project.yml"),
            "name: app\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\nseed-paths: [seeds]\n",
        );
        write_file(&tmp.path().join("models").join("a.sql"), "SELECT 1");
        write_file(&tmp.path().join("seeds").join("countries.csv"), "id,name\n");
        let p = e.scan_project(tmp.path()).unwrap();
        assert!(p
            .nodes
            .iter()
            .any(|n| n.kind == "seed" && n.name == "countries"));
    }

    #[test]
    fn scans_test_sql_files() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("dbt_project.yml"),
            "name: app\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\n",
        );
        write_file(&tmp.path().join("models").join("a.sql"), "SELECT 1");
        write_file(
            &tmp.path().join("tests").join("assert_positive.sql"),
            "SELECT * FROM {{ ref('a') }} WHERE amount < 0",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        let test_node = p.nodes.iter().find(|n| n.kind == "test");
        assert!(test_node.is_some(), "should find test node");
        let t = test_node.unwrap();
        assert_eq!(t.name, "assert_positive");
        assert_eq!(t.unique_id, "test.app.assert_positive");
        assert!(t.depends_on.contains(&"model.app.a".to_string()));
    }

    #[test]
    fn scans_snapshot_sql_files() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("dbt_project.yml"),
            "name: app\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\n",
        );
        write_file(&tmp.path().join("models").join("a.sql"), "SELECT 1");
        write_file(
            &tmp.path().join("snapshots").join("snap_orders.sql"),
            "{% snapshot snap_orders %}SELECT * FROM orders{% endsnapshot %}",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        assert!(p
            .nodes
            .iter()
            .any(|n| n.kind == "snapshot" && n.name == "snap_orders"));
    }

    #[test]
    fn scans_custom_test_paths() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        write_file(
            &tmp.path().join("dbt_project.yml"),
            "name: app\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\ntest-paths: [custom_tests]\n",
        );
        write_file(&tmp.path().join("models").join("a.sql"), "SELECT 1");
        write_file(
            &tmp.path().join("custom_tests").join("check_null.sql"),
            "SELECT * FROM {{ ref('a') }} WHERE id IS NULL",
        );
        let p = e.scan_project(tmp.path()).unwrap();
        assert!(p
            .nodes
            .iter()
            .any(|n| n.kind == "test" && n.name == "check_null"));
    }

    // -- Slim CI prod-relation resolution -------------------------------------

    fn docs_with(models: Vec<DbtDocsModel>) -> DbtDocs {
        DbtDocs {
            models,
            ..Default::default()
        }
    }

    fn model_node(name: &str, db: Option<&str>, schema: Option<&str>) -> DbtDocsModel {
        DbtDocsModel {
            unique_id: format!("model.app.{name}"),
            name: name.to_string(),
            resource_type: "model".to_string(),
            database: db.map(String::from),
            schema: schema.map(String::from),
            ..Default::default()
        }
    }

    #[test]
    fn resolve_prod_relation_builds_three_part_reference() {
        let docs = docs_with(vec![model_node("orders", Some("analytics"), Some("public"))]);
        let rel = DbtEngine::resolve_prod_relation(&docs, "orders", DiffDialect::Standard).unwrap();
        assert_eq!(rel, "\"analytics\".\"public\".\"orders\"");
    }

    #[test]
    fn resolve_prod_relation_omits_absent_database() {
        let docs = docs_with(vec![model_node("orders", None, Some("public"))]);
        let rel = DbtEngine::resolve_prod_relation(&docs, "orders", DiffDialect::Standard).unwrap();
        assert_eq!(rel, "\"public\".\"orders\"");
    }

    #[test]
    fn resolve_prod_relation_errors_when_model_absent() {
        let docs = docs_with(vec![model_node("orders", None, Some("public"))]);
        let err =
            DbtEngine::resolve_prod_relation(&docs, "customers", DiffDialect::Standard).unwrap_err();
        assert!(matches!(err, SlimDiffError::ModelNotFound(m) if m == "customers"));
    }

    #[test]
    fn resolve_prod_relation_ignores_test_nodes() {
        let mut t = model_node("orders", None, Some("public"));
        t.resource_type = "test".to_string();
        let docs = docs_with(vec![t]);
        assert!(DbtEngine::resolve_prod_relation(&docs, "orders", DiffDialect::Standard).is_err());
    }

    #[test]
    fn expand_tilde_replaces_home_prefix() {
        let expanded = DbtEngine::expand_tilde("~/bin/dbt");
        let home = dirs::home_dir().unwrap();
        assert_eq!(expanded, home.join("bin/dbt").to_string_lossy());
    }

    #[test]
    fn expand_tilde_leaves_absolute_paths_unchanged() {
        assert_eq!(DbtEngine::expand_tilde("/usr/bin/dbt"), "/usr/bin/dbt");
    }

    #[test]
    fn expand_tilde_leaves_bare_name_unchanged() {
        assert_eq!(DbtEngine::expand_tilde("dbt"), "dbt");
    }

    // -- dbt docs (manifest.json + catalog.json) ------------------------------
    //
    // Fixtures are REAL artifacts produced by `dbt docs generate` (dbt 1.12,
    // postgres) against `fixtures/sample_dbt_project`. The manifest is trimmed
    // to `metadata`/`nodes`/`sources` (the keys the parser reads); every node
    // and source keeps its exact upstream field shape.

    const MANIFEST_FIXTURE: &str = include_str!("test_fixtures/manifest.json");
    const CATALOG_FIXTURE: &str = include_str!("test_fixtures/catalog.json");

    fn docs_project(with_catalog: bool) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir.path().join("dbt_project.yml"),
            "name: jaffle_shop\nversion: '1.0.0'\nprofile: jaffle_shop\n",
        );
        write_file(&dir.path().join("target").join("manifest.json"), MANIFEST_FIXTURE);
        if with_catalog {
            write_file(&dir.path().join("target").join("catalog.json"), CATALOG_FIXTURE);
        }
        dir
    }

    #[test]
    fn load_docs_parses_real_manifest_and_catalog() {
        let dir = docs_project(true);
        let docs = engine().load_docs(dir.path().to_path_buf()).expect("load_docs");

        assert!(docs.schema_version_supported, "v12 should be supported");
        assert_eq!(docs.dbt_version.as_deref(), Some("1.12.0b1"));
        assert!(docs.generated_at.is_some());

        // 3 models + 1 seed + 2 sources; the 9 tests are excluded.
        assert_eq!(docs.models.len(), 6);
        assert!(
            docs.models.iter().all(|m| m.resource_type != "test"),
            "tests must not appear as docs models"
        );

        let dim = docs
            .models
            .iter()
            .find(|m| m.unique_id == "model.jaffle_shop.dim_customers")
            .expect("dim_customers present");
        assert_eq!(dim.name, "dim_customers");
        assert_eq!(dim.description.as_deref(), Some("Customer dimension table with order summary"));
        assert_eq!(dim.materialized.as_deref(), Some("table"));
        assert_eq!(dim.schema.as_deref(), Some("public_marts"));
        assert_eq!(dim.file_path.as_deref(), Some("models/marts/dim_customers.sql"));
        assert!(dim.depends_on.contains(&"model.jaffle_shop.stg_customers".to_string()));
        assert!(dim.depends_on.contains(&"model.jaffle_shop.stg_orders".to_string()));

        // Column merge: description from manifest (yml), type from catalog.
        let cid = dim.columns.iter().find(|c| c.name == "customer_id").expect("customer_id");
        assert_eq!(cid.description.as_deref(), Some("Primary key"));
        assert_eq!(cid.r#type.as_deref(), Some("integer"));
        let total = dim.columns.iter().find(|c| c.name == "total_amount").expect("total_amount");
        assert_eq!(total.r#type.as_deref(), Some("bigint"));
        // Catalog index order: customer_id (1) precedes total_amount (6).
        let pos = |n: &str| dim.columns.iter().position(|c| c.name == n).unwrap();
        assert!(pos("customer_id") < pos("total_amount"));

        // Sources display as `source_name.table_name`.
        let src = docs
            .models
            .iter()
            .find(|m| m.unique_id == "source.jaffle_shop.jaffle_shop.raw_orders")
            .expect("raw_orders source present");
        assert_eq!(src.resource_type, "source");
        assert_eq!(src.name, "jaffle_shop.raw_orders");
        assert!(src.columns.iter().any(|c| c.name == "amount" && c.r#type.as_deref() == Some("integer")));
    }

    #[test]
    fn load_docs_degrades_without_catalog() {
        let dir = docs_project(false);
        let docs = engine().load_docs(dir.path().to_path_buf()).expect("load_docs");

        assert_eq!(docs.models.len(), 6);
        let dim = docs
            .models
            .iter()
            .find(|m| m.unique_id == "model.jaffle_shop.dim_customers")
            .unwrap();
        // Descriptions survive (from manifest); types are absent (catalog-only).
        let cid = dim.columns.iter().find(|c| c.name == "customer_id").unwrap();
        assert_eq!(cid.description.as_deref(), Some("Primary key"));
        assert_eq!(cid.r#type, None);
    }

    #[test]
    fn load_docs_errors_when_manifest_missing() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir.path().join("dbt_project.yml"),
            "name: jaffle_shop\nversion: '1.0.0'\nprofile: jaffle_shop\n",
        );
        let err = engine().load_docs(dir.path().to_path_buf()).unwrap_err();
        assert!(matches!(err, DbtDocsError::ManifestNotFound(_)));
    }

    #[test]
    fn load_docs_respects_custom_target_path() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir.path().join("dbt_project.yml"),
            "name: jaffle_shop\nversion: '1.0.0'\nprofile: jaffle_shop\ntarget-path: build\n",
        );
        write_file(&dir.path().join("build").join("manifest.json"), MANIFEST_FIXTURE);
        let docs = engine().load_docs(dir.path().to_path_buf()).expect("load_docs");
        assert_eq!(docs.models.len(), 6);
    }

    #[test]
    fn load_docs_tolerates_unknown_and_missing_fields() {
        // Unknown top-level + node fields (a hypothetical future schema bump) and
        // a node missing most fields must not fail the parse.
        let manifest = r#"{
            "metadata": {"dbt_schema_version": "https://schemas.getdbt.com/dbt/manifest/v99.json", "future_key": 1},
            "new_top_level_section": {"whatever": true},
            "nodes": {
                "model.app.bare": {"resource_type": "model", "name": "bare", "surprise_field": [1,2,3]},
                "model.app.full": {
                    "unique_id": "model.app.full", "name": "full", "resource_type": "model",
                    "description": "ok", "columns": {"x": {"name": "x", "description": "col x"}},
                    "depends_on": {"nodes": ["model.app.bare"]}, "unexpected": {"a": 1}
                }
            }
        }"#;
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir.path().join("dbt_project.yml"),
            "name: app\nversion: '1.0.0'\nprofile: app\n",
        );
        write_file(&dir.path().join("target").join("manifest.json"), manifest);

        let docs = engine().load_docs(dir.path().to_path_buf()).expect("load_docs degrades");
        // v99 is outside the tested set → unsupported, but still rendered.
        assert!(!docs.schema_version_supported);
        assert_eq!(docs.models.len(), 2);
        let full = docs.models.iter().find(|m| m.name == "full").unwrap();
        assert_eq!(full.columns.len(), 1);
        assert_eq!(full.columns[0].description.as_deref(), Some("col x"));
        assert!(full.depends_on.contains(&"model.app.bare".to_string()));
    }

    #[test]
    fn manifest_schema_supported_checks_version() {
        let v = |s| DbtEngine::manifest_schema_supported(Some(s));
        assert!(v("https://schemas.getdbt.com/dbt/manifest/v12.json"));
        assert!(v("https://schemas.getdbt.com/dbt/manifest/v10.json"));
        assert!(!v("https://schemas.getdbt.com/dbt/manifest/v99.json"));
        assert!(!v("garbage"));
        assert!(!DbtEngine::manifest_schema_supported(None));
    }

    const RUN_RESULTS_FIXTURE: &str = include_str!("test_fixtures/run_results.json");

    fn run_results_project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir.path().join("dbt_project.yml"),
            "name: jaffle_shop\nversion: '1.0.0'\nprofile: jaffle_shop\n",
        );
        write_file(&dir.path().join("target").join("run_results.json"), RUN_RESULTS_FIXTURE);
        dir
    }

    #[test]
    fn load_run_results_parses_per_node_outcomes() {
        let dir = run_results_project();
        let rr = engine().load_run_results(dir.path().to_path_buf()).expect("load_run_results");

        assert_eq!(rr.dbt_version.as_deref(), Some("1.12.0b1"));
        assert!(rr.generated_at.is_some());
        assert_eq!(rr.elapsed_time, 2.5);
        assert_eq!(rr.results.len(), 4);

        let fail = rr
            .results
            .iter()
            .find(|r| r.unique_id == "test.jaffle_shop.not_null_dim_customers_customer_id.def456")
            .expect("failing test present");
        assert_eq!(fail.status, "fail");
        assert_eq!(fail.failures, Some(3));
        assert_eq!(fail.message.as_deref(), Some("Got 3 results, configured to fail if != 0"));

        let pass = rr
            .results
            .iter()
            .find(|r| r.status == "pass")
            .expect("passing test present");
        assert_eq!(pass.failures, Some(0));

        // adapter_response.rows_affected is flattened onto the normalized result.
        let model = rr
            .results
            .iter()
            .find(|r| r.unique_id == "model.jaffle_shop.dim_customers")
            .expect("model present");
        assert_eq!(model.status, "success");
        assert_eq!(model.rows_affected, Some(100));
    }

    #[test]
    fn load_run_results_errors_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir.path().join("dbt_project.yml"),
            "name: jaffle_shop\nversion: '1.0.0'\nprofile: jaffle_shop\n",
        );
        let err = engine().load_run_results(dir.path().to_path_buf()).unwrap_err();
        assert!(matches!(err, DbtRunResultsError::NotFound(_)));
    }

    #[test]
    fn load_run_results_tolerates_unknown_and_missing_fields() {
        // A future schema bump (unknown keys) and a result missing most fields
        // must not fail the parse.
        let json = r#"{
            "metadata": {"dbt_version": "1.99.0", "future_key": 1},
            "new_section": {"x": true},
            "results": [
                {"unique_id": "test.app.bare", "status": "pass", "surprise": [1,2]}
            ],
            "elapsed_time": 0.0
        }"#;
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir.path().join("dbt_project.yml"),
            "name: app\nversion: '1.0.0'\nprofile: app\n",
        );
        write_file(&dir.path().join("target").join("run_results.json"), json);
        let rr = engine()
            .load_run_results(dir.path().to_path_buf())
            .expect("degrades gracefully");
        assert_eq!(rr.results.len(), 1);
        assert_eq!(rr.results[0].status, "pass");
        assert_eq!(rr.results[0].execution_time, 0.0);
        assert_eq!(rr.results[0].failures, None);
    }
}
