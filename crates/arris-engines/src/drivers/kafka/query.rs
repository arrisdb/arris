use futures::stream::{self, StreamExt};
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::message::{BorrowedMessage, Message};
use rdkafka::ClientConfig;
use tokio::sync::mpsc;

use crate::drivers::common::RowChunkPump;
use crate::drivers::constants::STREAM_CHUNK_ROWS;
use crate::drivers::errors::Result;
use crate::{ColumnSpec, DriverError, QueryValue, RowChunkStream};

use super::constants::{
    CONSUME_TIMEOUT, EMPTY_POLLS_BEFORE_STOP, MAX_ROWS, METADATA_TIMEOUT, POLL_INTERVAL,
    STREAM_ROW_CHANNEL_CAPACITY,
};
use super::schema_registry::{columns_from_rows, SchemaRegistryClient};
use super::sql_parser::{
    eval_condition, AggFunc, ColumnExpr, KafkaQuery, SelectClause, SelectColumn,
};
use super::KafkaState;

// ── shared consume helpers ──────────────────────────────────────────────────

/// Create a fresh consumer and assign every partition of the query's topic at
/// the requested start offset. Shared by the buffered and streaming paths.
fn build_assigned_consumer(cc: &ClientConfig, query: &KafkaQuery) -> Result<BaseConsumer> {
    use rdkafka::TopicPartitionList;

    let consumer: BaseConsumer = cc
        .create()
        .map_err(|e| DriverError::QueryFailed(format!("Failed to create consumer: {e}")))?;

    let metadata = consumer
        .fetch_metadata(Some(&query.topic), METADATA_TIMEOUT)
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let topic_meta = metadata
        .topics()
        .first()
        .ok_or_else(|| DriverError::QueryFailed(format!("Topic '{}' not found", query.topic)))?;
    if topic_meta.partitions().is_empty() {
        return Err(DriverError::QueryFailed(format!(
            "Topic '{}' has no partitions",
            query.topic
        )));
    }

    let partition_ids: Vec<i32> = topic_meta.partitions().iter().map(|p| p.id()).collect();
    drop(metadata);

    let offset = if query.from_latest {
        rdkafka::Offset::End
    } else {
        rdkafka::Offset::Beginning
    };
    let mut tpl = TopicPartitionList::new();
    for pid in &partition_ids {
        tpl.add_partition_offset(&query.topic, *pid, offset)
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    }
    consumer
        .assign(&tpl)
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    Ok(consumer)
}

/// Decode a message payload to a JSON row, injecting the `_partition`/`_offset`/
/// `_timestamp` metadata fields. Non-object or non-JSON payloads become `value`.
pub(super) fn build_row(
    payload: &[u8],
    partition: i32,
    offset: i64,
    timestamp_ms: Option<i64>,
) -> serde_json::Value {
    let json_val: serde_json::Value = serde_json::from_slice(payload).unwrap_or_else(|_| {
        serde_json::json!({ "value": String::from_utf8_lossy(payload).to_string() })
    });
    match json_val {
        serde_json::Value::Object(mut map) => {
            map.insert("_partition".to_string(), serde_json::json!(partition));
            map.insert("_offset".to_string(), serde_json::json!(offset));
            if let Some(ts) = timestamp_ms {
                map.insert("_timestamp".to_string(), serde_json::json!(ts));
            }
            serde_json::Value::Object(map)
        }
        other => serde_json::json!({
            "value": other,
            "_partition": partition,
            "_offset": offset,
        }),
    }
}

fn message_to_row(msg: &BorrowedMessage) -> Option<serde_json::Value> {
    let payload = msg.payload()?;
    Some(build_row(
        payload,
        msg.partition(),
        msg.offset(),
        msg.timestamp().to_millis(),
    ))
}

fn passes_filter(row: &serde_json::Value, query: &KafkaQuery) -> bool {
    query
        .where_conditions
        .iter()
        .all(|cond| eval_condition(row, cond))
}

/// A query streams when it needs no whole-result buffering: no `GROUP BY`
/// (aggregate) and no `ORDER BY` (sort). Those take the materialized path.
pub(super) fn is_streamable(query: &KafkaQuery) -> bool {
    query.group_by.is_empty() && query.order_by.is_empty()
}

