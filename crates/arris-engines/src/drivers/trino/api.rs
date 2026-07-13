use std::time::Duration;

use futures::stream::{BoxStream, StreamExt};
use reqwest::{Certificate, Client};
use serde::Deserialize;
use serde_json::Value;

use crate::drivers::errors::Result;
use crate::DriverError;

/// One raw Trino row (JSON cells) or a paging error, as delivered by the lazy
/// `nextUri` walk.
pub(super) type RowStream = BoxStream<'static, std::result::Result<Vec<Value>, DriverError>>;

#[derive(Clone)]
pub(super) struct TrinoApi {
    http: Client,
    base_url: String,
    user: String,
    password: Option<String>,
    catalog: Option<String>,
    schema: Option<String>,
}

impl TrinoApi {
    pub(super) fn new(
        base_url: String,
        user: String,
        password: Option<String>,
        catalog: Option<String>,
        schema: Option<String>,
        ssl_mode: crate::SslMode,
        ca_cert_path: Option<&str>,
    ) -> Result<Self> {
        // Trino speaks HTTP(S); `ssl_mode` selects the scheme (see base_url) and
        // how strictly the server cert is checked. Preferred/Required encrypt
        // without verifying; the verify modes check the chain against the CA.
        // Client-certificate (mTLS) is not wired for Trino.
        let mut builder = Client::builder().timeout(Duration::from_secs(60));
        if ssl_mode.forces_tls() {
            if matches!(ssl_mode, crate::SslMode::VerifyCa | crate::SslMode::VerifyIdentity) {
                if let Some(ca) = ca_cert_path.filter(|s| !s.is_empty()) {
                    let pem = std::fs::read(ca).map_err(|e| {
                        DriverError::ConnectionFailed(format!("read CA {ca}: {e}"))
                    })?;
                    let cert = Certificate::from_pem(&pem).map_err(|e| {
                        DriverError::ConnectionFailed(format!("parse CA {ca}: {e}"))
                    })?;
                    builder = builder.add_root_certificate(cert);
                }
            } else {
                builder = builder.danger_accept_invalid_certs(true);
            }
        }
        let http = builder
            .build()
            .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
        Ok(Self {
            http,
            base_url,
            user,
            password,
            catalog,
            schema,
        })
    }

    fn post_req(&self, sql: &str) -> reqwest::RequestBuilder {
        let mut req = self
            .http
            .post(format!("{}/v1/statement", self.base_url))
            .header("X-Trino-User", &self.user)
            .header("X-Trino-Source", "arris")
            .body(sql.to_owned());
        if let Some(catalog) = &self.catalog {
            req = req.header("X-Trino-Catalog", catalog);
        }
        if let Some(schema) = &self.schema {
            req = req.header("X-Trino-Schema", schema);
        }
        if let Some(password) = &self.password {
            req = req.basic_auth(&self.user, Some(password));
        }
        req
    }

    /// Run a statement to completion, following `nextUri` links until the
    /// query finishes, accumulating columns and rows along the way.
    pub(super) async fn query(&self, sql: &str) -> Result<TrinoResponse> {
        let mut page = self.send(self.post_req(sql)).await?;

        let mut columns: Vec<TrinoColumn> = Vec::new();
        let mut rows: Vec<Vec<Value>> = Vec::new();
        let mut update_count: Option<i64> = None;

        loop {
            if let Some(err) = page.error {
                return Err(DriverError::QueryFailed(err.message));
            }
            if columns.is_empty() {
                if let Some(cols) = page.columns.take() {
                    columns = cols;
                }
            }
            if let Some(data) = page.data.take() {
                rows.extend(data);
            }
            if let Some(count) = page.update_count {
                update_count = Some(count);
            }

            match page.next_uri.take() {
                Some(next) => {
                    let req = self.authed_get(&next);
                    page = self.send(req).await?;
                }
                None => break,
            }
        }

        Ok(TrinoResponse {
            columns,
            rows,
            update_count,
        })
    }

    fn authed_get(&self, url: &str) -> reqwest::RequestBuilder {
        let mut req = self.http.get(url).header("X-Trino-User", &self.user);
        if let Some(password) = &self.password {
            req = req.basic_auth(&self.user, Some(password));
        }
        req
    }

