use axum::{extract::State, routing::get, Json, Router};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
    services::app_settings,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/settings/timezone", get(get_timezone).put(update_timezone))
}

#[derive(Debug, Serialize)]
struct TimezoneResponse {
    timezone: String,
}

#[derive(Debug, Deserialize)]
struct UpdateTimezoneBody {
    timezone: String,
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
    Json(body): Json<UpdateTimezoneBody>,
) -> Result<Json<TimezoneResponse>, AppError> {
    require_admin(&state, auth.user_id).await?;
    let timezone = body
        .timezone
        .trim()
        .parse::<Tz>()
        .map_err(|_| AppError::Validation("timezone must be a valid IANA timezone".into()))?;
    app_settings::set_app_timezone(&state.pool, timezone).await?;
    Ok(Json(TimezoneResponse {
        timezone: timezone.name().to_string(),
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
