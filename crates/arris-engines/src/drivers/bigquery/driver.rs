use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use gcp_bigquery_client::model::query_request::QueryRequest;
use gcp_bigquery_client::Client;
use tokio::sync::Mutex;

use super::query;
use super::schema::{ColumnMeta, DatasetMeta, TableKind, TableMeta};
use crate::drivers::errors::Result;
use crate::drivers::sql_builder::SqlBuilder;
use crate::drivers::DatabaseDriver;
use crate::{
    ConnectionConfig, DatabaseKind, DriverError, ExplainMode, MutationResult, PlanNode,
    PlanResult, QueryLanguage, QueryResult, QueryValue, RowDelete, RowInsert, SchemaNode,
    TableRef, ValueMap,
};

struct ConnState {
    client: Arc<Client>,
    project_id: String,
    /// Optional BigQuery processing location (region/multi-region, e.g. `US`,
    /// `EU`, `asia-northeast1`). When set it is threaded into every
    /// `QueryRequest` so jobs run in the region that holds the datasets;
    /// otherwise BigQuery infers the location and may reject cross-region jobs.
    location: Option<String>,
}

impl ConnState {
    /// Builds a `QueryRequest` for `sql` with this connection's location applied.
    fn query_request(&self, sql: &str) -> QueryRequest {
        build_query_request(sql, self.location.as_deref())
    }
}

/// Builds a `QueryRequest` for `sql`, threading the optional BigQuery
/// processing `location` so the job runs in the region that holds the data.
pub(super) fn build_query_request(sql: &str, location: Option<&str>) -> QueryRequest {
    let mut req = QueryRequest::new(sql);
    req.location = location.map(str::to_owned);
    req
}

pub struct BigqueryDriver {
    inner: Mutex<Option<ConnState>>,
}

impl BigqueryDriver {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Fetches the tables (with their columns) for a single dataset. Used by
    /// `list_schema` so a dataset's tables load lazily on selection rather than
    /// every dataset's metadata loading up front in `list_schemas`.
    async fn fetch_dataset_tables(
        client: &Client,
        project: &str,
        dataset_id: &str,
        location: Option<&str>,
    ) -> Result<Vec<(TableMeta, Vec<ColumnMeta>)>> {
        let tables_sql = format!(
            "SELECT table_name, table_type FROM `{project}.{dataset_id}`.INFORMATION_SCHEMA.TABLES"
        );
        // TABLES is queried non-fatally (same as COLUMNS below): a partial grant
        // where the service account can see the dataset but is denied its
        // `TABLES` view must not fail the load. Denied → return an empty table
        // list so the dataset still renders (with no tables) and every
        // accessible dataset keeps showing.
        let tables_info: Vec<(String, String)> =
            match client.job().query(project, build_query_request(&tables_sql, location)).await {
                Ok(tables_resp) => tables_resp
                    .rows
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|row| {
                        let cells = row.columns.as_ref()?;
                        let name = cells.first()?.value.as_ref()?.as_str()?.to_owned();
                        let table_type = cells.get(1)?.value.as_ref()?.as_str()?.to_owned();
                        Some((name, table_type))
                    })
                    .collect(),
                Err(_) => return Ok(Vec::new()),
            };

        let col_sql = format!(
            "SELECT table_name, column_name, data_type \
             FROM `{project}.{dataset_id}`.INFORMATION_SCHEMA.COLUMNS \
             ORDER BY table_name, ordinal_position"
        );
        let mut columns_map: std::collections::HashMap<String, Vec<ColumnMeta>> =
            std::collections::HashMap::new();
        if let Ok(resp) = client.job().query(project, build_query_request(&col_sql, location)).await {
            for row in resp.rows.as_deref().unwrap_or_default() {
                if let Some(cells) = row.columns.as_ref() {
                    if let (Some(tname), Some(cname), Some(dtype)) = (
                        cells.first().and_then(|c| c.value.as_ref()?.as_str()),
                        cells.get(1).and_then(|c| c.value.as_ref()?.as_str()),
                        cells.get(2).and_then(|c| c.value.as_ref()?.as_str()),
                    ) {
                        columns_map
                            .entry(tname.to_owned())
                            .or_default()
                            .push(ColumnMeta {
                                name: cname.to_owned(),
                                data_type: dtype.to_owned(),
                            });
                    }
                }
            }
        }

