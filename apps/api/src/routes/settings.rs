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
            "/settings/update-check",
            get(get_update_check_settings).put(update_update_check_settings),
        )
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
    let visible = authentication_settings::load(&state.pool, &state.age_key).await?;
    authentication_settings::validate_effective(&visible)?;
    let effective = authentication_settings::load_effective(&state.pool, &state.age_key).await?;
    let mut provider_settings = effective.clone();
    // Test-before-enable is intentional so the administrator can validate the
    // provider and recovery path without exposing SSO on the login page.
    provider_settings.oidc_enabled = true;
    crate::services::oidc::test_provider(&provider_settings).await?;
    authentication_settings::record_validation(&state.pool, &effective, &state.age_key).await?;
    Ok(Json(
        serde_json::json!({ "valid": true, "discovery": "validated", "message": "OIDC provider discovery and JWKS retrieval succeeded." }),
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

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum UpdateCheckFrequency {
    Hourly,
    Daily,
    Weekly,
    Monthly,
}

impl UpdateCheckFrequency {
    fn as_str(self) -> &'static str {
        match self {
            Self::Hourly => "hourly",
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
        }
    }

    fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "hourly" => Ok(Self::Hourly),
            "daily" => Ok(Self::Daily),
            "weekly" => Ok(Self::Weekly),
            "monthly" => Ok(Self::Monthly),
            _ => Err(AppError::Internal(anyhow::anyhow!(
                "unknown update check frequency in database"
            ))),
        }
    }
}

#[derive(Debug, Serialize)]
struct UpdateCheckSettingsResponse {
    enabled: bool,
    frequency: UpdateCheckFrequency,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateCheckSettingsBody {
    enabled: bool,
    frequency: UpdateCheckFrequency,
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

async fn get_update_check_settings(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<UpdateCheckSettingsResponse>, AppError> {
    let (enabled, frequency): (bool, String) = sqlx::query_as(
        "SELECT enabled, frequency FROM riviamigo.update_check_settings WHERE id = TRUE",
    )
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(UpdateCheckSettingsResponse {
        enabled,
        frequency: UpdateCheckFrequency::parse(&frequency)?,
    }))
}

async fn update_update_check_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(body): Json<UpdateCheckSettingsBody>,
) -> Result<Json<UpdateCheckSettingsResponse>, AppError> {
    require_admin(&state, auth.user_id).await?;
    let mut transaction = state.pool.begin().await?;
    let (enabled, frequency): (bool, String) = sqlx::query_as(
        "INSERT INTO riviamigo.update_check_settings (id, enabled, frequency, updated_by) \
         VALUES (TRUE, $1, $2, $3) \
         ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, \
             frequency = EXCLUDED.frequency, updated_by = EXCLUDED.updated_by, updated_at = now() \
         RETURNING enabled, frequency",
    )
    .bind(body.enabled)
    .bind(body.frequency.as_str())
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await?;
    SecurityAuditEvent::success("github_release_check_settings_updated", Some(auth.user_id))
        .target("system_config:github_release_check")
        .request_id_from_headers(&headers)
        .record_tx(&mut transaction)
        .await?;
    transaction.commit().await?;
    Ok(Json(UpdateCheckSettingsResponse {
        enabled,
        frequency: UpdateCheckFrequency::parse(&frequency)?,
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

    if role_can_manage_installation(role.as_deref()) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

fn role_can_manage_installation(role: Option<&str>) -> bool {
    matches!(role, Some("admin" | "super_user"))
}

#[cfg(test)]
mod update_check_tests {
    use super::{role_can_manage_installation, UpdateCheckFrequency};

    #[test]
    fn only_administrator_roles_can_change_installation_settings() {
        assert!(role_can_manage_installation(Some("admin")));
        assert!(role_can_manage_installation(Some("super_user")));
        assert!(!role_can_manage_installation(Some("user")));
        assert!(!role_can_manage_installation(None));
    }

    #[test]
    fn supports_only_the_persisted_update_check_frequencies() {
        assert_eq!(
            UpdateCheckFrequency::parse("hourly").unwrap(),
            UpdateCheckFrequency::Hourly
        );
        assert_eq!(
            UpdateCheckFrequency::parse("daily").unwrap(),
            UpdateCheckFrequency::Daily
        );
        assert_eq!(
            UpdateCheckFrequency::parse("weekly").unwrap(),
            UpdateCheckFrequency::Weekly
        );
        assert_eq!(
            UpdateCheckFrequency::parse("monthly").unwrap(),
            UpdateCheckFrequency::Monthly
        );
        assert!(UpdateCheckFrequency::parse("fortnightly").is_err());
    }
}
