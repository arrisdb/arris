use std::sync::Arc;

use axum::extract::{Query, Request, State};
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, COOKIE, HOST, LOCATION, SET_COOKIE};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use super::{
    ARRIS_TOKEN_COOKIE, BACKSLASH, BEARER_PREFIX, COOKIE_ATTRIBUTES, COOKIE_SEPARATOR,
    LOCALHOST_HOST, LOOPBACK_HOST, NO_STORE, PROTOCOL_RELATIVE_PREFIX, ROOT_ROUTE, ServerState,
    TokenQuery,
};

/// Loopback Host check plus bearer/cookie token check for every route.
pub struct AuthGuard;

impl AuthGuard {
    pub async fn layer(
        State(state): State<Arc<ServerState>>,
        req: Request,
        next: Next,
    ) -> Response {
        // Host pinning defeats DNS rebinding: a foreign page cannot reach us under its own name.
        if !Self::host_allowed(req.headers(), state.port) {
            return StatusCode::FORBIDDEN.into_response();
        }
        if req.method() == Method::GET
            && req.uri().path() == ROOT_ROUTE
            && let Ok(Query(TokenQuery {
                token: Some(token),
                next,
            })) = Query::try_from_uri(req.uri())
        {
            return Self::login(&state, &token, next.as_deref());
        }
        match Self::request_token(req.headers()) {
            Some(token) if Self::tokens_match(&token, &state.token) => next.run(req).await,
            _ => StatusCode::FORBIDDEN.into_response(),
        }
    }

    fn login(state: &ServerState, token: &str, next: Option<&str>) -> Response {
        if !Self::tokens_match(token, &state.token) {
            return StatusCode::FORBIDDEN.into_response();
        }
        let cookie = format!("{ARRIS_TOKEN_COOKIE}={token}; {COOKIE_ATTRIBUTES}");
        let location = next
            .filter(|n| Self::is_local_path(n))
            .unwrap_or(ROOT_ROUTE);
        (
            StatusCode::FOUND,
            [
                (LOCATION, location.to_owned()),
                (SET_COOKIE, cookie),
                (CACHE_CONTROL, NO_STORE.to_owned()),
            ],
        )
            .into_response()
    }

    /// Same-origin path only: one leading `/`, no backslash or control chars, so no open redirect.
    fn is_local_path(next: &str) -> bool {
        next.starts_with(ROOT_ROUTE)
            && !next.starts_with(PROTOCOL_RELATIVE_PREFIX)
            && !next.contains(BACKSLASH)
            && !next.chars().any(char::is_control)
    }

    fn host_allowed(headers: &HeaderMap, port: u16) -> bool {
        let Some(host) = headers.get(HOST).and_then(|h| h.to_str().ok()) else {
            return false;
        };
        [LOOPBACK_HOST, LOCALHOST_HOST]
            .iter()
            .any(|name| host == format!("{name}:{port}"))
    }

    fn request_token(headers: &HeaderMap) -> Option<String> {
        let bearer = headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix(BEARER_PREFIX));
        if let Some(token) = bearer {
            return Some(token.to_owned());
        }
        let prefix = format!("{ARRIS_TOKEN_COOKIE}=");
        headers
            .get_all(COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .flat_map(|v| v.split(COOKIE_SEPARATOR))
            .find_map(|pair| pair.trim().strip_prefix(prefix.as_str()).map(str::to_owned))
    }

    /// Constant-time so response timing does not leak how much of a guess matched.
    fn tokens_match(given: &str, expected: &str) -> bool {
        let (a, b) = (given.as_bytes(), expected.as_bytes());
        a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_match_requires_exact_equality() {
        assert!(AuthGuard::tokens_match("abc", "abc"));
        assert!(!AuthGuard::tokens_match("abd", "abc"));
        assert!(!AuthGuard::tokens_match("ab", "abc"));
        assert!(!AuthGuard::tokens_match("", "abc"));
    }

    #[test]
    fn is_local_path_rejects_open_redirects() {
        for safe in ["/", "/connections/new?request=abc"] {
            assert!(AuthGuard::is_local_path(safe), "{safe}");
        }
        for unsafe_next in [
            "",
            "//evil.example",
            "https://evil.example",
            "/\\evil.example",
            "\\evil.example",
            "/\t/evil.example",
            "evil",
        ] {
            assert!(!AuthGuard::is_local_path(unsafe_next), "{unsafe_next}");
        }
    }
}
