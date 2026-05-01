//! CRUD routes for user-defined geofences.

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
    models::geofence::Geofence,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/geofences", get(list_geofences).post(create_geofence))
        .route(
            "/geofences/:id",
            get(get_geofence).put(update_geofence).delete(delete_geofence),
        )
}

// ─── Request / response bodies ────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateGeofenceBody {
    name: String,
    latitude: f64,
    longitude: f64,
    radius_m: f64,
    is_home: Option<bool>,
    is_work: Option<bool>,
    cost_profile_id: Option<Uuid>,
    address_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct UpdateGeofenceBody {
    name: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    radius_m: Option<f64>,
    is_home: Option<bool>,
    is_work: Option<bool>,
    cost_profile_id: Option<Uuid>,
}

#[derive(Serialize)]
struct GeofenceResponse {
    geofences: Vec<Geofence>,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn list_geofences(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<GeofenceResponse>, AppError> {
    let rows = sqlx::query_as!(
        Geofence,
        r#"SELECT id, user_id, name, latitude, longitude, radius_m,
                address_id, cost_profile_id, is_home, is_work, created_at, updated_at
           FROM riviamigo.geofences
           WHERE user_id = $1
           ORDER BY name"#,
        auth.user_id
    )
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(GeofenceResponse { geofences: rows }))
}

async fn get_geofence(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Geofence>, AppError> {
    let row = sqlx::query_as!(
        Geofence,
        r#"SELECT id, user_id, name, latitude, longitude, radius_m,
                address_id, cost_profile_id, is_home, is_work, created_at, updated_at
           FROM riviamigo.geofences
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

async fn create_geofence(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateGeofenceBody>,
) -> Result<Json<Geofence>, AppError> {
    let row = sqlx::query_as!(
        Geofence,
        r#"INSERT INTO riviamigo.geofences
           (user_id, name, latitude, longitude, radius_m,
            is_home, is_work, cost_profile_id, address_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, user_id, name, latitude, longitude, radius_m,
                     address_id, cost_profile_id, is_home, is_work, created_at, updated_at"#,
        auth.user_id,
        body.name,
        body.latitude,
        body.longitude,
        body.radius_m,
        body.is_home.unwrap_or(false),
        body.is_work.unwrap_or(false),
        body.cost_profile_id,
        body.address_id
    )
    .fetch_one(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(row))
}

async fn update_geofence(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateGeofenceBody>,
) -> Result<Json<Geofence>, AppError> {
    let row = sqlx::query_as!(
        Geofence,
        r#"UPDATE riviamigo.geofences SET
           name            = COALESCE($3, name),
           latitude        = COALESCE($4, latitude),
           longitude       = COALESCE($5, longitude),
           radius_m        = COALESCE($6, radius_m),
           is_home         = COALESCE($7, is_home),
           is_work         = COALESCE($8, is_work),
           cost_profile_id = COALESCE($9, cost_profile_id)
           WHERE id = $1 AND user_id = $2
           RETURNING id, user_id, name, latitude, longitude, radius_m,
                     address_id, cost_profile_id, is_home, is_work, created_at, updated_at"#,
        id,
        auth.user_id,
        body.name,
        body.latitude,
        body.longitude,
        body.radius_m,
        body.is_home,
        body.is_work,
        body.cost_profile_id
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(AppError::from)?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}

async fn delete_geofence(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = sqlx::query!(
        "DELETE FROM riviamigo.geofences WHERE id = $1 AND user_id = $2",
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
