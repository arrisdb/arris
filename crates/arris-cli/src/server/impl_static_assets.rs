use axum::http::Uri;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::response::{IntoResponse, Response};

use super::{
    API_PREFIX, ASSETS_PREFIX, ApiError, CACHE_IMMUTABLE, CACHE_NO_CACHE, INDEX_EMBED_EXPECT,
    INDEX_FILE, ROOT_ROUTE, WebDist,
};

/// Serves the embedded web UI with an index.html fallback for client-side routes.
pub struct StaticAssets;

impl StaticAssets {
    pub async fn handler(uri: Uri) -> Response {
        let path = uri.path();
        if path.starts_with(API_PREFIX) {
            return ApiError::UnknownRoute.into_response();
        }
        let wanted = path.strip_prefix(ROOT_ROUTE).unwrap_or(path);
        let (name, file) = match WebDist::get(wanted) {
            Some(file) => (wanted, file),
            None => (
                INDEX_FILE,
                WebDist::get(INDEX_FILE).expect(INDEX_EMBED_EXPECT),
            ),
        };
        let cache = if name.starts_with(ASSETS_PREFIX) {
            CACHE_IMMUTABLE
        } else {
            CACHE_NO_CACHE
        };
        (
            [
                (CONTENT_TYPE, file.metadata.mimetype().to_owned()),
                (CACHE_CONTROL, cache.to_owned()),
            ],
            file.data,
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arris_engines::AppEnvironment;
    use arris_engines::persistence::MemorySecretStore;
    use reqwest::StatusCode;
    use reqwest::header::{CACHE_CONTROL, CONTENT_TYPE, COOKIE};
    use tempfile::TempDir;

    use crate::server::{
        ARRIS_TOKEN_COOKIE, ApiErrorBody, ApiErrorCode, CACHE_NO_CACHE, CONNECTION_NEW_PAGE,
        ROOT_ROUTE, Server,
    };

    const HTML_TYPE: &str = "text/html";
    const UNKNOWN_API_PATH: &str = "/api/nope";
    const APP_ROOT_MARKER: &str = "id=\"root\"";

    struct Harness {
        _tmp: TempDir,
        base: String,
        cookie: String,
        client: reqwest::Client,
    }

    impl Harness {
        async fn start() -> Self {
            let tmp = TempDir::new().unwrap();
            let env =
                AppEnvironment::init_at(tmp.path().into(), Arc::new(MemorySecretStore::new()))
                    .await
                    .unwrap();
            let server = Server::bind(env, Some(0)).unwrap();
            let state = server.state();
            tokio::spawn(server.serve());
            Self {
                _tmp: tmp,
                base: format!("http://127.0.0.1:{}", state.port),
                cookie: format!("{ARRIS_TOKEN_COOKIE}={}", state.token),
                client: reqwest::Client::new(),
            }
        }

        async fn get(&self, path: &str, authed: bool) -> reqwest::Response {
            let req = self.client.get(format!("{}{path}", self.base));
            let req = if authed {
                req.header(COOKIE, &self.cookie)
            } else {
                req
            };
            req.send().await.unwrap()
        }
    }

    #[tokio::test]
    async fn serves_index_html_at_root_with_cookie() {
        let h = Harness::start().await;
        let resp = h.get(ROOT_ROUTE, true).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(
            resp.headers()[CONTENT_TYPE]
                .to_str()
                .unwrap()
                .starts_with(HTML_TYPE)
        );
        assert_eq!(resp.headers()[CACHE_CONTROL], CACHE_NO_CACHE);
        assert!(resp.text().await.unwrap().contains(APP_ROOT_MARKER));
    }

    #[tokio::test]
    async fn spa_fallback_for_connections_new() {
        let h = Harness::start().await;
        let path = format!("{CONNECTION_NEW_PAGE}?request=abc");
        let resp = h.get(&path, true).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(
            resp.headers()[CONTENT_TYPE]
                .to_str()
                .unwrap()
                .starts_with(HTML_TYPE)
        );
        assert!(resp.text().await.unwrap().contains(APP_ROOT_MARKER));
    }

    #[tokio::test]
    async fn static_without_auth_is_403() {
        let h = Harness::start().await;
        for path in [ROOT_ROUTE, CONNECTION_NEW_PAGE] {
            assert_eq!(
                h.get(path, false).await.status(),
                StatusCode::FORBIDDEN,
                "{path}"
            );
        }
    }

    #[tokio::test]
    async fn unknown_api_path_is_json_404() {
        let h = Harness::start().await;
        let resp = h.get(UNKNOWN_API_PATH, true).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        let body: ApiErrorBody = resp.json().await.unwrap();
        assert_eq!(body.error.code, ApiErrorCode::RouteNotFound);
    }
}
