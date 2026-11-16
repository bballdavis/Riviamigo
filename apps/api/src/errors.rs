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
    #[error("Resource capacity reached: {0}")]
    ResourceLimited(&'static str),
    #[error("First-owner setup requires the configured setup token")]
    SetupProofRequired,
    #[error("The first-owner setup token is invalid")]
    SetupProofInvalid,
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Recovery operation conflict: {0}")]
    RecoveryConflict(String),
    #[error("Recovery package too large: {0}")]
    RecoveryTooLarge(String),
    #[error("Invalid recovery package: {0}")]
    RecoveryInvalid(String),
    #[error("Insufficient recovery storage: {0}")]
    RecoveryInsufficientStorage(String),
    #[error("Recovery operation deadline exceeded: {0}")]
    RecoveryDeadline(String),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Rivian API error: {0}")]
    RivianApi(String),
    #[error("Rivian rejected the account credentials")]
    RivianCredentialsRejected,
    #[error("Rivian rejected the verification code")]
    RivianOtpRejected,
    #[error("Rivian connection session expired")]
    RivianConnectSessionExpired,
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

impl AppError {
    /// Logs variants whose cause is not recorded where the response is built.
    ///
    /// Server faults (`Database`, `Io`, `Redis`, `Internal`) log at `ERROR`
    /// inside `into_response`, where the underlying error is in hand. The
    /// rest are classified here so every response has exactly one entry:
    /// upstream and capacity problems the operator can act on are `WARN`;
    /// problems the caller caused are `DEBUG` because they are expected
    /// traffic, not faults.
    fn log_outcome(&self) {
        match self {
            AppError::Database(_)
            | AppError::Io(_)
            | AppError::Redis(_)
            | AppError::Internal(_) => {}
            AppError::DependencyUnavailable(message)
            | AppError::RivianApi(message)
            | AppError::RecoveryInsufficientStorage(message)
            | AppError::RecoveryDeadline(message) => {
                tracing::warn!(error = %self, detail = %message, "request failed: dependency or capacity problem");
            }
            AppError::ResourceLimited(class) => {
                tracing::warn!(class = *class, "request rejected: server capacity reached");
            }
            _ => tracing::debug!(error = %self, "request rejected"),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        self.log_outcome();
        let (status, code, message) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, "NOT_FOUND", self.to_string()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", self.to_string()),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "FORBIDDEN", self.to_string()),
            AppError::ResourceLimited(_) => (
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMITED",
                "Server capacity reached. Please retry shortly.".into(),
            ),
            AppError::SetupProofRequired => (
                StatusCode::FORBIDDEN,
                "SETUP_PROOF_REQUIRED",
                self.to_string(),
            ),
            AppError::SetupProofInvalid => (
                StatusCode::FORBIDDEN,
                "SETUP_PROOF_INVALID",
                self.to_string(),
            ),
            AppError::Conflict(m) => (StatusCode::CONFLICT, "CONFLICT", m.clone()),
            AppError::RecoveryConflict(m) => (StatusCode::CONFLICT, "RECOVERY_CONFLICT", m.clone()),
            AppError::RecoveryTooLarge(m) => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "RECOVERY_TOO_LARGE",
                m.clone(),
            ),
            AppError::RecoveryInvalid(m) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "RECOVERY_INVALID",
                m.clone(),
            ),
            AppError::RecoveryInsufficientStorage(m) => (
                StatusCode::INSUFFICIENT_STORAGE,
                "RECOVERY_INSUFFICIENT_STORAGE",
                m.clone(),
            ),
            AppError::RecoveryDeadline(m) => {
                (StatusCode::GATEWAY_TIMEOUT, "RECOVERY_DEADLINE", m.clone())
            }
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
                tracing::error!(error = %e, "request failed: filesystem error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL",
                    "Filesystem error".into(),
                )
            }
            AppError::Redis(e) => {
                tracing::error!(error = %e, "request failed: redis error");
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "DEPENDENCY_UNAVAILABLE",
                    "Temporary session storage is unavailable. Please try again.".into(),
                )
            }
            AppError::Database(e) => {
                tracing::error!(error = %e, "request failed: database error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL",
                    "Database error".into(),
                )
            }
            AppError::RivianApi(m) => (StatusCode::BAD_GATEWAY, "RIVIAN_API", m.clone()),
            AppError::RivianCredentialsRejected => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "RIVIAN_CREDENTIALS_REJECTED",
                "Rivian did not accept that email or password.".into(),
            ),
            AppError::RivianOtpRejected => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "RIVIAN_OTP_REJECTED",
                "Rivian did not accept that verification code.".into(),
            ),
            AppError::RivianConnectSessionExpired => (
                StatusCode::CONFLICT,
                "RIVIAN_CONNECT_SESSION_EXPIRED",
                "Your secure Rivian sign-in session expired. Start again from the account step."
                    .into(),
            ),
            AppError::Internal(e) => {
                tracing::error!(error = ?e, "request failed: internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL",
                    "Internal server error".into(),
                )
            }
        };
        let body = json!({ "error": { "code": code, "message": message } });
        let mut response = (status, Json(body)).into_response();
        if let AppError::ResourceLimited(class) = self {
            response
                .headers_mut()
                .insert("retry-after", "5".parse().unwrap());
            response
                .headers_mut()
                .insert("x-ratelimit-source", "application".parse().unwrap());
            response
                .headers_mut()
                .insert("x-ratelimit-class", class.parse().unwrap());
        }
        response
    }
}
