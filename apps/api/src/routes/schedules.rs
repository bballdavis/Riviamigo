//! Schedule and enrichment routes.
//!
//! Routes:
//!   GET  /v1/vehicles/:id/charging-schedule
//!   PUT  /v1/vehicles/:id/charging-schedule
//!   GET  /v1/vehicles/:id/departure-schedules
//!   POST /v1/vehicles/:id/departure-schedules
//!   PATCH /v1/vehicles/:id/departure-schedules/:schedule_id
//!   DELETE /v1/vehicles/:id/departure-schedules/:schedule_id
//!   GET  /v1/vehicles/:id/wallboxes
//!   GET  /v1/vehicles/:id/ota-details

use axum::{
    extract::{Path, State},
    routing::{get, patch},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::vehicles::{require_vehicle_manager_access, require_vehicle_read_access},
    errors::AppError,
    ingestion::rivian_poll::{self, ChargingScheduleInput, DepartureScheduleInput},
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/vehicles/:id/charging-schedule",
            get(get_charging_schedule).put(put_charging_schedule),
        )
        .route(
            "/vehicles/:id/departure-schedules",
            get(list_departure_schedules).post(create_departure_schedule),
        )
        .route(
            "/vehicles/:id/departure-schedules/:schedule_id",
            patch(update_departure_schedule).delete(delete_departure_schedule),
        )
        .route("/vehicles/:id/wallboxes", get(list_wallboxes))
        .route("/vehicles/:id/ota-details", get(get_ota_details))
}

fn http_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| AppError::Internal(error.into()))
}

async fn reject_demo_schedule_mutation(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
) -> Result<(), AppError> {
    let key = sqlx::query_scalar::<_, String>(
        "SELECT rivian_vehicle_id FROM riviamigo.vehicles WHERE id=$1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if key.starts_with("demo-") {
        return Err(AppError::Validation(
            "demo vehicles are historical examples and cannot change Rivian schedules".into(),
        ));
    }
    Ok(())
}

// ── GET /v1/vehicles/:id/charging-schedule ───────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ChargingScheduleRow {
    id: Uuid,
    enabled: bool,
    start_time_minutes: Option<i32>,
    duration_minutes: Option<i32>,
    amperage: Option<f64>,
    location_lat: Option<f64>,
    location_lng: Option<f64>,
    week_days: Option<Vec<String>>,
    rivian_updated_at: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
}