pub(super) fn consume_topic_fresh(
    cc: &ClientConfig,
    query: &KafkaQuery,
) -> Result<Vec<serde_json::Value>> {
    let consumer = build_assigned_consumer(cc, query)?;

    let max_rows = query.limit.unwrap_or(MAX_ROWS).min(MAX_ROWS);
    let mut rows = Vec::with_capacity(max_rows);
    let deadline = std::time::Instant::now() + CONSUME_TIMEOUT;
    let mut empty_polls = 0u32;

    while rows.len() < max_rows && std::time::Instant::now() < deadline {
        let poll_timeout = deadline
            .saturating_duration_since(std::time::Instant::now())
            .min(POLL_INTERVAL);
        match consumer.poll(poll_timeout) {
            Some(Ok(msg)) => {
                empty_polls = 0;
                let Some(row) = message_to_row(&msg) else {
                    continue;
                };
                if passes_filter(&row, query) {
                    rows.push(row);
                }
            }
            Some(Err(e)) => {
                tracing::warn!("Kafka poll error: {e}");
                break;
            }
            None => {
                empty_polls += 1;
                if !rows.is_empty() && empty_polls >= EMPTY_POLLS_BEFORE_STOP {
                    break;
                }
            }
        }
    }

    Ok(rows)
}

// ── column inference ────────────────────────────────────────────────────────

fn meta_columns() -> Vec<ColumnSpec> {
    vec![
        ColumnSpec { name: "_partition".into(), type_hint: "int".into() },
        ColumnSpec { name: "_offset".into(), type_hint: "long".into() },
        ColumnSpec { name: "_timestamp".into(), type_hint: "long".into() },
    ]
}

pub(super) fn columns_for_select(cols: &[SelectColumn]) -> Vec<ColumnSpec> {
    cols.iter()
        .map(|sc| {
            let name = sc.alias.clone().unwrap_or_else(|| match &sc.expr {
                ColumnExpr::Name(n) => n.clone(),
                ColumnExpr::Agg(func, col) => format!("{func:?}({col})").to_lowercase(),
                ColumnExpr::CountAll => "count(*)".to_string(),
            });
            ColumnSpec { name, type_hint: "text".to_string() }
        })
        .collect()
}

/// Columns known before reading any data: an explicit column list, or a
/// `SELECT *` backed by a schema-registry subject. Returns `None` when the shape
/// must be sampled from the rows (`SELECT *` without a registry).
async fn columns_upfront(
    query: &KafkaQuery,
    registry: Option<&SchemaRegistryClient>,
) -> Option<Vec<ColumnSpec>> {
    match &query.select {
        SelectClause::Columns(cols) => Some(columns_for_select(cols)),
        SelectClause::All => {
            let sr = registry?;
            let subject = format!("{}-value", query.topic);
            let mut cols = sr.get_columns_for_subject(&subject).await.ok()?;
            cols.extend(meta_columns());
            Some(cols)
        }
    }
}

/// `SELECT *` fallback: infer columns from the sampled rows (their field union
/// plus metadata), or a bare `value` column when the topic yielded nothing.
fn columns_from_sample_rows(rows: &[serde_json::Value]) -> Vec<ColumnSpec> {
    if rows.is_empty() {
        let mut cols = vec![ColumnSpec { name: "value".into(), type_hint: "bytes".into() }];
        cols.extend(meta_columns());
        return cols;
    }
    let mut cols = columns_from_rows(rows);
    for mc in meta_columns() {
        if !cols.iter().any(|c| c.name == mc.name) {
            cols.push(mc);
        }
    }
    cols
}

async fn infer_columns(
    rows: &[serde_json::Value],
    query: &KafkaQuery,
    state: &KafkaState,
) -> Vec<ColumnSpec> {
    if let Some(cols) = columns_upfront(query, state.schema_registry.as_ref()).await {
        return cols;
    }
    columns_from_sample_rows(rows)
}

fn project_row(row: &serde_json::Value, columns: &[ColumnSpec]) -> Vec<QueryValue> {
    columns
        .iter()
        .map(|col| json_to_query_value(row.get(&col.name)))
        .collect()
}

// ── streaming ───────────────────────────────────────────────────────────────

