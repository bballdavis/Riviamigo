//! Vehicle health endpoint — returns tire pressures, software version history,
//! closure states, and thermal event counts.

use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    db::{users::require_admin_or_super_user, vehicles::require_vehicle_read_access},
    errors::AppError,
    middleware::auth::{require_vehicle_access, AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/vehicles/{vehicle_id}/health", get(health))
        .route(
            "/admin/charge-session-repairs/{journal_id}/rollback",
            post(rollback_repair),
        )
}

async fn rollback_repair(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(journal_id): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    crate::services::charge_session_repair::rollback_repair(&state.pool, journal_id)
        .await
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    Ok(Json(
        serde_json::json!({ "journal_id": journal_id, "status": "reverted" }),
    ))
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
    ota_release_notes_url: Option<String>,
    software_history: Vec<SoftwareEntry>,
    thermal_events_30d: i64,
    extended_telemetry: ExtendedTelemetry,
}

#[derive(Serialize)]
struct ExtendedTelemetry {
    collector: Option<CollectorHealth>,
    parallax: Option<ParallaxHealth>,
    legacy_charging_session: LegacyChargingHealth,
    session_repair: Option<RepairHealth>,
    network: Option<NetworkHealth>,
    efficiency: Option<EfficiencyHealth>,
    mass: Option<MassHealth>,
    cold_weather: Option<ColdWeatherHealth>,
}

