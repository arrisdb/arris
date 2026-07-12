mod constants;
mod query;
mod schema;

use std::time::Instant;

use async_trait::async_trait;
use indexmap::IndexMap;
use reqwest::Client;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::{
    ColumnSpec, ConnectionConfig, DriverError, ExplainMode, MutationResult, PlanResult,
    QueryLanguage, QueryResult, QueryStream, QueryValue, RowDelete, RowInsert, SchemaNode,
    SchemaNodeKind, TableRef,
};
use crate::drivers::errors::Result;

use crate::drivers::DatabaseDriver;

use query::{
    encode_path_part, es_value_to_query, flatten_source, parse_request, post_sql_page,
    query_value_to_json, sql_columns, sql_cursor, sql_first_payload, sql_rows, stream_sql,
};
use schema::{
    alias_nodes, data_stream_nodes, field_nodes_from_mapping, index_template_nodes, schema_path,
};

pub struct ElasticsearchDriver {
    inner: Mutex<Option<EsState>>,
}

struct EsState {
    client: Client,
    base_url: String,
}

const ES_ROOT_NAME: &str = "Elasticsearch";
const ES_ROOT_PATH: &str = "elasticsearch";

impl ElasticsearchDriver {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    fn build_base_url(config: &ConnectionConfig) -> String {
        let scheme = if config.ssl_mode.forces_tls() { "https" } else { "http" };
        let host = if config.host.is_empty() {
            "localhost"
        } else {
            &config.host
        };
        let port = if config.port > 0 { config.port } else { 9200 };
        format!("{scheme}://{host}:{port}")
    }

    async fn get_json(st: &EsState, path: &str) -> Result<Value> {
        let resp = st
            .client
            .get(format!("{}{}", st.base_url, path))
            .send()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        if !status.is_success() {
            let err_msg = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| {
                    v["error"]["reason"]
                        .as_str()
                        .or_else(|| v["error"]["root_cause"][0]["reason"].as_str())
                        .or_else(|| v["error"].as_str())
                        .map(ToOwned::to_owned)
                })
                .unwrap_or(body);
            return Err(DriverError::QueryFailed(format!(
                "HTTP {status}: {err_msg}"
            )));
        }

        serde_json::from_str(&body).map_err(|e| DriverError::QueryFailed(e.to_string()))
    }

    async fn mapping_children(
        st: &EsState,
        target: &str,
        node_path: &str,
    ) -> Result<Vec<SchemaNode>> {
        let target = encode_path_part(target);
        let mapping = Self::get_json(st, &format!("/{target}/_mapping")).await?;
        Ok(field_nodes_from_mapping(node_path, &mapping))
    }

    /// Returns the leading SQL keyword (uppercased), skipping leading whitespace,
    /// `--` line comments, `/* */` block comments, and opening parentheses.
    fn leading_keyword(sql: &str) -> String {
        let mut rest = sql.trim_start();
        loop {
            if let Some(after) = rest.strip_prefix("--") {
                rest = after.splitn(2, '\n').nth(1).unwrap_or("").trim_start();
            } else if let Some(after) = rest.strip_prefix("/*") {
                rest = after.splitn(2, "*/").nth(1).unwrap_or("").trim_start();
            } else if let Some(after) = rest.strip_prefix('(') {
                rest = after.trim_start();
            } else {
                break;
            }
        }
        rest.chars()
            .take_while(|c| c.is_ascii_alphabetic())
            .collect::<String>()
            .to_uppercase()
    }

    /// Elasticsearch SQL only supports read statements, and even among reads it
    /// rejects CTEs. Catch the unsupported forms up front with a clear message
    /// instead of letting a confusing driver error surface: write statements
    /// (UPDATE/INSERT/DELETE) otherwise yield a raw `mismatched input` parser
    /// error, and `WITH` parses but resolves the CTE alias as a missing index
    /// (`Unknown index [...]`).
    fn ensure_read_only_sql(sql: &str) -> Result<()> {
        const READ_KEYWORDS: [&str; 7] = [
            "SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "SYS", "DEBUG",
        ];
        let keyword = Self::leading_keyword(sql);
        if keyword.is_empty() || READ_KEYWORDS.contains(&keyword.as_str()) {
            return Ok(());
        }
        if keyword == "WITH" {
            return Err(DriverError::QueryFailed(
                "Elasticsearch SQL does not support CTEs (WITH ... AS). Inline the subquery into the SELECT instead."
                    .to_string(),
            ));
        }
        Err(DriverError::QueryFailed(
            "Elasticsearch SQL only supports SELECT queries (UPDATE/INSERT/DELETE are not supported)."
                .to_string(),
        ))
    }

    async fn run_sql_query(st: &EsState, sql: &str, started: Instant) -> Result<QueryResult> {
        Self::ensure_read_only_sql(sql)?;

        // First page carries the column metadata; subsequent pages are fetched by
        // replaying the returned cursor so a full-table scan returns every row
        // instead of truncating at `fetch_size`. The cursor is absent on the
        // final page (and is auto-closed by ES once exhausted).
        let sql_url = format!("{}/_sql", st.base_url);
        let mut body = post_sql_page(&st.client, &sql_url, &sql_first_payload(sql)).await?;
        let columns = sql_columns(&body);
        let mut rows = sql_rows(&body);

        let mut cursor = sql_cursor(&body);
        while let Some(c) = cursor {
            body = post_sql_page(&st.client, &sql_url, &serde_json::json!({ "cursor": c })).await?;
            rows.extend(sql_rows(&body));
            cursor = sql_cursor(&body);
        }

        Ok(QueryResult {
            columns,
            rows,
            rows_affected: None,
            elapsed: started.elapsed().as_secs_f64(),
            ..Default::default()
        })
    }
}

