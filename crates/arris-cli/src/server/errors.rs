use arris_engines::AppEnvironmentError;
use arris_engines::CanvasError;
use arris_engines::StoreError;
use arris_engines::connection::ConnectionError;
use arris_engines::query::QueryError;
use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use super::{ApiErrorBody, ApiErrorCode, ApiErrorDetail};

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("an arris server is already running for this data dir")]
    AlreadyRunning,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("missing or non-UTF-8 x-arris-project header")]
    MissingProject,
    #[error("invalid project: {0}")]
    InvalidProject(#[from] AppEnvironmentError),
    #[error("invalid request body: {0}")]
    BadBody(#[from] JsonRejection),
    #[error("unknown api route")]
    UnknownRoute,
    #[error("connection_test needs `config` or `connection`")]
    MissingTestTarget,
    #[error("title must not be empty")]
    EmptyTitle,
    #[error("connection not found: {0}")]
    ConnectionNotFound(String),
    #[error("run not found: {0}")]
    RunNotFound(String),
    #[error("result no longer cached for run {0}; re-run the query")]
    ResultNotCached(String),
    #[error("pin not found: {0}")]
    PinNotFound(String),
    #[error("invalid canvas doc: {0}")]
    InvalidCanvasDoc(String),
    #[error("{0}")]
    CanvasPlan(String),
    #[error("canvas not found: {0}")]
    CanvasNotFound(String),
    #[error("canvas title matches several canvases, use an id: {0}")]
    Ambiguous(String),
    #[error("connection request not found (the server may have restarted): {0}")]
    ConnectionRequestNotFound(String),
    #[error("connection request belongs to another project")]
    Forbidden,
    #[error("connection request is no longer pending (cancelled or already saved): {0}")]
    Conflict(String),
    #[error("--dir must stay inside the project root: {0}")]
    DirOutsideProject(String),
    #[error("directory not found: {0}")]
    DirNotFound(String),
    #[error("no dbt_project.yml in {0}; pass --dir with the dbt project folder")]
    DbtProjectNotFound(String),
    #[error("no sqlmesh config.yaml in {0}; pass --dir with the sqlmesh project folder")]
    SqlMeshProjectNotFound(String),
    #[error("model not found: {0}")]
    ModelNotFound(String),
    #[error("tool run not found: {0}")]
    ToolRunNotFound(String),
    #[error("project scan failed: {0}")]
    ProjectScan(String),
    #[error("{0}")]
    Connection(#[from] ConnectionError),
    #[error("{0}")]
    Query(#[from] QueryError),
    #[error("result cache: {0}")]
    Cache(#[from] CanvasError),
    #[error("store: {0}")]
    Store(#[from] StoreError),
}

impl ApiError {
    pub fn code(&self) -> ApiErrorCode {
        match self {
            Self::MissingProject => ApiErrorCode::MissingProject,
            Self::InvalidProject(_) => ApiErrorCode::InvalidProject,
            Self::BadBody(_)
            | Self::MissingTestTarget
            | Self::EmptyTitle
            | Self::InvalidCanvasDoc(_)
            | Self::CanvasPlan(_)
            | Self::ProjectScan(_) => ApiErrorCode::InvalidRequest,
            Self::UnknownRoute => ApiErrorCode::RouteNotFound,
            Self::ConnectionNotFound(_) => ApiErrorCode::ConnectionNotFound,
            Self::RunNotFound(_) => ApiErrorCode::RunNotFound,
            Self::PinNotFound(_) => ApiErrorCode::PinNotFound,
            Self::CanvasNotFound(_) => ApiErrorCode::CanvasNotFound,
            Self::Ambiguous(_) => ApiErrorCode::Ambiguous,
            Self::ResultNotCached(_) => ApiErrorCode::ResultNotCached,
            Self::ConnectionRequestNotFound(_) => ApiErrorCode::ConnectionRequestNotFound,
            Self::Forbidden | Self::DirOutsideProject(_) => ApiErrorCode::Forbidden,
            Self::DirNotFound(_) => ApiErrorCode::DirNotFound,
            Self::DbtProjectNotFound(_) => ApiErrorCode::DbtProjectNotFound,
            Self::SqlMeshProjectNotFound(_) => ApiErrorCode::SqlmeshProjectNotFound,
            Self::ModelNotFound(_) => ApiErrorCode::ModelNotFound,
            Self::ToolRunNotFound(_) => ApiErrorCode::ToolRunNotFound,
            Self::Conflict(_) => ApiErrorCode::Conflict,
            Self::Connection(_) => ApiErrorCode::ConnectionFailed,
            Self::Query(_) => ApiErrorCode::QueryFailed,
            Self::Store(_) | Self::Cache(_) => ApiErrorCode::StoreFailed,
        }
    }

    pub fn status(&self) -> StatusCode {
        match self {
            Self::UnknownRoute
            | Self::ConnectionNotFound(_)
            | Self::RunNotFound(_)
            | Self::PinNotFound(_)
            | Self::CanvasNotFound(_)
            | Self::ResultNotCached(_)
            | Self::ConnectionRequestNotFound(_)
            | Self::DirNotFound(_)
            | Self::DbtProjectNotFound(_)
            | Self::SqlMeshProjectNotFound(_)
            | Self::ModelNotFound(_)
            | Self::ToolRunNotFound(_) => StatusCode::NOT_FOUND,
            Self::Forbidden | Self::DirOutsideProject(_) => StatusCode::FORBIDDEN,
            Self::Conflict(_) | Self::Ambiguous(_) => StatusCode::CONFLICT,
            Self::Store(_) | Self::Cache(_) => StatusCode::INTERNAL_SERVER_ERROR,
            _ => StatusCode::BAD_REQUEST,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ApiErrorBody {
            error: ApiErrorDetail {
                code: self.code(),
                message: self.to_string(),
            },
        };
        (self.status(), Json(body)).into_response()
    }
}