/// Blocking poll loop feeding parsed, filtered rows to the async chunker. No row
/// cap (only the query's `LIMIT`); a bounded channel backpressures the consumer.
fn stream_poll_blocking(
    cc: ClientConfig,
    query: KafkaQuery,
    row_tx: mpsc::Sender<Result<serde_json::Value>>,
) {
    let consumer = match build_assigned_consumer(&cc, &query) {
        Ok(c) => c,
        Err(e) => {
            let _ = row_tx.blocking_send(Err(e));
            return;
        }
    };
    let deadline = std::time::Instant::now() + CONSUME_TIMEOUT;
    let mut empty_polls = 0u32;
    let mut sent = 0usize;

    loop {
        if query.limit.is_some_and(|l| sent >= l) {
            break;
        }
        let now = std::time::Instant::now();
        if now >= deadline {
            break;
        }
        let poll_timeout = deadline.saturating_duration_since(now).min(POLL_INTERVAL);
        match consumer.poll(poll_timeout) {
            Some(Ok(msg)) => {
                empty_polls = 0;
                let Some(row) = message_to_row(&msg) else {
                    continue;
                };
                if !passes_filter(&row, &query) {
                    continue;
                }
                if row_tx.blocking_send(Ok(row)).is_err() {
                    return; // consumer dropped: cancel
                }
                sent += 1;
            }
            Some(Err(e)) => {
                let _ = row_tx.blocking_send(Err(DriverError::QueryFailed(e.to_string())));
                return;
            }
            None => {
                empty_polls += 1;
                if sent > 0 && empty_polls >= EMPTY_POLLS_BEFORE_STOP {
                    break;
                }
            }
        }
    }
}

/// Stream a plain projection: resolve columns up front (registry / explicit) or
/// sample the first chunk to fix them, then hand the rest to `RowChunkPump`.
pub(super) async fn stream_query(
    cc: ClientConfig,
    query: KafkaQuery,
    registry: Option<SchemaRegistryClient>,
) -> Result<RowChunkStream> {
    let upfront = columns_upfront(&query, registry.as_ref()).await;

    let (row_tx, row_rx) = mpsc::channel::<Result<serde_json::Value>>(STREAM_ROW_CHANNEL_CAPACITY);
    let poll_query = query.clone();
    tokio::task::spawn_blocking(move || stream_poll_blocking(cc, poll_query, row_tx));

    let mut rows = stream::unfold(row_rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    })
    .boxed();

    let (columns, first): (Vec<ColumnSpec>, Vec<serde_json::Value>) = match upfront {
        Some(cols) => (cols, Vec::new()),
        None => {
            let mut buf = Vec::new();
            while buf.len() < STREAM_CHUNK_ROWS {
                match rows.next().await {
                    Some(Ok(row)) => buf.push(row),
                    Some(Err(e)) => return Err(e),
                    None => break,
                }
            }
            (columns_from_sample_rows(&buf), buf)
        }
    };

    let map_cols = columns.clone();
    let combined = stream::iter(first.into_iter().map(Ok::<_, DriverError>)).chain(rows);
    Ok(RowChunkPump::spawn(
        columns,
        move || async move { Ok::<_, DriverError>(combined) },
        move |row: serde_json::Value| project_row(&row, &map_cols),
    ))
}

// ── projection / aggregation ────────────────────────────────────────────────

pub(super) async fn project_rows(
    rows: &[serde_json::Value],
    query: &KafkaQuery,
    state: &KafkaState,
) -> Result<(Vec<ColumnSpec>, Vec<Vec<QueryValue>>)> {
    if !query.group_by.is_empty() {
        return aggregate_rows(rows, query);
    }

    let columns = infer_columns(rows, query, state).await;

    let mut sorted_rows: Vec<&serde_json::Value> = rows.iter().collect();
    for ob in query.order_by.iter().rev() {
        sorted_rows.sort_by(|a, b| {
            let va = a.get(&ob.column);
            let vb = b.get(&ob.column);
            let cmp = compare_json_values(va, vb);
            if ob.desc {
                cmp.reverse()
            } else {
                cmp
            }
        });
    }

    let result_rows: Vec<Vec<QueryValue>> =
        sorted_rows.iter().map(|row| project_row(row, &columns)).collect();

    Ok((columns, result_rows))
}