    /// Follow `nextUri` pages only until the columns are known, then hand back a
    /// lazy stream that walks the remaining pages on demand. Trino applies
    /// ORDER BY / aggregation / LIMIT server-side, so paged rows are already
    /// final and stream without any in-driver reordering.
    pub(super) async fn open_row_stream(&self, sql: &str) -> Result<(Vec<TrinoColumn>, RowStream)> {
        let mut page = self.send(self.post_req(sql)).await?;
        let mut columns: Vec<TrinoColumn> = Vec::new();
        let mut buffered: Vec<Vec<Value>> = Vec::new();
        loop {
            if let Some(err) = page.error {
                return Err(DriverError::QueryFailed(err.message));
            }
            if columns.is_empty() {
                if let Some(cols) = page.columns.take() {
                    columns = cols;
                }
            }
            if let Some(data) = page.data.take() {
                buffered.extend(data);
            }
            if !columns.is_empty() {
                break;
            }
            match page.next_uri.take() {
                Some(next) => page = self.send(self.authed_get(&next)).await?,
                None => break,
            }
        }
        let cursor = PageCursor {
            api: self.clone(),
            next_uri: page.next_uri.take(),
            pending: buffered.into_iter(),
        };
        Ok((columns, cursor.into_row_stream()))
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> Result<StatementPage> {
        let resp = req
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
        serde_json::from_str(&raw).map_err(|e| DriverError::QueryFailed(e.to_string()))
    }
}

/// Lazy `nextUri` walk: drains the current page's buffered rows, then fetches
/// the next page on demand. Owns a cheap `TrinoApi` clone so the stream outlives
/// the connection guard.
struct PageCursor {
    api: TrinoApi,
    next_uri: Option<String>,
    pending: std::vec::IntoIter<Vec<Value>>,
}

impl PageCursor {
    fn into_row_stream(self) -> RowStream {
        futures::stream::unfold(self, |mut cursor| async move {
            loop {
                if let Some(row) = cursor.pending.next() {
                    return Some((Ok(row), cursor));
                }
                let url = cursor.next_uri.take()?;
                match cursor.api.send(cursor.api.authed_get(&url)).await {
                    Ok(mut page) => {
                        if let Some(err) = page.error {
                            cursor.next_uri = None;
                            return Some((Err(DriverError::QueryFailed(err.message)), cursor));
                        }
                        cursor.pending = page.data.take().unwrap_or_default().into_iter();
                        cursor.next_uri = page.next_uri.take();
                    }
                    Err(e) => {
                        cursor.next_uri = None;
                        return Some((Err(e), cursor));
                    }
                }
            }
        })
        .boxed()
    }
}

pub(super) struct TrinoResponse {
    pub columns: Vec<TrinoColumn>,
    pub rows: Vec<Vec<Value>>,
    pub update_count: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatementPage {
    next_uri: Option<String>,
    columns: Option<Vec<TrinoColumn>>,
    data: Option<Vec<Vec<Value>>>,
    error: Option<TrinoError>,
    update_count: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct TrinoColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub data_type: String,
}

#[derive(Deserialize)]
struct TrinoError {
    message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statement_page_parses_columns_and_data() {
        let json = r#"{
            "id": "q1",
            "infoUri": "http://h/ui/query.html?q1",
            "nextUri": "http://h/v1/statement/q1/2",
            "columns": [
                {"name":"id","type":"integer"},
                {"name":"name","type":"varchar"}
            ],
            "data": [[1,"alice"],[2,"bob"]],
            "stats": {"state":"RUNNING"}
        }"#;
        let page: StatementPage = serde_json::from_str(json).unwrap();
        assert_eq!(page.next_uri.as_deref(), Some("http://h/v1/statement/q1/2"));
        let cols = page.columns.unwrap();
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].name, "id");
        assert_eq!(cols[0].data_type, "integer");
        assert_eq!(page.data.unwrap().len(), 2);
    }

    #[test]
    fn statement_page_final_has_no_next_uri() {
        let json = r#"{"id":"q1","infoUri":"http://h","stats":{"state":"FINISHED"}}"#;
        let page: StatementPage = serde_json::from_str(json).unwrap();
        assert!(page.next_uri.is_none());
        assert!(page.columns.is_none());
        assert!(page.data.is_none());
    }

    #[test]
    fn statement_page_error_parses_message() {
        let json = r#"{
            "id":"q1",
            "infoUri":"http://h",
            "error":{"message":"line 1:8: Column 'x' cannot be resolved","errorName":"COLUMN_NOT_FOUND"},
            "stats":{"state":"FAILED"}
        }"#;
        let page: StatementPage = serde_json::from_str(json).unwrap();
        assert_eq!(
            page.error.unwrap().message,
            "line 1:8: Column 'x' cannot be resolved"
        );
    }

    #[test]
    fn statement_page_dml_parses_update_count() {
        let json = r#"{"id":"q1","infoUri":"http://h","updateType":"INSERT","updateCount":5,"stats":{"state":"FINISHED"}}"#;
        let page: StatementPage = serde_json::from_str(json).unwrap();
        assert_eq!(page.update_count, Some(5));
    }
}