#[async_trait]
impl DatabaseDriver for ElasticsearchDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let base_url = Self::build_base_url(config);

        let mut builder = Client::builder();
        if config.ssl_mode.forces_tls() {
            builder = builder.danger_accept_invalid_certs(true);
        }
        let client = builder
            .build()
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        let mut req = client.get(format!("{base_url}/"));
        if !config.user.is_empty() {
            req = req.basic_auth(&config.user, Some(&config.password));
        }

        let resp = req
            .send()
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(DriverError::ConnectionFailed(format!(
                "HTTP {}",
                resp.status()
            )));
        }

        *self.inner.lock().await = Some(EsState { client, base_url });
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let guard = self.inner.lock().await;
        let st = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let indices = Self::get_json(
            st,
            "/_cat/indices?format=json&expand_wildcards=all&h=index,health,docs.count",
        )
        .await?;
        let aliases = Self::get_json(st, "/_aliases?expand_wildcards=all").await?;
        let templates = Self::get_json(st, "/_index_template").await?;
        let data_streams = Self::get_json(st, "/_data_stream").await?;

        let mut children: Vec<SchemaNode> = Vec::new();

        for idx_val in indices.as_array().map(Vec::as_slice).unwrap_or(&[]) {
            let index_name = idx_val["index"].as_str().unwrap_or_default().to_owned();
            if index_name.is_empty() {
                continue;
            }

            let path = schema_path("indices", &index_name);
            let field_children = Self::mapping_children(st, &index_name, &path).await?;
            let health = idx_val["health"].as_str().unwrap_or("unknown");
            let docs = idx_val["docs.count"].as_str().unwrap_or("?");

            children.push(
                SchemaNode::new(&index_name, SchemaNodeKind::ElasticsearchIndex, path)
                    .with_detail(format!("{health} · {docs} docs"))
                    .with_children(field_children),
            );
        }

        for mut alias in alias_nodes(&aliases) {
            let field_children = Self::mapping_children(st, &alias.name, &alias.path).await?;
            alias.children = field_children;
            children.push(alias);
        }
        children.extend(index_template_nodes(&templates));
        for mut stream in data_stream_nodes(&data_streams) {
            let field_children = Self::mapping_children(st, &stream.name, &stream.path).await?;
            stream.children = field_children;
            children.push(stream);
        }
        children.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(vec![
            SchemaNode::new(ES_ROOT_NAME, SchemaNodeKind::Database, ES_ROOT_PATH)
                .with_children(children),
        ])
    }

    async fn list_schema(&self, schema: &str) -> Result<Vec<SchemaNode>> {
        let all = self.list_schemas().await?;
        Ok(crate::drivers::common::schema::find_schema_node(&all, schema))
    }

    async fn run_query(
        &self,
        text: &str,
        _params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryResult> {
        let guard = self.inner.lock().await;
        let st = guard.as_ref().ok_or(DriverError::NotConnected)?;
        let started = Instant::now();

        if language == QueryLanguage::Sql {
            return Self::run_sql_query(st, text, started).await;
        }

        let parsed = parse_request(text, "");
        let url = format!("{}{}", st.base_url, parsed.path);

        let req = match parsed.method.as_str() {
            "GET" => {
                let r = st.client.get(&url);
                if let Some(b) = &parsed.body {
                    r.header("content-type", "application/json").body(b.clone())
                } else {
                    r
                }
            }
            "PUT" => {
                let r = st.client.put(&url);
                if let Some(b) = &parsed.body {
                    r.header("content-type", "application/json").body(b.clone())
                } else {
                    r
                }
            }
            "DELETE" => st.client.delete(&url),
            "HEAD" => st.client.head(&url),
            _ => {
                let r = st.client.post(&url);
                if let Some(b) = &parsed.body {
                    r.header("content-type", "application/json").body(b.clone())
                } else {
                    r
                }
            }
        };

        let resp = req
            .send()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        if !status.is_success() {
            let err_msg = body["error"]["reason"]
                .as_str()
                .or_else(|| body["error"].as_str())
                .unwrap_or("Unknown error");
            return Err(DriverError::QueryFailed(format!(
                "HTTP {status}: {err_msg}"
            )));
        }

        if let Some(hits) = body["hits"]["hits"].as_array() {
            let mut all_keys: IndexMap<String, ()> = IndexMap::new();
            all_keys.insert("_index".into(), ());
            all_keys.insert("_id".into(), ());

            let flat_rows: Vec<IndexMap<String, QueryValue>> = hits
                .iter()
                .map(|hit| {
                    let mut row = IndexMap::new();
                    row.insert("_index".into(), es_value_to_query(&hit["_index"]));
                    row.insert("_id".into(), es_value_to_query(&hit["_id"]));
                    let source = flatten_source(&hit["_source"]);
                    for (k, v) in source {
                        all_keys.insert(k.clone(), ());
                        row.insert(k, v);
                    }
                    row
                })
                .collect();

            let columns: Vec<ColumnSpec> = all_keys
                .keys()
                .map(|k| ColumnSpec::new(k, "dynamic"))
                .collect();

            let rows: Vec<Vec<QueryValue>> = flat_rows
                .iter()
                .map(|row| {
                    all_keys
                        .keys()
                        .map(|k| row.get(k).cloned().unwrap_or(QueryValue::Null))
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
        } else {
            let columns = vec![ColumnSpec::new("result", "json")];
            let rows = vec![vec![QueryValue::Json(
                serde_json::to_string_pretty(&body).unwrap_or_default(),
            )]];
            Ok(QueryResult {
                columns,
                rows,
                rows_affected: None,
                elapsed: started.elapsed().as_secs_f64(),
                ..Default::default()
            })
        }
    }

    async fn run_query_stream(
        &self,
        text: &str,
        params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryStream> {
        // Only SQL SELECT streams via the `_sql` cursor; native `_search` and
        // writes are bounded or single-shot, so the materialized path is fine.
        if language != QueryLanguage::Sql {
            return Ok(QueryStream::from_materialized(
                self.run_query(text, params, language).await?,
            ));
        }
        Self::ensure_read_only_sql(text)?;
        let (client, base_url) = {
            let guard = self.inner.lock().await;
            let st = guard.as_ref().ok_or(DriverError::NotConnected)?;
            (st.client.clone(), st.base_url.clone())
        };
        Ok(QueryStream::Rows(stream_sql(client, base_url, text).await?))
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
        Ok(Some(vec!["_id".into()]))
    }

    async fn update_row(
        &self,
        table: &TableRef,
        primary_key: &crate::ValueMap,
        changes: &crate::ValueMap,
    ) -> Result<MutationResult> {
        let guard = self.inner.lock().await;
        let st = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let doc_id = primary_key
            .get("_id")
            .and_then(|v| match v {
                QueryValue::Text(s) => Some(s.clone()),
                _ => None,
            })
            .ok_or_else(|| DriverError::InvalidArgument("_id required for update".into()))?;

        let index = &table.name;
        let doc: serde_json::Map<String, Value> = changes
            .iter()
            .map(|(k, v)| (k.clone(), query_value_to_json(v)))
            .collect();

        let body = serde_json::json!({ "doc": doc });
        let url = format!("{}/{index}/_update/{doc_id}", st.base_url);

        let resp = st
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        if !resp.status().is_success() {
            let err: Value = resp.json().await.unwrap_or_default();
            let msg = err["error"]["reason"].as_str().unwrap_or("update failed");
            return Err(DriverError::QueryFailed(msg.to_string()));
        }

        Ok(MutationResult {
            rows_affected: 1,
            statements: vec![format!("POST /{index}/_update/{doc_id}")],
        })
    }

    async fn insert_rows(&self, table: &TableRef, inserts: &[RowInsert]) -> Result<MutationResult> {
        let guard = self.inner.lock().await;
        let st = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let index = &table.name;
        let mut result = MutationResult::default();

        for ins in inserts {
            let doc: serde_json::Map<String, Value> = ins
                .values
                .iter()
                .map(|(k, v)| (k.clone(), query_value_to_json(v)))
                .collect();

            let url = format!("{}/{index}/_doc", st.base_url);
            let resp = st
                .client
                .post(&url)
                .json(&doc)
                .send()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            if !resp.status().is_success() {
                let err: Value = resp.json().await.unwrap_or_default();
                let msg = err["error"]["reason"].as_str().unwrap_or("insert failed");
                return Err(DriverError::QueryFailed(msg.to_string()));
            }

            result.rows_affected += 1;
            result.statements.push(format!("POST /{index}/_doc"));
        }

        Ok(result)
    }

    async fn delete_rows(&self, table: &TableRef, deletes: &[RowDelete]) -> Result<MutationResult> {
        let guard = self.inner.lock().await;
        let st = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let index = &table.name;
        let mut result = MutationResult::default();

        for del in deletes {
            let doc_id = del
                .primary_key
                .get("_id")
                .and_then(|v| match v {
                    QueryValue::Text(s) => Some(s.clone()),
                    _ => None,
                })
                .ok_or_else(|| DriverError::InvalidArgument("_id required for delete".into()))?;

            let url = format!("{}/{index}/_doc/{doc_id}", st.base_url);
            let resp = st
                .client
                .delete(&url)
                .send()
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            if !resp.status().is_success() {
                let err: Value = resp.json().await.unwrap_or_default();
                let msg = err["error"]["reason"].as_str().unwrap_or("delete failed");
                return Err(DriverError::QueryFailed(msg.to_string()));
            }

            result.rows_affected += 1;
            result
                .statements
                .push(format!("DELETE /{index}/_doc/{doc_id}"));
        }

        Ok(result)
    }

    fn pagination_strategy(&self) -> crate::PaginationStrategy {
        crate::PaginationStrategy::None
    }

    async fn close(&self) {
        let _ = self.inner.lock().await.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use query::{es_value_to_query, flatten_source, parse_request, query_value_to_json};
    use schema::{alias_nodes, data_stream_nodes, field_nodes_from_mapping, index_template_nodes};

    #[test]
    fn ensure_read_only_sql_allows_read_statements() {
        for sql in [
            "SELECT * FROM customers",
            "  select 1",
            "SHOW TABLES",
            "DESCRIBE customers",
            "DESC customers",
            "EXPLAIN SELECT * FROM customers",
            "-- comment\nSELECT 1",
            "/* block */ SELECT 1",
            "(SELECT 1)",
        ] {
            assert!(
                ElasticsearchDriver::ensure_read_only_sql(sql).is_ok(),
                "expected read statement to be allowed: {sql}"
            );
        }
    }

    #[test]
    fn ensure_read_only_sql_rejects_write_statements() {
        for sql in [
            "UPDATE customers SET email = 'abc' WHERE customer_id = 1;",
            "INSERT INTO customers VALUES (1)",
            "DELETE FROM customers WHERE id = 1",
            "drop table customers",
        ] {
            let err = ElasticsearchDriver::ensure_read_only_sql(sql).unwrap_err();
            assert_eq!(
                err.to_string(),
                "query failed: Elasticsearch SQL only supports SELECT queries (UPDATE/INSERT/DELETE are not supported)."
            );
        }
    }

    #[test]
    fn ensure_read_only_sql_rejects_ctes() {
        for sql in [
            "WITH cus AS (SELECT * FROM customers) SELECT * FROM cus",
            "  with t as (select 1) select * from t",
        ] {
            let err = ElasticsearchDriver::ensure_read_only_sql(sql).unwrap_err();
            assert_eq!(
                err.to_string(),
                "query failed: Elasticsearch SQL does not support CTEs (WITH ... AS). Inline the subquery into the SELECT instead."
            );
        }
    }

    #[test]
    fn leading_keyword_strips_comments_and_parens() {
        assert_eq!(ElasticsearchDriver::leading_keyword("  SELECT 1"), "SELECT");
        assert_eq!(ElasticsearchDriver::leading_keyword("(select 1)"), "SELECT");
        assert_eq!(
            ElasticsearchDriver::leading_keyword("-- c\nUPDATE x"),
            "UPDATE"
        );
        assert_eq!(ElasticsearchDriver::leading_keyword("/* c */ delete"), "DELETE");
        assert_eq!(ElasticsearchDriver::leading_keyword("   "), "");
    }

    #[test]
    fn parse_request_with_method_and_path() {
        let p = parse_request("GET /myindex/_search\n{\"query\":{\"match_all\":{}}}", "");
        assert_eq!(p.method, "GET");
        assert_eq!(p.path, "/myindex/_search");
        assert_eq!(p.body.as_deref(), Some("{\"query\":{\"match_all\":{}}}"));
    }

    #[test]
    fn parse_request_defaults_to_post_search() {
        let p = parse_request("{\"query\":{\"match_all\":{}}}", "products");
        assert_eq!(p.method, "POST");
        assert_eq!(p.path, "/products/_search");
        assert_eq!(p.body.as_deref(), Some("{\"query\":{\"match_all\":{}}}"));
    }

    #[test]
    fn parse_request_no_default_index() {
        let p = parse_request("{}", "");
        assert_eq!(p.path, "/_all/_search");
    }

    #[test]
    fn parse_request_delete_no_body() {
        let p = parse_request("DELETE /myindex/_doc/abc123", "");
        assert_eq!(p.method, "DELETE");
        assert_eq!(p.path, "/myindex/_doc/abc123");
        assert!(p.body.is_none());
    }

    #[test]
    fn parse_request_put_with_body() {
        let p = parse_request("PUT /myindex\n{\"mappings\":{}}", "");
        assert_eq!(p.method, "PUT");
        assert_eq!(p.path, "/myindex");
        assert_eq!(p.body.as_deref(), Some("{\"mappings\":{}}"));
    }

    #[test]
    fn es_value_conversions() {
        assert_eq!(es_value_to_query(&Value::Null), QueryValue::Null);
        assert_eq!(
            es_value_to_query(&Value::Bool(true)),
            QueryValue::Bool(true)
        );
        assert_eq!(
            es_value_to_query(&serde_json::json!(42)),
            QueryValue::Int(42)
        );
        assert_eq!(
            es_value_to_query(&serde_json::json!(3.14)),
            QueryValue::Double(3.14)
        );
        assert_eq!(
            es_value_to_query(&serde_json::json!("hello")),
            QueryValue::Text("hello".into())
        );
    }

    #[test]
    fn es_array_value_returns_json_variant() {
        let arr = serde_json::json!([1, 2, 3]);
        match es_value_to_query(&arr) {
            QueryValue::Json(s) => {
                let parsed: Value = serde_json::from_str(&s).unwrap();
                assert_eq!(parsed, serde_json::json!([1, 2, 3]));
            }
            other => panic!("expected QueryValue::Json, got {other:?}"),
        }
    }

    #[test]
    fn es_object_value_returns_json_variant() {
        let obj = serde_json::json!({"key": "value"});
        match es_value_to_query(&obj) {
            QueryValue::Json(s) => {
                let parsed: Value = serde_json::from_str(&s).unwrap();
                assert_eq!(parsed, serde_json::json!({"key": "value"}));
            }
            other => panic!("expected QueryValue::Json, got {other:?}"),
        }
    }

    #[test]
    fn mapping_fields_include_nested_objects_and_multi_fields() {
        let mapping = serde_json::json!({
            "orders": {
                "mappings": {
                    "properties": {
                        "customer": {
                            "type": "text",
                            "fields": {
                                "keyword": { "type": "keyword" }
                            }
                        },
                        "shipping": {
                            "properties": {
                                "city": { "type": "keyword" }
                            }
                        }
                    }
                }
            }
        });

        let nodes = field_nodes_from_mapping("elasticsearch.indices.orders", &mapping);
        let customer = nodes.iter().find(|n| n.name == "customer").unwrap();
        assert_eq!(customer.kind, SchemaNodeKind::Column);
        assert_eq!(customer.detail.as_deref(), Some("text"));
        assert_eq!(customer.children[0].name, "keyword");
        assert_eq!(customer.children[0].detail.as_deref(), Some("keyword"));

        let shipping = nodes.iter().find(|n| n.name == "shipping").unwrap();
        assert_eq!(shipping.detail.as_deref(), Some("object"));
        assert_eq!(shipping.children[0].name, "city");
    }

    #[test]
    fn aliases_are_deduped_across_indices() {
        let aliases = serde_json::json!({
            "orders_v1": { "aliases": { "orders": {} } },
            "orders_v2": { "aliases": { "orders": {}, "orders_write": {} } }
        });

        let nodes = alias_nodes(&aliases);
        let orders = nodes.iter().find(|n| n.name == "orders").unwrap();
        assert_eq!(orders.kind, SchemaNodeKind::ElasticsearchAlias);
        assert_eq!(
            orders.detail.as_deref(),
            Some("alias -> orders_v1, orders_v2")
        );
        assert_eq!(orders.path, "elasticsearch.aliases.orders");
        assert_eq!(nodes.len(), 2);
    }

    #[test]
    fn index_templates_and_data_streams_become_metadata_nodes() {
        let templates = serde_json::json!({
            "index_templates": [{
                "name": "logs-template",
                "index_template": {
                    "index_patterns": ["logs-*"],
                    "template": {
                        "mappings": {
                            "properties": {
                                "message": { "type": "text" }
                            }
                        }
                    }
                }
            }]
        });
        let streams = serde_json::json!({
            "data_streams": [{
                "name": "logs-prod",
                "status": "GREEN",
                "indices": [
                    { "index_name": ".ds-logs-prod-000001" },
                    { "index_name": ".ds-logs-prod-000002" }
                ]
            }]
        });

        let template_nodes = index_template_nodes(&templates);
        assert_eq!(
            template_nodes[0].kind,
            SchemaNodeKind::ElasticsearchIndexTemplate
        );
        assert_eq!(template_nodes[0].detail.as_deref(), Some("logs-*"));
        assert_eq!(template_nodes[0].children[0].name, "message");

        let stream_nodes = data_stream_nodes(&streams);
        assert_eq!(
            stream_nodes[0].kind,
            SchemaNodeKind::ElasticsearchDataStream
        );
        assert_eq!(
            stream_nodes[0].detail.as_deref(),
            Some("GREEN · 2 backing indices")
        );
    }

    #[test]
    fn pagination_strategy_is_none() {
        let driver = ElasticsearchDriver::new();
        assert_eq!(
            driver.pagination_strategy(),
            crate::PaginationStrategy::None
        );
    }

    #[test]
    fn flatten_source_extracts_fields() {
        let source = serde_json::json!({"name": "test", "count": 42});
        let flat = flatten_source(&source);
        assert_eq!(flat.len(), 2);
        assert_eq!(flat["name"], QueryValue::Text("test".into()));
        assert_eq!(flat["count"], QueryValue::Int(42));
    }

    #[test]
    fn query_value_to_json_roundtrips() {
        assert_eq!(query_value_to_json(&QueryValue::Null), Value::Null);
        assert_eq!(
            query_value_to_json(&QueryValue::Text("hi".into())),
            Value::String("hi".into())
        );
        assert_eq!(
            query_value_to_json(&QueryValue::Int(99)),
            serde_json::json!(99)
        );
        assert_eq!(
            query_value_to_json(&QueryValue::Bool(false)),
            Value::Bool(false)
        );
    }

    #[test]
    fn build_base_url_defaults() {
        let cfg = ConnectionConfig::new("test", crate::DatabaseKind::Elasticsearch);
        let url = ElasticsearchDriver::build_base_url(&cfg);
        assert_eq!(url, "http://localhost:9200");
    }

    #[test]
    fn build_base_url_custom() {
        let mut cfg = ConnectionConfig::new("test", crate::DatabaseKind::Elasticsearch);
        cfg.host = "es.example.com".into();
        cfg.port = 9201;
        cfg.ssl_mode = crate::SslMode::Required;
        let url = ElasticsearchDriver::build_base_url(&cfg);
        assert_eq!(url, "https://es.example.com:9201");
    }

    #[tokio::test]
    async fn driver_starts_disconnected() {
        let d = ElasticsearchDriver::new();
        assert!(!d.is_connected().await);
    }

    #[tokio::test]
    async fn primary_key_returns_id() {
        let driver = ElasticsearchDriver::new();
        let table = TableRef::new("test_index");
        let result = driver.primary_key(&table).await.unwrap();
        assert_eq!(result, Some(vec!["_id".to_string()]));
    }

    #[cfg(feature = "elasticsearch")]
    #[test]
    fn factory_returns_elasticsearch_driver() {
        let d = crate::driver_for_kind(crate::DatabaseKind::Elasticsearch);
        assert!(d.is_ok());
    }
}
