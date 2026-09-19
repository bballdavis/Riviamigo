use axum::{extract::State, http::HeaderMap, routing::get, Json, Router};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::users::require_super_user,
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
    services::authentication_settings::{
        self, AuthenticationSettingsResponse, AuthenticationSettingsUpdate,
    },
    services::{app_settings, security_audit::SecurityAuditEvent},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/timezone", get(get_timezone).put(update_timezone))
        .route(
            "/settings/authentication",
            get(get_authentication).put(update_authentication),
        )
        .route(
            "/settings/authentication/test",
            axum::routing::post(test_authentication),
        )
        .route("/admin/security/status", get(get_security_status))
}

async fn get_authentication(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<AuthenticationSettingsResponse>, AppError> {
    require_super_user(&state.pool, auth.user_id).await?;
    Ok(Json(
        authentication_settings::load(&state.pool, &state.age_key).await?,
    ))
}

async fn update_authentication(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<AuthenticationSettingsUpdate>,
) -> Result<Json<AuthenticationSettingsResponse>, AppError> {
    require_super_user(&state.pool, auth.user_id).await?;
    Ok(Json(
        authentication_settings::update(&state.pool, &state.age_key, auth.user_id, body).await?,
    ))
}

async fn test_authentication(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    require_super_user(&state.pool, auth.user_id).await?;
    let settings = authentication_settings::load(&state.pool, &state.age_key).await?;
    authentication_settings::validate_effective(&settings)?;
    Ok(Json(
        serde_json::json!({ "valid": true, "discovery": "not_checked", "message": "OIDC settings are structurally valid; provider discovery will be checked by the login flow." }),
    ))
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
