mod constants;
mod query;
pub mod schema_registry;
pub mod sql_parser;

use async_trait::async_trait;
use crate::{
    ConnectionConfig, DriverError, ExplainMode, MutationResult, PlanResult,
    QueryLanguage, QueryResult, QueryStream, QueryValue, RowDelete, RowInsert,
    SchemaNode, SchemaNodeKind, TableRef,
};
use crate::drivers::errors::Result;
use rdkafka::admin::AdminClient;
use rdkafka::client::DefaultClientContext;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::ClientConfig;
use tokio::sync::Mutex;

use crate::drivers::DatabaseDriver;
use constants::METADATA_TIMEOUT;
use schema_registry::SchemaRegistryClient;
use sql_parser::parse_kafka_sql;

pub struct KafkaDriver {
    inner: Mutex<Option<KafkaState>>,
}

struct KafkaState {
    consumer: BaseConsumer,
    #[allow(dead_code)]
    admin: AdminClient<DefaultClientContext>,
    #[allow(dead_code)]
    config: ConnectionConfig,
    #[allow(dead_code)]
    client_config: ClientConfig,
    schema_registry: Option<SchemaRegistryClient>,
}

impl KafkaDriver {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    fn build_client_config(config: &ConnectionConfig) -> ClientConfig {
        let broker = if config.port > 0 {
            format!("{}:{}", config.host, config.port)
        } else {
            format!("{}:9092", config.host)
        };

        let mut cc = ClientConfig::new();
        cc.set("bootstrap.servers", &broker);
        cc.set("group.id", &format!("arris-{}", config.id));
        cc.set("auto.offset.reset", "earliest");
        cc.set("enable.auto.commit", "false");
        cc.set("session.timeout.ms", "10000");

        let tls_on = config.ssl_mode.forces_tls();
        if tls_on {
            cc.set("security.protocol", "SSL");
        }

        if let Some(ref sasl) = config.sasl_mechanism {
            let mech = match sasl {
                crate::SaslMechanism::None => return cc,
                crate::SaslMechanism::Plain => "PLAIN",
                crate::SaslMechanism::ScramSha256 => "SCRAM-SHA-256",
                crate::SaslMechanism::ScramSha512 => "SCRAM-SHA-512",
            };
            let protocol = if tls_on {
                "SASL_SSL"
            } else {
                "SASL_PLAINTEXT"
            };
            cc.set("security.protocol", protocol);
            cc.set("sasl.mechanism", mech);
            cc.set("sasl.username", &config.user);
            cc.set("sasl.password", &config.password);
        }

        cc
    }
}

#[async_trait]
impl DatabaseDriver for KafkaDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()> {
        let cc = Self::build_client_config(config);

        let consumer: BaseConsumer = cc
            .create()
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        let admin: AdminClient<DefaultClientContext> = cc
            .create()
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        consumer
            .fetch_metadata(None, METADATA_TIMEOUT)
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        let schema_registry = config
            .schema_registry_url
            .as_deref()
            .filter(|u| !u.is_empty())
            .map(SchemaRegistryClient::new);

