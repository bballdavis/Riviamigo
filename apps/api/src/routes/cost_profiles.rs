//! CRUD routes for user-defined cost profiles.

use axum::{
    extract::{Path, State},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
    models::cost_profile::CostProfile,
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
    effective_from: Option<chrono::NaiveDate>,
    effective_to: Option<chrono::NaiveDate>,
}

#[derive(Deserialize)]
struct UpdateProfileBody {
    name: Option<String>,
    billing_type: Option<String>,
    rate: Option<f64>,
    session_fee: Option<f64>,
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
    let rows = sqlx::query_as!(
        CostProfile,
        r#"SELECT id, user_id, name, billing_type, rate, session_fee, currency,
                  effective_from, effective_to, created_at
           FROM riviamigo.cost_profiles
           WHERE user_id = $1
           ORDER BY name"#,
        auth.user_id
    )
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
    let row = sqlx::query_as!(
        CostProfile,
        r#"SELECT id, user_id, name, billing_type, rate, session_fee, currency,
                  effective_from, effective_to, created_at
           FROM riviamigo.cost_profiles
           WHERE id = $1 AND user_id = $2"#,
        id,
        auth.user_id
    )
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
    validate_billing_type(&body.billing_type)?;
    let row = sqlx::query_as!(
        CostProfile,
        r#"INSERT INTO riviamigo.cost_profiles
           (user_id, name, billing_type, rate, session_fee, currency,
            effective_from, effective_to)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, user_id, name, billing_type, rate, session_fee, currency,
                     effective_from, effective_to, created_at"#,
        auth.user_id,
        body.name,
        body.billing_type,
        body.rate,
        body.session_fee.unwrap_or(0.0),
        body.currency.as_deref().unwrap_or("USD"),
        body.effective_from,
        body.effective_to
    )
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
    if let Some(bt) = &body.billing_type {
        validate_billing_type(bt)?;
    }

    let row = sqlx::query_as!(
        CostProfile,
        r#"UPDATE riviamigo.cost_profiles SET
           name           = COALESCE($3, name),
           billing_type   = COALESCE($4, billing_type),
           rate           = COALESCE($5, rate),
           session_fee    = COALESCE($6, session_fee),
           effective_from = COALESCE($7, effective_from),
           effective_to   = COALESCE($8, effective_to)
           WHERE id = $1 AND user_id = $2
           RETURNING id, user_id, name, billing_type, rate, session_fee, currency,
                     effective_from, effective_to, created_at"#,
        id,
        auth.user_id,
        body.name,
        body.billing_type,
        body.rate,
        body.session_fee,
        body.effective_from,
        body.effective_to
    )
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
    let result = sqlx::query!(
        "DELETE FROM riviamigo.cost_profiles WHERE id = $1 AND user_id = $2",
        id,
        auth.user_id
    )
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
        "per_kwh" | "per_minute" | "free" | "flat" => Ok(()),
        _ => Err(AppError::Validation(
            "billing_type must be one of: per_kwh, per_minute, free, flat".to_string(),
        )),
    }
}