async fn get_charging_schedule(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<Option<ChargingScheduleRow>>, AppError> {
    require_vehicle_read_access(&state.pool, &auth, vehicle_id).await?;

    let row = sqlx::query_as::<_, ChargingScheduleRow>(
        "SELECT id, enabled, start_time_minutes, duration_minutes, amperage,
                location_lat, location_lng, week_days, rivian_updated_at, updated_at
         FROM riviamigo.charging_schedules
         WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await?;

    Ok(Json(row))
}

// ── PUT /v1/vehicles/:id/charging-schedule ───────────────────────────────────

async fn put_charging_schedule(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
    Json(body): Json<ChargingScheduleInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    reject_demo_schedule_mutation(&state.pool, vehicle_id).await?;

    let client = http_client()?;

    rivian_poll::mutate_charging_schedule_for_vehicle(
        vehicle_id,
        &body,
        &state.pool,
        &client,
        &state.age_key,
    )
    .await
    .map_err(|e| AppError::RivianApi(e.to_string()))?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── GET /v1/vehicles/:id/departure-schedules ─────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
struct DepartureScheduleRow {
    id: Uuid,
    rivian_schedule_id: String,
    name: Option<String>,
    enabled: bool,
    occurrence: Option<serde_json::Value>,
    comfort_settings: Option<serde_json::Value>,
    updated_at: DateTime<Utc>,
}

async fn list_departure_schedules(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<Vec<DepartureScheduleRow>>, AppError> {
    require_vehicle_read_access(&state.pool, &auth, vehicle_id).await?;

    let rows = sqlx::query_as::<_, DepartureScheduleRow>(
        "SELECT id, rivian_schedule_id, name, enabled, occurrence, comfort_settings, updated_at
         FROM riviamigo.departure_schedules
         WHERE vehicle_id = $1
         ORDER BY created_at",
    )
    .bind(vehicle_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

// ── POST /v1/vehicles/:id/departure-schedules ────────────────────────────────

#[derive(Debug, Deserialize)]
struct CreateDepartureBody {
    name: Option<String>,
    enabled: bool,
    occurrence: Option<serde_json::Value>,
    comfort_settings: Option<serde_json::Value>,
}

async fn create_departure_schedule(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
    Json(body): Json<CreateDepartureBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    reject_demo_schedule_mutation(&state.pool, vehicle_id).await?;

    let client = http_client()?;

    let input = DepartureScheduleInput {
        name: body.name,
        enabled: body.enabled,
        occurrence: body.occurrence,
        comfort_settings: body.comfort_settings,
    };

    let rivian_id = rivian_poll::create_departure_schedule_for_vehicle(
        vehicle_id,
        &input,
        &state.pool,
        &client,
        &state.age_key,
    )
    .await
    .map_err(|e| AppError::RivianApi(e.to_string()))?;

    Ok(Json(serde_json::json!({ "rivian_schedule_id": rivian_id })))
}

// ── PATCH /v1/vehicles/:id/departure-schedules/:schedule_id ─────────────────

async fn update_departure_schedule(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((vehicle_id, schedule_id)): Path<(Uuid, String)>,
    Json(body): Json<CreateDepartureBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    reject_demo_schedule_mutation(&state.pool, vehicle_id).await?;

    // Resolve rivian_schedule_id from local id (schedule_id may be either).
    let rivian_sched_id: Option<String> = sqlx::query_scalar(
        "SELECT rivian_schedule_id FROM riviamigo.departure_schedules
         WHERE vehicle_id = $1 AND (rivian_schedule_id = $2 OR id::text = $2)",
    )
    .bind(vehicle_id)
    .bind(&schedule_id)
    .fetch_optional(&state.pool)
    .await?;

    let rivian_sched_id = rivian_sched_id.ok_or(AppError::NotFound)?;

    let client = http_client()?;

    let input = DepartureScheduleInput {
        name: body.name,
        enabled: body.enabled,
        occurrence: body.occurrence,
        comfort_settings: body.comfort_settings,
    };

    rivian_poll::update_departure_schedule_for_vehicle(
        vehicle_id,
        &rivian_sched_id,
        &input,
        &state.pool,
        &client,
        &state.age_key,
    )
    .await
    .map_err(|e| AppError::RivianApi(e.to_string()))?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── DELETE /v1/vehicles/:id/departure-schedules/:schedule_id ────────────────

async fn delete_departure_schedule(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((vehicle_id, schedule_id)): Path<(Uuid, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    reject_demo_schedule_mutation(&state.pool, vehicle_id).await?;

    let rivian_sched_id: Option<String> = sqlx::query_scalar(
        "SELECT rivian_schedule_id FROM riviamigo.departure_schedules
         WHERE vehicle_id = $1 AND (rivian_schedule_id = $2 OR id::text = $2)",
    )
    .bind(vehicle_id)
    .bind(&schedule_id)
    .fetch_optional(&state.pool)
    .await?;

    let rivian_sched_id = rivian_sched_id.ok_or(AppError::NotFound)?;

    let client = http_client()?;

    rivian_poll::delete_departure_schedule_for_vehicle(
        vehicle_id,
        &rivian_sched_id,
        &state.pool,
        &client,
        &state.age_key,
    )
    .await
    .map_err(|e| AppError::RivianApi(e.to_string()))?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── GET /v1/vehicles/:id/wallboxes ───────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
struct WallboxRow {
    id: Uuid,
    rivian_wallbox_id: String,
    name: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    max_power_kw: Option<f64>,
    model: Option<String>,
    serial_number: Option<String>,
    firmware_version: Option<String>,
    linked: Option<bool>,
    updated_at: DateTime<Utc>,
}

async fn list_wallboxes(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<Vec<WallboxRow>>, AppError> {
    require_vehicle_read_access(&state.pool, &auth, vehicle_id).await?;

    let rows = sqlx::query_as::<_, WallboxRow>(
        "SELECT w.id, w.rivian_wallbox_id, w.name, w.latitude, w.longitude,
                w.max_power_kw, w.model, w.serial_number, w.firmware_version,
                w.linked, w.updated_at
         FROM riviamigo.wallboxes w
         JOIN riviamigo.vehicles v ON v.user_id = w.user_id
         WHERE v.id = $1
         ORDER BY w.created_at",
    )
    .bind(vehicle_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

// ── GET /v1/vehicles/:id/ota-details ─────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
struct OtaDetailsRow {
    ota_current_version: Option<String>,
    ota_available_version: Option<String>,
    ota_release_notes_url: Option<String>,
}

async fn get_ota_details(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<OtaDetailsRow>, AppError> {
    require_vehicle_read_access(&state.pool, &auth, vehicle_id).await?;

    // Latest versions from telemetry + notes URL from vehicles table.
    let row = sqlx::query_as::<_, OtaDetailsRow>(
        "SELECT
             t.ota_current_version,
             t.ota_available_version,
             v.ota_release_notes_url
         FROM riviamigo.vehicles v
         LEFT JOIN LATERAL (
             SELECT ota_current_version, ota_available_version
             FROM timeseries.telemetry
             WHERE vehicle_id = $1
               AND (ota_current_version IS NOT NULL OR ota_available_version IS NOT NULL)
             ORDER BY ts DESC
             LIMIT 1
         ) t ON true
         WHERE v.id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}