        let mut guard = self.inner.lock().await;
        *guard = Some(KafkaState {
            consumer,
            admin,
            config: config.clone(),
            client_config: cc,
            schema_registry,
        });
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        let guard = self.inner.lock().await;
        guard.is_some()
    }

    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        let guard = self.inner.lock().await;
        let state = guard.as_ref().ok_or(DriverError::NotConnected)?;

        let (topic_info, consumer_groups) = {
            let metadata = state
                .consumer
                .fetch_metadata(None, METADATA_TIMEOUT)
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            let topics: Vec<(String, usize, usize)> = metadata
                .topics()
                .iter()
                .filter(|t| !t.name().starts_with("__") && !t.name().starts_with("_schemas"))
                .map(|t| {
                    let replication_factor = t
                        .partitions()
                        .first()
                        .map(|p| p.replicas().len())
                        .unwrap_or(0);
                    (t.name().to_string(), t.partitions().len(), replication_factor)
                })
                .collect();

            let group_list = state
                .consumer
                .fetch_group_list(None, METADATA_TIMEOUT)
                .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

            let groups: Vec<SchemaNode> = group_list
                .groups()
                .iter()
                .filter(|g| g.protocol_type() == "consumer")
                .map(|g| SchemaNode {
                    name: g.name().to_string(),
                    kind: SchemaNodeKind::ConsumerGroup,
                    path: format!("__consumer_group__{}", g.name()),
                    detail: Some(format!("{} · {} members", g.state(), g.members().len())),
                    children: vec![],
                })
                .collect();

            (topics, groups)
        };

        let mut nodes: Vec<SchemaNode> = Vec::new();

        for (name, partition_count, replication_factor) in &topic_info {
            let children = if let Some(ref sr) = state.schema_registry {
                sr.get_topic_schema_nodes(name).await.unwrap_or_default()
            } else {
                vec![]
            };

            nodes.push(SchemaNode {
                name: name.clone(),
                kind: SchemaNodeKind::Topic,
                path: name.clone(),
                detail: Some(format!(
                    "{partition_count} partitions · RF {replication_factor}"
                )),
                children,
            });
        }

        nodes.extend(consumer_groups);
        nodes.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.name.cmp(&b.name)));
        Ok(nodes)
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
        let start = std::time::Instant::now();
        let parsed_query =
            parse_kafka_sql(text).map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let guard = self.inner.lock().await;
        let state = guard.as_ref().ok_or(DriverError::NotConnected)?;
        let cc = state.client_config.clone();
        drop(guard);

        let query_clone = parsed_query.clone();
        let rows =
            tokio::task::spawn_blocking(move || query::consume_topic_fresh(&cc, &query_clone))
                .await
                .map_err(|e| DriverError::QueryFailed(e.to_string()))??;

        let guard = self.inner.lock().await;
        let state = guard.as_ref().ok_or(DriverError::NotConnected)?;
        let (columns, result_rows) = query::project_rows(&rows, &parsed_query, state).await?;

        Ok(QueryResult {
            columns,
            rows: result_rows,
            rows_affected: None,
            elapsed: start.elapsed().as_secs_f64(),
            ..Default::default()
        })
    }

    async fn run_query_stream(
        &self,
        text: &str,
        params: &[QueryValue],
        language: QueryLanguage,
    ) -> Result<QueryStream> {
        let parsed = parse_kafka_sql(text).map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        // GROUP BY / ORDER BY buffer the whole result to aggregate or sort, so
        // they stay on the materialized path; plain projections stream.
        if !query::is_streamable(&parsed) {
            return Ok(QueryStream::from_materialized(
                self.run_query(text, params, language).await?,
            ));
        }

        let (cc, registry) = {
            let guard = self.inner.lock().await;
            let state = guard.as_ref().ok_or(DriverError::NotConnected)?;
            (state.client_config.clone(), state.schema_registry.clone())
        };
        Ok(QueryStream::Rows(
            query::stream_query(cc, parsed, registry).await?,
        ))
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
        Err(DriverError::Other("Kafka topics are read-only".into()))
    }

    async fn insert_rows(
        &self,
        _table: &TableRef,
        _inserts: &[RowInsert],
    ) -> Result<MutationResult> {
        Err(DriverError::Other("Kafka topics are read-only".into()))
    }

    async fn delete_rows(
        &self,
        _table: &TableRef,
        _deletes: &[RowDelete],
    ) -> Result<MutationResult> {
        Err(DriverError::Other("Kafka topics are read-only".into()))
    }

    fn pagination_strategy(&self) -> crate::PaginationStrategy {
        crate::PaginationStrategy::InMemory
    }

    async fn close(&self) {
        let mut guard = self.inner.lock().await;
        *guard = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sql_parser::{AggFunc, ColumnExpr, SelectClause};

    #[test]
    fn driver_starts_disconnected() {
        let driver = KafkaDriver::new();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        assert!(!rt.block_on(driver.is_connected()));
    }

    #[test]
    fn json_to_query_value_mappings() {
        assert_eq!(query::json_to_query_value(None), QueryValue::Null);
        assert_eq!(query::json_to_query_value(Some(&serde_json::json!(null))), QueryValue::Null);
        assert_eq!(query::json_to_query_value(Some(&serde_json::json!(true))), QueryValue::Bool(true));
        assert_eq!(query::json_to_query_value(Some(&serde_json::json!(42))), QueryValue::Int(42));
        assert_eq!(query::json_to_query_value(Some(&serde_json::json!(3.14))), QueryValue::Double(3.14));
        assert_eq!(query::json_to_query_value(Some(&serde_json::json!("hello"))), QueryValue::Text("hello".into()));
    }

    #[test]
    fn compute_agg_count() {
        let data = vec![serde_json::json!({"x": 1}), serde_json::json!({"x": 2}), serde_json::json!({"x": 3})];
        let rows: Vec<&serde_json::Value> = data.iter().collect();
        assert_eq!(query::compute_agg(AggFunc::Count, &rows, "x"), QueryValue::Int(3));
    }

    #[test]
    fn compute_agg_sum() {
        let data = vec![serde_json::json!({"x": 10}), serde_json::json!({"x": 20})];
        let rows: Vec<&serde_json::Value> = data.iter().collect();
        assert_eq!(query::compute_agg(AggFunc::Sum, &rows, "x"), QueryValue::Double(30.0));
    }

    #[test]
    fn compute_agg_avg() {
        let data = vec![serde_json::json!({"x": 10}), serde_json::json!({"x": 20}), serde_json::json!({"x": 30})];
        let rows: Vec<&serde_json::Value> = data.iter().collect();
        assert_eq!(query::compute_agg(AggFunc::Avg, &rows, "x"), QueryValue::Double(20.0));
    }

    #[test]
    fn compute_agg_min_max() {
        let data = vec![serde_json::json!({"x": 5}), serde_json::json!({"x": 1}), serde_json::json!({"x": 9})];
        let rows: Vec<&serde_json::Value> = data.iter().collect();
        assert_eq!(query::compute_agg(AggFunc::Min, &rows, "x"), QueryValue::Double(1.0));
        assert_eq!(query::compute_agg(AggFunc::Max, &rows, "x"), QueryValue::Double(9.0));
    }

    #[test]
    fn compute_agg_empty() {
        let rows: Vec<&serde_json::Value> = vec![];
        assert_eq!(query::compute_agg(AggFunc::Sum, &rows, "x"), QueryValue::Null);
    }

    #[test]
    fn compare_json_values_ordering() {
        let a = serde_json::json!(1);
        let b = serde_json::json!(2);
        assert_eq!(query::compare_json_values(Some(&a), Some(&b)), std::cmp::Ordering::Less);
        assert_eq!(query::compare_json_values(None, Some(&b)), std::cmp::Ordering::Less);
        assert_eq!(query::compare_json_values(Some(&a), None), std::cmp::Ordering::Greater);
    }

    #[test]
    fn aggregate_rows_group_by() {
        let rows = vec![
            serde_json::json!({"region": "US", "amount": 10}),
            serde_json::json!({"region": "US", "amount": 20}),
            serde_json::json!({"region": "EU", "amount": 5}),
        ];

        let query = sql_parser::KafkaQuery {
            topic: "sales".into(),
            select: SelectClause::Columns(vec![
                sql_parser::SelectColumn { expr: ColumnExpr::Name("region".into()), alias: None },
                sql_parser::SelectColumn { expr: ColumnExpr::Agg(AggFunc::Sum, "amount".into()), alias: Some("total".into()) },
            ]),
            where_conditions: vec![],
            group_by: vec!["region".into()],
            order_by: vec![],
            limit: None,
            from_latest: false,
        };

        let (cols, result) = query::aggregate_rows(&rows, &query).unwrap();
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].name, "region");
        assert_eq!(cols[1].name, "total");
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn read_only_rejects_mutations() {
        let driver = KafkaDriver::new();
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let table = TableRef { database: None, schema: None, name: "t".into() };
        assert!(rt.block_on(driver.insert_rows(&table, &[])).is_err());
        assert!(rt.block_on(driver.delete_rows(&table, &[])).is_err());
    }

    #[test]
    fn pagination_strategy_is_in_memory() {
        let driver = KafkaDriver::new();
        assert_eq!(
            driver.pagination_strategy(),
            crate::PaginationStrategy::InMemory
        );
    }
}
