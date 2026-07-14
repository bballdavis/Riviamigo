use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not found")]
    NotFound,
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Forbidden")]
    Forbidden,
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Rivian API error: {0}")]
    RivianApi(String),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Dependency unavailable: {0}")]
    DependencyUnavailable(String),
    #[error("External connection disabled: {0}")]
    ExternalConnectionDisabled(String),
    #[error("Internal error")]
    Internal(#[from] anyhow::Error),
    #[error("Redis error: {0}")]
    Redis(#[from] redis::RedisError),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, "NOT_FOUND", self.to_string()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", self.to_string()),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "FORBIDDEN", self.to_string()),
            AppError::Conflict(m) => (StatusCode::CONFLICT, "CONFLICT", m.clone()),
            AppError::Validation(m) => (StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION", m.clone()),
            AppError::DependencyUnavailable(m) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "DEPENDENCY_UNAVAILABLE",
                m.clone(),
            ),
            AppError::ExternalConnectionDisabled(m) => (
                StatusCode::CONFLICT,
                "EXTERNAL_CONNECTION_DISABLED",
                m.clone(),
            ),
            AppError::Io(e) => {
                tracing::error!(err = %e, "io error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL",
                    "Filesystem error".into(),
                )
            }
            AppError::Redis(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL",
                "Internal error".into(),
            ),
            AppError::Database(e) => {
                tracing::error!(err = %e, "database error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL",
                    "Database error".into(),
                )
            }
            AppError::RivianApi(m) => (StatusCode::BAD_GATEWAY, "RIVIAN_API", m.clone()),
            AppError::Internal(e) => {
                tracing::error!(err = %e, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL",
                    "Internal server error".into(),
                )
            }
        };
        let body = json!({ "error": { "code": code, "message": message } });
        (status, Json(body)).into_response()
    }
}
