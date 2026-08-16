use axum::{extract::State, http::HeaderMap, routing::get, Json, Router};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
    services::{app_settings, security_audit::SecurityAuditEvent},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/timezone", get(get_timezone).put(update_timezone))
        .route("/admin/security/status", get(get_security_status))
}

#[derive(Debug, Serialize)]
struct TimezoneResponse {
    timezone: String,
}

#[derive(Debug, Deserialize)]
struct UpdateTimezoneBody {
    timezone: String,
}

#[derive(Debug, Serialize)]
struct SecurityStatusResponse {
    cryptographic_key_source: &'static str,
    database_key_shared_fate: bool,
    setup_proof_available: bool,
    security_event_retention_days: i32,
}

async fn get_timezone(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<TimezoneResponse>, AppError> {
    Ok(Json(TimezoneResponse {
        timezone: app_settings::load_app_timezone_name(&state.pool).await?,
    }))
}

async fn update_timezone(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(body): Json<UpdateTimezoneBody>,
) -> Result<Json<TimezoneResponse>, AppError> {
    require_admin(&state, auth.user_id).await?;
    let timezone = body
        .timezone
        .trim()
        .parse::<Tz>()
        .map_err(|_| AppError::Validation("timezone must be a valid IANA timezone".into()))?;
    let mut transaction = state.pool.begin().await?;
    app_settings::set_app_timezone_tx(&mut transaction, timezone).await?;
    SecurityAuditEvent::success("application_timezone_updated", Some(auth.user_id))
        .target("system_config:app_timezone")
        .request_id_from_headers(&headers)
        .record_tx(&mut transaction)
        .await?;
    transaction.commit().await?;
    Ok(Json(TimezoneResponse {
        timezone: timezone.name().to_string(),
    }))
}

async fn get_security_status(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<SecurityStatusResponse>, AppError> {
    require_admin(&state, auth.user_id).await?;
    let cryptographic_key_source = state.config.cryptographic_key_source();
    Ok(Json(SecurityStatusResponse {
        cryptographic_key_source,
        database_key_shared_fate: cryptographic_key_source == "database",
        setup_proof_available: state.config.setup_proof_available(),
        security_event_retention_days:
            crate::services::security_audit::SECURITY_EVENT_RETENTION_DAYS,
    }))
}

async fn require_admin(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    let role = sqlx::query_scalar!("SELECT role FROM riviamigo.users WHERE id = $1", user_id)
        .fetch_optional(&state.pool)
        .await?;

    match role.as_deref() {
        Some("admin") | Some("super_user") => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}
