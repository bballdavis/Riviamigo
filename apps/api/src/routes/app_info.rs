use axum::{routing::get, Json, Router};
use serde::Serialize;

use crate::{errors::AppError, middleware::auth::AuthUser};

pub fn router() -> Router<crate::middleware::auth::AppState> {
    Router::new().route("/app/version", get(get_app_version))
}

#[derive(Debug, Serialize)]
struct AppVersionResponse {
    version: String,
}

fn current_build_version(value: Option<String>) -> String {
    value
        .map(|version| version.trim().to_string())
        .filter(|version| !version.is_empty() && version != "unknown")
        .unwrap_or_else(|| "unknown".to_string())
}

async fn get_app_version(_auth: AuthUser) -> Result<Json<AppVersionResponse>, AppError> {
    Ok(Json(AppVersionResponse {
        version: current_build_version(std::env::var("RIVIAMIGO_BUILD_VERSION").ok()),
    }))
}

#[cfg(test)]
mod tests {
    use super::current_build_version;

    #[test]
    fn missing_build_version_is_unknown() {
        assert_eq!(current_build_version(None), "unknown");
        assert_eq!(current_build_version(Some("  ".into())), "unknown");
        assert_eq!(current_build_version(Some("unknown".into())), "unknown");
    }

    #[test]
    fn build_version_is_trimmed() {
        assert_eq!(
            current_build_version(Some(" 2026.09.4+dev ".into())),
            "2026.09.4+dev"
        );
    }
}
