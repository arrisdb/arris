use std::collections::HashMap;
use std::io::Read;
use std::time::Duration;

use flate2::read::GzDecoder;
use futures::stream::{BoxStream, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use url::Url;
use uuid::Uuid;

use super::constants::GZIP_MAGIC;
use crate::drivers::errors::Result;
use crate::DriverError;

/// One raw Snowflake row (nullable string cells) or a paging error, as delivered
/// by the lazy chunk-download walk.
pub(super) type RowStream = BoxStream<'static, std::result::Result<Vec<Option<String>>, DriverError>>;

#[derive(Clone)]
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

    /// POST the statement and return its columns, inline first chunk, and the
    /// descriptors for any out-of-line chunks. Snowflake caps the inline
    /// `rowset` at one chunk (~12k rows); the rest live at pre-signed URLs.
    async fn submit(&self, sql: &str) -> Result<QueryData> {
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
            return Err(DriverError::QueryFailed(
                parsed.message.unwrap_or_else(|| "query failed".to_owned()),
            ));
        }

        let data = parsed
            .data
            .ok_or_else(|| DriverError::QueryFailed("missing query response data".to_owned()))?;

        Ok(QueryData {
            columns: data.row_types.unwrap_or_default(),
            rows: data.row_set.unwrap_or_default(),
            chunks: data.chunks.unwrap_or_default(),
            chunk_headers: data.chunk_headers.unwrap_or_default(),
        })
    }

    /// Run a statement to completion, materializing the inline chunk plus every
    /// out-of-line chunk. Used by the buffered `run_query` path (schema
    /// introspection, mutations, EXPLAIN).
    pub(super) async fn query(&self, sql: &str) -> Result<QueryResponse> {
        let mut data = self.submit(sql).await?;
        for chunk in std::mem::take(&mut data.chunks) {
            let rows = self.download_chunk(&chunk.url, &data.chunk_headers).await?;
            data.rows.extend(rows);
        }
        Ok(QueryResponse {
            columns: data.columns,
            rows: data.rows,
        })
    }

    /// Submit the statement and hand back a lazy stream: the inline chunk first,
    /// then each out-of-line chunk downloaded on demand. Snowflake applies
    /// ORDER BY / aggregation / LIMIT server-side, so chunks are already final
    /// and stream without any in-driver reordering.
    pub(super) async fn open_row_stream(&self, sql: &str) -> Result<(Vec<ColumnMeta>, RowStream)> {
        let QueryData {
            columns,
            rows,
            chunks,
            chunk_headers,
        } = self.submit(sql).await?;
        let cursor = PageCursor {
            api: self.clone(),
            headers: chunk_headers,
            chunks: chunks.into_iter(),
            pending: rows.into_iter(),
        };
        Ok((columns, cursor.into_row_stream()))
    }

    async fn download_chunk(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
    ) -> Result<Vec<Vec<Option<String>>>> {
        let mut req = self.http.get(url);
        for (k, v) in headers {
            req = req.header(k, v);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        let status = resp.status();
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
        if !status.is_success() {
            return Err(DriverError::QueryFailed(
                String::from_utf8_lossy(&bytes).into_owned(),
            ));
        }
        Self::decode_chunk_bytes(&bytes)
    }

    /// Chunk files are gzip-compressed JSON fragments: comma-separated row
    /// arrays with no enclosing brackets. Inflate by signature, then wrap in
    /// `[ ]` so the fragment parses as a row array.
    fn decode_chunk_bytes(bytes: &[u8]) -> Result<Vec<Vec<Option<String>>>> {
        let text = if bytes.starts_with(&GZIP_MAGIC) {
            let mut s = String::new();
            GzDecoder::new(bytes)
                .read_to_string(&mut s)
                .map_err(|e| DriverError::QueryFailed(format!("chunk gunzip: {e}")))?;
            s
        } else {
            String::from_utf8_lossy(bytes).into_owned()
        };
        serde_json::from_str(&format!("[{text}]"))
            .map_err(|e| DriverError::QueryFailed(format!("chunk parse: {e}")))
    }
}

