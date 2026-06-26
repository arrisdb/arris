use std::time::Instant;

use async_trait::async_trait;
use crate::{
    ColumnSpec, ConnectionConfig, DatabaseKind, DriverError, ExplainMode, MutationResult,
    PlanResult, QueryLanguage, QueryResult, QueryValue, RowDelete, RowInsert, SchemaNode,
    TableRef,
};
use crate::drivers::errors::Result;
use tokio::sync::Mutex;

use super::api;
use super::query;
use super::schema;
use super::sql_parser::{self, ColumnSelection};
use crate::drivers::DatabaseDriver;

pub(super) const EXPORT_BASE_URL: &str = "https://data.mixpanel.com/api/2.0/export";
pub(super) const QUERY_API_BASE: &str = "https://mixpanel.com/api/query";
pub(super) const SCHEMAS_API_BASE: &str = "https://mixpanel.com/api/app/projects";
pub(super) const MP_ROOT_NAME: &str = "Mixpanel";
pub(super) const MP_ROOT_PATH: &str = "mixpanel";
pub(super) const MAX_PROPERTY_FETCHES: usize = 50;

pub struct MixpanelDriver {
    inner: Mutex<Option<api::Inner>>,
}

impl MixpanelDriver {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

#[async_trait]
impl DatabaseDriver for MixpanelDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        if config.kind != DatabaseKind::Mixpanel {
            return Err(DriverError::InvalidArgument(
                "MixpanelDriver requires kind == Mixpanel".into(),
            ));
        }
        if config.database.is_empty() {
            return Err(DriverError::ConnectionFailed(
                "Project ID is required (use the 'database' field)".into(),
            ));
        }
        if config.user.is_empty() || config.password.is_empty() {
            return Err(DriverError::ConnectionFailed(
                "Service account username and secret are required".into(),
            ));
        }

        let client = reqwest::Client::new();

        let today = sql_parser::default_to_date();
        let url = format!(
            "{EXPORT_BASE_URL}?project_id={}&from_date={today}&to_date={today}&limit=1",
            &config.database
        );

        let resp = client
            .get(&url)
            .basic_auth(&config.user, Some(&config.password))
            .header("Accept", "text/plain")
            .send()
            .await
            .map_err(|e| DriverError::ConnectionFailed(format!("Mixpanel request failed: {e}")))?;

        let status = resp.status().as_u16();
        if status != 200 && status != 204 {
            return Err(DriverError::ConnectionFailed(format!(
                "Mixpanel auth failed (HTTP {status}). Check project ID and service account credentials."
            )));
        }