pub(super) fn aggregate_rows(
    rows: &[serde_json::Value],
    query: &KafkaQuery,
) -> Result<(Vec<ColumnSpec>, Vec<Vec<QueryValue>>)> {
    let mut groups: indexmap::IndexMap<String, Vec<&serde_json::Value>> = indexmap::IndexMap::new();

    for row in rows {
        let key: String = query
            .group_by
            .iter()
            .map(|col| {
                row.get(col)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "null".to_string())
            })
            .collect::<Vec<_>>()
            .join("|");
        groups.entry(key).or_default().push(row);
    }

    let select_cols = match &query.select {
        SelectClause::Columns(cols) => cols,
        SelectClause::All => {
            return Err(DriverError::QueryFailed(
                "SELECT * with GROUP BY is not supported".into(),
            ))
        }
    };

    let columns = columns_for_select(select_cols);

    let mut result_rows = Vec::new();
    for group_rows in groups.values() {
        let mut row_values = Vec::new();
        for sc in select_cols {
            let val = match &sc.expr {
                ColumnExpr::Name(n) => {
                    json_to_query_value(group_rows.first().and_then(|r| r.get(n)))
                }
                ColumnExpr::CountAll => QueryValue::Int(group_rows.len() as i64),
                ColumnExpr::Agg(func, col) => compute_agg(*func, group_rows, col),
            };
            row_values.push(val);
        }
        result_rows.push(row_values);
    }

    if !query.order_by.is_empty() {
        let col_indices: std::collections::HashMap<&str, usize> = columns
            .iter()
            .enumerate()
            .map(|(i, c)| (c.name.as_str(), i))
            .collect();

        for ob in query.order_by.iter().rev() {
            if let Some(&idx) = col_indices.get(ob.column.as_str()) {
                result_rows.sort_by(|a, b| {
                    let cmp = compare_query_values(&a[idx], &b[idx]);
                    if ob.desc { cmp.reverse() } else { cmp }
                });
            }
        }
    }

    if let Some(limit) = query.limit {
        result_rows.truncate(limit);
    }

    Ok((columns, result_rows))
}

pub(super) fn compute_agg(func: AggFunc, rows: &[&serde_json::Value], col: &str) -> QueryValue {
    let nums: Vec<f64> = rows
        .iter()
        .filter_map(|r| r.get(col).and_then(|v| v.as_f64()))
        .collect();

    if nums.is_empty() {
        return QueryValue::Null;
    }

    match func {
        AggFunc::Count => QueryValue::Int(nums.len() as i64),
        AggFunc::Sum => QueryValue::Double(nums.iter().sum()),
        AggFunc::Avg => QueryValue::Double(nums.iter().sum::<f64>() / nums.len() as f64),
        AggFunc::Min => QueryValue::Double(nums.iter().cloned().fold(f64::INFINITY, f64::min)),
        AggFunc::Max => QueryValue::Double(
            nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
        ),
    }
}

pub(super) fn json_to_query_value(val: Option<&serde_json::Value>) -> QueryValue {
    match val {
        None | Some(serde_json::Value::Null) => QueryValue::Null,
        Some(serde_json::Value::Bool(b)) => QueryValue::Bool(*b),
        Some(serde_json::Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                QueryValue::Int(i)
            } else if let Some(f) = n.as_f64() {
                QueryValue::Double(f)
            } else {
                QueryValue::Text(n.to_string())
            }
        }
        Some(serde_json::Value::String(s)) => QueryValue::Text(s.clone()),
        Some(v @ serde_json::Value::Array(_)) | Some(v @ serde_json::Value::Object(_)) => {
            QueryValue::Json(v.to_string())
        }
    }
}

pub(super) fn compare_json_values(
    a: Option<&serde_json::Value>,
    b: Option<&serde_json::Value>,
) -> std::cmp::Ordering {
    match (a, b) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (Some(_), None) => std::cmp::Ordering::Greater,
        (Some(a), Some(b)) => {
            if let (Some(an), Some(bn)) = (a.as_f64(), b.as_f64()) {
                an.partial_cmp(&bn).unwrap_or(std::cmp::Ordering::Equal)
            } else {
                a.to_string().cmp(&b.to_string())
            }
        }
    }
}

