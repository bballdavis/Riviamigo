//! Vehicle health endpoint — returns tire pressures, software version history,
//! closure states, and thermal event counts.

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new().route("/vehicles/:vehicle_id/health", get(health))
}

#[derive(Serialize)]
struct HealthResponse {
    vehicle_id: Uuid,
    vehicle: HealthVehicle,
    generated_at: DateTime<Utc>,
    runtime: Option<RuntimeHealth>,
    latest: Option<LatestHealthTelemetry>,
    tires: Option<TirePressures>,
    closures: Option<Closures>,
    current_software_version: Option<String>,
    software_history: Vec<SoftwareEntry>,
    thermal_events_30d: i64,
}

#[derive(Serialize, sqlx::FromRow)]
struct HealthVehicle {
    name: Option<String>,
    model: String,
    trim: Option<String>,
    vin: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct RuntimeHealth {
    is_online: Option<bool>,
    last_event_at: Option<DateTime<Utc>>,
    worker_health: Option<String>,
    worker_health_msg: Option<String>,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
struct LatestHealthTelemetry {
    ts: DateTime<Utc>,
    twelve_volt_health: Option<String>,
    hv_thermal_event: Option<String>,
    ota_current_version: Option<String>,
    ota_available_version: Option<String>,
    ota_status: Option<String>,
    ota_current_status: Option<String>,
    is_online: Option<bool>,
}

#[derive(Serialize, sqlx::FromRow)]
struct TirePressures {
    ts: DateTime<Utc>,
    tire_fl_psi: Option<f64>,
    tire_fr_psi: Option<f64>,
    tire_rl_psi: Option<f64>,
    tire_rr_psi: Option<f64>,
    tire_fl_status: Option<String>,
    tire_fr_status: Option<String>,
    tire_rl_status: Option<String>,
    tire_rr_status: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct Closures {
    ts: DateTime<Utc>,
    closure_frunk_closed: Option<bool>,
    closure_liftgate_closed: Option<bool>,
    closure_tailgate_closed: Option<bool>,
    door_front_left_closed: Option<bool>,
    door_front_right_closed: Option<bool>,
    door_rear_left_closed: Option<bool>,
    door_rear_right_closed: Option<bool>,
}

#[derive(Serialize, sqlx::FromRow)]
struct SoftwareEntry {
    version: Option<String>,
    installed_at: DateTime<Utc>,
    observed_until: Option<DateTime<Utc>>,
}

async fn health(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<HealthResponse>, AppError> {
    ensure_owned(&state.pool, vehicle_id, auth.user_id).await?;

    let (vehicle, runtime, latest, tires, closures, sw_history, thermal_count) = tokio::try_join!(
        fetch_vehicle(&state.pool, vehicle_id),
        fetch_runtime(&state.pool, vehicle_id),
        fetch_latest(&state.pool, vehicle_id),
        fetch_tires(&state.pool, vehicle_id),
        fetch_closures(&state.pool, vehicle_id),
        fetch_sw_history(&state.pool, vehicle_id),
        fetch_thermal_count(&state.pool, vehicle_id),
    )?;

    let current_version = sw_history
        .iter()
        .find(|e| e.observed_until.is_none() && e.version.is_some())
        .and_then(|e| e.version.clone())
        .or_else(|| latest.as_ref().and_then(|e| e.ota_current_version.clone()));

    Ok(Json(HealthResponse {
        vehicle_id,
        vehicle,
        generated_at: Utc::now(),
        runtime,
        latest,
        tires,
        closures,
        current_software_version: current_version,
        software_history: sw_history,
        thermal_events_30d: thermal_count,
    }))
}

async fn fetch_vehicle(pool: &sqlx::PgPool, vid: Uuid) -> Result<HealthVehicle, AppError> {
    let row = sqlx::query_as::<_, HealthVehicle>(
        r#"SELECT name, model, trim, vin
           FROM riviamigo.vehicles
           WHERE id = $1"#
    )
    .bind(vid)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)?;
    Ok(row)
}

async fn fetch_runtime(pool: &sqlx::PgPool, vid: Uuid) -> Result<Option<RuntimeHealth>, AppError> {
    let row = sqlx::query_as::<_, RuntimeHealth>(
        r#"SELECT is_online, last_event_at, worker_health, worker_health_msg, updated_at
           FROM riviamigo.vehicle_runtime_state
           WHERE vehicle_id = $1"#
    )
    .bind(vid)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;
    Ok(row)
}

async fn fetch_latest(
    pool: &sqlx::PgPool,
    vid: Uuid,
) -> Result<Option<LatestHealthTelemetry>, AppError> {
    let row = sqlx::query_as::<_, LatestHealthTelemetry>(
        r#"SELECT ts, twelve_volt_health, hv_thermal_event, ota_current_version,
                  ota_available_version, ota_status, ota_current_status, is_online
           FROM timeseries.telemetry
           WHERE vehicle_id = $1
             AND (twelve_volt_health IS NOT NULL
                  OR hv_thermal_event IS NOT NULL
                  OR ota_current_version IS NOT NULL
                  OR ota_available_version IS NOT NULL
                  OR ota_status IS NOT NULL
                  OR ota_current_status IS NOT NULL
                  OR is_online IS NOT NULL)
           ORDER BY ts DESC LIMIT 1"#
    )
    .bind(vid)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;
    Ok(row)
}

async fn fetch_tires(pool: &sqlx::PgPool, vid: Uuid) -> Result<Option<TirePressures>, AppError> {
    let row = sqlx::query_as::<_, TirePressures>(
        r#"SELECT ts,
                  tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
                  tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status
           FROM timeseries.telemetry
           WHERE vehicle_id = $1
             AND (tire_fl_psi IS NOT NULL
                  OR tire_fr_psi IS NOT NULL
                  OR tire_rl_psi IS NOT NULL
                  OR tire_rr_psi IS NOT NULL)
           ORDER BY ts DESC LIMIT 1"#
    )
    .bind(vid)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;
    Ok(row)
}

async fn fetch_closures(pool: &sqlx::PgPool, vid: Uuid) -> Result<Option<Closures>, AppError> {
    let row = sqlx::query_as::<_, Closures>(
        r#"SELECT ts,
                  closure_frunk_closed, closure_liftgate_closed, closure_tailgate_closed,
                  door_front_left_closed, door_front_right_closed,
                  door_rear_left_closed, door_rear_right_closed
           FROM timeseries.telemetry
           WHERE vehicle_id = $1
             AND (closure_frunk_closed IS NOT NULL
                  OR closure_liftgate_closed IS NOT NULL
                  OR closure_tailgate_closed IS NOT NULL
                  OR door_front_left_closed IS NOT NULL
                  OR door_front_right_closed IS NOT NULL
                  OR door_rear_left_closed IS NOT NULL
                  OR door_rear_right_closed IS NOT NULL)
           ORDER BY ts DESC LIMIT 1"#
    )
    .bind(vid)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;
    Ok(row)
}

async fn fetch_sw_history(pool: &sqlx::PgPool, vid: Uuid) -> Result<Vec<SoftwareEntry>, AppError> {
    let rows = sqlx::query_as::<_, SoftwareEntry>(
        r#"SELECT version, installed_at, observed_until
           FROM riviamigo.software_versions
           WHERE vehicle_id = $1
           ORDER BY installed_at DESC
           LIMIT 20"#,
    )
    .bind(vid)
    .fetch_all(pool)
    .await
    .map_err(AppError::from)?;
    Ok(rows)
}

async fn fetch_thermal_count(pool: &sqlx::PgPool, vid: Uuid) -> Result<i64, AppError> {
    let count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM timeseries.telemetry
           WHERE vehicle_id = $1
             AND hv_thermal_event IS NOT NULL
             AND hv_thermal_event != 'none'
             AND ts >= now() - interval '30 days'"#,
    )
    .bind(vid)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)?;
    Ok(count)
}

async fn ensure_owned(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let owned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM riviamigo.vehicles WHERE id=$1 AND user_id=$2)",
    )
    .bind(vehicle_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)?;

    if !owned {
        Err(AppError::NotFound)
    } else {
        Ok(())
    }
}