        *self.inner.lock().await = Some(api::Inner {
            client,
            project_id: config.database.clone(),
            username: config.user.clone(),
            password: config.password.clone(),
        });

        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let guard = self.inner.lock().await;
        let inner = guard.as_ref().ok_or(DriverError::NotConnected)?;
        let discovered = api::discover_events(inner).await;
        Ok(schema::build_schema_tree(&discovered))
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let all = self.list_schemas().await?;
        Ok(crate::drivers::common::schema::find_schema_node(&all, schema))
    }

    async fn run_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        let guard = self.inner.lock().await;
        let inner = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let started = Instant::now();
        let parsed_query = sql_parser::parse(text)
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let mut all_rows = api::execute_export(inner, &parsed_query).await?;

        if let Some(where_expr) = &parsed_query.where_expression {
            all_rows.retain(|row| sql_parser::evaluate(where_expr, row));
        }

        let has_agg = !parsed_query.group_by.is_empty()
            || parsed_query
                .columns
                .iter()
                .any(|c| matches!(c, ColumnSelection::Aggregation(..)));

        if has_agg {
            all_rows = query::apply_aggregations(&all_rows, &parsed_query);
        } else {
            all_rows = query::select_columns(&all_rows, &parsed_query);
        }

        if !parsed_query.order_by.is_empty() {
            query::apply_order_by(&mut all_rows, &parsed_query.order_by);
        }

        if let Some(limit) = parsed_query.limit {
            all_rows.truncate(limit);
        }

        let columns: Vec<ColumnSpec> = if all_rows.is_empty() {
            sql_parser::resolve_column_names(&parsed_query)
                .into_iter()
                .map(|name| ColumnSpec {
                    name,
                    type_hint: "text".into(),
                })
                .collect()
        } else {
            all_rows[0]
                .iter()
                .map(|(name, val)| {
                    let hint = match val {
                        QueryValue::Int(_) => "bigint",
                        QueryValue::Double(_) => "double",
                        QueryValue::Bool(_) => "boolean",
                        _ => "text",
                    };
                    ColumnSpec {
                        name: name.clone(),
                        type_hint: hint.into(),
                    }
                })
                .collect()
        };

        let col_names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
        let rows: Vec<Vec<QueryValue>> = all_rows
            .iter()
            .map(|row| {
                col_names
                    .iter()
                    .map(|name| row.get(*name).cloned().unwrap_or(QueryValue::Null))
                    .collect()
            })
            .collect();

        Ok(QueryResult {
            columns,
            rows,
            rows_affected: None,
            elapsed: started.elapsed().as_secs_f64(),
            ..Default::default()
        })
    }

    async fn supports_explain(&self, _mode: ExplainMode) -> bool {
        false
    }

    async fn explain_query(
        &self,
        _text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
        _mode: ExplainMode,
    ) -> Result<PlanResult> {
        Err(DriverError::ExplainUnsupported)
    }

    async fn primary_key(&self, _table: &TableRef) -> Result<Option<Vec<String>>> {
        Ok(None)
    }

    async fn update_row(
        &self,
        _table: &TableRef,
        _primary_key: &crate::ValueMap,
        _changes: &crate::ValueMap,
    ) -> Result<MutationResult> {
        Err(DriverError::InvalidArgument(
            "Mixpanel does not support row updates".into(),
        ))
    }

    async fn insert_rows(
        &self,
        _table: &TableRef,
        _inserts: &[RowInsert],
    ) -> Result<MutationResult> {
        Err(DriverError::InvalidArgument(
            "Mixpanel does not support row inserts".into(),
        ))
    }

    async fn delete_rows(
        &self,
        _table: &TableRef,
        _deletes: &[RowDelete],
    ) -> Result<MutationResult> {
        Err(DriverError::InvalidArgument(
            "Mixpanel does not support row deletes".into(),
        ))
    }

    async fn close(&self) {
        *self.inner.lock().await = None;
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::SchemaNodeKind;

    use super::schema;
    use super::*;

    #[test]
    fn build_schema_tree_produces_correct_tree() {
        let mut events = BTreeMap::new();

        let mut signup_props = BTreeMap::new();
        signup_props.insert("$browser".to_owned(), "string".to_owned());
        signup_props.insert("$city".to_owned(), "string".to_owned());
        signup_props.insert("plan".to_owned(), "string".to_owned());
        events.insert("Sign Up".to_owned(), signup_props);

        let mut purchase_props = BTreeMap::new();
        purchase_props.insert("amount".to_owned(), "number".to_owned());
        purchase_props.insert("$browser".to_owned(), "string".to_owned());
        events.insert("Purchase".to_owned(), purchase_props);

        let tree = schema::build_schema_tree(&events);
        assert_eq!(tree.len(), 1);
        let root = &tree[0];
        assert_eq!(root.name, "Mixpanel");
        assert_eq!(root.kind, SchemaNodeKind::Database);
        assert_eq!(root.path, "mixpanel");

        let event_nodes: Vec<&crate::SchemaNode> = root
            .children
            .iter()
            .filter(|c| c.kind == SchemaNodeKind::MixpanelEvent)
            .collect();
        assert_eq!(event_nodes.len(), 2);

        let signup = event_nodes.iter().find(|e| e.name == "Sign Up").unwrap();
        assert_eq!(signup.children.len(), 3);
        let browser_col = signup.children.iter().find(|c| c.name == "$browser").unwrap();
        assert_eq!(browser_col.kind, SchemaNodeKind::Column);
        assert_eq!(browser_col.detail.as_deref(), Some("string"));

        let purchase = event_nodes.iter().find(|e| e.name == "Purchase").unwrap();
        assert_eq!(purchase.children.len(), 2);
        let amount_col = purchase.children.iter().find(|c| c.name == "amount").unwrap();
        assert_eq!(amount_col.detail.as_deref(), Some("number"));

        let global_props: Vec<&crate::SchemaNode> = root
            .children
            .iter()
            .filter(|c| c.kind == SchemaNodeKind::MixpanelEventProperty)
            .collect();
        assert_eq!(global_props.len(), 4);
        let browser_prop = global_props.iter().find(|p| p.name == "$browser").unwrap();
        assert_eq!(browser_prop.path, "mixpanel.properties.$browser");
    }

    #[test]
    fn build_schema_tree_handles_empty_input() {
        let tree = schema::build_schema_tree(&BTreeMap::new());
        assert_eq!(tree.len(), 1);
        assert!(tree[0].children.is_empty());
    }

    #[test]
    fn build_schema_tree_omits_detail_for_empty_type() {
        let mut events = BTreeMap::new();
        let mut props = BTreeMap::new();
        props.insert("$browser".to_owned(), String::new());
        events.insert("Click".to_owned(), props);

        let tree = schema::build_schema_tree(&events);
        let root = &tree[0];
        let click = root
            .children
            .iter()
            .find(|c| c.kind == SchemaNodeKind::MixpanelEvent)
            .unwrap();
        let browser = &click.children[0];
        assert_eq!(browser.name, "$browser");
        assert_eq!(browser.detail, None);
    }

    #[tokio::test]
    async fn driver_starts_disconnected() {
        let d = MixpanelDriver::new();
        assert!(!d.is_connected().await);
    }
}
