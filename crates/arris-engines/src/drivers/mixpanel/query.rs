use std::collections::BTreeMap;

use crate::QueryValue;

use super::sql_parser::{AggFunc, ColumnSelection, MixpanelQuery};

pub(super) fn json_to_query_value(value: &serde_json::Value) -> QueryValue {
    match value {
        serde_json::Value::String(s) => QueryValue::Text(s.clone()),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                QueryValue::Int(i)
            } else if let Some(f) = n.as_f64() {
                QueryValue::Double(f)
            } else {
                QueryValue::Text(n.to_string())
            }
        }
        serde_json::Value::Bool(b) => QueryValue::Bool(*b),
        serde_json::Value::Null => QueryValue::Null,
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            QueryValue::Json(value.to_string())
        }
    }
}

pub(super) fn select_columns(
    rows: &[BTreeMap<String, QueryValue>],
    query: &MixpanelQuery,
) -> Vec<BTreeMap<String, QueryValue>> {
    let wants_all = query
        .columns
        .iter()
        .any(|c| matches!(c, ColumnSelection::All));
    if wants_all {
        return rows.to_vec();
    }

    let names: Vec<&str> = query
        .columns
        .iter()
        .filter_map(|c| {
            if let ColumnSelection::Named(n) = c {
                Some(n.as_str())
            } else {
                None
            }
        })
        .collect();
    if names.is_empty() {
        return rows.to_vec();
    }

    rows.iter()
        .map(|row| {
            let mut filtered = BTreeMap::new();
            for &n in &names {
                filtered.insert(n.to_string(), row.get(n).cloned().unwrap_or(QueryValue::Null));
            }
            filtered
        })
        .collect()
}

pub(super) fn apply_aggregations(
    rows: &[BTreeMap<String, QueryValue>],
    query: &MixpanelQuery,
) -> Vec<BTreeMap<String, QueryValue>> {
    let mut groups: BTreeMap<String, Vec<&BTreeMap<String, QueryValue>>> = BTreeMap::new();
    for row in rows {
        let key = query
            .group_by
            .iter()
            .map(|gb| {
                row.get(gb)
                    .map(|v| v.display_string())
                    .unwrap_or_else(|| "NULL".into())
            })
            .collect::<Vec<_>>()
            .join("|");
        groups.entry(key).or_default().push(row);
    }

    let mut result = Vec::new();
    for group_rows in groups.values() {
        let mut out_row = BTreeMap::new();
        for gb in &query.group_by {
            out_row.insert(
                gb.clone(),
                group_rows
                    .first()
                    .and_then(|r| r.get(gb))
                    .cloned()
                    .unwrap_or(QueryValue::Null),
            );
        }
        for col in &query.columns {
            if let ColumnSelection::Aggregation(func, c, alias) = col {
                let name = alias.clone().unwrap_or_else(|| {
                    format!("{}({})", func.label(), c.as_deref().unwrap_or("*"))
                });
                out_row.insert(name, compute_agg(*func, c.as_deref(), group_rows));
            }
        }
        result.push(out_row);
    }
    result
}

fn compute_agg(
    func: AggFunc,
    column: Option<&str>,
    rows: &[&BTreeMap<String, QueryValue>],
) -> QueryValue {
    match func {
        AggFunc::Count => {
            if let Some(col) = column {
                let count = rows
                    .iter()
                    .filter(|row| {
                        row.get(col)
                            .is_some_and(|v| !matches!(v, QueryValue::Null))
                    })
                    .count();
                QueryValue::Int(count as i64)
            } else {
                QueryValue::Int(rows.len() as i64)
            }
        }
        AggFunc::Sum => {
            let Some(col) = column else {
                return QueryValue::Null;
            };
            let mut sum = 0.0;
            for row in rows {
                match row.get(col) {
                    Some(QueryValue::Int(i)) => sum += *i as f64,
                    Some(QueryValue::Double(d)) => sum += d,
                    _ => {}
                }
            }
            QueryValue::Double(sum)
        }
        AggFunc::Avg => {
            let Some(col) = column else {
                return QueryValue::Null;
            };
            let mut sum = 0.0;
            let mut count = 0;
            for row in rows {
                match row.get(col) {
                    Some(QueryValue::Int(i)) => {
                        sum += *i as f64;
                        count += 1;
                    }
                    Some(QueryValue::Double(d)) => {
                        sum += d;
                        count += 1;
                    }
                    _ => {}
                }
            }
            if count > 0 {
                QueryValue::Double(sum / count as f64)
            } else {
                QueryValue::Null
            }
        }
        AggFunc::Min => {
            let Some(col) = column else {
                return QueryValue::Null;
            };
            let mut min_val: Option<f64> = None;
            for row in rows {
                let d = match row.get(col) {
                    Some(QueryValue::Int(i)) => Some(*i as f64),
                    Some(QueryValue::Double(d)) => Some(*d),
                    _ => None,
                };
                if let Some(d) = d {
                    min_val = Some(min_val.map_or(d, |m: f64| m.min(d)));
                }
            }
            min_val
                .map(QueryValue::Double)
                .unwrap_or(QueryValue::Null)
        }
        AggFunc::Max => {
            let Some(col) = column else {
                return QueryValue::Null;
            };
            let mut max_val: Option<f64> = None;
            for row in rows {
                let d = match row.get(col) {
                    Some(QueryValue::Int(i)) => Some(*i as f64),
                    Some(QueryValue::Double(d)) => Some(*d),
                    _ => None,
                };
                if let Some(d) = d {
                    max_val = Some(max_val.map_or(d, |m: f64| m.max(d)));
                }
            }
            max_val
                .map(QueryValue::Double)
                .unwrap_or(QueryValue::Null)
        }
    }
}

pub(super) fn apply_order_by(rows: &mut [BTreeMap<String, QueryValue>], order_by: &[(String, bool)]) {
    rows.sort_by(|a, b| {
        for (col, asc) in order_by {
            let va = a.get(col).unwrap_or(&QueryValue::Null);
            let vb = b.get(col).unwrap_or(&QueryValue::Null);
            let cmp = compare_query_values(va, vb);
            if cmp != std::cmp::Ordering::Equal {
                return if *asc { cmp } else { cmp.reverse() };
            }
        }
        std::cmp::Ordering::Equal
    });
}

fn compare_query_values(a: &QueryValue, b: &QueryValue) -> std::cmp::Ordering {
    match (a, b) {
        (QueryValue::Null, QueryValue::Null) => std::cmp::Ordering::Equal,
        (QueryValue::Null, _) => std::cmp::Ordering::Less,
        (_, QueryValue::Null) => std::cmp::Ordering::Greater,
        (QueryValue::Int(ai), QueryValue::Int(bi)) => ai.cmp(bi),
        (QueryValue::Double(ad), QueryValue::Double(bd)) => {
            ad.partial_cmp(bd).unwrap_or(std::cmp::Ordering::Equal)
        }
        (QueryValue::Int(ai), QueryValue::Double(bd)) => {
            (*ai as f64)
                .partial_cmp(bd)
                .unwrap_or(std::cmp::Ordering::Equal)
        }
        (QueryValue::Double(ad), QueryValue::Int(bi)) => {
            ad.partial_cmp(&(*bi as f64))
                .unwrap_or(std::cmp::Ordering::Equal)
        }
        _ => a.display_string().cmp(&b.display_string()),
    }
}