        Ok(tables_info
            .into_iter()
            .map(|(name, table_type)| {
                let columns = columns_map.remove(&name).unwrap_or_default();
                (
                    TableMeta {
                        id: name,
                        kind: TableKind::from_bq_type(&table_type),
                    },
                    columns,
                )
            })
            .collect())
    }
}

#[async_trait]
impl DatabaseDriver for BigqueryDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        if config.kind != DatabaseKind::Bigquery {
            return Err(DriverError::InvalidArgument(
                "BigqueryDriver requires kind == Bigquery".into(),
            ));
        }
        if config.database.is_empty() {
            return Err(DriverError::ConnectionFailed(
                "Project ID is required (use the 'database' field)".into(),
            ));
        }

        let client = match &config.credentials_file {
            Some(path) if !path.is_empty() => Client::from_service_account_key_file(path)
                .await
                .map_err(|e| {
                    DriverError::ConnectionFailed(format!("BigQuery auth failed: {e}"))
                })?,
            _ => Client::from_application_default_credentials()
                .await
                .map_err(|e| {
                    DriverError::ConnectionFailed(format!(
                        "BigQuery ADC auth failed: {e}. Set GOOGLE_APPLICATION_CREDENTIALS or provide a credentials file."
                    ))
                })?,
        };

        let location = config
            .location
            .as_ref()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty());

        client
            .job()
            .query(
                &config.database,
                build_query_request("SELECT 1", location.as_deref()),
            )
            .await
            .map_err(|e| {
                DriverError::ConnectionFailed(format!("BigQuery connection test failed: {e}"))
            })?;

        *self.inner.lock().await = Some(ConnState {
            client: Arc::new(client),
            project_id: config.database.clone(),
            location,
        });

        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    /// Lists datasets only (one `SCHEMATA` query, no table/column metadata) so a
    /// BigQuery connection loads cheaply even with many datasets. Tables are
    /// fetched lazily per dataset via [`Self::list_schema`] when the user
    /// selects datasets in the schemas dropdown.
    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let guard = self.inner.lock().await;
        let state = guard.as_ref().ok_or(DriverError::NotConnected)?;
        let client = &state.client;
        let project = &state.project_id;

        let ds_sql = format!(
            "SELECT schema_name FROM `{project}`.INFORMATION_SCHEMA.SCHEMATA"
        );
        let ds_resp = client
            .job()
            .query(project, state.query_request(&ds_sql))
            .await
            .map_err(|e| DriverError::QueryFailed(format!("Failed to list datasets: {e}")))?;

        let datasets: Vec<DatasetMeta> = ds_resp
            .rows
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter_map(|row| {
                row.columns
                    .as_ref()?
                    .first()?
                    .value
                    .as_ref()?
                    .as_str()
                    .map(|s| DatasetMeta { id: s.to_owned() })
            })
            .collect();

        Ok(super::schema::build_datasets_only(project, &datasets))
    }

    /// Fetches a single dataset's tables and columns, returning the populated
    /// `Schema` node so the frontend can merge it into the cached tree when the
    /// user selects that dataset. `schema` is the BigQuery dataset id.
    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let guard = self.inner.lock().await;
        let state = guard.as_ref().ok_or(DriverError::NotConnected)?;
        let project = &state.project_id;

        let tables =
            Self::fetch_dataset_tables(&state.client, project, schema, state.location.as_deref())
                .await?;
        let dataset = DatasetMeta {
            id: schema.to_owned(),
        };
        Ok(vec![super::schema::build_dataset_node(
            project, &dataset, &tables,
        )])
    }

    async fn run_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        let guard = self.inner.lock().await;
        let state = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let started = Instant::now();
        let resp = state
            .client
            .job()
            .query(&state.project_id, state.query_request(text))
            .await
            .map_err(|e| DriverError::QueryFailed(format!("{e}")))?;

        let columns = query::columns_from_response(&resp);
        let col_count = columns.len();
        let rows = query::rows_from_response(&resp, col_count);

        let is_select = self.looks_like_select(text);
        let rows_affected = if is_select {
            None
        } else {
            resp.num_dml_affected_rows
                .as_ref()
                .and_then(|s| s.parse::<i64>().ok())
        };

        Ok(QueryResult {
            columns,
            rows,
            rows_affected,
            elapsed: started.elapsed().as_secs_f64(),
            ..Default::default()
        })
    }

    async fn object_definition(&self, object: &crate::ObjectRef) -> Result<String> {
        let guard = self.inner.lock().await;
        let state = guard.as_ref().ok_or(DriverError::NotConnected)?;
        super::definition::object_definition(
            &state.client,
            &state.project_id,
            object,
            state.location.as_deref(),
        )
        .await
    }

    async fn supports_explain(&self, mode: ExplainMode) -> bool {
        matches!(mode, ExplainMode::DryRun)
    }

    async fn explain_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
        mode: ExplainMode,
    ) -> Result<PlanResult> {
        if mode != ExplainMode::DryRun {
            return Err(DriverError::ExplainUnsupported);
        }

        let guard = self.inner.lock().await;
        let state = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let mut req = state.query_request(text);
        req.dry_run = Some(true);

        let resp = state
            .client
            .job()
            .query(&state.project_id, req)
            .await
            .map_err(|e| DriverError::QueryFailed(format!("{e}")))?;

        let bytes = resp
            .total_bytes_processed
            .as_ref()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);

        let mb = bytes / (1024.0 * 1024.0);
        let label = format!("Dry run — {mb:.2} MB will be processed");
        let mut root = PlanNode::new(&label, "DryRun");
        root.cost_total = Some(bytes);

        let raw = format!("totalBytesProcessed: {bytes}");
        Ok(PlanResult::new(root, mode, raw))
    }

    async fn primary_key(&self, table: &TableRef) -> Result<Option<Vec<String>>> {
        let guard = self.inner.lock().await;
        let state = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let dataset = table.schema.as_deref().unwrap_or("_default");
        let sql = format!(
            "SELECT column_name FROM `{dataset}`.INFORMATION_SCHEMA.KEY_COLUMN_USAGE \
             WHERE table_name = '{}' ORDER BY ordinal_position",
            table.name
        );

        match state.client.job().query(&state.project_id, state.query_request(&sql)).await {
            Ok(resp) => {
                let keys: Vec<String> = resp
                    .rows
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|row| {
                        row.columns
                            .as_ref()?
                            .first()?
                            .value
                            .as_ref()?
                            .as_str()
                            .map(|s| s.to_owned())
                    })
                    .collect();
                if keys.is_empty() { Ok(None) } else { Ok(Some(keys)) }
            }
            Err(_) => Ok(None),
        }
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &ValueMap,
        changes: &ValueMap,
    ) -> Result<MutationResult> {
        let (sql, params) = SqlBuilder::build_update(
            table,
            primary_key,
            changes,
            SqlBuilder::quote_backtick,
            SqlBuilder::placeholder_qmark,
        )
        .map_err(|e| DriverError::InvalidArgument(e.into()))?;

        let guard = self.inner.lock().await;
        let state = guard.as_ref().ok_or(DriverError::NotConnected)?;
        let inlined = inline_params(&sql, params);
        state
            .client
            .job()
            .query(&state.project_id, state.query_request(&inlined))
            .await
            .map_err(|e| DriverError::QueryFailed(format!("{e}")))?;

        Ok(MutationResult {
            rows_affected: 1,
            statements: vec![inlined],
        })
    }

    async fn insert_rows(
        &self,
        table: &TableRef,
        inserts: &[RowInsert],
    ) -> Result<MutationResult> {
        let mut result = MutationResult::default();
        for insert in inserts {
            let (sql, params) = SqlBuilder::build_insert(
                table,
                &insert.values,
                SqlBuilder::quote_backtick,
                SqlBuilder::placeholder_qmark,
            )
            .map_err(|e| DriverError::InvalidArgument(e.into()))?;

            let guard = self.inner.lock().await;
            let state = guard.as_ref().ok_or(DriverError::NotConnected)?;
            let inlined = inline_params(&sql, params);
            state
                .client
                .job()
                .query(&state.project_id, state.query_request(&inlined))
                .await
                .map_err(|e| DriverError::QueryFailed(format!("{e}")))?;
            result.rows_affected += 1;
            result.statements.push(inlined);
        }
        Ok(result)
    }

    async fn delete_rows(
        &self,
        table: &TableRef,
        deletes: &[RowDelete],
    ) -> Result<MutationResult> {
        let mut result = MutationResult::default();
        for delete in deletes {
            let (sql, params) = SqlBuilder::build_delete(
                table,
                &delete.primary_key,
                SqlBuilder::quote_backtick,
                SqlBuilder::placeholder_qmark,
            )
            .map_err(|e| DriverError::InvalidArgument(e.into()))?;

            let guard = self.inner.lock().await;
            let state = guard.as_ref().ok_or(DriverError::NotConnected)?;
            let inlined = inline_params(&sql, params);
            state
                .client
                .job()
                .query(&state.project_id, state.query_request(&inlined))
                .await
                .map_err(|e| DriverError::QueryFailed(format!("{e}")))?;
            result.rows_affected += 1;
            result.statements.push(inlined);
        }
        Ok(result)
    }

    async fn close(&self) {
        *self.inner.lock().await = None;
    }
}

