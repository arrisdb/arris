use std::collections::BTreeMap;

use crate::{DriverError, QueryValue};
use crate::drivers::errors::Result;

use super::driver::{
    EXPORT_BASE_URL, MAX_PROPERTY_FETCHES, QUERY_API_BASE, SCHEMAS_API_BASE,
};
use super::query;
use super::sql_parser;

pub(super) struct Inner {
    pub(super) client: reqwest::Client,
    pub(super) project_id: String,
    pub(super) username: String,
    pub(super) password: String,
}

pub(super) async fn execute_export(
    inner: &Inner,
    parsed_query: &sql_parser::MixpanelQuery,
) -> Result<Vec<BTreeMap<String, QueryValue>>> {
    let mut url = format!(
        "{EXPORT_BASE_URL}?project_id={}&from_date={}&to_date={}",
        inner.project_id, parsed_query.from_date, parsed_query.to_date,
    );

    if !parsed_query.event_filter.is_empty() {
        let json_array = serde_json::to_string(&parsed_query.event_filter)
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        url.push_str(&format!(
            "&event={}",
            percent_encoding::utf8_percent_encode(
                &json_array,
                percent_encoding::NON_ALPHANUMERIC
            )
        ));
    }

    if let Some(where_expr) = &parsed_query.where_expression {
        let mp_where = sql_parser::build_mixpanel_where(where_expr);
        url.push_str(&format!(
            "&where={}",
            percent_encoding::utf8_percent_encode(&mp_where, percent_encoding::NON_ALPHANUMERIC)
        ));
    }

    let resp = inner
        .client
        .get(&url)
        .basic_auth(&inner.username, Some(&inner.password))
        .header("Accept", "text/plain")
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| DriverError::QueryFailed(format!("Mixpanel export request failed: {e}")))?;

    let status = resp.status().as_u16();
    if status != 200 {
        let body = resp.text().await.unwrap_or_default();
        return Err(DriverError::QueryFailed(format!(
            "Mixpanel export failed (HTTP {status}): {body}"
        )));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| DriverError::QueryFailed(format!("Failed to read response: {e}")))?;
    let mut rows: Vec<BTreeMap<String, QueryValue>> = Vec::new();

    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };

        let mut row = BTreeMap::new();
        if let Some(event_name) = obj.get("event").and_then(|v| v.as_str()) {
            row.insert("event".into(), QueryValue::Text(event_name.into()));
        }
        if let Some(props) = obj.get("properties").and_then(|v| v.as_object()) {
            for (key, value) in props {
                row.insert(key.clone(), query::json_to_query_value(value));
            }
        }
        rows.push(row);
    }

    Ok(rows)
}

async fn fetch_event_names(inner: &Inner) -> Vec<String> {
    let url = format!(
        "{QUERY_API_BASE}/events/names?project_id={}&type=general&limit=255",
        inner.project_id
    );
    let Ok(resp) = inner
        .client
        .get(&url)
        .basic_auth(&inner.username, Some(&inner.password))
        .send()
        .await
    else {
        return Vec::new();
    };
    if resp.status().as_u16() != 200 {
        return Vec::new();
    }
    resp.json::<Vec<String>>().await.unwrap_or_default()
}

async fn fetch_lexicon_schemas(inner: &Inner) -> BTreeMap<String, BTreeMap<String, String>> {
    let url = format!("{SCHEMAS_API_BASE}/{}/schemas/event", inner.project_id);
    let Ok(resp) = inner
        .client
        .get(&url)
        .basic_auth(&inner.username, Some(&inner.password))
        .send()
        .await
    else {
        return BTreeMap::new();
    };
    if resp.status().as_u16() != 200 {
        return BTreeMap::new();
    }
    let Ok(body) = resp.json::<serde_json::Value>().await else {
        return BTreeMap::new();
    };

    let mut result = BTreeMap::new();
    if let Some(results) = body.get("results").and_then(|v| v.as_array()) {
        for schema_entry in results {
            let Some(name) = schema_entry.get("name").and_then(|v| v.as_str()) else {
                continue;
            };
            let mut props = BTreeMap::new();
            if let Some(properties) = schema_entry
                .get("schemaJson")
                .and_then(|s| s.get("properties"))
                .and_then(|p| p.as_object())
            {
                for (prop_name, prop_def) in properties {
                    let type_str = prop_def
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("string")
                        .to_owned();
                    props.insert(prop_name.clone(), type_str);
                }
            }
            result.insert(name.to_owned(), props);
        }
    }
    result
}

async fn fetch_event_properties_top(
    inner: &Inner,
    event_name: &str,
) -> BTreeMap<String, String> {
    let url = format!(
        "{QUERY_API_BASE}/events/properties/top?project_id={}&event={}&limit=255",
        inner.project_id,
        percent_encoding::utf8_percent_encode(event_name, percent_encoding::NON_ALPHANUMERIC)
    );
    let Ok(resp) = inner
        .client
        .get(&url)
        .basic_auth(&inner.username, Some(&inner.password))
        .send()
        .await
    else {
        return BTreeMap::new();
    };
    if resp.status().as_u16() != 200 {
        return BTreeMap::new();
    }
    let Ok(body) = resp.json::<serde_json::Value>().await else {
        return BTreeMap::new();
    };
    let Some(obj) = body.as_object() else {
        return BTreeMap::new();
    };
    obj.keys().map(|k| (k.clone(), String::new())).collect()
}

pub(super) async fn discover_events(inner: &Inner) -> BTreeMap<String, BTreeMap<String, String>> {
    let (event_names, lexicon) =
        tokio::join!(fetch_event_names(inner), fetch_lexicon_schemas(inner),);

    let mut result = BTreeMap::new();
    let mut needs_properties: Vec<String> = Vec::new();

    for name in &event_names {
        if let Some(props) = lexicon.get(name) {
            result.insert(name.clone(), props.clone());
        } else {
            needs_properties.push(name.clone());
        }
    }

    for (name, props) in &lexicon {
        result.entry(name.clone()).or_insert_with(|| props.clone());
    }

    let fetch_count = needs_properties.len().min(MAX_PROPERTY_FETCHES);
    for name in &needs_properties[..fetch_count] {
        let props = fetch_event_properties_top(inner, name).await;
        result.insert(name.clone(), props);
    }

    for name in &needs_properties[fetch_count..] {
        result.entry(name.clone()).or_default();
    }

    result
}