#[derive(Serialize, sqlx::FromRow)]
struct ParallaxHealth {
    status: String,
    last_frame_at: Option<DateTime<Utc>>,
    last_meaningful_frame_at: Option<DateTime<Utc>>,
    reconnect_count: i64,
    decode_error_count: i64,
    empty_frame_count: i64,
    ambiguity_count: i64,
    last_error: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct LegacyChargingHealth {
    classification: String,
    last_frame_at: Option<DateTime<Utc>>,
    last_meaningful_frame_at: Option<DateTime<Utc>>,
    null_count: i64,
    missing_count: i64,
    malformed_count: i64,
    all_null_count: i64,
    meaningful_count: i64,
}

#[derive(Serialize, sqlx::FromRow)]
struct RepairHealth {
    repair_key: String,
    reason: String,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
struct CollectorHealth {
    status: String,
    running: bool,
    connected_at: Option<DateTime<Utc>>,
    last_event_at: Option<DateTime<Utc>>,
    last_error: Option<String>,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
struct NetworkHealth {
    source_at: DateTime<Utc>,
    wifi_connected: Option<bool>,
    wifi_rssi_dbm: Option<i32>,
    wifi_link_speed_mbps: Option<i32>,
    wifi_frequency_mhz: Option<i32>,
    wifi_channel_width_mhz: Option<i32>,
    cellular_access_technology: Option<String>,
    cellular_signal_dbm: Option<i32>,
}

#[derive(Serialize, sqlx::FromRow)]
struct EfficiencyHealth {
    source_at: DateTime<Utc>,
    reference_wh_per_km: Option<i32>,
    learned_wh_per_km: Option<i32>,
    mode_ranges_km: serde_json::Value,
}

#[derive(Serialize, sqlx::FromRow)]
struct MassHealth {
    source_at: DateTime<Utc>,
    estimated_mass_kg: i32,
}

#[derive(Serialize, sqlx::FromRow)]
struct ColdWeatherHealth {
    source_at: DateTime<Utc>,
    available_soc_pct: Option<i32>,
    cold_limited_soc_pct: Option<i32>,
    cold_range_impact_km: Option<f64>,
}

#[derive(Serialize, sqlx::FromRow)]
struct HealthVehicle {
    name: Option<String>,
    model: String,
    trim: Option<String>,
    vin: Option<String>,
    ota_release_notes_url: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct RuntimeHealth {
    is_online: Option<bool>,
    last_event_at: Option<DateTime<Utc>>,
    worker_health: Option<String>,
    worker_health_msg: Option<String>,
    auth_state: Option<String>,
    auth_reason_code: Option<String>,
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
    require_vehicle_access(&auth, vehicle_id)?;
    require_vehicle_read_access(&state.pool, &auth, vehicle_id).await?;

    let (vehicle, runtime, latest, tires, closures, sw_history, thermal_count, extended) = tokio::try_join!(
        fetch_vehicle(&state.pool, vehicle_id),
        fetch_runtime(&state.pool, vehicle_id),
        fetch_latest(&state.pool, vehicle_id),
        fetch_tires(&state.pool, vehicle_id),
        fetch_closures(&state.pool, vehicle_id),
        fetch_sw_history(&state.pool, vehicle_id),
        fetch_thermal_count(&state.pool, vehicle_id),
        fetch_extended_telemetry(&state.pool, vehicle_id),
    )?;

    let ota_release_notes_url = vehicle.ota_release_notes_url.clone();

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
        ota_release_notes_url,
        software_history: sw_history,
        thermal_events_30d: thermal_count,
        extended_telemetry: extended,
    }))
}

async fn fetch_extended_telemetry(
    pool: &sqlx::PgPool,
    vid: Uuid,
) -> Result<ExtendedTelemetry, AppError> {
    let (collector, parallax, legacy, repair, network, efficiency, mass, cold_weather) = tokio::try_join!(
        sqlx::query_as::<_, CollectorHealth>(
            // updated_at is the collector heartbeat; two minutes allows for
            // transient scheduling delays while making stale connected rows false.
            r#"SELECT CASE
                        WHEN owner_kind IS NULL AND updated_at >= now()-interval '2 minutes' THEN 'duplicate_owner'
                        WHEN status='connected' AND updated_at < now()-interval '2 minutes' THEN 'stale'
                        ELSE status END AS status,
                      status = 'connected' AND owner_kind='in_process' AND updated_at >= now() - interval '2 minutes' AS running,
                      connected_at, last_event_at, last_error, updated_at
               FROM riviamigo.parallax_collector_state WHERE vehicle_id = $1"#,
        )
        .bind(vid)
        .fetch_optional(pool),
        sqlx::query_as::<_, ParallaxHealth>(r#"SELECT CASE WHEN status='connected' AND updated_at < now()-interval '2 minutes' THEN 'stale' ELSE status END AS status,last_frame_at,last_meaningful_frame_at,reconnect_count,decode_error_count,empty_frame_count,ambiguity_count,last_error FROM riviamigo.parallax_collector_state WHERE vehicle_id=$1"#)
            .bind(vid).fetch_optional(pool),
        sqlx::query_as::<_, LegacyChargingHealth>(r#"SELECT
            COALESCE(legacy_last_classification,'not_observed') AS classification,
            legacy_last_frame_at AS last_frame_at,
            legacy_last_meaningful_frame_at AS last_meaningful_frame_at,
            legacy_null_count AS null_count,legacy_missing_count AS missing_count,
            legacy_malformed_count AS malformed_count,legacy_all_null_count AS all_null_count,
            legacy_meaningful_count AS meaningful_count
            FROM riviamigo.parallax_collector_state WHERE vehicle_id=$1"#)
            .bind(vid).fetch_optional(pool),
        sqlx::query_as::<_, RepairHealth>(r#"SELECT repair_key,reason,created_at FROM riviamigo.charge_session_repair_journal WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT 1"#)
            .bind(vid).fetch_optional(pool),
        sqlx::query_as::<_, NetworkHealth>(
            r#"SELECT source_at, wifi_connected, wifi_rssi_dbm, wifi_link_speed_mbps,
                      wifi_frequency_mhz, wifi_channel_width_mhz,
                      cellular_access_technology, cellular_signal_dbm
               FROM timeseries.parallax_network_samples
               WHERE vehicle_id = $1 ORDER BY source_at DESC LIMIT 1"#,
        )
        .bind(vid)
        .fetch_optional(pool),
        sqlx::query_as::<_, EfficiencyHealth>(
            r#"SELECT source_at, reference_wh_per_km, learned_wh_per_km, mode_ranges_km
               FROM timeseries.parallax_efficiency_samples
               WHERE vehicle_id = $1 ORDER BY source_at DESC LIMIT 1"#,
        )
        .bind(vid)
        .fetch_optional(pool),
        sqlx::query_as::<_, MassHealth>(
            r#"SELECT source_at, estimated_mass_kg
               FROM timeseries.parallax_mass_samples
               WHERE vehicle_id = $1 ORDER BY source_at DESC LIMIT 1"#,
        )
        .bind(vid)
        .fetch_optional(pool),
        sqlx::query_as::<_, ColdWeatherHealth>(
            r#"SELECT source_at, available_soc_pct, cold_limited_soc_pct, cold_range_impact_km
               FROM timeseries.parallax_cold_weather_samples
               WHERE vehicle_id = $1
                 AND (cold_limited_soc_pct IS NOT NULL OR cold_range_impact_km IS NOT NULL)
               ORDER BY source_at DESC LIMIT 1"#,
        )
        .bind(vid)
        .fetch_optional(pool),
    )?;
    Ok(ExtendedTelemetry {
        collector,
        parallax,
        legacy_charging_session: legacy.unwrap_or(LegacyChargingHealth {
            classification: "not_observed".into(),
            last_frame_at: None,
            last_meaningful_frame_at: None,
            null_count: 0,
            missing_count: 0,
            malformed_count: 0,
            all_null_count: 0,
            meaningful_count: 0,
        }),
        session_repair: repair,
        network,
        efficiency,
        mass,
        cold_weather,
    })
}

async fn fetch_vehicle(pool: &sqlx::PgPool, vid: Uuid) -> Result<HealthVehicle, AppError> {
    let row = sqlx::query_as::<_, HealthVehicle>(
        r#"SELECT name, model, trim, vin
                  , ota_release_notes_url
           FROM riviamigo.vehicles
           WHERE id = $1"#,
    )
    .bind(vid)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)?;
    Ok(row)
}

async fn fetch_runtime(pool: &sqlx::PgPool, vid: Uuid) -> Result<Option<RuntimeHealth>, AppError> {
    let row = sqlx::query_as::<_, RuntimeHealth>(
        r#"SELECT is_online, last_event_at, worker_health, worker_health_msg, auth_state, auth_reason_code, updated_at
           FROM riviamigo.vehicle_runtime_state
           WHERE vehicle_id = $1"#,
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
           ORDER BY ts DESC LIMIT 1"#,
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
           ORDER BY ts DESC LIMIT 1"#,
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
           ORDER BY ts DESC LIMIT 1"#,
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
