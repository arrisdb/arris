use arris_engines::{AppEnvironmentError, PrefillError};

use super::{
    CliErrorBody, CliErrorDetail, ERROR_CODE_CANCELLED, ERROR_CODE_INVALID_KIND,
    ERROR_CODE_INVALID_RESPONSE, ERROR_CODE_IO, ERROR_CODE_SERVER, ERROR_CODE_SERVER_UNAVAILABLE,
    ERROR_CODE_PROJECT_CONFIG_INVALID, ERROR_CODE_PROJECT_CONFIG_NOT_FOUND, ERROR_CODE_TIMEOUT,
    ERROR_CODE_TOOL_NOT_FOUND, ERROR_CODE_UNSUPPORTED_ADAPTER, EXIT_API_ERROR, EXIT_CANCELLED,
    EXIT_SERVER_UNAVAILABLE, EXIT_TOOL_NOT_FOUND,
};
use crate::server::{ApiError, ApiErrorBody, ApiErrorDetail, ServerError};

#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error("environment: {0}")]
    Environment(#[from] AppEnvironmentError),
    #[error("server: {0}")]
    Server(#[from] ServerError),
    #[error("{}", .0.message)]
    Api(ApiErrorDetail),
    #[error("server unavailable: {0}")]
    Unavailable(String),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid server response: {0}")]
    InvalidResponse(#[from] serde_json::Error),
    #[error("unknown kind `{0}`; valid kinds: {1}")]
    InvalidKind(String, String),
    #[error("connection request was cancelled")]
    Cancelled,
    #[error("timed out waiting for the connection form")]
    TimedOut,
    #[error("`{0}` could not be started; install it or set its ARRIS_*_BIN path")]
    ToolNotFound(String),
    #[error("{0}")]
    Prefill(#[from] PrefillError),
    /// A native tool exited non-zero: its run output is printed as-is.
    #[error("tool exited with code {code}")]
    ToolExit { output: serde_json::Value, code: u8 },
}

impl From<ApiError> for CliError {
    fn from(e: ApiError) -> Self {
        Self::Api(ApiErrorDetail {
            code: e.code(),
            message: e.to_string(),
        })
    }
}

impl CliError {
    pub fn exit_code(&self) -> u8 {
        match self {
            Self::Unavailable(_) | Self::Http(_) => EXIT_SERVER_UNAVAILABLE,
            Self::Cancelled | Self::TimedOut => EXIT_CANCELLED,
            Self::ToolNotFound(_) => EXIT_TOOL_NOT_FOUND,
            Self::ToolExit { code, .. } => *code,
            _ => EXIT_API_ERROR,
        }
    }

    /// `{ "error": { code, message } }`; server errors pass through verbatim.
    pub fn body(&self) -> serde_json::Value {
        let code = match self {
            Self::Api(detail) => {
                let body = ApiErrorBody {
                    error: detail.clone(),
                };
                return serde_json::to_value(body).unwrap_or_default();
            }
            Self::ToolExit { output, .. } => return output.clone(),
            Self::ToolNotFound(_) => ERROR_CODE_TOOL_NOT_FOUND,
            Self::Prefill(PrefillError::UnsupportedAdapter(_)) => ERROR_CODE_UNSUPPORTED_ADAPTER,
            Self::Prefill(PrefillError::NotFound(_)) => ERROR_CODE_PROJECT_CONFIG_NOT_FOUND,
            Self::Prefill(PrefillError::Invalid(_)) => ERROR_CODE_PROJECT_CONFIG_INVALID,
            Self::Unavailable(_) | Self::Http(_) => ERROR_CODE_SERVER_UNAVAILABLE,
            Self::Io(_) => ERROR_CODE_IO,
            Self::InvalidResponse(_) => ERROR_CODE_INVALID_RESPONSE,
            Self::InvalidKind(..) => ERROR_CODE_INVALID_KIND,
            Self::Cancelled => ERROR_CODE_CANCELLED,
            Self::TimedOut => ERROR_CODE_TIMEOUT,
            Self::Environment(_) | Self::Server(_) => ERROR_CODE_SERVER,
        };
        let body = CliErrorBody {
            error: CliErrorDetail {
                code,
                message: self.to_string(),
            },
        };
        serde_json::to_value(body).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::ApiErrorCode;

    #[test]
    fn api_errors_pass_through_with_exit_1() {
        let err = CliError::Api(ApiErrorDetail {
            code: ApiErrorCode::RunNotFound,
            message: "run not found: x".into(),
        });
        assert_eq!(err.exit_code(), EXIT_API_ERROR);
        assert_eq!(err.body()["error"]["code"], "run_not_found");
        assert_eq!(err.body()["error"]["message"], "run not found: x");
    }

    #[test]
    fn unavailable_exits_2() {
        let err = CliError::Unavailable("timed out".into());
        assert_eq!(err.exit_code(), EXIT_SERVER_UNAVAILABLE);
        assert_eq!(err.body()["error"]["code"], ERROR_CODE_SERVER_UNAVAILABLE);
    }

    #[test]
    fn cancelled_and_timeout_exit_3() {
        assert_eq!(CliError::Cancelled.exit_code(), EXIT_CANCELLED);
        assert_eq!(CliError::Cancelled.body()["error"]["code"], "cancelled");
        assert_eq!(CliError::TimedOut.exit_code(), EXIT_CANCELLED);
        assert_eq!(CliError::TimedOut.body()["error"]["code"], "timeout");
    }
}
