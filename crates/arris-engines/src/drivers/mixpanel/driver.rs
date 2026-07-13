use std::time::Instant;

use async_trait::async_trait;
use crate::{
    ConnectionConfig, DatabaseKind, DriverError, ExplainMode, MutationResult, PlanResult,
    QueryLanguage, QueryResult, QueryStream, QueryValue, RowDelete, RowInsert, SchemaNode,
    TableRef,
};
use crate::drivers::errors::Result;
use tokio::sync::Mutex;

use super::api;
use super::query;
use super::schema;
use super::sql_parser::{self, ColumnSelection};
use crate::drivers::DatabaseDriver;

use super::constants::EXPORT_BASE_URL;

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
        let has_agg = !parsed_query.group_by.is_empty()
            || parsed_query
                .columns
                .iter()
                .any(|c| matches!(c, ColumnSelection::Aggregation(..)));

        // Push LIMIT down to the export API when nothing downstream reorders or
        // collapses the rows. ORDER BY and aggregation would make an API-side cut
        // truncate the wrong events, so those buffer fully and get limited below.
        let api_limit = parsed_query
            .limit
            .filter(|_| !has_agg && parsed_query.order_by.is_empty());
        let mut all_rows = api::execute_export(inner, &parsed_query, api_limit).await?;

        if let Some(where_expr) = &parsed_query.where_expression {
            all_rows.retain(|row| sql_parser::evaluate(where_expr, row));
        }

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

        let columns = query::build_columns(&parsed_query, &all_rows);
        let col_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
        let rows: Vec<Vec<QueryValue>> = all_rows
            .iter()
            .map(|row| query::project_row(row, &col_names))
            .collect();

        Ok(QueryResult {
            columns,
            rows,
            rows_affected: None,
            elapsed: started.elapsed().as_secs_f64(),
            ..Default::default()
        })
    }

    async fn run_query_stream(
        &self,
        text: &str,
        params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryStream> {
        let parsed_query =
            sql_parser::parse(text).map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let has_agg = !parsed_query.group_by.is_empty()
            || parsed_query
                .columns
                .iter()
                .any(|c| matches!(c, ColumnSelection::Aggregation(..)));

        // Aggregation and ORDER BY collapse or reorder the whole result, so they
        // need the buffered path; a plain projection with WHERE/LIMIT streams.
        if has_agg || !parsed_query.order_by.is_empty() {
            return Ok(QueryStream::from_materialized(
                self.run_query(text, params, language).await?,
            ));
        }

        let guard = self.inner.lock().await;
        let inner = guard.as_ref().ok_or(DriverError::NotConnected)?;
        let url = api::build_export_url(inner, &parsed_query, parsed_query.limit)?;
        let resp = api::send_export_stream(inner, url).await?;
        Ok(QueryStream::Rows(
            query::stream_export(resp, &parsed_query).await?,
        ))
    }

    fn pagination_strategy(&self) -> crate::PaginationStrategy {
        // The driver buffers the full export result and applies LIMIT itself;
        // the Mixpanel SQL subset cannot parse a wrapped subquery.
        crate::PaginationStrategy::None
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
    fn build_schema_tree_produces_single_events_table() {
        let mut events = BTreeMap::new();

        let mut signup_props = BTreeMap::new();
        signup_props.insert("$browser".to_owned(), "string".to_owned());
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

        // Exactly one table node, `events`.
        assert_eq!(root.children.len(), 1);
        let events_table = &root.children[0];
        assert_eq!(events_table.name, "events");
        assert_eq!(events_table.kind, SchemaNodeKind::Table);
        assert_eq!(events_table.path, "mixpanel.events");

        // Columns = base columns + the union of every event's properties.
        assert!(events_table
            .children
            .iter()
            .all(|c| c.kind == SchemaNodeKind::Column));
        let col_names: Vec<&str> = events_table
            .children
            .iter()
            .map(|c| c.name.as_str())
            .collect();
        for expected in ["event", "time", "distinct_id", "$browser", "plan", "amount"] {
            assert!(col_names.contains(&expected), "missing column {expected}");
        }
        // {$browser, plan, amount} ∪ {event, time, distinct_id} = 6 columns.
        assert_eq!(events_table.children.len(), 6);

        let browser = events_table
            .children
            .iter()
            .find(|c| c.name == "$browser")
            .unwrap();
        assert_eq!(browser.detail.as_deref(), Some("string"));
        assert_eq!(browser.path, "mixpanel.events.$browser");
        let amount = events_table
            .children
            .iter()
            .find(|c| c.name == "amount")
            .unwrap();
        assert_eq!(amount.detail.as_deref(), Some("number"));
    }

    #[test]
    fn build_schema_tree_handles_empty_input() {
        let tree = schema::build_schema_tree(&BTreeMap::new());
        assert_eq!(tree.len(), 1);
        let events_table = &tree[0].children[0];
        assert_eq!(events_table.name, "events");
        assert_eq!(events_table.kind, SchemaNodeKind::Table);
        // Even with no discovered events, the base columns are present.
        let col_names: Vec<&str> = events_table
            .children
            .iter()
            .map(|c| c.name.as_str())
            .collect();
        assert_eq!(col_names, vec!["distinct_id", "event", "time"]);
    }

    #[test]
    fn build_schema_tree_omits_detail_for_empty_type() {
        let mut events = BTreeMap::new();
        let mut props = BTreeMap::new();
        props.insert("custom_prop".to_owned(), String::new());
        events.insert("Click".to_owned(), props);

        let tree = schema::build_schema_tree(&events);
        let events_table = &tree[0].children[0];
        let prop = events_table
            .children
            .iter()
            .find(|c| c.name == "custom_prop")
            .unwrap();
        assert_eq!(prop.detail, None);
    }

    #[tokio::test]
    async fn driver_starts_disconnected() {
        let d = MixpanelDriver::new();
        assert!(!d.is_connected().await);
    }

    #[test]
    fn pagination_strategy_is_none() {
        let d = MixpanelDriver::new();
        assert_eq!(d.pagination_strategy(), crate::PaginationStrategy::None);
    }
}