fn inline_params(sql: &str, params: Vec<QueryValue>) -> String {
    let mut result = String::with_capacity(sql.len());
    let mut param_idx = 0;
    for ch in sql.chars() {
        if ch == '?' {
            if let Some(val) = params.get(param_idx) {
                match val {
                    QueryValue::Null => result.push_str("NULL"),
                    QueryValue::Bool(b) => result.push_str(if *b { "TRUE" } else { "FALSE" }),
                    QueryValue::Int(i) => result.push_str(&i.to_string()),
                    QueryValue::Double(f) => result.push_str(&f.to_string()),
                    QueryValue::Decimal(s) => result.push_str(s),
                    QueryValue::Text(s) => {
                        result.push('\'');
                        result.push_str(&s.replace('\'', "\\'"));
                        result.push('\'');
                    }
                    QueryValue::Data(d) => {
                        result.push_str("b'");
                        for b in d {
                            result.push_str(&format!("\\x{b:02x}"));
                        }
                        result.push('\'');
                    }
                    QueryValue::Json(j) => {
                        result.push_str("JSON '");
                        result.push_str(&j.replace('\'', "\\'"));
                        result.push('\'');
                    }
                };
                param_idx += 1;
            } else {
                result.push(ch);
            }
        } else {
            result.push(ch);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn driver_starts_disconnected() {
        let d = BigqueryDriver::new();
        assert!(!d.is_connected().await);
    }

    #[test]
    fn inline_params_replaces_placeholders() {
        let sql = "UPDATE t SET a = ?, b = ? WHERE id = ?";
        let params = vec![
            QueryValue::Text("hello".into()),
            QueryValue::Int(42),
            QueryValue::Int(1),
        ];
        let result = inline_params(sql, params);
        assert_eq!(result, "UPDATE t SET a = 'hello', b = 42 WHERE id = 1");
    }

    #[test]
    fn inline_params_handles_null() {
        let result = inline_params("SELECT ?", vec![QueryValue::Null]);
        assert_eq!(result, "SELECT NULL");
    }

    #[test]
    fn inline_params_escapes_single_quotes() {
        let result = inline_params("SELECT ?", vec![QueryValue::Text("it's".into())]);
        assert_eq!(result, "SELECT 'it\\'s'");
    }

    #[test]
    fn inline_params_no_placeholders() {
        let result = inline_params("SELECT 1", vec![]);
        assert_eq!(result, "SELECT 1");
    }

    #[test]
    fn build_query_request_applies_location() {
        let req = build_query_request("SELECT 1", Some("EU"));
        assert_eq!(req.location.as_deref(), Some("EU"));
        assert_eq!(req.query, "SELECT 1");
    }

    #[test]
    fn build_query_request_omits_location_when_none() {
        let req = build_query_request("SELECT 1", None);
        assert!(req.location.is_none());
    }
}