fn compare_query_values(a: &QueryValue, b: &QueryValue) -> std::cmp::Ordering {
    match (a, b) {
        (QueryValue::Int(a), QueryValue::Int(b)) => a.cmp(b),
        (QueryValue::Double(a), QueryValue::Double(b)) => {
            a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
        }
        (QueryValue::Text(a), QueryValue::Text(b)) => a.cmp(b),
        (QueryValue::Null, QueryValue::Null) => std::cmp::Ordering::Equal,
        (QueryValue::Null, _) => std::cmp::Ordering::Less,
        (_, QueryValue::Null) => std::cmp::Ordering::Greater,
        _ => std::cmp::Ordering::Equal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drivers::kafka::sql_parser::{OrderByClause, SelectColumn};

    fn query_all(topic: &str) -> KafkaQuery {
        KafkaQuery {
            topic: topic.into(),
            select: SelectClause::All,
            where_conditions: vec![],
            group_by: vec![],
            order_by: vec![],
            limit: None,
            from_latest: false,
        }
    }

    #[test]
    fn build_row_injects_metadata_into_object() {
        let payload = br#"{"event_id":7,"page":"/home"}"#;
        let row = build_row(payload, 2, 99, Some(1234));
        assert_eq!(row.get("event_id").unwrap(), &serde_json::json!(7));
        assert_eq!(row.get("_partition").unwrap(), &serde_json::json!(2));
        assert_eq!(row.get("_offset").unwrap(), &serde_json::json!(99));
        assert_eq!(row.get("_timestamp").unwrap(), &serde_json::json!(1234));
    }

    #[test]
    fn build_row_wraps_non_object_payload() {
        let row = build_row(b"not json", 0, 1, None);
        assert_eq!(row.get("value").unwrap(), &serde_json::json!("not json"));
        assert_eq!(row.get("_partition").unwrap(), &serde_json::json!(0));
        assert!(row.get("_timestamp").is_none());
    }

    #[test]
    fn project_row_orders_by_columns_and_nulls_missing() {
        let row = serde_json::json!({"a": 1, "b": "x"});
        let cols = vec![
            ColumnSpec { name: "b".into(), type_hint: "text".into() },
            ColumnSpec { name: "missing".into(), type_hint: "text".into() },
            ColumnSpec { name: "a".into(), type_hint: "int".into() },
        ];
        assert_eq!(
            project_row(&row, &cols),
            vec![QueryValue::Text("x".into()), QueryValue::Null, QueryValue::Int(1)]
        );
    }

    #[test]
    fn columns_from_sample_rows_unions_fields_and_appends_meta() {
        let rows = vec![
            serde_json::json!({"a": 1, "_partition": 0, "_offset": 0}),
            serde_json::json!({"a": 2, "b": "x", "_partition": 0, "_offset": 1}),
        ];
        let cols = columns_from_sample_rows(&rows);
        let has = |n: &str| cols.iter().any(|c| c.name == n);
        assert!(has("a"));
        assert!(has("b"));
        assert!(has("_partition"));
        assert!(has("_offset"));
        assert!(has("_timestamp"));
    }

    #[test]
    fn columns_from_sample_rows_empty_yields_value_and_meta() {
        let cols = columns_from_sample_rows(&[]);
        let names: Vec<&str> = cols.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["value", "_partition", "_offset", "_timestamp"]);
    }

    #[tokio::test]
    async fn columns_upfront_uses_explicit_column_list() {
        let mut q = query_all("t");
        q.select = SelectClause::Columns(vec![SelectColumn {
            expr: ColumnExpr::Name("page".into()),
            alias: None,
        }]);
        let cols = columns_upfront(&q, None).await.unwrap();
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "page");
    }

    #[tokio::test]
    async fn columns_upfront_none_for_select_star_without_registry() {
        assert!(columns_upfront(&query_all("t"), None).await.is_none());
    }

    #[test]
    fn is_streamable_only_without_group_or_order() {
        let mut q = query_all("t");
        assert!(is_streamable(&q));
        q.group_by = vec!["region".into()];
        assert!(!is_streamable(&q));
        let mut q2 = query_all("t");
        q2.order_by = vec![OrderByClause { column: "a".into(), desc: false }];
        assert!(!is_streamable(&q2));
    }
}