/// Lazy chunk walk: drains the current chunk's buffered rows, then downloads the
/// next chunk on demand. Owns a cheap `SnowflakeApi` clone so the stream outlives
/// the connection guard.
struct PageCursor {
    api: SnowflakeApi,
    headers: HashMap<String, String>,
    chunks: std::vec::IntoIter<ChunkMeta>,
    pending: std::vec::IntoIter<Vec<Option<String>>>,
}

impl PageCursor {
    fn into_row_stream(self) -> RowStream {
        futures::stream::unfold(self, |mut cursor| async move {
            loop {
                if let Some(row) = cursor.pending.next() {
                    return Some((Ok(row), cursor));
                }
                let chunk = cursor.chunks.next()?;
                match cursor.api.download_chunk(&chunk.url, &cursor.headers).await {
                    Ok(rows) => cursor.pending = rows.into_iter(),
                    Err(e) => {
                        cursor.chunks = Vec::new().into_iter();
                        return Some((Err(e), cursor));
                    }
                }
            }
        })
        .boxed()
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
    chunks: Option<Vec<ChunkMeta>>,
    chunk_headers: Option<HashMap<String, String>>,
}

#[derive(Deserialize)]
struct ChunkMeta {
    url: String,
}

/// A statement's parsed response: columns, the inline first chunk, and the
/// descriptors + shared headers for any out-of-line chunks.
struct QueryData {
    columns: Vec<ColumnMeta>,
    rows: Vec<Vec<Option<String>>>,
    chunks: Vec<ChunkMeta>,
    chunk_headers: HashMap<String, String>,
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
    use std::io::Write;

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

    #[test]
    fn raw_response_parses_out_of_line_chunks() {
        let json = r#"{
            "data": {
                "rowtype": [{"name":"N","type":"FIXED"}],
                "rowset": [["0"]],
                "chunks": [
                    {"url":"https://sf/chunk/1","rowCount":100,"uncompressedSize":900,"compressedSize":300},
                    {"url":"https://sf/chunk/2","rowCount":50}
                ],
                "chunkHeaders": {"x-amz-server-side-encryption-customer-key":"KEY"},
                "queryResultFormat": "json"
            },
            "message": null,
            "success": true
        }"#;
        let resp: RawResponse = serde_json::from_str(json).unwrap();
        let data = resp.data.unwrap();
        let chunks = data.chunks.unwrap();
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].url, "https://sf/chunk/1");
        assert_eq!(chunks[1].url, "https://sf/chunk/2");
        let headers = data.chunk_headers.unwrap();
        assert_eq!(
            headers.get("x-amz-server-side-encryption-customer-key").unwrap(),
            "KEY"
        );
    }

    #[test]
    fn decode_chunk_bytes_parses_plain_fragment() {
        // Chunk files are bracket-less JSON fragments; the decoder wraps them.
        let fragment = br#"["1","alice"],["2",null]"#;
        let rows = SnowflakeApi::decode_chunk_bytes(fragment).unwrap();
        assert_eq!(
            rows,
            vec![
                vec![Some("1".to_owned()), Some("alice".to_owned())],
                vec![Some("2".to_owned()), None],
            ]
        );
    }

    #[test]
    fn decode_chunk_bytes_inflates_gzip_fragment() {
        let fragment = br#"["3","bob"],["4","carol"]"#;
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(fragment).unwrap();
        let gz = enc.finish().unwrap();
        assert_eq!(&gz[..2], &GZIP_MAGIC);

        let rows = SnowflakeApi::decode_chunk_bytes(&gz).unwrap();
        assert_eq!(
            rows,
            vec![
                vec![Some("3".to_owned()), Some("bob".to_owned())],
                vec![Some("4".to_owned()), Some("carol".to_owned())],
            ]
        );
    }
}
