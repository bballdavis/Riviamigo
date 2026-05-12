//! CRUD routes for user-defined cost profiles.

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
    models::cost_profile::{CostProfile, TouPeriod, validate_tou_periods},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/cost-profiles",
            get(list_profiles).post(create_profile),
        )
        .route(
            "/cost-profiles/:id",
            get(get_profile).put(update_profile).delete(delete_profile),
        )
}

// ─── Request bodies ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateProfileBody {
    name: String,
    billing_type: String,
    rate: f64,
    session_fee: Option<f64>,
    currency: Option<String>,
    timezone: Option<String>,
    tou_periods: Option<serde_json::Value>,
    effective_from: Option<chrono::NaiveDate>,
    effective_to: Option<chrono::NaiveDate>,
}

#[derive(Deserialize)]
struct UpdateProfileBody {
    name: Option<String>,
    billing_type: Option<String>,
    rate: Option<f64>,
    session_fee: Option<f64>,
    currency: Option<String>,
    timezone: Option<String>,
    tou_periods: Option<serde_json::Value>,
    effective_from: Option<chrono::NaiveDate>,
    effective_to: Option<chrono::NaiveDate>,
}

#[derive(Serialize)]
struct ProfileListResponse {
    cost_profiles: Vec<CostProfile>,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn list_profiles(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<ProfileListResponse>, AppError> {
    let rows = sqlx::query_as::<_, CostProfile>(
        r#"SELECT id, user_id, name, billing_type, rate, session_fee, currency,
              timezone, tou_periods,
                  effective_from, effective_to, created_at
           FROM riviamigo.cost_profiles
           WHERE user_id = $1
           ORDER BY name"#
    )
    .bind(auth.user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(ProfileListResponse { cost_profiles: rows }))
}

async fn get_profile(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<CostProfile>, AppError> {
    let row = sqlx::query_as::<_, CostProfile>(
        r#"SELECT id, user_id, name, billing_type, rate, session_fee, currency,
              timezone, tou_periods,
                  effective_from, effective_to, created_at
           FROM riviamigo.cost_profiles
           WHERE id = $1 AND user_id = $2"#
    )
    .bind(id)
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(AppError::from)?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}

async fn create_profile(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateProfileBody>,
) -> Result<Json<CostProfile>, AppError> {
    let tou_periods = normalize_tou_periods(body.tou_periods.clone())?;
    validate_profile_details(
        &body.billing_type,
        body.rate,
        body.timezone.as_deref(),
        &tou_periods,
    )?;

    let row = sqlx::query_as::<_, CostProfile>(
        r#"INSERT INTO riviamigo.cost_profiles
           (user_id, name, billing_type, rate, session_fee, currency,
            timezone, tou_periods, effective_from, effective_to)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, user_id, name, billing_type, rate, session_fee, currency,
                     timezone, tou_periods,
                     effective_from, effective_to, created_at"#
    )
    .bind(auth.user_id)
    .bind(body.name)
    .bind(body.billing_type)
    .bind(body.rate)
    .bind(body.session_fee.unwrap_or(0.0))
    .bind(body.currency.as_deref().unwrap_or("USD"))
    .bind(body.timezone)
    .bind(tou_periods)
    .bind(body.effective_from)
    .bind(body.effective_to)
    .fetch_one(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(row))
}

async fn update_profile(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateProfileBody>,
) -> Result<Json<CostProfile>, AppError> {
    let current = sqlx::query_as::<_, CostProfile>(
        r#"SELECT id, user_id, name, billing_type, rate, session_fee, currency,
                  timezone, tou_periods,
                  effective_from, effective_to, created_at
           FROM riviamigo.cost_profiles
           WHERE id = $1 AND user_id = $2"#
    )
    .bind(id)
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(AppError::from)?
    .ok_or(AppError::NotFound)?;

    let billing_type = body.billing_type.clone().unwrap_or_else(|| current.billing_type.clone());
    let rate = body.rate.unwrap_or(current.rate);
    let session_fee = body.session_fee.unwrap_or(current.session_fee);
    let currency = body.currency.clone().unwrap_or_else(|| current.currency.clone());
    let timezone = body.timezone.clone().or_else(|| current.timezone.clone());
    let tou_periods = normalize_tou_periods(body.tou_periods.clone().or_else(|| Some(current.tou_periods.clone())))?;

    validate_profile_details(&billing_type, rate, timezone.as_deref(), &tou_periods)?;

    let row = sqlx::query_as::<_, CostProfile>(
        r#"UPDATE riviamigo.cost_profiles SET
           name           = $3,
           billing_type   = $4,
           rate           = $5,
           session_fee    = $6,
           currency       = $7,
           timezone       = $8,
           tou_periods    = $9,
           effective_from = $10,
           effective_to   = $11
           WHERE id = $1 AND user_id = $2
           RETURNING id, user_id, name, billing_type, rate, session_fee, currency,
                     timezone, tou_periods,
                     effective_from, effective_to, created_at"#
    )
    .bind(id)
    .bind(auth.user_id)
    .bind(body.name.unwrap_or(current.name))
    .bind(billing_type)
    .bind(rate)
    .bind(session_fee)
    .bind(currency)
    .bind(timezone)
    .bind(tou_periods)
    .bind(body.effective_from.or(current.effective_from))
    .bind(body.effective_to.or(current.effective_to))
    .fetch_optional(&state.pool)
    .await
    .map_err(AppError::from)?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}

async fn delete_profile(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = sqlx::query("DELETE FROM riviamigo.cost_profiles WHERE id = $1 AND user_id = $2")
    .bind(id)
    .bind(auth.user_id)
    .execute(&state.pool)
    .await
    .map_err(AppError::from)?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ─── Validation ───────────────────────────────────────────────────────────────

fn validate_billing_type(bt: &str) -> Result<(), AppError> {
    match bt {
        "per_kwh" | "per_minute" | "free" | "flat" | "tou" => Ok(()),
        _ => Err(AppError::Validation(
            "billing_type must be one of: per_kwh, per_minute, free, flat, tou".to_string(),
        )),
    }
}

fn normalize_tou_periods(value: Option<serde_json::Value>) -> Result<serde_json::Value, AppError> {
    match value {
        Some(value) => Ok(value),
        None => Ok(serde_json::json!([])),
    }
}

fn validate_profile_details(
    billing_type: &str,
    rate: f64,
    timezone: Option<&str>,
    tou_periods: &serde_json::Value,
) -> Result<(), AppError> {
    validate_billing_type(billing_type)?;
    if !rate.is_finite() || rate < 0.0 {
        return Err(AppError::Validation("rate must be a non-negative number".into()));
    }

    if billing_type == "tou" {
        if timezone.map(str::trim).filter(|value| !value.is_empty()).is_none() {
            return Err(AppError::Validation("timezone is required for TOU profiles".into()));
        }
        let periods: Vec<TouPeriod> = serde_json::from_value(tou_periods.clone())
            .map_err(|_| AppError::Validation("tou_periods must be a JSON array of schedule periods".into()))?;
        validate_tou_periods(&periods).map_err(AppError::Validation)?;
    }

    Ok(())
}
