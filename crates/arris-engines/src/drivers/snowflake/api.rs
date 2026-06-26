use std::collections::HashMap;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use url::Url;
use uuid::Uuid;

use crate::drivers::errors::Result;
use crate::DriverError;

pub(super) struct SnowflakeApi {
    http: Client,
    base_url: String,
    token: String,
}

impl SnowflakeApi {
    pub(super) async fn login(
        account: &str,
        user: &str,
        password: &str,
        warehouse: Option<&str>,
        database: Option<&str>,
        schema: Option<&str>,
        role: Option<&str>,
    ) -> Result<Self> {
        let base_url = format!("https://{account}.snowflakecomputing.com");
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        let mut url = Url::parse(&format!("{base_url}/session/v1/login-request"))
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
        {
            let mut q = url.query_pairs_mut();
            if let Some(wh) = warehouse {
                q.append_pair("warehouse", wh);
            }
            if let Some(db) = database {
                q.append_pair("databaseName", db);
            }
            if let Some(sc) = schema {
                q.append_pair("schemaName", sc);
            }
            if let Some(rl) = role {
                q.append_pair("roleName", rl);
            }
        }

        let login_body = serde_json::json!({
            "data": {
                "ACCOUNT_NAME": account,
                "LOGIN_NAME": user,
                "PASSWORD": password,
            }
        });

        let resp = http
            .post(url)
            .json(&login_body)
            .send()
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        if !status.is_success() {
            return Err(DriverError::ConnectionFailed(body));
        }

        let parsed: LoginResponse =
            serde_json::from_str(&body).map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;

        if !parsed.success {
            return Err(DriverError::ConnectionFailed(
                parsed.message.unwrap_or_else(|| "login failed".to_owned()),
            ));
        }

        let token = parsed
            .data
            .ok_or_else(|| DriverError::ConnectionFailed("missing login response data".to_owned()))?
            .token;

        Ok(Self {
            http,
            base_url,
            token,
        })
    }

    pub(super) async fn query(&self, sql: &str) -> Result<QueryResponse> {
        let request_id = Uuid::new_v4();
        let url = format!(
            "{}/queries/v1/query-request?requestId={request_id}",
            self.base_url
        );

        let body = QueryRequestBody {
            sql_text: sql.to_owned(),
            bindings: HashMap::new(),
        };

        let resp = self
            .http
            .post(&url)
            .header("Accept", "application/snowflake")
            .header(
                "Authorization",
                format!(r#"Snowflake Token="{}""#, self.token),
            )
            .json(&body)
            .send()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        let status = resp.status();
        let raw = resp
            .text()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        if !status.is_success() {
            return Err(DriverError::QueryFailed(raw));
        }

        let parsed: RawResponse =
            serde_json::from_str(&raw).map_err(|e| DriverError::QueryFailed(e.to_string()))?;

        if !parsed.success {
            return Err(DriverError::QueryFailed(format!(
                "{}",
                parsed.message.unwrap_or_else(|| "query failed".to_owned())
            )));
        }

        let data = parsed
            .data
            .ok_or_else(|| DriverError::QueryFailed("missing query response data".to_owned()))?;

        Ok(QueryResponse {
            columns: data.row_types.unwrap_or_default(),
            rows: data.row_set.unwrap_or_default(),
        })
    }
}

// ── Request types ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryRequestBody {
    sql_text: String,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    bindings: HashMap<String, serde_json::Value>,
}

// ── Response types ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginResponse {
    data: Option<LoginData>,
    message: Option<String>,
    success: bool,
}

#[derive(Deserialize)]
struct LoginData {
    token: String,
}

#[derive(Deserialize)]
struct RawResponse {
    data: Option<RawResponseData>,
    message: Option<String>,
    success: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawResponseData {
    #[serde(rename = "rowset")]
    row_set: Option<Vec<Vec<Option<String>>>>,
    #[serde(rename = "rowtype")]
    row_types: Option<Vec<ColumnMeta>>,
}

pub(super) struct QueryResponse {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<Option<String>>>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct ColumnMeta {
    pub name: String,
    #[serde(rename = "type")]
    pub data_type: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_response_deserializes() {
        let json = r#"{"data":{"token":"abc123"},"message":null,"success":true}"#;
        let resp: LoginResponse = serde_json::from_str(json).unwrap();
        assert!(resp.success);
        assert_eq!(resp.data.unwrap().token, "abc123");
    }

    #[test]
    fn login_failure_deserializes() {
        let json = r#"{"data":null,"message":"bad creds","success":false}"#;
        let resp: LoginResponse = serde_json::from_str(json).unwrap();
        assert!(!resp.success);
        assert_eq!(resp.message.unwrap(), "bad creds");
    }

    #[test]
    fn query_response_deserializes_with_rows() {
        let json = r#"{
            "data": {
                "rowtype": [
                    {"name":"ID","type":"FIXED","nullable":false,"scale":0,"length":null,"precision":10,"byteLength":null,"database":"DB","schema":"S","table":"T"},
                    {"name":"NAME","type":"TEXT","nullable":true,"scale":null,"length":100,"precision":null,"byteLength":400,"database":"DB","schema":"S","table":"T"}
                ],
                "rowset": [["1","Alice"],["2","Bob"],[null,"Charlie"]],
                "queryResultFormat": "json"
            },
            "message": null,
            "success": true
        }"#;
        let resp: RawResponse = serde_json::from_str(json).unwrap();
        assert!(resp.success);
        let data = resp.data.unwrap();
        assert_eq!(data.row_types.as_ref().unwrap().len(), 2);
        assert_eq!(data.row_types.as_ref().unwrap()[0].name, "ID");
        assert_eq!(data.row_types.as_ref().unwrap()[0].data_type, "FIXED");
        assert_eq!(data.row_set.as_ref().unwrap().len(), 3);
        assert_eq!(data.row_set.as_ref().unwrap()[0][0], Some("1".to_owned()));
        assert!(data.row_set.as_ref().unwrap()[2][0].is_none());
    }

    #[test]
    fn query_response_deserializes_empty_result() {
        let json = r#"{
            "data": {
                "rowtype": [{"name":"C","type":"TEXT","nullable":true}],
                "rowset": [],
                "queryResultFormat": "json"
            },
            "message": null,
            "success": true
        }"#;
        let resp: RawResponse = serde_json::from_str(json).unwrap();
        let data = resp.data.unwrap();
        assert_eq!(data.row_set.as_ref().unwrap().len(), 0);
        assert_eq!(data.row_types.as_ref().unwrap().len(), 1);
    }

    #[test]
    fn query_request_body_serializes() {
        let body = QueryRequestBody {
            sql_text: "SELECT 1".to_owned(),
            bindings: HashMap::new(),
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(json["sqlText"], "SELECT 1");
        assert!(json.get("bindings").is_none());
    }
}
