use std::time::Duration;

use crate::{ColumnSpec, DriverError, QueryValue};
use crate::drivers::errors::Result;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::message::Message;
use rdkafka::ClientConfig;

use super::schema_registry::columns_from_json_sample;
use super::sql_parser::{AggFunc, ColumnExpr, KafkaQuery, SelectClause};
use super::{KafkaState, CONSUME_TIMEOUT, MAX_ROWS};

pub(super) fn consume_topic_fresh(
    cc: &ClientConfig,
    query: &KafkaQuery,
) -> Result<Vec<serde_json::Value>> {
    use rdkafka::TopicPartitionList;

    let consumer: BaseConsumer = cc
        .create()
        .map_err(|e| DriverError::QueryFailed(format!("Failed to create consumer: {e}")))?;

    let metadata = consumer
        .fetch_metadata(Some(&query.topic), super::METADATA_TIMEOUT)
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

    let mut tpl = TopicPartitionList::new();
    for pid in &partition_ids {
        let offset = if query.from_latest {
            rdkafka::Offset::End
        } else {
            rdkafka::Offset::Beginning
        };
        tpl.add_partition_offset(&query.topic, *pid, offset)
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    }
    consumer
        .assign(&tpl)
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    let max_rows = query.limit.unwrap_or(MAX_ROWS).min(MAX_ROWS);
    let mut rows = Vec::with_capacity(max_rows);
    let deadline = std::time::Instant::now() + CONSUME_TIMEOUT;
    let mut empty_polls = 0u32;

    while rows.len() < max_rows && std::time::Instant::now() < deadline {
        let poll_timeout = deadline
            .saturating_duration_since(std::time::Instant::now())
            .min(Duration::from_millis(1000));
        match consumer.poll(poll_timeout) {
            Some(Ok(msg)) => {
                empty_polls = 0;
                let payload = match msg.payload() {
                    Some(bytes) => bytes,
                    None => continue,
                };
                let json_val: serde_json::Value = match serde_json::from_slice(payload) {
                    Ok(v) => v,
                    Err(_) => {
                        serde_json::json!({
                            "value": String::from_utf8_lossy(payload).to_string(),
                            "_partition": msg.partition(),
                            "_offset": msg.offset(),
                        })
                    }
                };
                let row = match json_val {
                    serde_json::Value::Object(mut map) => {
                        map.insert("_partition".to_string(), serde_json::json!(msg.partition()));
                        map.insert("_offset".to_string(), serde_json::json!(msg.offset()));
                        if let Some(ts) = msg.timestamp().to_millis() {
                            map.insert("_timestamp".to_string(), serde_json::json!(ts));
                        }
                        serde_json::Value::Object(map)
                    }
                    other => {
                        serde_json::json!({
                            "value": other,
                            "_partition": msg.partition(),
                            "_offset": msg.offset(),
                        })
                    }
                };

                let passes_filter = query
                    .where_conditions
                    .iter()
                    .all(|cond| super::sql_parser::eval_condition(&row, cond));

                if passes_filter {
                    rows.push(row);
                }
            }
            Some(Err(e)) => {
                tracing::warn!("Kafka poll error: {e}");
                break;
            }
            None => {
                empty_polls += 1;
                if !rows.is_empty() && empty_polls >= 2 {
                    break;
                }
            }
        }
    }

    Ok(rows)
}

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

    let result_rows: Vec<Vec<QueryValue>> = sorted_rows
        .iter()
        .map(|row| {
            columns
                .iter()
                .map(|col| json_to_query_value(row.get(&col.name)))
                .collect()
        })
        .collect();

    Ok((columns, result_rows))
}

async fn infer_columns(
    rows: &[serde_json::Value],
    query: &KafkaQuery,
    state: &KafkaState,
) -> Vec<ColumnSpec> {
    let meta_cols = vec![
        ColumnSpec { name: "_partition".into(), type_hint: "int".into() },
        ColumnSpec { name: "_offset".into(), type_hint: "long".into() },
        ColumnSpec { name: "_timestamp".into(), type_hint: "long".into() },
    ];

    match &query.select {
        SelectClause::All => {
            if let Some(ref sr) = state.schema_registry {
                let subject = format!("{}-value", query.topic);
                if let Ok(mut cols) = sr.get_columns_for_subject(&subject).await {
                    cols.extend(meta_cols);
                    return cols;
                }
            }
            if let Some(first) = rows.first() {
                let mut cols = columns_from_json_sample(first);
                for mc in &meta_cols {
                    if !cols.iter().any(|c| c.name == mc.name) {
                        cols.push(mc.clone());
                    }
                }
                cols
            } else {
                let mut cols = vec![ColumnSpec {
                    name: "value".into(),
                    type_hint: "bytes".into(),
                }];
                cols.extend(meta_cols);
                cols
            }
        }
        SelectClause::Columns(cols) => cols
            .iter()
            .map(|sc| {
                let name = sc.alias.clone().unwrap_or_else(|| match &sc.expr {
                    ColumnExpr::Name(n) => n.clone(),
                    ColumnExpr::Agg(func, col) => format!("{func:?}({col})").to_lowercase(),
                    ColumnExpr::CountAll => "count(*)".to_string(),
                });
                ColumnSpec {
                    name,
                    type_hint: "text".to_string(),
                }
            })
            .collect(),
    }
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

    let columns: Vec<ColumnSpec> = select_cols
        .iter()
        .map(|sc| {
            let name = sc.alias.clone().unwrap_or_else(|| match &sc.expr {
                ColumnExpr::Name(n) => n.clone(),
                ColumnExpr::Agg(func, col) => format!("{func:?}({col})").to_lowercase(),
                ColumnExpr::CountAll => "count(*)".to_string(),
            });
            ColumnSpec {
                name,
                type_hint: "text".to_string(),
            }
        })
        .collect();

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
