use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderName, HeaderValue},
    response::Response,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use tracing::{info, warn};
use uuid::Uuid;

use std::{
    collections::BTreeMap,
    path::{Path as StdPath, PathBuf},
    time::Duration,
};

use crate::{
    db::users::require_admin_or_super_user,
    db::vehicles::{get_default_vehicle_id, require_vehicle_role},
    errors::AppError,
    ingestion::{
        rivian_auth::{RivianAuthError, RivianVehicleSummary},
        supervisor::SupervisorCommand,
    },
    middleware::auth::{require_vehicle_access, AppState, AuthUser},
    routes::range_normalization::normalize_remaining_range_miles,
    services::demo_seed::seed_demo_vehicle,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/vehicles/connect", post(connect))
        .route("/vehicles/connect/otp", post(connect_otp))
        .route("/vehicles/demo", post(create_demo_vehicle))
        .route("/vehicles/{id}/demo/refresh", post(refresh_demo_vehicle))
        .route(
            "/vehicle-image-cache/{id}/{image_key}",
            get(vehicle_image_cache_asset),
        )
        .route(
            "/admin/vehicles/{id}/images/remirror",
            post(admin_remirror_vehicle_images),
        )
        .route(
            "/admin/vehicles/{id}/images/cache/purge",
            post(admin_purge_vehicle_artwork_cache),
        )
        .route("/vehicles", post(add_vehicle).get(list_vehicles))
        .route("/vehicles/{id}", delete(delete_vehicle))
        .route("/vehicles/{id}/default", post(set_default_vehicle))
        .route(
            "/vehicles/{id}/members",
            get(list_vehicle_members).post(add_vehicle_member),
        )
        .route(
            "/vehicles/{id}/members/{user_id}",
            put(update_vehicle_member).delete(remove_vehicle_member),
        )
        .route(
            "/vehicles/{id}/invites",
            get(list_vehicle_invites).post(create_vehicle_invite),
        )
        .route(
            "/vehicles/{id}/invites/{invite_id}",
            delete(revoke_vehicle_invite),
        )
        .route("/invites/{token}", get(preview_invite))
        .route("/invites/{token}/accept", post(accept_invite))
        .route(
            "/vehicles/{id}/credentials",
            put(refresh_vehicle_credentials),
        )
        .route("/vehicles/{id}/status", get(vehicle_status))
        .route("/vehicles/{id}/images", get(vehicle_images))
        .route("/vehicles/{id}/raw-data", get(raw_vehicle_data))
        .route("/vehicles/{id}/telemetry/lanes", get(telemetry_lanes))
        .route("/vehicles/{id}/raw-events", get(raw_vehicle_events))
        .route(
            "/vehicles/{id}/raw-events/{event_id}",
            get(raw_vehicle_event),
        )
        .route("/vehicles/{id}/settings", put(update_vehicle_settings))
        .route("/vehicles/{id}/battery-config", put(update_battery_config))
        .route("/vehicles/{id}/name", put(update_vehicle_name))
}

#[derive(Deserialize)]
struct RawDataParams {
    limit: Option<i64>,
    per_page: Option<i64>,
    page: Option<i64>,
    from: Option<chrono::DateTime<chrono::Utc>>,
    to: Option<chrono::DateTime<chrono::Utc>>,
    search: Option<String>,
    fields: Option<String>,
    populated_only: Option<bool>,
}

#[derive(Deserialize)]
struct TelemetryLaneParams {
    from: Option<chrono::DateTime<chrono::Utc>>,
    to: Option<chrono::DateTime<chrono::Utc>>,
    lanes: Option<String>,
    resolution: Option<String>,
    max_points: Option<i64>,
}

#[derive(Deserialize)]
struct RawEventParams {
    per_page: Option<i64>,
    page: Option<i64>,
    from: Option<chrono::DateTime<chrono::Utc>>,
    to: Option<chrono::DateTime<chrono::Utc>>,
    event_type: Option<String>,
    message_type: Option<String>,
}

#[derive(Deserialize)]
struct ConnectBody {
    email: String,
    password: String,
}

#[derive(Deserialize)]
struct OtpBody {
    challenge_id: String,
    #[serde(alias = "otp")]
    otp_code: String,
}

#[derive(Deserialize)]
struct AddVehicleBody {
    rivian_vehicle_id: String,
    name: Option<String>,
    home_lat: Option<f64>,
    home_lng: Option<f64>,
    model: Option<String>,
    trim: Option<String>,
    vin: Option<String>,
}

#[derive(Deserialize)]
struct CreateDemoVehicleBody {
    model: String,
}

fn is_demo_vehicle_key(value: &str) -> bool {
    value.starts_with("demo-")
}

async fn require_remote_backed_vehicle(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
) -> Result<String, AppError> {
    let key = sqlx::query_scalar::<_, String>(
        "SELECT rivian_vehicle_id FROM riviamigo.vehicles WHERE id=$1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if is_demo_vehicle_key(&key) {
        return Err(AppError::Validation(
            "demo vehicles do not use Rivian credentials or remote artwork".into(),
        ));
    }
    Ok(key)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingOtpChallenge {
    email: String,
    otp_token: String,
    csrf_token: String,
    app_session_token: String,
    user_id: Uuid,
}

#[derive(Debug, Default, sqlx::FromRow)]
struct LatestVehicleTelemetry {
    ts: Option<chrono::DateTime<chrono::Utc>>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    altitude_m: Option<f64>,
    speed_mph: Option<f64>,
    location_ts: Option<chrono::DateTime<chrono::Utc>>,
    speed_mph_ts: Option<chrono::DateTime<chrono::Utc>>,
    battery_level: Option<f64>,
    battery_capacity_wh: Option<f64>,
    distance_to_empty_mi: Option<f64>,
    battery_limit: Option<f64>,
    battery_level_ts: Option<chrono::DateTime<chrono::Utc>>,
    distance_to_empty_mi_ts: Option<chrono::DateTime<chrono::Utc>>,
    battery_limit_ts: Option<chrono::DateTime<chrono::Utc>>,
    power_state: Option<String>,
    power_state_ts: Option<chrono::DateTime<chrono::Utc>>,
    charger_state: Option<String>,
    charger_state_ts: Option<chrono::DateTime<chrono::Utc>>,
    charger_status: Option<String>,
    charger_status_ts: Option<chrono::DateTime<chrono::Utc>>,
    time_to_end_of_charge_min: Option<i32>,
    time_to_end_of_charge_min_ts: Option<chrono::DateTime<chrono::Utc>>,
    drive_mode: Option<String>,
    gear_status: Option<String>,
    cabin_temp_c: Option<f64>,
    driver_temp_c: Option<f64>,
    outside_temp_c: Option<f64>,
    heading_deg: Option<f64>,
    odometer_miles: Option<f64>,
    odometer_miles_ts: Option<chrono::DateTime<chrono::Utc>>,
    tire_fl_psi: Option<f64>,
    tire_fr_psi: Option<f64>,
    tire_rl_psi: Option<f64>,
    tire_rr_psi: Option<f64>,
    tire_fl_status: Option<String>,
    tire_fr_status: Option<String>,
    tire_rl_status: Option<String>,
    tire_rr_status: Option<String>,
    tire_fl_valid: Option<bool>,
    tire_fr_valid: Option<bool>,
    tire_rl_valid: Option<bool>,
    tire_rr_valid: Option<bool>,
    door_front_left_locked: Option<bool>,
    door_front_right_locked: Option<bool>,
    door_rear_left_locked: Option<bool>,
    door_rear_right_locked: Option<bool>,
    door_front_left_closed: Option<bool>,
    door_front_right_closed: Option<bool>,
    door_rear_left_closed: Option<bool>,
    door_rear_right_closed: Option<bool>,
    closure_frunk_locked: Option<bool>,
    closure_frunk_closed: Option<bool>,
    closure_liftgate_locked: Option<bool>,
    closure_liftgate_closed: Option<bool>,
    closure_tailgate_locked: Option<bool>,
    closure_tailgate_closed: Option<bool>,
    ota_current_version: Option<String>,
    ota_available_version: Option<String>,
    ota_status: Option<String>,
    ota_current_status: Option<String>,
    hv_thermal_event: Option<String>,
    twelve_volt_health: Option<String>,
    // Extended vehicleStatus fields (migration 0022)
    charge_port_open: Option<bool>,
    charger_derate_active: Option<bool>,
    cabin_precon_status: Option<String>,
    cabin_precon_type: Option<String>,
    pet_mode_active: Option<bool>,
    pet_mode_temp_ok: Option<bool>,
    defrost_active: Option<bool>,
    steering_wheel_heat: Option<i16>,
    seat_fl_heat: Option<i16>,
    seat_fr_heat: Option<i16>,
    seat_rl_heat: Option<i16>,
    seat_rr_heat: Option<i16>,
    seat_fl_vent: Option<i16>,
    seat_fr_vent: Option<i16>,
    tonneau_locked: Option<bool>,
    tonneau_closed: Option<bool>,
    side_bin_left_locked: Option<bool>,
    side_bin_right_locked: Option<bool>,
    side_bin_left_closed: Option<bool>,
    side_bin_right_closed: Option<bool>,
    window_fl_closed: Option<bool>,
    window_fr_closed: Option<bool>,
    window_rl_closed: Option<bool>,
    window_rr_closed: Option<bool>,
    gear_guard_locked: Option<bool>,
    gear_guard_video_status: Option<String>,
    wiper_fluid_low: Option<bool>,
    brake_fluid_low: Option<bool>,
    alarm_active: Option<bool>,
    service_mode: Option<bool>,
}

#[derive(Debug, sqlx::FromRow)]
struct VehicleListRow {
    id: Uuid,
    rivian_vehicle_id: String,
    model: String,
    trim: Option<String>,
    vin: Option<String>,
    color: Option<String>,
    name: Option<String>,
    battery_capacity_wh: Option<f64>,
    target_tire_pressure_psi: Option<f64>,
    battery_config: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    // Enrichment fields (migration 0023)
    interior_color: Option<String>,
    wheel_option: Option<String>,
    max_vehicle_power_kw: Option<f64>,
    charge_port_type: Option<String>,
    battery_cell_type: Option<String>,
    supported_features: Option<serde_json::Value>,
    // Backfill tracking (migration 0025)
    history_backfill_status: Option<String>,
    history_backfilled_at: Option<chrono::DateTime<chrono::Utc>>,
    history_session_count: Option<i32>,
    worker_health: Option<String>,
    worker_health_msg: Option<String>,
    auth_state: Option<String>,
    auth_reason_code: Option<String>,
    membership_role: String,
}

#[derive(Deserialize)]
struct RefreshCredentialsBody {
    rivian_vehicle_id: Option<String>,
}

#[derive(Debug, Default, sqlx::FromRow)]
struct VehicleRuntimeStateRow {
    is_online: Option<bool>,
    last_event_at: Option<chrono::DateTime<chrono::Utc>>,
    last_payload_at: Option<chrono::DateTime<chrono::Utc>>,
    last_heartbeat_at: Option<chrono::DateTime<chrono::Utc>>,
    last_ws_received_at: Option<chrono::DateTime<chrono::Utc>>,
    last_ws_payload_received_at: Option<chrono::DateTime<chrono::Utc>>,
    last_ws_heartbeat_received_at: Option<chrono::DateTime<chrono::Utc>>,
    last_charge_history_sync_at: Option<chrono::DateTime<chrono::Utc>>,
    last_charge_history_success_at: Option<chrono::DateTime<chrono::Utc>>,
    worker_health: Option<String>,
    auth_state: Option<String>,
    auth_reason_code: Option<String>,
}

#[derive(Debug, Default, sqlx::FromRow)]
struct VehicleStatusFieldSeenRow {
    tire_fl_psi_at: Option<chrono::DateTime<chrono::Utc>>,
    tire_fr_psi_at: Option<chrono::DateTime<chrono::Utc>>,
    tire_rl_psi_at: Option<chrono::DateTime<chrono::Utc>>,
    tire_rr_psi_at: Option<chrono::DateTime<chrono::Utc>>,
    tire_fl_status_at: Option<chrono::DateTime<chrono::Utc>>,
    tire_fr_status_at: Option<chrono::DateTime<chrono::Utc>>,
    tire_rl_status_at: Option<chrono::DateTime<chrono::Utc>>,
    tire_rr_status_at: Option<chrono::DateTime<chrono::Utc>>,
    tire_fl_valid_at: Option<chrono::DateTime<chrono::Utc>>,
    tire_fr_valid_at: Option<chrono::DateTime<chrono::Utc>>,
    tire_rl_valid_at: Option<chrono::DateTime<chrono::Utc>>,
    tire_rr_valid_at: Option<chrono::DateTime<chrono::Utc>>,
    hv_thermal_event_at: Option<chrono::DateTime<chrono::Utc>>,
    twelve_volt_health_at: Option<chrono::DateTime<chrono::Utc>>,
    ota_current_version_at: Option<chrono::DateTime<chrono::Utc>>,
    ota_available_version_at: Option<chrono::DateTime<chrono::Utc>>,
    ota_status_at: Option<chrono::DateTime<chrono::Utc>>,
    ota_current_status_at: Option<chrono::DateTime<chrono::Utc>>,
    charge_port_open_at: Option<chrono::DateTime<chrono::Utc>>,
    charger_derate_active_at: Option<chrono::DateTime<chrono::Utc>>,
    cabin_precon_status_at: Option<chrono::DateTime<chrono::Utc>>,
    cabin_precon_type_at: Option<chrono::DateTime<chrono::Utc>>,
    pet_mode_active_at: Option<chrono::DateTime<chrono::Utc>>,
    pet_mode_temp_ok_at: Option<chrono::DateTime<chrono::Utc>>,
    defrost_active_at: Option<chrono::DateTime<chrono::Utc>>,
    steering_wheel_heat_at: Option<chrono::DateTime<chrono::Utc>>,
    seat_fl_heat_at: Option<chrono::DateTime<chrono::Utc>>,
    seat_fr_heat_at: Option<chrono::DateTime<chrono::Utc>>,
    seat_rl_heat_at: Option<chrono::DateTime<chrono::Utc>>,
    seat_rr_heat_at: Option<chrono::DateTime<chrono::Utc>>,
    seat_fl_vent_at: Option<chrono::DateTime<chrono::Utc>>,
    seat_fr_vent_at: Option<chrono::DateTime<chrono::Utc>>,
    tonneau_locked_at: Option<chrono::DateTime<chrono::Utc>>,
    tonneau_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    side_bin_left_locked_at: Option<chrono::DateTime<chrono::Utc>>,
    side_bin_right_locked_at: Option<chrono::DateTime<chrono::Utc>>,
    side_bin_left_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    side_bin_right_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    window_fl_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    window_fr_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    window_rl_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    window_rr_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    gear_guard_locked_at: Option<chrono::DateTime<chrono::Utc>>,
    gear_guard_video_status_at: Option<chrono::DateTime<chrono::Utc>>,
    wiper_fluid_low_at: Option<chrono::DateTime<chrono::Utc>>,
    brake_fluid_low_at: Option<chrono::DateTime<chrono::Utc>>,
    alarm_active_at: Option<chrono::DateTime<chrono::Utc>>,
    service_mode_at: Option<chrono::DateTime<chrono::Utc>>,
    closure_frunk_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    closure_liftgate_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    closure_tailgate_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    door_front_left_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    door_front_right_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    door_rear_left_closed_at: Option<chrono::DateTime<chrono::Utc>>,
    door_rear_right_closed_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum StatusFieldAvailabilityState {
    Current,
    Historical,
    NeverSeen,
}

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum StatusFieldAvailabilityReasonCode {
    MissingRecentPayload,
    NeverSeen,
    InvalidSensor,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
struct StatusFieldAvailability {
    ever_seen: bool,
    last_seen_at: Option<chrono::DateTime<chrono::Utc>>,
    latest_event_at: Option<chrono::DateTime<chrono::Utc>>,
    availability: StatusFieldAvailabilityState,
    reason_code: Option<StatusFieldAvailabilityReasonCode>,
}

/// Serializable response shape for `GET /v1/vehicles/:id/status`.
/// Using a typed struct instead of `serde_json::json!` avoids the recursive
/// macro expansion that exhausts the compiler's recursion limit as fields grow.
#[derive(serde::Serialize)]
struct VehicleStatusResponse {
    vehicle_id: Uuid,
    is_online: bool,
    last_event_at: Option<chrono::DateTime<chrono::Utc>>,
    last_updated: Option<chrono::DateTime<chrono::Utc>>,
    last_payload_at: Option<chrono::DateTime<chrono::Utc>>,
    last_heartbeat_at: Option<chrono::DateTime<chrono::Utc>>,
    last_ws_received_at: Option<chrono::DateTime<chrono::Utc>>,
    last_ws_payload_received_at: Option<chrono::DateTime<chrono::Utc>>,
    last_ws_heartbeat_received_at: Option<chrono::DateTime<chrono::Utc>>,
    last_charge_history_sync_at: Option<chrono::DateTime<chrono::Utc>>,
    last_charge_history_success_at: Option<chrono::DateTime<chrono::Utc>>,
    worker_health: Option<String>,
    auth_state: Option<String>,
    auth_reason_code: Option<String>,
    battery_level: Option<f64>,
    battery_level_ts: Option<chrono::DateTime<chrono::Utc>>,
    range_miles: Option<f64>,
    range_miles_ts: Option<chrono::DateTime<chrono::Utc>>,
    battery_capacity_kwh: Option<f64>,
    battery_limit: Option<f64>,
    battery_limit_ts: Option<chrono::DateTime<chrono::Utc>>,
    power_state: Option<String>,
    power_state_ts: Option<chrono::DateTime<chrono::Utc>>,
    charger_state: Option<String>,
    charger_state_ts: Option<chrono::DateTime<chrono::Utc>>,
    charger_status: Option<String>,
    charger_status_ts: Option<chrono::DateTime<chrono::Utc>>,
    time_to_end_of_charge_min: Option<i32>,
    time_to_end_of_charge_min_ts: Option<chrono::DateTime<chrono::Utc>>,
    speed_mph: Option<f64>,
    speed_mph_ts: Option<chrono::DateTime<chrono::Utc>>,
    altitude_m: Option<f64>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    location_ts: Option<chrono::DateTime<chrono::Utc>>,
    drive_mode: Option<String>,
    gear_status: Option<String>,
    cabin_temp_c: Option<f64>,
    driver_temp_c: Option<f64>,
    outside_temp_c: Option<f64>,
    heading_deg: Option<f64>,
    odometer_miles: Option<f64>,
    odometer_miles_ts: Option<chrono::DateTime<chrono::Utc>>,
    tire_fl_psi: Option<f64>,
    tire_fr_psi: Option<f64>,
    tire_rl_psi: Option<f64>,
    tire_rr_psi: Option<f64>,
    tire_min_psi: Option<f64>,
    tire_fl_status: Option<String>,
    tire_fr_status: Option<String>,
    tire_rl_status: Option<String>,
    tire_rr_status: Option<String>,
    tire_fl_valid: Option<bool>,
    tire_fr_valid: Option<bool>,
    tire_rl_valid: Option<bool>,
    tire_rr_valid: Option<bool>,
    door_front_left_locked: Option<bool>,
    door_front_right_locked: Option<bool>,
    door_rear_left_locked: Option<bool>,
    door_rear_right_locked: Option<bool>,
    door_front_left_closed: Option<bool>,
    door_front_right_closed: Option<bool>,
    door_rear_left_closed: Option<bool>,
    door_rear_right_closed: Option<bool>,
    closure_frunk_locked: Option<bool>,
    closure_frunk_closed: Option<bool>,
    closure_liftgate_locked: Option<bool>,
    closure_liftgate_closed: Option<bool>,
    closure_tailgate_locked: Option<bool>,
    closure_tailgate_closed: Option<bool>,
    ota_current_version: Option<String>,
    ota_available_version: Option<String>,
    ota_status: Option<String>,
    ota_current_status: Option<String>,
    hv_thermal_event: Option<String>,
    twelve_volt_health: Option<String>,
    doors_locked: Option<bool>,
    open_closures: serde_json::Value,
    tire_pressure_status: Option<String>,
    software_update_status: Option<String>,
    // Extended vehicleStatus fields (migration 0022)
    charge_port_open: Option<bool>,
    charger_derate_active: Option<bool>,
    cabin_precon_status: Option<String>,
    cabin_precon_type: Option<String>,
    pet_mode_active: Option<bool>,
    pet_mode_temp_ok: Option<bool>,
    defrost_active: Option<bool>,
    steering_wheel_heat: Option<i16>,
    seat_fl_heat: Option<i16>,
    seat_fr_heat: Option<i16>,
    seat_rl_heat: Option<i16>,
    seat_rr_heat: Option<i16>,
    seat_fl_vent: Option<i16>,
    seat_fr_vent: Option<i16>,
    tonneau_locked: Option<bool>,
    tonneau_closed: Option<bool>,
    side_bin_left_locked: Option<bool>,
    side_bin_right_locked: Option<bool>,
    side_bin_left_closed: Option<bool>,
    side_bin_right_closed: Option<bool>,
    window_fl_closed: Option<bool>,
    window_fr_closed: Option<bool>,
    window_rl_closed: Option<bool>,
    window_rr_closed: Option<bool>,
    gear_guard_locked: Option<bool>,
    gear_guard_video_status: Option<String>,
    wiper_fluid_low: Option<bool>,
    brake_fluid_low: Option<bool>,
    alarm_active: Option<bool>,
    service_mode: Option<bool>,
    telemetry_stale: bool,
    telemetry_stale_reason: Option<String>,
    field_availability: BTreeMap<String, StatusFieldAvailability>,
}

const WS_RECEIVE_STALE_AFTER: chrono::Duration = chrono::Duration::minutes(10);
const BATTERY_STATUS_STALE_AFTER: chrono::Duration = chrono::Duration::minutes(90);
const RANGE_STATUS_STALE_AFTER: chrono::Duration = chrono::Duration::minutes(90);
const CHARGING_STATUS_STALE_AFTER: chrono::Duration = chrono::Duration::minutes(45);

fn timestamp_is_older_than(
    now: chrono::DateTime<chrono::Utc>,
    ts: Option<chrono::DateTime<chrono::Utc>>,
    threshold: chrono::Duration,
) -> bool {
    ts.is_some_and(|value| now - value >= threshold)
}

fn classify_status_field_availability(
    latest_event_at: Option<chrono::DateTime<chrono::Utc>>,
    last_seen_at: Option<chrono::DateTime<chrono::Utc>>,
    reason_override: Option<StatusFieldAvailabilityReasonCode>,
) -> StatusFieldAvailability {
    let availability = match (latest_event_at, last_seen_at) {
        (_, None) => StatusFieldAvailabilityState::NeverSeen,
        (Some(latest_event_at), Some(last_seen_at)) if last_seen_at < latest_event_at => {
            StatusFieldAvailabilityState::Historical
        }
        _ => StatusFieldAvailabilityState::Current,
    };

    let reason_code = match availability {
        StatusFieldAvailabilityState::NeverSeen => {
            Some(StatusFieldAvailabilityReasonCode::NeverSeen)
        }
        StatusFieldAvailabilityState::Historical => {
            Some(reason_override.unwrap_or(StatusFieldAvailabilityReasonCode::MissingRecentPayload))
        }
        StatusFieldAvailabilityState::Current => reason_override,
    };

    StatusFieldAvailability {
        ever_seen: last_seen_at.is_some(),
        last_seen_at,
        latest_event_at,
        availability,
        reason_code,
    }
}

fn max_seen_at(
    values: impl IntoIterator<Item = Option<chrono::DateTime<chrono::Utc>>>,
) -> Option<chrono::DateTime<chrono::Utc>> {
    values.into_iter().flatten().max()
}

fn insert_field_availability(
    availability: &mut BTreeMap<String, StatusFieldAvailability>,
    field: &str,
    latest_event_at: Option<chrono::DateTime<chrono::Utc>>,
    last_seen_at: Option<chrono::DateTime<chrono::Utc>>,
    reason_override: Option<StatusFieldAvailabilityReasonCode>,
) {
    availability.insert(
        field.to_string(),
        classify_status_field_availability(latest_event_at, last_seen_at, reason_override),
    );
}

fn derive_vehicle_status_freshness(
    now: chrono::DateTime<chrono::Utc>,
    runtime: Option<&VehicleRuntimeStateRow>,
    latest: &LatestVehicleTelemetry,
) -> (Option<String>, bool, Option<String>) {
    let ws_received_at = runtime.and_then(|row| row.last_ws_received_at);
    let base_health = runtime.and_then(|row| row.worker_health.clone());

    if timestamp_is_older_than(now, ws_received_at, WS_RECEIVE_STALE_AFTER) {
        return (
            Some("stale".to_string()),
            true,
            Some("ws_silent".to_string()),
        );
    }

    if latest.battery_level.is_some()
        && timestamp_is_older_than(
            now,
            latest.battery_level_ts.or(latest.ts),
            BATTERY_STATUS_STALE_AFTER,
        )
    {
        return (
            Some("stale".to_string()),
            true,
            Some("battery_stale".to_string()),
        );
    }

    if latest.distance_to_empty_mi.is_some()
        && timestamp_is_older_than(
            now,
            latest.distance_to_empty_mi_ts.or(latest.ts),
            RANGE_STATUS_STALE_AFTER,
        )
    {
        return (
            Some("stale".to_string()),
            true,
            Some("range_stale".to_string()),
        );
    }

    let charging_active = latest
        .charger_state
        .as_deref()
        .map(|state| matches!(state, "charging"))
        .unwrap_or(false)
        || latest
            .charger_status
            .as_deref()
            .map(|status| status.eq_ignore_ascii_case("chrgr_sts_connected_charging"))
            .unwrap_or(false)
        || latest.time_to_end_of_charge_min.is_some();

    if charging_active
        && timestamp_is_older_than(
            now,
            latest
                .charger_status_ts
                .or(latest.charger_state_ts)
                .or(latest.time_to_end_of_charge_min_ts)
                .or(latest.ts),
            CHARGING_STATUS_STALE_AFTER,
        )
    {
        return (
            Some("stale".to_string()),
            true,
            Some("charging_stale".to_string()),
        );
    }

    (base_health, false, None)
}

#[derive(Debug, sqlx::FromRow)]
struct VehicleImageRow {
    placement: String,
    design: Option<String>,
    size: Option<String>,
    resolution: Option<String>,
    url: String,
    overlays: serde_json::Value,
    metadata: serde_json::Value,
}

#[derive(Debug, sqlx::FromRow)]
struct VehicleArtworkCacheStateRow {
    status: String,
    asset_count: i32,
    ready_asset_count: i32,
    attempts: i32,
    last_repair_attempt_at: Option<chrono::DateTime<chrono::Utc>>,
    last_repair_success_at: Option<chrono::DateTime<chrono::Utc>>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct VehicleImageOverlay {
    url: String,
    overlay: Option<String>,
    #[serde(rename = "zIndex")]
    z_index: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct MirroredOverlayAsset {
    source_url: String,
    mirror_key: String,
    mirror_relpath: String,
    mime_type: String,
    sha256: String,
    overlay: Option<String>,
    #[serde(rename = "zIndex")]
    z_index: Option<i32>,
}

#[derive(Debug, Clone)]
struct MirroredFileAsset {
    mirror_key: String,
    mirror_relpath: String,
    mime_type: String,
    sha256: String,
}

#[derive(Debug, sqlx::FromRow)]
struct RawVehicleSampleRow {
    ts: chrono::DateTime<chrono::Utc>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    altitude_m: Option<f64>,
    speed_mph: Option<f64>,
    battery_level: Option<f64>,
    battery_capacity_wh: Option<f64>,
    distance_to_empty_mi: Option<f64>,
    battery_limit: Option<f64>,
    power_state: Option<String>,
    charger_state: Option<String>,
    charger_status: Option<String>,
    time_to_end_of_charge_min: Option<i32>,
    drive_mode: Option<String>,
    gear_status: Option<String>,
    cabin_temp_c: Option<f64>,
    driver_temp_c: Option<f64>,
    outside_temp_c: Option<f64>,
    hvac_active: Option<bool>,
    power_kw: Option<f64>,
    regen_power_kw: Option<f64>,
    heading_deg: Option<f64>,
    odometer_miles: Option<f64>,
    tire_fl_psi: Option<f64>,
    tire_fr_psi: Option<f64>,
    tire_rl_psi: Option<f64>,
    tire_rr_psi: Option<f64>,
    tire_fl_status: Option<String>,
    tire_fr_status: Option<String>,
    tire_rl_status: Option<String>,
    tire_rr_status: Option<String>,
    tire_fl_valid: Option<bool>,
    tire_fr_valid: Option<bool>,
    tire_rl_valid: Option<bool>,
    tire_rr_valid: Option<bool>,
    door_front_left_locked: Option<bool>,
    door_front_right_locked: Option<bool>,
    door_rear_left_locked: Option<bool>,
    door_rear_right_locked: Option<bool>,
    door_front_left_closed: Option<bool>,
    door_front_right_closed: Option<bool>,
    door_rear_left_closed: Option<bool>,
    door_rear_right_closed: Option<bool>,
    closure_frunk_closed: Option<bool>,
    closure_liftgate_closed: Option<bool>,
    closure_tailgate_closed: Option<bool>,
    ota_current_version: Option<String>,
    ota_available_version: Option<String>,
    ota_status: Option<String>,
    ota_current_status: Option<String>,
    hv_thermal_event: Option<String>,
    twelve_volt_health: Option<String>,
    is_online: Option<bool>,
}

#[derive(Debug, sqlx::FromRow)]
struct RawVehicleCoverageRow {
    first_event_at: Option<chrono::DateTime<chrono::Utc>>,
    last_event_at: Option<chrono::DateTime<chrono::Utc>>,
    sample_count: i64,
    odometer_samples: i64,
    battery_samples: i64,
    range_samples: i64,
    outside_temp_samples: i64,
    power_samples: i64,
    regen_samples: i64,
    tire_pressure_samples: i64,
    lock_samples: i64,
    software_samples: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct RawTelemetryFieldCoverageRow {
    field: String,
    sample_count: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct TelemetryLaneRow {
    bucket: chrono::DateTime<chrono::Utc>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    altitude_m: Option<f64>,
    speed_mph: Option<f64>,
    battery_level: Option<f64>,
    battery_capacity_wh: Option<f64>,
    distance_to_empty_mi: Option<f64>,
    battery_limit: Option<f64>,
    time_to_end_of_charge_min: Option<f64>,
    cabin_temp_c: Option<f64>,
    driver_temp_c: Option<f64>,
    outside_temp_c: Option<f64>,
    power_kw: Option<f64>,
    regen_power_kw: Option<f64>,
    heading_deg: Option<f64>,
    odometer_miles: Option<f64>,
    tire_fl_psi: Option<f64>,
    tire_fr_psi: Option<f64>,
    tire_rl_psi: Option<f64>,
    tire_rr_psi: Option<f64>,
}

#[derive(Debug, Serialize)]
struct TelemetryLaneWindow {
    from: chrono::DateTime<chrono::Utc>,
    to: chrono::DateTime<chrono::Utc>,
    resolution_seconds: i64,
    approximate: bool,
}

#[derive(Debug, Serialize)]
struct TelemetryLane {
    numeric: BTreeMap<String, Vec<Option<f64>>>,
    coverage: BTreeMap<String, i64>,
    source: &'static str,
}

#[derive(Debug, Serialize)]
struct TelemetryLaneFrame {
    vehicle_id: Uuid,
    window: TelemetryLaneWindow,
    spine: Vec<chrono::DateTime<chrono::Utc>>,
    lanes: BTreeMap<String, TelemetryLane>,
    truncated: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct RawEventSummaryRow {
    id: Uuid,
    received_at: chrono::DateTime<chrono::Utc>,
    event_type: String,
    message_type: Option<String>,
    has_json: bool,
    has_payload: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct RawEventDetailRow {
    id: Uuid,
    received_at: chrono::DateTime<chrono::Utc>,
    event_type: String,
    message_type: Option<String>,
    payload_json: Option<serde_json::Value>,
    payload_text: Option<String>,
}

const RAW_TELEMETRY_FIELDS: &[&str] = &[
    "latitude",
    "longitude",
    "altitude_m",
    "speed_mph",
    "battery_level",
    "battery_capacity_wh",
    "distance_to_empty_mi",
    "battery_limit",
    "power_state",
    "charger_state",
    "charger_status",
    "time_to_end_of_charge_min",
    "drive_mode",
    "gear_status",
    "cabin_temp_c",
    "driver_temp_c",
    "outside_temp_c",
    "hvac_active",
    "power_kw",
    "regen_power_kw",
    "heading_deg",
    "odometer_miles",
    "tire_fl_psi",
    "tire_fr_psi",
    "tire_rl_psi",
    "tire_rr_psi",
    "tire_fl_status",
    "tire_fr_status",
    "tire_rl_status",
    "tire_rr_status",
    "tire_fl_valid",
    "tire_fr_valid",
    "tire_rl_valid",
    "tire_rr_valid",
    "door_front_left_locked",
    "door_front_right_locked",
    "door_rear_left_locked",
    "door_rear_right_locked",
    "door_front_left_closed",
    "door_front_right_closed",
    "door_rear_left_closed",
    "door_rear_right_closed",
    "closure_frunk_closed",
    "closure_liftgate_closed",
    "closure_tailgate_closed",
    "ota_current_version",
    "ota_available_version",
    "ota_status",
    "ota_current_status",
    "hv_thermal_event",
    "twelve_volt_health",
    "is_online",
];

#[derive(Serialize)]
struct ConnectResponse {
    status: &'static str,
    requires_otp: bool,
    challenge_id: Option<String>,
    vehicle_id: Option<Uuid>,
    vehicles: Vec<RivianVehicleSummary>,
}

fn age_identity(state: &AppState) -> Result<age::x25519::Identity, AppError> {
    state
        .age_key
        .parse::<age::x25519::Identity>()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("bad age key: {e}")))
}

async fn store_encrypted_redis<T: Serialize>(
    state: &AppState,
    conn: &mut redis::aio::MultiplexedConnection,
    key: &str,
    value: &T,
    ttl_secs: u64,
) -> Result<(), AppError> {
    let identity = age_identity(state)?;
    let ciphertext = crate::ingestion::session_store::encrypt_json(value, &identity)
        .map_err(AppError::Internal)?;

    let _: () = redis::AsyncCommands::set_ex(conn, key, ciphertext, ttl_secs)
        .await
        .map_err(|error| {
            warn!(operation = "connect_session.write", error = %error, "secure_session_store.unavailable");
            AppError::Redis(error)
        })?;
    Ok(())
}

async fn load_encrypted_redis<T: DeserializeOwned>(
    state: &AppState,
    conn: &mut redis::aio::MultiplexedConnection,
    key: &str,
) -> Result<Option<T>, AppError> {
    let ciphertext: Option<Vec<u8>> = redis::AsyncCommands::get(conn, key)
        .await
        .map_err(|error| {
            warn!(operation = "connect_session.read", error = %error, "secure_session_store.unavailable");
            AppError::Redis(error)
        })?;
    let Some(ciphertext) = ciphertext else {
        return Ok(None);
    };

    let identity = age_identity(state)?;
    let value = crate::ingestion::session_store::decrypt_json::<T>(&ciphertext, &identity)
        .map_err(|error| {
            warn!(key, error = %error, "vehicle.connect_session.decrypt_failed");
            AppError::RivianConnectSessionExpired
        })?;

    Ok(Some(value))
}

fn map_rivian_login_error(error: RivianAuthError) -> AppError {
    match error {
        RivianAuthError::InvalidCredentials => AppError::RivianCredentialsRejected,
        RivianAuthError::Network(error) => {
            warn!(error = %error, "vehicle.connect.rivian_network_error");
            AppError::RivianApi("Unable to reach Rivian. Please try again shortly.".into())
        }
        RivianAuthError::UnexpectedResponse(error) => {
            warn!(error = %error, "vehicle.connect.rivian_unexpected_response");
            AppError::RivianApi(
                "Rivian returned an unexpected sign-in response. Please try again shortly.".into(),
            )
        }
        RivianAuthError::InvalidOtp => {
            warn!("vehicle.connect.login_returned_otp_error");
            AppError::RivianApi(
                "Rivian returned an unexpected sign-in response. Please try again shortly.".into(),
            )
        }
    }
}

fn map_rivian_otp_error(error: RivianAuthError) -> AppError {
    match error {
        RivianAuthError::InvalidOtp => AppError::RivianOtpRejected,
        RivianAuthError::InvalidCredentials => AppError::RivianConnectSessionExpired,
        RivianAuthError::Network(error) => {
            warn!(error = %error, "vehicle.connect_otp.rivian_network_error");
            AppError::RivianApi("Unable to reach Rivian. Please try again shortly.".into())
        }
        RivianAuthError::UnexpectedResponse(error) => {
            warn!(error = %error, "vehicle.connect_otp.rivian_unexpected_response");
            AppError::RivianApi(
                "Rivian returned an unexpected verification response. Please try again shortly."
                    .into(),
            )
        }
    }
}

async fn connect(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<ConnectBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    info!(
        user_id = %auth.user_id,
        email_present = !body.email.trim().is_empty(),
        "vehicle.connect.start"
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default();
    match crate::ingestion::rivian_auth::rivian_login(&client, &body.email, &body.password)
        .await
        .map_err(|e| {
            warn!(user_id = %auth.user_id, error = %e, "vehicle.connect.login_failed");
            map_rivian_login_error(e)
        })? {
        crate::ingestion::rivian_auth::LoginResult::Authenticated(tokens) => {
            let vehicles = crate::ingestion::rivian_auth::rivian_user_vehicles(&client, &tokens)
                .await
                .map_err(|e| {
                    warn!(
                        user_id = %auth.user_id,
                        error = %e,
                        "vehicle.connect.fetch_user_vehicles_failed"
                    );
                    AppError::RivianApi("Unable to fetch vehicles from Rivian".into())
                })?;
            let mut conn = state.redis.get_multiplexed_async_connection().await?;
            let key = format!("rivian:connect:{}", auth.user_id);
            store_encrypted_redis(&state, &mut conn, &key, &tokens, 300).await?;
            info!(
                user_id = %auth.user_id,
                vehicle_count = vehicles.len(),
                connect_key = %key,
                "vehicle.connect.authenticated"
            );
            Ok(Json(
                serde_json::to_value(ConnectResponse {
                    status: "connected",
                    requires_otp: false,
                    challenge_id: None,
                    vehicle_id: None,
                    vehicles,
                })
                .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?,
            ))
        }
        crate::ingestion::rivian_auth::LoginResult::OtpRequired(challenge) => {
            let challenge_id = Uuid::new_v4().to_string();
            let mut conn = state.redis.get_multiplexed_async_connection().await?;
            let key = format!("rivian:otp:{challenge_id}");
            let pending = PendingOtpChallenge {
                email: challenge.email,
                otp_token: challenge.otp_token,
                csrf_token: challenge.csrf_token,
                app_session_token: challenge.app_session_token,
                user_id: auth.user_id,
            };
            store_encrypted_redis(&state, &mut conn, &key, &pending, 300).await?;
            info!(
                user_id = %auth.user_id,
                challenge_id = %challenge_id,
                challenge_key = %key,
                "vehicle.connect.otp_required"
            );
            Ok(Json(
                serde_json::to_value(ConnectResponse {
                    status: "otp_required",
                    requires_otp: true,
                    challenge_id: Some(challenge_id),
                    vehicle_id: None,
                    vehicles: Vec::new(),
                })
                .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?,
            ))
        }
    }
}

async fn connect_otp(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<OtpBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    info!(
        user_id = %auth.user_id,
        challenge_id = %body.challenge_id,
        "vehicle.connect_otp.start"
    );

    let mut conn = state.redis.get_multiplexed_async_connection().await?;
    let key = format!("rivian:otp:{}", body.challenge_id);
    let pending = load_encrypted_redis::<PendingOtpChallenge>(&state, &mut conn, &key).await?;
    let pending = pending.ok_or_else(|| {
        warn!(
            user_id = %auth.user_id,
            challenge_id = %body.challenge_id,
            "vehicle.connect_otp.challenge_missing"
        );
        AppError::RivianConnectSessionExpired
    })?;

    if pending.user_id != auth.user_id {
        warn!(
            user_id = %auth.user_id,
            challenge_id = %body.challenge_id,
            stored_user_id = %pending.user_id,
            "vehicle.connect_otp.challenge_user_mismatch"
        );
        return Err(AppError::RivianConnectSessionExpired);
    }

    let challenge = crate::ingestion::rivian_auth::RivianOtpChallenge {
        email: pending.email,
        otp_token: pending.otp_token,
        csrf_token: pending.csrf_token,
        app_session_token: pending.app_session_token,
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default();
    let tokens =
        crate::ingestion::rivian_auth::rivian_login_otp(&client, &challenge, &body.otp_code)
            .await
            .map_err(|e| {
                warn!(
                    user_id = %auth.user_id,
                    challenge_id = %body.challenge_id,
                    error = %e,
                    "vehicle.connect_otp.login_failed"
                );
                map_rivian_otp_error(e)
            })?;
    let vehicles = crate::ingestion::rivian_auth::rivian_user_vehicles(&client, &tokens)
        .await
        .map_err(|e| {
            warn!(
                user_id = %auth.user_id,
                challenge_id = %body.challenge_id,
                error = %e,
                "vehicle.connect_otp.fetch_user_vehicles_failed"
            );
            AppError::RivianApi("Unable to fetch vehicles from Rivian".into())
        })?;

    let connect_key = format!("rivian:connect:{}", auth.user_id);
    store_encrypted_redis(&state, &mut conn, &connect_key, &tokens, 300).await?;
    let _: () = redis::AsyncCommands::del(&mut conn, &key).await?;
    info!(
        user_id = %auth.user_id,
        challenge_id = %body.challenge_id,
        vehicle_count = vehicles.len(),
        connect_key = %connect_key,
        "vehicle.connect_otp.authenticated"
    );

    Ok(Json(
        serde_json::to_value(ConnectResponse {
            status: "connected",
            requires_otp: false,
            challenge_id: None,
            vehicle_id: None,
            vehicles,
        })
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?,
    ))
}

async fn add_vehicle(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<AddVehicleBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rivian_vehicle_id = body.rivian_vehicle_id.clone();

    info!(
        user_id = %auth.user_id,
        rivian_vehicle_id = %body.rivian_vehicle_id,
        "vehicle.add.start"
    );

    // Retrieve tokens from Redis
    let mut conn = state.redis.get_multiplexed_async_connection().await?;
    let key = format!("rivian:connect:{}", auth.user_id);
    let tokens = load_encrypted_redis::<crate::ingestion::session_store::RivianTokenBundle>(
        &state, &mut conn, &key,
    )
    .await?;
    let tokens = tokens.ok_or_else(|| {
        warn!(
            user_id = %auth.user_id,
            connect_key = %key,
            "vehicle.add.missing_connect_session"
        );
        AppError::RivianConnectSessionExpired
    })?;

    let identity = age_identity(&state)?;
    let encrypted = crate::ingestion::session_store::encrypt_tokens(&tokens, &identity)
        .map_err(AppError::Internal)?;

    let existing_vehicle_id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM riviamigo.vehicles WHERE rivian_vehicle_id = $1")
            .bind(&rivian_vehicle_id)
            .fetch_optional(&state.pool)
            .await?;

    let mut tx = state.pool.begin().await?;

    let vehicle_id = if let Some(existing_vehicle_id) = existing_vehicle_id {
        let already_member = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(
                SELECT 1
                FROM riviamigo.vehicle_memberships
                WHERE vehicle_id = $1 AND user_id = $2
            )",
        )
        .bind(existing_vehicle_id)
        .bind(auth.user_id)
        .fetch_one(&mut *tx)
        .await?;

        if already_member {
            return Err(AppError::Conflict(
                "vehicle already exists; refresh credentials from vehicle settings".into(),
            ));
        }

        sqlx::query(
            "INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
             VALUES ($1, $2, 'owner', FALSE)",
        )
        .bind(existing_vehicle_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO riviamigo.vehicle_user_settings
             (vehicle_id, user_id, display_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (vehicle_id, user_id) DO UPDATE
             SET display_name = COALESCE(EXCLUDED.display_name, riviamigo.vehicle_user_settings.display_name),
                 updated_at = now()",
        )
        .bind(existing_vehicle_id)
        .bind(auth.user_id)
        .bind(body.name.as_deref())
        .execute(&mut *tx)
        .await?;

        existing_vehicle_id
    } else {
        let vehicle_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO riviamigo.vehicles
               (user_id, rivian_vehicle_id, model, trim, vin, name, home_latitude, home_longitude)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id"#,
        )
        .bind(auth.user_id)
        .bind(&rivian_vehicle_id)
        .bind(body.model.as_deref().unwrap_or("R1T"))
        .bind(body.trim.as_deref())
        .bind(body.vin.as_deref())
        .bind(body.name.as_deref())
        .bind(body.home_lat)
        .bind(body.home_lng)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
             VALUES ($1, $2, 'owner', FALSE)",
        )
        .bind(vehicle_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO riviamigo.vehicle_user_settings
             (vehicle_id, user_id, display_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (vehicle_id, user_id) DO UPDATE
             SET display_name = COALESCE(EXCLUDED.display_name, riviamigo.vehicle_user_settings.display_name),
                 updated_at = now()",
        )
        .bind(vehicle_id)
        .bind(auth.user_id)
        .bind(body.name.as_deref())
        .execute(&mut *tx)
        .await?;

        vehicle_id
    };

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_credentials (vehicle_id, encrypted_tokens, token_created_at) \
         VALUES ($1,$2,now())
         ON CONFLICT (vehicle_id) DO UPDATE
         SET encrypted_tokens = EXCLUDED.encrypted_tokens,
             token_created_at = now(),
             last_refreshed_at = now()",
    )
    .bind(vehicle_id)
    .bind(encrypted.as_slice())
    .execute(&mut *tx)
    .await?;

    // Set as default vehicle if user has none.
    sqlx::query(
        "UPDATE riviamigo.vehicle_memberships
         SET is_default = TRUE, updated_at = now()
         WHERE vehicle_id = $1
           AND user_id = $2
           AND NOT EXISTS (
               SELECT 1 FROM riviamigo.vehicle_memberships
               WHERE user_id = $2 AND is_default = TRUE
           )",
    )
    .bind(vehicle_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE riviamigo.users SET default_vehicle_id = $1 \
         WHERE id = $2 AND default_vehicle_id IS NULL",
    )
    .bind(vehicle_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_runtime_state (vehicle_id, auth_state, auth_reason_code, worker_health_msg, updated_at)
         VALUES ($1, 'authorized', NULL, NULL, now())
         ON CONFLICT (vehicle_id) DO UPDATE
         SET auth_state = 'authorized',
             auth_reason_code = NULL,
             worker_health_msg = NULL,
             updated_at = now()",
    )
    .bind(vehicle_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    cache_vehicle_images(&state.pool, &state.config, vehicle_id, &tokens).await;

    let _: () = redis::AsyncCommands::del(&mut conn, &key).await?;
    info!(
        user_id = %auth.user_id,
        vehicle_id = %vehicle_id,
        rivian_vehicle_id = %rivian_vehicle_id,
        "vehicle.add.persisted"
    );

    state
        .supervisor
        .send(SupervisorCommand::StartWorker { vehicle_id })
        .await;

    Ok(Json(serde_json::json!({"vehicle_id": vehicle_id})))
}

async fn refresh_vehicle_credentials(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Json(body): Json<RefreshCredentialsBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_role(&state.pool, auth.user_id, vid, &["owner", "manager"]).await?;

    let rivian_vehicle_id = require_remote_backed_vehicle(&state.pool, vid).await?;

    if let Some(requested) = body.rivian_vehicle_id.as_deref() {
        if requested != rivian_vehicle_id {
            return Err(AppError::Validation(
                "selected Rivian vehicle does not match this local vehicle".into(),
            ));
        }
    }

    let mut conn = state.redis.get_multiplexed_async_connection().await?;
    let key = format!("rivian:connect:{}", auth.user_id);
    let tokens = load_encrypted_redis::<crate::ingestion::session_store::RivianTokenBundle>(
        &state, &mut conn, &key,
    )
    .await?
    .ok_or(AppError::RivianConnectSessionExpired)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default();
    let account_vehicles = crate::ingestion::rivian_auth::rivian_user_vehicles(&client, &tokens)
        .await
        .map_err(|e| {
            warn!(vehicle_id = %vid, user_id = %auth.user_id, error = %e, "vehicle.refresh_credentials.fetch_user_vehicles_failed");
            AppError::RivianApi("Unable to verify Rivian vehicle access".into())
        })?;
    if !account_vehicles
        .iter()
        .any(|vehicle| vehicle.id == rivian_vehicle_id)
    {
        return Err(AppError::Validation(
            "Rivian account does not include this vehicle".into(),
        ));
    }

    let identity = age_identity(&state)?;
    let encrypted = crate::ingestion::session_store::encrypt_tokens(&tokens, &identity)
        .map_err(AppError::Internal)?;

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_credentials (vehicle_id, encrypted_tokens, token_created_at, last_refreshed_at)
         VALUES ($1,$2,now(),now())
         ON CONFLICT (vehicle_id) DO UPDATE
         SET encrypted_tokens = EXCLUDED.encrypted_tokens,
             last_refreshed_at = now()",
    )
    .bind(vid)
    .bind(encrypted.as_slice())
    .execute(&state.pool)
    .await?;

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_runtime_state (vehicle_id, auth_state, auth_reason_code, worker_health_msg, updated_at)
         VALUES ($1, 'authorized', NULL, NULL, now())
         ON CONFLICT (vehicle_id) DO UPDATE
         SET auth_state = 'authorized',
             auth_reason_code = NULL,
             worker_health_msg = NULL,
             updated_at = now()",
    )
    .bind(vid)
    .execute(&state.pool)
    .await?;

    let _: () = redis::AsyncCommands::del(&mut conn, &key).await?;
    Ok(Json(serde_json::json!({ "ok": true, "vehicle_id": vid })))
}

async fn delete_vehicle(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_role(&state.pool, auth.user_id, vid, &["owner"]).await?;

    sqlx::query("DELETE FROM riviamigo.vehicles WHERE id = $1")
        .bind(vid)
        .execute(&state.pool)
        .await?;

    let next_default = get_default_vehicle_id(&state.pool, auth.user_id).await?;

    sqlx::query("UPDATE riviamigo.users SET default_vehicle_id = $1 WHERE id = $2")
        .bind(next_default)
        .bind(auth.user_id)
        .execute(&state.pool)
        .await?;

    state
        .supervisor
        .send(SupervisorCommand::StopWorker { vehicle_id: vid })
        .await;

    Ok(Json(
        serde_json::json!({ "ok": true, "default_vehicle_id": next_default }),
    ))
}

#[derive(Deserialize)]
struct UpdateBatteryConfigBody {
    battery_capacity_kwh: Option<f64>,
    battery_config: Option<String>,
    target_tire_pressure_psi: Option<f64>,
}

async fn update_battery_config(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Json(body): Json<UpdateBatteryConfigBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    update_vehicle_settings_impl(&state, auth.user_id, vid, body).await
}

async fn update_vehicle_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Json(body): Json<UpdateBatteryConfigBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    update_vehicle_settings_impl(&state, auth.user_id, vid, body).await
}

async fn update_vehicle_settings_impl(
    state: &AppState,
    user_id: Uuid,
    vid: Uuid,
    body: UpdateBatteryConfigBody,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_role(&state.pool, user_id, vid, &["owner", "manager"]).await?;
    let capacity_wh = body.battery_capacity_kwh.map(|kwh| kwh * 1000.0);
    let target_tire_pressure_psi = match body.target_tire_pressure_psi {
        Some(value) if !value.is_finite() => {
            return Err(AppError::Validation(
                "target_tire_pressure_psi must be a finite number".into(),
            ))
        }
        Some(value) if !(20.0..=80.0).contains(&value) => {
            return Err(AppError::Validation(
                "target_tire_pressure_psi must be between 20 and 80".into(),
            ))
        }
        other => other,
    };
    sqlx::query(
        "UPDATE riviamigo.vehicles
         SET battery_capacity_wh = COALESCE($2, battery_capacity_wh),
             battery_config = COALESCE($3, battery_config),
             target_tire_pressure_psi = COALESCE($4, target_tire_pressure_psi)
         WHERE id = $1",
    )
    .bind(vid)
    .bind(capacity_wh)
    .bind(body.battery_config)
    .bind(target_tire_pressure_psi)
    .execute(&state.pool)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
struct UpdateVehicleNameBody {
    name: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct VehicleMemberRow {
    user_id: Uuid,
    email: String,
    role: String,
    is_default: bool,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
struct AddVehicleMemberBody {
    email: String,
    role: String,
}

#[derive(Deserialize)]
struct CreateVehicleInviteBody {
    email: String,
    role: String,
    expires_in_days: Option<i32>,
}

#[derive(sqlx::FromRow, Serialize)]
struct VehicleInviteRow {
    id: Uuid,
    vehicle_id: Uuid,
    invited_by: Uuid,
    invitee_email: String,
    role: String,
    expires_at: chrono::DateTime<chrono::Utc>,
    accepted_at: Option<chrono::DateTime<chrono::Utc>>,
    revoked_at: Option<chrono::DateTime<chrono::Utc>>,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
struct UpdateVehicleMemberBody {
    role: String,
}

async fn update_vehicle_name(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Json(body): Json<UpdateVehicleNameBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_role(&state.pool, auth.user_id, vid, &["owner", "manager"]).await?;
    let trimmed = body.name.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Validation("name must not be blank".into()));
    }
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_user_settings (vehicle_id, user_id, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (vehicle_id, user_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             updated_at = now()",
    )
    .bind(vid)
    .bind(auth.user_id)
    .bind(trimmed)
    .execute(&state.pool)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn set_default_vehicle(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let mut tx = state.pool.begin().await?;

    sqlx::query(
        "UPDATE riviamigo.vehicle_memberships
         SET is_default = FALSE, updated_at = now()
         WHERE user_id = $1",
    )
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await?;

    let updated = sqlx::query(
        "UPDATE riviamigo.vehicle_memberships
         SET is_default = TRUE, updated_at = now()
         WHERE user_id = $1 AND vehicle_id = $2",
    )
    .bind(auth.user_id)
    .bind(vid)
    .execute(&mut *tx)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }

    sqlx::query("UPDATE riviamigo.users SET default_vehicle_id = $1 WHERE id = $2")
        .bind(vid)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(Json(
        serde_json::json!({ "ok": true, "default_vehicle_id": vid }),
    ))
}

async fn list_vehicle_members(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let rows = sqlx::query_as::<_, VehicleMemberRow>(
        "SELECT vm.user_id, u.email, vm.role, vm.is_default, vm.created_at
         FROM riviamigo.vehicle_memberships vm
         JOIN riviamigo.users u ON u.id = vm.user_id
         WHERE vm.vehicle_id = $1
         ORDER BY CASE vm.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.email",
    )
    .bind(vid)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "members": rows,
    })))
}

async fn add_vehicle_member(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Json(body): Json<AddVehicleMemberBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_role(&state.pool, auth.user_id, vid, &["owner"]).await?;

    let email = body.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err(AppError::Validation("valid email required".into()));
    }
    if !matches!(body.role.as_str(), "owner" | "manager" | "viewer") {
        return Err(AppError::Validation(
            "role must be owner, manager, or viewer".into(),
        ));
    }

    let target_user_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM riviamigo.users WHERE email = $1")
            .bind(&email)
            .fetch_optional(&state.pool)
            .await?;

    if let Some(target_user_id) = target_user_id {
        let result = sqlx::query(
            "INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
             VALUES ($1, $2, $3, FALSE)
             ON CONFLICT (vehicle_id, user_id) DO UPDATE
             SET role = EXCLUDED.role,
                 updated_at = now()",
        )
        .bind(vid)
        .bind(target_user_id)
        .bind(body.role.as_str())
        .execute(&state.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::Conflict("member already exists".into()));
        }

        sqlx::query(
            "INSERT INTO riviamigo.vehicle_user_settings (vehicle_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (vehicle_id, user_id) DO NOTHING",
        )
        .bind(vid)
        .bind(target_user_id)
        .execute(&state.pool)
        .await?;

        return Ok(Json(
            serde_json::json!({ "ok": true, "invite_created": false }),
        ));
    }

    let token = format!("rmi_{}", Uuid::new_v4().simple());
    let token_hash = hash_invite_token(&token);
    let expires_in_days = 14;
    let expires_at = chrono::Utc::now() + chrono::Duration::days(expires_in_days as i64);
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_invites
         (vehicle_id, invited_by, invitee_email, role, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(vid)
    .bind(auth.user_id)
    .bind(email)
    .bind(body.role.as_str())
    .bind(token_hash.as_slice())
    .bind(expires_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "invite_created": true,
        "invite_token": token,
    })))
}

async fn update_vehicle_member(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path((vid, member_user_id)): axum::extract::Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateVehicleMemberBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_role(&state.pool, auth.user_id, vid, &["owner"]).await?;

    if !matches!(body.role.as_str(), "owner" | "manager" | "viewer") {
        return Err(AppError::Validation(
            "role must be owner, manager, or viewer".into(),
        ));
    }

    let updated = sqlx::query(
        "UPDATE riviamigo.vehicle_memberships
         SET role = $3, updated_at = now()
         WHERE vehicle_id = $1 AND user_id = $2",
    )
    .bind(vid)
    .bind(member_user_id)
    .bind(body.role.as_str())
    .execute(&state.pool)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn remove_vehicle_member(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path((vid, member_user_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_role(&state.pool, auth.user_id, vid, &["owner"]).await?;

    let member_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM riviamigo.vehicle_memberships WHERE vehicle_id = $1 AND user_id = $2",
    )
    .bind(vid)
    .bind(member_user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    if member_role == "owner" {
        let owner_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM riviamigo.vehicle_memberships WHERE vehicle_id = $1 AND role = 'owner'",
        )
        .bind(vid)
        .fetch_one(&state.pool)
        .await?;
        if owner_count <= 1 {
            return Err(AppError::Validation(
                "vehicle must keep at least one owner".into(),
            ));
        }
    }

    sqlx::query("DELETE FROM riviamigo.vehicle_memberships WHERE vehicle_id = $1 AND user_id = $2")
        .bind(vid)
        .bind(member_user_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn create_vehicle_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vid): Path<Uuid>,
    Json(body): Json<CreateVehicleInviteBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_role(&state.pool, auth.user_id, vid, &["owner"]).await?;
    if !matches!(body.role.as_str(), "owner" | "manager" | "viewer") {
        return Err(AppError::Validation(
            "role must be owner, manager, or viewer".into(),
        ));
    }
    let email = body.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err(AppError::Validation("valid email required".into()));
    }
    let token = format!("rmi_{}", Uuid::new_v4().simple());
    let token_hash = hash_invite_token(&token);
    let expires_in_days = body.expires_in_days.unwrap_or(14).clamp(1, 30);
    let expires_at = chrono::Utc::now() + chrono::Duration::days(expires_in_days as i64);
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_invites
         (vehicle_id, invited_by, invitee_email, role, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(vid)
    .bind(auth.user_id)
    .bind(email)
    .bind(body.role)
    .bind(token_hash.as_slice())
    .bind(expires_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "invite_token": token,
        "expires_at": expires_at,
    })))
}

async fn list_vehicle_invites(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vid): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_role(&state.pool, auth.user_id, vid, &["owner"]).await?;
    let rows = sqlx::query_as::<_, VehicleInviteRow>(
        "SELECT id, vehicle_id, invited_by, invitee_email, role, expires_at, accepted_at, revoked_at, created_at
         FROM riviamigo.vehicle_invites
         WHERE vehicle_id = $1
         ORDER BY created_at DESC",
    )
    .bind(vid)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(serde_json::json!({ "invites": rows })))
}

async fn revoke_vehicle_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vid, invite_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_role(&state.pool, auth.user_id, vid, &["owner"]).await?;
    sqlx::query(
        "UPDATE riviamigo.vehicle_invites
         SET revoked_at = now(), updated_at = now()
         WHERE id = $1 AND vehicle_id = $2 AND accepted_at IS NULL",
    )
    .bind(invite_id)
    .bind(vid)
    .execute(&state.pool)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn preview_invite(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let token_hash = hash_invite_token(&token);
    let row = sqlx::query(
        "SELECT i.id, i.vehicle_id, i.invitee_email, i.role, i.expires_at, i.accepted_at, i.revoked_at, COALESCE(v.name, v.model) AS vehicle_name
         FROM riviamigo.vehicle_invites i
         JOIN riviamigo.vehicles v ON v.id = i.vehicle_id
         WHERE i.token_hash = $1",
    )
    .bind(token_hash.as_slice())
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(serde_json::json!({
        "id": row.get::<Uuid, _>("id"),
        "vehicle_id": row.get::<Uuid, _>("vehicle_id"),
        "vehicle_name": row.get::<String, _>("vehicle_name"),
        "invitee_email": row.get::<String, _>("invitee_email"),
        "role": row.get::<String, _>("role"),
        "expires_at": row.get::<chrono::DateTime<chrono::Utc>, _>("expires_at"),
        "accepted_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("accepted_at"),
        "revoked_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at"),
    })))
}

async fn accept_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let token_hash = hash_invite_token(&token);
    let mut tx = state.pool.begin().await?;
    let invite = sqlx::query(
        "SELECT i.id, i.vehicle_id, i.invitee_email, i.role, i.expires_at, i.accepted_at, i.revoked_at, u.email AS user_email
         FROM riviamigo.vehicle_invites i
         JOIN riviamigo.users u ON u.id = $2
         WHERE i.token_hash = $1
         FOR UPDATE",
    )
    .bind(token_hash.as_slice())
    .bind(auth.user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    if invite
        .get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at")
        .is_some()
    {
        return Err(AppError::Validation("invite revoked".into()));
    }
    if invite
        .get::<Option<chrono::DateTime<chrono::Utc>>, _>("accepted_at")
        .is_some()
    {
        return Err(AppError::Validation("invite already accepted".into()));
    }
    let expires_at = invite.get::<chrono::DateTime<chrono::Utc>, _>("expires_at");
    if expires_at < chrono::Utc::now() {
        return Err(AppError::Validation("invite expired".into()));
    }
    let invitee_email = invite.get::<String, _>("invitee_email");
    let user_email = invite.get::<String, _>("user_email").to_lowercase();
    if invitee_email.to_lowercase() != user_email {
        return Err(AppError::Forbidden);
    }
    let vehicle_id = invite.get::<Uuid, _>("vehicle_id");
    let role = invite.get::<String, _>("role");
    let invite_id = invite.get::<Uuid, _>("id");

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
         VALUES ($1, $2, $3, FALSE)
         ON CONFLICT (vehicle_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, updated_at = now()",
    )
    .bind(vehicle_id)
    .bind(auth.user_id)
    .bind(role)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_user_settings (vehicle_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (vehicle_id, user_id) DO NOTHING",
    )
    .bind(vehicle_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE riviamigo.vehicle_invites
         SET accepted_at = now(), accepted_user_id = $2, updated_at = now()
         WHERE id = $1",
    )
    .bind(invite_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(
        serde_json::json!({ "ok": true, "vehicle_id": vehicle_id }),
    ))
}

fn hash_invite_token(token: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hasher.finalize().to_vec()
}

async fn list_vehicles(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query_as::<_, VehicleListRow>(
        "SELECT v.id, v.rivian_vehicle_id, v.model, v.trim, v.vin, v.color, \
                COALESCE(vus.display_name, v.name) AS name, v.battery_capacity_wh, v.target_tire_pressure_psi, \
                v.battery_config, v.created_at, v.interior_color, v.wheel_option, v.max_vehicle_power_kw, \
                v.charge_port_type, v.battery_cell_type, v.supported_features, \
                v.history_backfill_status, v.history_backfilled_at, v.history_session_count, \
                vrs.worker_health, vrs.worker_health_msg, vrs.auth_state, vrs.auth_reason_code, \
                vm.role AS membership_role \
         FROM riviamigo.vehicles v \
         JOIN riviamigo.vehicle_memberships vm ON vm.vehicle_id = v.id \
         LEFT JOIN riviamigo.vehicle_user_settings vus ON vus.vehicle_id = v.id AND vus.user_id = vm.user_id \
         LEFT JOIN riviamigo.vehicle_runtime_state vrs ON vrs.vehicle_id = v.id \
         WHERE vm.user_id = $1
           AND ($2::uuid IS NULL OR v.id = $2)
         ORDER BY v.created_at",
    )
    .bind(auth.user_id)
    .bind(auth.api_vehicle_id)
    .fetch_all(&state.pool)
    .await?;

    let mut vehicles = Vec::with_capacity(rows.len());
    for r in rows {
        let is_demo = is_demo_vehicle_key(&r.rivian_vehicle_id);
        if !is_demo {
            queue_vehicle_artwork_repair(&state, r.id).await;
        }
        let images = fetch_vehicle_images_json(&state.pool, &state.config, r.id)
            .await
            .unwrap_or_else(|_| serde_json::json!({ "all": [] }));
        // Listing vehicles must never become a hidden Rivian-image fetch.
        // Artwork is downloaded and mirrored at vehicle add time (or by the
        // explicit administrator repair action), so a browser render reads
        // only local cache files and falls back to the local placeholder.
        vehicles.push(serde_json::json!({
            "id":                       r.id,
            "user_id":                  auth.user_id,
            "rivian_vehicle_id":        r.rivian_vehicle_id,
            "is_demo":                  is_demo,
            "vin":                      r.vin,
            "model":                    r.model,
            "year":                     serde_json::Value::Null,
            "trim":                     r.trim,
            "color":                    r.color,
            "interior_color":           r.interior_color,
            "wheel_option":             r.wheel_option,
            "max_vehicle_power_kw":     r.max_vehicle_power_kw,
            "charge_port_type":         r.charge_port_type,
            "battery_cell_type":        r.battery_cell_type,
            "supported_features":       r.supported_features,
            "battery_capacity_kwh":     r.battery_capacity_wh.map(|w| w / 1000.0),
            "target_tire_pressure_psi": r.target_tire_pressure_psi,
            "battery_config":           r.battery_config,
            "display_name":             r.name.as_deref().unwrap_or(&r.model),
            "membership_role":          r.membership_role,
            "created_at":               r.created_at,
            "images":                   images,
            "history_backfill_status":  r.history_backfill_status,
            "history_backfilled_at":    r.history_backfilled_at,
            "history_session_count":    r.history_session_count,
            "worker_health":            r.worker_health,
            "worker_health_msg":        r.worker_health_msg,
            "auth_state":               r.auth_state,
            "auth_reason_code":         r.auth_reason_code,
        }));
    }

    Ok(Json(serde_json::json!({"vehicles": vehicles})))
}

async fn create_demo_vehicle(
    State(state): State<AppState>,
    auth: AuthUser,
    body: Option<Json<CreateDemoVehicleBody>>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    let mut tx = state.pool.begin().await?;
    let model = body
        .as_ref()
        .map(|payload| payload.model.trim().to_uppercase())
        .unwrap_or_else(|| "R1T".to_string());
    if !matches!(model.as_str(), "R1T" | "R1S" | "R2S") {
        return Err(AppError::Validation(
            "model must be one of R1T, R1S, R2S".into(),
        ));
    }
    let demo_key = format!("demo-{}-local", model.to_lowercase());
    let display_name = format!("Demo {model}");
    let (trim, battery_config, battery_capacity_wh, _range_mi) = match model.as_str() {
        "R1S" => ("Adventure", "r1_large_g1", 135_000.0_f64, 260.0_f64),
        "R2S" => ("Adventure", "r2s", 82_000.0_f64, 300.0_f64),
        _ => ("Adventure", "r1_large_g1", 135_000.0_f64, 248.0_f64),
    };

    let existing_vehicle_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT v.id
         FROM riviamigo.vehicles v
         JOIN riviamigo.vehicle_memberships vm ON vm.vehicle_id = v.id
         WHERE vm.user_id = $1 AND v.rivian_vehicle_id = $2
         LIMIT 1",
    )
    .bind(auth.user_id)
    .bind(&demo_key)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(Some(vehicle_id)) = existing_vehicle_id {
        tx.commit().await?;
        return Ok(Json(serde_json::json!({
            "ok": true,
            "vehicle_id": vehicle_id,
            "created": false,
            "seeded": false,
            "refreshed": false,
            "seeded_at": null,
            "window_start": null,
            "window_end": null,
            "counts": null
        })));
    }

    let vehicle_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO riviamigo.vehicles
              (user_id, rivian_vehicle_id, model, trim, color, battery_config, battery_capacity_wh, name)
             VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id",
        )
        .bind(auth.user_id)
        .bind(&demo_key)
        .bind(&model)
        .bind(trim)
        .bind("Limestone")
        .bind(battery_config)
        .bind(battery_capacity_wh)
        .bind(&display_name)
        .fetch_one(&mut *tx)
        .await?;

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
         VALUES ($1, $2, 'owner', FALSE)
         ON CONFLICT (vehicle_id, user_id) DO UPDATE
         SET role = 'owner', updated_at = now()",
    )
    .bind(vehicle_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_user_settings (vehicle_id, user_id, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (vehicle_id, user_id) DO UPDATE
         SET display_name = EXCLUDED.display_name, updated_at = now()",
    )
    .bind(vehicle_id)
    .bind(auth.user_id)
    .bind(&display_name)
    .execute(&mut *tx)
    .await?;

    let summary = seed_demo_vehicle(&mut tx, vehicle_id, &model, Utc::now()).await?;

    tx.commit().await?;
    Ok(Json(serde_json::json!({
        "ok": true,
        "vehicle_id": vehicle_id,
        "created": true,
        "seeded": true,
        "refreshed": false,
        "seeded_at": summary.seeded_at,
        "window_start": summary.window_start,
        "window_end": summary.window_end,
        "counts": summary.counts
    })))
}

async fn refresh_demo_vehicle(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    require_vehicle_access(&auth, vehicle_id)?;
    let (demo_key, model) = sqlx::query_as::<_, (String, String)>(
        "SELECT rivian_vehicle_id, model FROM riviamigo.vehicles WHERE id=$1",
    )
    .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if !is_demo_vehicle_key(&demo_key) {
        return Err(AppError::Validation(
            "only demo vehicles can refresh demo data".into(),
        ));
    }

    let mut tx = state.pool.begin().await?;
    let summary = seed_demo_vehicle(&mut tx, vehicle_id, &model, Utc::now()).await?;
    tx.commit().await?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "vehicle_id": vehicle_id,
        "created": false,
        "seeded": true,
        "refreshed": true,
        "seeded_at": summary.seeded_at,
        "window_start": summary.window_start,
        "window_end": summary.window_end,
        "counts": summary.counts
    })))
}

async fn vehicle_status(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
) -> Result<Json<VehicleStatusResponse>, AppError> {
    require_vehicle_access(&auth, vid)?;
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    queue_vehicle_artwork_repair(&state, vid).await;

    let vehicle = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT battery_capacity_wh FROM riviamigo.vehicles WHERE id = $1",
    )
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .flatten();

    let row = sqlx::query_as::<_, VehicleRuntimeStateRow>(
        "SELECT is_online, last_event_at, last_payload_at, last_heartbeat_at, \
                last_ws_received_at, last_ws_payload_received_at, last_ws_heartbeat_received_at, \
                last_charge_history_sync_at, last_charge_history_success_at, \
                worker_health, auth_state, auth_reason_code FROM riviamigo.vehicle_runtime_state \
         WHERE vehicle_id = $1",
    )
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?;

    let latest = sqlx::query_as::<_, LatestVehicleTelemetry>(
        r#"
        SELECT
          ts, latitude, longitude, altitude_m, speed_mph, location_ts, speed_mph_ts,
          battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit,
          battery_level_ts, distance_to_empty_mi_ts, battery_limit_ts,
          power_state, power_state_ts,
          charger_state, charger_state_ts, charger_status, charger_status_ts,
          time_to_end_of_charge_min, time_to_end_of_charge_min_ts,
          drive_mode, gear_status, cabin_temp_c, driver_temp_c, outside_temp_c,
          heading_deg, odometer_miles, odometer_miles_ts,
          tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
          tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status,
          tire_fl_valid, tire_fr_valid, tire_rl_valid, tire_rr_valid,
          door_front_left_locked, door_front_right_locked, door_rear_left_locked, door_rear_right_locked,
          door_front_left_closed, door_front_right_closed, door_rear_left_closed, door_rear_right_closed,
          closure_frunk_locked, closure_frunk_closed, closure_liftgate_locked, closure_liftgate_closed,
          closure_tailgate_locked, closure_tailgate_closed,
          ota_current_version, ota_available_version, ota_status, ota_current_status,
          hv_thermal_event, twelve_volt_health,
          charge_port_open, charger_derate_active, cabin_precon_status, cabin_precon_type,
          pet_mode_active, pet_mode_temp_ok, defrost_active, steering_wheel_heat,
          seat_fl_heat, seat_fr_heat, seat_rl_heat, seat_rr_heat,
          seat_fl_vent, seat_fr_vent,
          tonneau_locked, tonneau_closed, side_bin_left_locked, side_bin_right_locked,
          side_bin_left_closed, side_bin_right_closed,
          window_fl_closed, window_fr_closed, window_rl_closed, window_rr_closed,
          gear_guard_locked, gear_guard_video_status, wiper_fluid_low, brake_fluid_low,
          alarm_active, service_mode
        FROM riviamigo.vehicle_latest_status
        WHERE vehicle_id = $1
        "#,
    )
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .unwrap_or(LatestVehicleTelemetry {
        ts: None,
        latitude: None,
        longitude: None,
        altitude_m: None,
        speed_mph: None,
        location_ts: None,
        speed_mph_ts: None,
        battery_level: None,
        battery_capacity_wh: None,
        distance_to_empty_mi: None,
        battery_limit: None,
        battery_level_ts: None,
        distance_to_empty_mi_ts: None,
        battery_limit_ts: None,
        power_state: None,
        power_state_ts: None,
        charger_state: None,
        charger_state_ts: None,
        charger_status: None,
        time_to_end_of_charge_min: None,
        charger_status_ts: None,
        time_to_end_of_charge_min_ts: None,
        drive_mode: None,
        gear_status: None,
        cabin_temp_c: None,
        driver_temp_c: None,
        outside_temp_c: None,
        heading_deg: None,
        odometer_miles: None,
        odometer_miles_ts: None,
        tire_fl_psi: None,
        tire_fr_psi: None,
        tire_rl_psi: None,
        tire_rr_psi: None,
        tire_fl_status: None,
        tire_fr_status: None,
        tire_rl_status: None,
        tire_rr_status: None,
        tire_fl_valid: None,
        tire_fr_valid: None,
        tire_rl_valid: None,
        tire_rr_valid: None,
        door_front_left_locked: None,
        door_front_right_locked: None,
        door_rear_left_locked: None,
        door_rear_right_locked: None,
        door_front_left_closed: None,
        door_front_right_closed: None,
        door_rear_left_closed: None,
        door_rear_right_closed: None,
        closure_frunk_locked: None,
        closure_frunk_closed: None,
        closure_liftgate_locked: None,
        closure_liftgate_closed: None,
        closure_tailgate_locked: None,
        closure_tailgate_closed: None,
        ota_current_version: None,
        ota_available_version: None,
        ota_status: None,
        ota_current_status: None,
        hv_thermal_event: None,
        twelve_volt_health: None,
        charge_port_open: None,
        charger_derate_active: None,
        cabin_precon_status: None,
        cabin_precon_type: None,
        pet_mode_active: None,
        pet_mode_temp_ok: None,
        defrost_active: None,
        steering_wheel_heat: None,
        seat_fl_heat: None,
        seat_fr_heat: None,
        seat_rl_heat: None,
        seat_rr_heat: None,
        seat_fl_vent: None,
        seat_fr_vent: None,
        tonneau_locked: None,
        tonneau_closed: None,
        side_bin_left_locked: None,
        side_bin_right_locked: None,
        side_bin_left_closed: None,
        side_bin_right_closed: None,
        window_fl_closed: None,
        window_fr_closed: None,
        window_rl_closed: None,
        window_rr_closed: None,
        gear_guard_locked: None,
        gear_guard_video_status: None,
        wiper_fluid_low: None,
        brake_fluid_low: None,
        alarm_active: None,
        service_mode: None,
    });

    let seen = sqlx::query_as::<_, VehicleStatusFieldSeenRow>(
        r#"
        SELECT
          max(ts) FILTER (WHERE tire_fl_psi IS NOT NULL) AS tire_fl_psi_at,
          max(ts) FILTER (WHERE tire_fr_psi IS NOT NULL) AS tire_fr_psi_at,
          max(ts) FILTER (WHERE tire_rl_psi IS NOT NULL) AS tire_rl_psi_at,
          max(ts) FILTER (WHERE tire_rr_psi IS NOT NULL) AS tire_rr_psi_at,
          max(ts) FILTER (WHERE tire_fl_status IS NOT NULL) AS tire_fl_status_at,
          max(ts) FILTER (WHERE tire_fr_status IS NOT NULL) AS tire_fr_status_at,
          max(ts) FILTER (WHERE tire_rl_status IS NOT NULL) AS tire_rl_status_at,
          max(ts) FILTER (WHERE tire_rr_status IS NOT NULL) AS tire_rr_status_at,
          max(ts) FILTER (WHERE tire_fl_valid IS NOT NULL) AS tire_fl_valid_at,
          max(ts) FILTER (WHERE tire_fr_valid IS NOT NULL) AS tire_fr_valid_at,
          max(ts) FILTER (WHERE tire_rl_valid IS NOT NULL) AS tire_rl_valid_at,
          max(ts) FILTER (WHERE tire_rr_valid IS NOT NULL) AS tire_rr_valid_at,
          max(ts) FILTER (WHERE hv_thermal_event IS NOT NULL) AS hv_thermal_event_at,
          max(ts) FILTER (WHERE twelve_volt_health IS NOT NULL) AS twelve_volt_health_at,
          max(ts) FILTER (WHERE ota_current_version IS NOT NULL) AS ota_current_version_at,
          max(ts) FILTER (WHERE ota_available_version IS NOT NULL) AS ota_available_version_at,
          max(ts) FILTER (WHERE ota_status IS NOT NULL) AS ota_status_at,
          max(ts) FILTER (WHERE ota_current_status IS NOT NULL) AS ota_current_status_at,
          max(ts) FILTER (WHERE charge_port_open IS NOT NULL) AS charge_port_open_at,
          max(ts) FILTER (WHERE charger_derate_active IS NOT NULL) AS charger_derate_active_at,
          max(ts) FILTER (WHERE cabin_precon_status IS NOT NULL) AS cabin_precon_status_at,
          max(ts) FILTER (WHERE cabin_precon_type IS NOT NULL) AS cabin_precon_type_at,
          max(ts) FILTER (WHERE pet_mode_active IS NOT NULL) AS pet_mode_active_at,
          max(ts) FILTER (WHERE pet_mode_temp_ok IS NOT NULL) AS pet_mode_temp_ok_at,
          max(ts) FILTER (WHERE defrost_active IS NOT NULL) AS defrost_active_at,
          max(ts) FILTER (WHERE steering_wheel_heat IS NOT NULL) AS steering_wheel_heat_at,
          max(ts) FILTER (WHERE seat_fl_heat IS NOT NULL) AS seat_fl_heat_at,
          max(ts) FILTER (WHERE seat_fr_heat IS NOT NULL) AS seat_fr_heat_at,
          max(ts) FILTER (WHERE seat_rl_heat IS NOT NULL) AS seat_rl_heat_at,
          max(ts) FILTER (WHERE seat_rr_heat IS NOT NULL) AS seat_rr_heat_at,
          max(ts) FILTER (WHERE seat_fl_vent IS NOT NULL) AS seat_fl_vent_at,
          max(ts) FILTER (WHERE seat_fr_vent IS NOT NULL) AS seat_fr_vent_at,
          max(ts) FILTER (WHERE tonneau_locked IS NOT NULL) AS tonneau_locked_at,
          max(ts) FILTER (WHERE tonneau_closed IS NOT NULL) AS tonneau_closed_at,
          max(ts) FILTER (WHERE side_bin_left_locked IS NOT NULL) AS side_bin_left_locked_at,
          max(ts) FILTER (WHERE side_bin_right_locked IS NOT NULL) AS side_bin_right_locked_at,
          max(ts) FILTER (WHERE side_bin_left_closed IS NOT NULL) AS side_bin_left_closed_at,
          max(ts) FILTER (WHERE side_bin_right_closed IS NOT NULL) AS side_bin_right_closed_at,
          max(ts) FILTER (WHERE window_fl_closed IS NOT NULL) AS window_fl_closed_at,
          max(ts) FILTER (WHERE window_fr_closed IS NOT NULL) AS window_fr_closed_at,
          max(ts) FILTER (WHERE window_rl_closed IS NOT NULL) AS window_rl_closed_at,
          max(ts) FILTER (WHERE window_rr_closed IS NOT NULL) AS window_rr_closed_at,
          max(ts) FILTER (WHERE gear_guard_locked IS NOT NULL) AS gear_guard_locked_at,
          max(ts) FILTER (WHERE gear_guard_video_status IS NOT NULL) AS gear_guard_video_status_at,
          max(ts) FILTER (WHERE wiper_fluid_low IS NOT NULL) AS wiper_fluid_low_at,
          max(ts) FILTER (WHERE brake_fluid_low IS NOT NULL) AS brake_fluid_low_at,
          max(ts) FILTER (WHERE alarm_active IS NOT NULL) AS alarm_active_at,
          max(ts) FILTER (WHERE service_mode IS NOT NULL) AS service_mode_at,
          max(ts) FILTER (WHERE closure_frunk_closed IS NOT NULL) AS closure_frunk_closed_at,
          max(ts) FILTER (WHERE closure_liftgate_closed IS NOT NULL) AS closure_liftgate_closed_at,
          max(ts) FILTER (WHERE closure_tailgate_closed IS NOT NULL) AS closure_tailgate_closed_at,
          max(ts) FILTER (WHERE door_front_left_closed IS NOT NULL) AS door_front_left_closed_at,
          max(ts) FILTER (WHERE door_front_right_closed IS NOT NULL) AS door_front_right_closed_at,
          max(ts) FILTER (WHERE door_rear_left_closed IS NOT NULL) AS door_rear_left_closed_at,
          max(ts) FILTER (WHERE door_rear_right_closed IS NOT NULL) AS door_rear_right_closed_at
        FROM timeseries.telemetry
        WHERE vehicle_id = $1
        "#,
    )
    .bind(vid)
    .fetch_one(&state.pool)
    .await?;

    let tire_values = [
        latest.tire_fl_psi,
        latest.tire_fr_psi,
        latest.tire_rl_psi,
        latest.tire_rr_psi,
    ];
    let tire_min_psi = tire_values
        .into_iter()
        .flatten()
        .filter(|v| v.is_finite())
        .min_by(|a, b| a.total_cmp(b));
    let tire_statuses = [
        latest.tire_fl_status.as_deref(),
        latest.tire_fr_status.as_deref(),
        latest.tire_rl_status.as_deref(),
        latest.tire_rr_status.as_deref(),
    ];
    let tire_validity = [
        latest.tire_fl_valid,
        latest.tire_fr_valid,
        latest.tire_rl_valid,
        latest.tire_rr_valid,
    ];
    let tire_pressure_status: Option<String> =
        if tire_validity.into_iter().flatten().any(|valid| !valid) {
            Some("invalid_sensor".to_string())
        } else {
            tire_statuses
                .into_iter()
                .flatten()
                .find(|status| {
                    !status.eq_ignore_ascii_case("ok") && !status.eq_ignore_ascii_case("unknown")
                })
                .or_else(|| {
                    [
                        latest.tire_fl_status.as_deref(),
                        latest.tire_fr_status.as_deref(),
                        latest.tire_rl_status.as_deref(),
                        latest.tire_rr_status.as_deref(),
                    ]
                    .into_iter()
                    .flatten()
                    .next()
                })
                .map(str::to_string)
        };
    let lock_values = [
        latest.door_front_left_locked,
        latest.door_front_right_locked,
        latest.door_rear_left_locked,
        latest.door_rear_right_locked,
    ];
    let doors_locked = if lock_values.iter().all(|value| value.is_some()) {
        Some(lock_values.into_iter().all(|value| value.unwrap_or(false)))
    } else {
        None
    };
    let open_closures = open_closures_json(&[
        ("Front left door", latest.door_front_left_closed),
        ("Front right door", latest.door_front_right_closed),
        ("Rear left door", latest.door_rear_left_closed),
        ("Rear right door", latest.door_rear_right_closed),
        ("Frunk", latest.closure_frunk_closed),
        ("Liftgate", latest.closure_liftgate_closed),
        ("Tailgate", latest.closure_tailgate_closed),
        ("Tonneau", latest.tonneau_closed),
        ("Left side bin", latest.side_bin_left_closed),
        ("Right side bin", latest.side_bin_right_closed),
        ("Front left window", latest.window_fl_closed),
        ("Front right window", latest.window_fr_closed),
        ("Rear left window", latest.window_rl_closed),
        ("Rear right window", latest.window_rr_closed),
    ]);
    let software_update_status: Option<String> = latest
        .ota_status
        .as_deref()
        .or(latest.ota_current_status.as_deref())
        .map(str::to_string);
    let latest_event_at = latest
        .ts
        .or_else(|| row.as_ref().and_then(|r| r.last_event_at));
    let normalized_range_miles = normalize_remaining_range_miles(
        latest.distance_to_empty_mi,
        latest.battery_level,
        latest.battery_capacity_wh.or(vehicle),
    );
    let now = chrono::Utc::now();
    let (effective_worker_health, telemetry_stale, telemetry_stale_reason) =
        derive_vehicle_status_freshness(now, row.as_ref(), &latest);
    let mut field_availability = BTreeMap::new();

    insert_field_availability(
        &mut field_availability,
        "hv_thermal_event",
        latest_event_at,
        seen.hv_thermal_event_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "twelve_volt_health",
        latest_event_at,
        seen.twelve_volt_health_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "ota_current_version",
        latest_event_at,
        seen.ota_current_version_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "ota_available_version",
        latest_event_at,
        seen.ota_available_version_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "ota_status",
        latest_event_at,
        seen.ota_status_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "ota_current_status",
        latest_event_at,
        seen.ota_current_status_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "charge_port_open",
        latest_event_at,
        seen.charge_port_open_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "charger_derate_active",
        latest_event_at,
        seen.charger_derate_active_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "cabin_precon_status",
        latest_event_at,
        seen.cabin_precon_status_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "cabin_precon_type",
        latest_event_at,
        seen.cabin_precon_type_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "pet_mode_active",
        latest_event_at,
        seen.pet_mode_active_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "pet_mode_temp_ok",
        latest_event_at,
        seen.pet_mode_temp_ok_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "defrost_active",
        latest_event_at,
        seen.defrost_active_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "steering_wheel_heat",
        latest_event_at,
        seen.steering_wheel_heat_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "seat_fl_heat",
        latest_event_at,
        seen.seat_fl_heat_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "seat_fr_heat",
        latest_event_at,
        seen.seat_fr_heat_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "seat_rl_heat",
        latest_event_at,
        seen.seat_rl_heat_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "seat_rr_heat",
        latest_event_at,
        seen.seat_rr_heat_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "seat_fl_vent",
        latest_event_at,
        seen.seat_fl_vent_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "seat_fr_vent",
        latest_event_at,
        seen.seat_fr_vent_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "tonneau_locked",
        latest_event_at,
        seen.tonneau_locked_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "tonneau_closed",
        latest_event_at,
        seen.tonneau_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "side_bin_left_locked",
        latest_event_at,
        seen.side_bin_left_locked_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "side_bin_right_locked",
        latest_event_at,
        seen.side_bin_right_locked_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "side_bin_left_closed",
        latest_event_at,
        seen.side_bin_left_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "side_bin_right_closed",
        latest_event_at,
        seen.side_bin_right_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "window_fl_closed",
        latest_event_at,
        seen.window_fl_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "window_fr_closed",
        latest_event_at,
        seen.window_fr_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "window_rl_closed",
        latest_event_at,
        seen.window_rl_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "window_rr_closed",
        latest_event_at,
        seen.window_rr_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "gear_guard_locked",
        latest_event_at,
        seen.gear_guard_locked_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "gear_guard_video_status",
        latest_event_at,
        seen.gear_guard_video_status_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "wiper_fluid_low",
        latest_event_at,
        seen.wiper_fluid_low_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "brake_fluid_low",
        latest_event_at,
        seen.brake_fluid_low_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "alarm_active",
        latest_event_at,
        seen.alarm_active_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "service_mode",
        latest_event_at,
        seen.service_mode_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "closure_frunk_closed",
        latest_event_at,
        seen.closure_frunk_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "closure_liftgate_closed",
        latest_event_at,
        seen.closure_liftgate_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "closure_tailgate_closed",
        latest_event_at,
        seen.closure_tailgate_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "door_front_left_closed",
        latest_event_at,
        seen.door_front_left_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "door_front_right_closed",
        latest_event_at,
        seen.door_front_right_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "door_rear_left_closed",
        latest_event_at,
        seen.door_rear_left_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "door_rear_right_closed",
        latest_event_at,
        seen.door_rear_right_closed_at,
        None,
    );
    insert_field_availability(
        &mut field_availability,
        "tire_fl_psi",
        latest_event_at,
        seen.tire_fl_psi_at,
        (latest.tire_fl_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_fr_psi",
        latest_event_at,
        seen.tire_fr_psi_at,
        (latest.tire_fr_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_rl_psi",
        latest_event_at,
        seen.tire_rl_psi_at,
        (latest.tire_rl_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_rr_psi",
        latest_event_at,
        seen.tire_rr_psi_at,
        (latest.tire_rr_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_fl_status",
        latest_event_at,
        seen.tire_fl_status_at,
        (latest.tire_fl_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_fr_status",
        latest_event_at,
        seen.tire_fr_status_at,
        (latest.tire_fr_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_rl_status",
        latest_event_at,
        seen.tire_rl_status_at,
        (latest.tire_rl_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_rr_status",
        latest_event_at,
        seen.tire_rr_status_at,
        (latest.tire_rr_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_fl_valid",
        latest_event_at,
        seen.tire_fl_valid_at,
        (latest.tire_fl_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_fr_valid",
        latest_event_at,
        seen.tire_fr_valid_at,
        (latest.tire_fr_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_rl_valid",
        latest_event_at,
        seen.tire_rl_valid_at,
        (latest.tire_rl_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_rr_valid",
        latest_event_at,
        seen.tire_rr_valid_at,
        (latest.tire_rr_valid == Some(false))
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    insert_field_availability(
        &mut field_availability,
        "tire_pressure_status",
        latest_event_at,
        max_seen_at([
            seen.tire_fl_psi_at,
            seen.tire_fr_psi_at,
            seen.tire_rl_psi_at,
            seen.tire_rr_psi_at,
            seen.tire_fl_status_at,
            seen.tire_fr_status_at,
            seen.tire_rl_status_at,
            seen.tire_rr_status_at,
            seen.tire_fl_valid_at,
            seen.tire_fr_valid_at,
            seen.tire_rl_valid_at,
            seen.tire_rr_valid_at,
        ]),
        tire_validity
            .into_iter()
            .flatten()
            .any(|valid| !valid)
            .then_some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );

    Ok(Json(VehicleStatusResponse {
        vehicle_id: vid,
        is_online: row.as_ref().and_then(|r| r.is_online).unwrap_or(false),
        last_event_at: row.as_ref().and_then(|r| r.last_event_at),
        last_updated: latest
            .ts
            .or_else(|| row.as_ref().and_then(|r| r.last_event_at)),
        last_payload_at: row.as_ref().and_then(|r| r.last_payload_at),
        last_heartbeat_at: row.as_ref().and_then(|r| r.last_heartbeat_at),
        last_ws_received_at: row.as_ref().and_then(|r| r.last_ws_received_at),
        last_ws_payload_received_at: row.as_ref().and_then(|r| r.last_ws_payload_received_at),
        last_ws_heartbeat_received_at: row.as_ref().and_then(|r| r.last_ws_heartbeat_received_at),
        last_charge_history_sync_at: row.as_ref().and_then(|r| r.last_charge_history_sync_at),
        last_charge_history_success_at: row.as_ref().and_then(|r| r.last_charge_history_success_at),
        worker_health: effective_worker_health,
        auth_state: row.as_ref().and_then(|r| r.auth_state.clone()),
        auth_reason_code: row.as_ref().and_then(|r| r.auth_reason_code.clone()),
        battery_level: latest.battery_level,
        battery_level_ts: latest.battery_level_ts.or(latest.ts),
        range_miles: normalized_range_miles,
        range_miles_ts: latest.distance_to_empty_mi_ts.or(latest.ts),
        battery_capacity_kwh: latest.battery_capacity_wh.map(|w| {
            if w > 1000.0 {
                w / 1000.0
            } else {
                w
            }
        }),
        battery_limit: latest.battery_limit,
        battery_limit_ts: latest.battery_limit_ts,
        power_state: latest.power_state,
        power_state_ts: latest.power_state_ts.or(latest.ts),
        charger_state: latest.charger_state,
        charger_state_ts: latest.charger_state_ts,
        charger_status: latest.charger_status,
        charger_status_ts: latest.charger_status_ts,
        time_to_end_of_charge_min: latest.time_to_end_of_charge_min,
        time_to_end_of_charge_min_ts: latest.time_to_end_of_charge_min_ts,
        speed_mph: latest.speed_mph,
        speed_mph_ts: latest.speed_mph_ts,
        altitude_m: latest.altitude_m,
        latitude: latest.latitude,
        longitude: latest.longitude,
        location_ts: latest.location_ts,
        drive_mode: latest.drive_mode,
        gear_status: latest.gear_status,
        cabin_temp_c: latest.cabin_temp_c,
        driver_temp_c: latest.driver_temp_c,
        outside_temp_c: latest.outside_temp_c,
        heading_deg: latest.heading_deg,
        odometer_miles: latest.odometer_miles,
        odometer_miles_ts: latest.odometer_miles_ts,
        tire_fl_psi: latest.tire_fl_psi,
        tire_fr_psi: latest.tire_fr_psi,
        tire_rl_psi: latest.tire_rl_psi,
        tire_rr_psi: latest.tire_rr_psi,
        tire_min_psi,
        tire_fl_status: latest.tire_fl_status,
        tire_fr_status: latest.tire_fr_status,
        tire_rl_status: latest.tire_rl_status,
        tire_rr_status: latest.tire_rr_status,
        tire_fl_valid: latest.tire_fl_valid,
        tire_fr_valid: latest.tire_fr_valid,
        tire_rl_valid: latest.tire_rl_valid,
        tire_rr_valid: latest.tire_rr_valid,
        door_front_left_locked: latest.door_front_left_locked,
        door_front_right_locked: latest.door_front_right_locked,
        door_rear_left_locked: latest.door_rear_left_locked,
        door_rear_right_locked: latest.door_rear_right_locked,
        door_front_left_closed: latest.door_front_left_closed,
        door_front_right_closed: latest.door_front_right_closed,
        door_rear_left_closed: latest.door_rear_left_closed,
        door_rear_right_closed: latest.door_rear_right_closed,
        closure_frunk_locked: latest.closure_frunk_locked,
        closure_frunk_closed: latest.closure_frunk_closed,
        closure_liftgate_locked: latest.closure_liftgate_locked,
        closure_liftgate_closed: latest.closure_liftgate_closed,
        closure_tailgate_locked: latest.closure_tailgate_locked,
        closure_tailgate_closed: latest.closure_tailgate_closed,
        ota_current_version: latest.ota_current_version,
        ota_available_version: latest.ota_available_version,
        ota_status: latest.ota_status,
        ota_current_status: latest.ota_current_status,
        hv_thermal_event: latest.hv_thermal_event,
        twelve_volt_health: latest.twelve_volt_health,
        doors_locked,
        open_closures,
        tire_pressure_status,
        software_update_status,
        // Extended vehicleStatus fields (migration 0022)
        charge_port_open: latest.charge_port_open,
        charger_derate_active: latest.charger_derate_active,
        cabin_precon_status: latest.cabin_precon_status,
        cabin_precon_type: latest.cabin_precon_type,
        pet_mode_active: latest.pet_mode_active,
        pet_mode_temp_ok: latest.pet_mode_temp_ok,
        defrost_active: latest.defrost_active,
        steering_wheel_heat: latest.steering_wheel_heat,
        seat_fl_heat: latest.seat_fl_heat,
        seat_fr_heat: latest.seat_fr_heat,
        seat_rl_heat: latest.seat_rl_heat,
        seat_rr_heat: latest.seat_rr_heat,
        seat_fl_vent: latest.seat_fl_vent,
        seat_fr_vent: latest.seat_fr_vent,
        tonneau_locked: latest.tonneau_locked,
        tonneau_closed: latest.tonneau_closed,
        side_bin_left_locked: latest.side_bin_left_locked,
        side_bin_right_locked: latest.side_bin_right_locked,
        side_bin_left_closed: latest.side_bin_left_closed,
        side_bin_right_closed: latest.side_bin_right_closed,
        window_fl_closed: latest.window_fl_closed,
        window_fr_closed: latest.window_fr_closed,
        window_rl_closed: latest.window_rl_closed,
        window_rr_closed: latest.window_rr_closed,
        gear_guard_locked: latest.gear_guard_locked,
        gear_guard_video_status: latest.gear_guard_video_status,
        wiper_fluid_low: latest.wiper_fluid_low,
        brake_fluid_low: latest.brake_fluid_low,
        alarm_active: latest.alarm_active,
        service_mode: latest.service_mode,
        telemetry_stale,
        telemetry_stale_reason,
        field_availability,
    }))
}

#[cfg(test)]
mod range_tests {
    use crate::routes::range_normalization::normalize_remaining_range_miles;

    #[test]
    fn leaves_plausible_miles_untouched() {
        let value = normalize_remaining_range_miles(Some(227.0), Some(71.0), Some(135_000.0));
        assert_eq!(value, Some(227.0));
    }

    #[test]
    fn converts_implausible_km_value_to_miles() {
        let value = normalize_remaining_range_miles(Some(380.0), Some(71.0), Some(135_000.0));
        assert_eq!(
            value.map(|miles| (miles * 10.0).round() / 10.0),
            Some(236.1)
        );
    }

    #[test]
    fn leaves_high_but_plausible_miles_untouched() {
        let value = normalize_remaining_range_miles(Some(227.0), Some(71.0), Some(105_000.0));
        assert_eq!(value, Some(227.0));
    }
}

#[cfg(test)]
mod freshness_tests {
    use super::{derive_vehicle_status_freshness, LatestVehicleTelemetry, VehicleRuntimeStateRow};
    use chrono::{TimeZone, Utc};

    #[test]
    fn flags_ws_silence_as_stale() {
        let now = Utc.with_ymd_and_hms(2026, 6, 19, 12, 0, 0).unwrap();
        let runtime = VehicleRuntimeStateRow {
            last_ws_received_at: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 40, 0).unwrap()),
            worker_health: Some("connected".to_string()),
            ..Default::default()
        };

        let (worker_health, telemetry_stale, reason) = derive_vehicle_status_freshness(
            now,
            Some(&runtime),
            &LatestVehicleTelemetry::default(),
        );

        assert_eq!(worker_health.as_deref(), Some("stale"));
        assert!(telemetry_stale);
        assert_eq!(reason.as_deref(), Some("ws_silent"));
    }

    #[test]
    fn flags_old_battery_timestamp_even_when_worker_is_connected() {
        let now = Utc.with_ymd_and_hms(2026, 6, 19, 12, 0, 0).unwrap();
        let runtime = VehicleRuntimeStateRow {
            last_ws_received_at: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
            worker_health: Some("connected".to_string()),
            ..Default::default()
        };
        let latest = LatestVehicleTelemetry {
            ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
            battery_level: Some(71.0),
            battery_level_ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 10, 20, 0).unwrap()),
            ..Default::default()
        };

        let (_, telemetry_stale, reason) =
            derive_vehicle_status_freshness(now, Some(&runtime), &latest);

        assert!(telemetry_stale);
        assert_eq!(reason.as_deref(), Some("battery_stale"));
    }

    #[test]
    fn keeps_recent_runtime_as_healthy() {
        let now = Utc.with_ymd_and_hms(2026, 6, 19, 12, 0, 0).unwrap();
        let runtime = VehicleRuntimeStateRow {
            last_ws_received_at: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
            worker_health: Some("connected".to_string()),
            ..Default::default()
        };
        let latest = LatestVehicleTelemetry {
            ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
            battery_level: Some(71.0),
            battery_level_ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 58, 30).unwrap()),
            ..Default::default()
        };

        let (worker_health, telemetry_stale, reason) =
            derive_vehicle_status_freshness(now, Some(&runtime), &latest);

        assert_eq!(worker_health.as_deref(), Some("connected"));
        assert!(!telemetry_stale);
        assert_eq!(reason, None);
    }
}

#[cfg(test)]
mod availability_tests {
    use super::{
        classify_status_field_availability, max_seen_at, StatusFieldAvailabilityReasonCode,
        StatusFieldAvailabilityState,
    };
    use chrono::{TimeZone, Utc};

    #[test]
    fn marks_missing_field_as_never_seen() {
        let latest_event_at = Some(Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap());
        let availability = classify_status_field_availability(latest_event_at, None, None);

        assert!(!availability.ever_seen);
        assert_eq!(
            availability.availability,
            StatusFieldAvailabilityState::NeverSeen
        );
        assert_eq!(
            availability.reason_code,
            Some(StatusFieldAvailabilityReasonCode::NeverSeen)
        );
    }

    #[test]
    fn marks_field_as_historical_when_latest_event_is_newer() {
        let latest_event_at = Some(Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap());
        let last_seen_at = Some(Utc.with_ymd_and_hms(2026, 7, 7, 10, 30, 0).unwrap());
        let availability = classify_status_field_availability(latest_event_at, last_seen_at, None);

        assert!(availability.ever_seen);
        assert_eq!(availability.last_seen_at, last_seen_at);
        assert_eq!(
            availability.availability,
            StatusFieldAvailabilityState::Historical
        );
        assert_eq!(
            availability.reason_code,
            Some(StatusFieldAvailabilityReasonCode::MissingRecentPayload)
        );
    }

    #[test]
    fn keeps_latest_field_as_current() {
        let latest_event_at = Some(Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap());
        let availability =
            classify_status_field_availability(latest_event_at, latest_event_at, None);

        assert_eq!(
            availability.availability,
            StatusFieldAvailabilityState::Current
        );
        assert_eq!(availability.reason_code, None);
    }

    #[test]
    fn preserves_invalid_sensor_reason_for_current_and_historical_fields() {
        let latest_event_at = Some(Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap());
        let current = classify_status_field_availability(
            latest_event_at,
            latest_event_at,
            Some(StatusFieldAvailabilityReasonCode::InvalidSensor),
        );
        let historical = classify_status_field_availability(
            latest_event_at,
            Some(Utc.with_ymd_and_hms(2026, 7, 7, 11, 0, 0).unwrap()),
            Some(StatusFieldAvailabilityReasonCode::InvalidSensor),
        );

        assert_eq!(
            current.reason_code,
            Some(StatusFieldAvailabilityReasonCode::InvalidSensor)
        );
        assert_eq!(
            historical.reason_code,
            Some(StatusFieldAvailabilityReasonCode::InvalidSensor)
        );
    }

    #[test]
    fn returns_latest_seen_timestamp() {
        let a = Utc.with_ymd_and_hms(2026, 7, 7, 8, 0, 0).unwrap();
        let b = Utc.with_ymd_and_hms(2026, 7, 7, 10, 0, 0).unwrap();
        let c = Utc.with_ymd_and_hms(2026, 7, 7, 9, 0, 0).unwrap();

        assert_eq!(max_seen_at([Some(a), Some(b), Some(c)]), Some(b));
    }
}

async fn vehicle_images(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_access(&auth, vid)?;
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    Ok(Json(
        fetch_vehicle_images_json(&state.pool, &state.config, vid).await?,
    ))
}

async fn cache_vehicle_images(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
    tokens: &crate::ingestion::session_store::RivianTokenBundle,
) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default();
    mark_vehicle_artwork_repair_attempt(pool, vehicle_id).await;
    crate::services::external_connections::record_attempt(
        pool,
        crate::services::external_connections::RIVIAN_ACCOUNT,
    )
    .await;
    match crate::ingestion::rivian_auth::rivian_vehicle_images(&client, tokens).await {
        Ok(images) => {
            let image_count = images.len();
            for image in images {
                let _ = sqlx::query(
                    r#"
                    INSERT INTO riviamigo.vehicle_images
                      (vehicle_id, placement, design, size, resolution, url, overlays, metadata)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                    ON CONFLICT (vehicle_id, url) DO UPDATE
                    SET placement = EXCLUDED.placement,
                        design = EXCLUDED.design,
                        size = EXCLUDED.size,
                        resolution = EXCLUDED.resolution,
                        overlays = EXCLUDED.overlays,
                        metadata = EXCLUDED.metadata,
                        updated_at = now()
                    "#,
                )
                .bind(vehicle_id)
                .bind(image.placement.as_deref().unwrap_or("unknown"))
                .bind(image.design)
                .bind(image.size)
                .bind(image.resolution)
                .bind(&image.url)
                .bind(image.overlays)
                .bind(build_cached_vehicle_image_metadata(
                    &image.url,
                    serde_json::json!({
                    "source": image.source,
                    "vehicle_version": image.vehicle_version,
                    "rivian_vehicle_id": image.vehicle_id,
                    "rivian_order_id": image.order_id,
                    "extension": image.extension
                    }),
                ))
                .execute(pool)
                .await;
            }
            mirror_vehicle_images(pool, config, vehicle_id).await;
            refresh_vehicle_artwork_cache_state(pool, config, vehicle_id, None).await;
            crate::services::external_connections::record_success(
                pool,
                crate::services::external_connections::RIVIAN_ACCOUNT,
            )
            .await;
            info!(vehicle_id = %vehicle_id, image_count, "vehicle.images.cached");
        }
        Err(error) => {
            refresh_vehicle_artwork_cache_state(pool, config, vehicle_id, Some(&error.to_string()))
                .await;
            crate::services::external_connections::record_failure(
                pool,
                crate::services::external_connections::RIVIAN_ACCOUNT,
                &error.to_string(),
            )
            .await;
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.add.image_cache_failed");
        }
    }
}

async fn ensure_vehicle_images_cached(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
    age_key: &str,
    force_manifest_refresh: bool,
) {
    let rows = sqlx::query_as::<_, VehicleImageRow>(
        "SELECT placement, design, size, resolution, url, overlays, metadata
         FROM riviamigo.vehicle_images
         WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if !rows.is_empty() && !force_manifest_refresh {
        if rows
            .iter()
            .any(|row| vehicle_image_needs_local_mirror(config, row))
        {
            mark_vehicle_artwork_repair_attempt(pool, vehicle_id).await;
            mirror_vehicle_images(pool, config, vehicle_id).await;
            refresh_vehicle_artwork_cache_state(pool, config, vehicle_id, None).await;
        }
        return;
    }

    let identity = match age_key.parse::<age::x25519::Identity>() {
        Ok(identity) => identity,
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.backfill_bad_age_key");
            return;
        }
    };

    let encrypted_tokens = match sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT encrypted_tokens FROM riviamigo.vehicle_credentials WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await
    {
        Ok(Some(tokens)) => tokens,
        Ok(None) => return,
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.backfill_credentials_failed");
            return;
        }
    };

    match crate::ingestion::session_store::decrypt_tokens(&encrypted_tokens, &identity) {
        Ok(tokens) => cache_vehicle_images(pool, config, vehicle_id, &tokens).await,
        Err(error) => {
            refresh_vehicle_artwork_cache_state(
                pool,
                config,
                vehicle_id,
                Some("Stored Rivian session could not be used for artwork repair."),
            )
            .await;
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.backfill_decrypt_failed");
        }
    }
}

fn build_cached_vehicle_image_metadata(
    source_url: &str,
    base: serde_json::Value,
) -> serde_json::Value {
    // A stable first-party key lets the UI render a local restoring placeholder
    // even before an initial mirror has completed. Successful mirrors replace
    // it with a checksum-revisioned immutable key.
    let pending_key = format!(
        "{}.webp",
        hex::encode(Sha256::digest(source_url.as_bytes()))
    );
    merge_metadata(
        base,
        serde_json::json!({
            "source_url": source_url,
            "mirror_key": pending_key,
            "mirror_status": "pending"
        }),
    )
}

fn merge_metadata(mut left: serde_json::Value, right: serde_json::Value) -> serde_json::Value {
    if let (Some(left_obj), Some(right_obj)) = (left.as_object_mut(), right.as_object()) {
        for (key, value) in right_obj {
            left_obj.insert(key.clone(), value.clone());
        }
        left
    } else {
        right
    }
}

fn overlay_entries_from_value(value: &serde_json::Value) -> Vec<VehicleImageOverlay> {
    serde_json::from_value::<Vec<VehicleImageOverlay>>(value.clone()).unwrap_or_default()
}

fn image_cache_root(config: &crate::config::Config) -> PathBuf {
    PathBuf::from(&config.vehicle_image_cache_dir)
}

fn mirror_file_path(config: &crate::config::Config, relpath: &str) -> PathBuf {
    image_cache_root(config).join(relpath.replace('/', std::path::MAIN_SEPARATOR_STR))
}

fn sanitize_image_key(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
}

fn infer_extension(source_url: &str, content_type: Option<&str>) -> &'static str {
    let lowered = source_url.to_ascii_lowercase();
    for ext in ["webp", "png", "jpg", "jpeg", "gif"] {
        if lowered.contains(&format!(".{ext}")) {
            return ext;
        }
    }
    match content_type.unwrap_or_default() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        _ => "webp",
    }
}

fn guess_mime_type(path: &StdPath) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        _ => "image/webp",
    }
}

async fn download_and_store_asset(
    client: &reqwest::Client,
    config: &crate::config::Config,
    vehicle_id: Uuid,
    source_url: &str,
) -> Result<MirroredFileAsset, anyhow::Error> {
    let response = client.get(source_url).send().await?.error_for_status()?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let bytes = response.bytes().await?;
    let sha256 = hex::encode(Sha256::digest(&bytes));
    let extension = infer_extension(source_url, content_type.as_deref());
    let key_hash = hex::encode(Sha256::digest(source_url.as_bytes()));
    // Include the content revision so a deliberate administrator refresh gets a
    // new immutable first-party URL rather than serving an old browser cache.
    let mirror_key = format!("{key_hash}-{}.{extension}", &sha256[..16]);
    let mirror_relpath = format!("{vehicle_id}/{mirror_key}");
    let path = mirror_file_path(config, &mirror_relpath);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, &bytes).await?;
    Ok(MirroredFileAsset {
        mirror_key,
        mirror_relpath,
        mime_type: content_type.unwrap_or_else(|| guess_mime_type(&path).to_string()),
        sha256,
    })
}

async fn mirror_vehicle_image_assets(
    client: &reqwest::Client,
    config: &crate::config::Config,
    vehicle_id: Uuid,
    source_url: &str,
    overlays: &[VehicleImageOverlay],
) -> Result<serde_json::Value, anyhow::Error> {
    let mirrored = download_and_store_asset(client, config, vehicle_id, source_url).await?;
    let mut overlay_assets = Vec::with_capacity(overlays.len());
    for overlay in overlays {
        let mirrored_overlay =
            download_and_store_asset(client, config, vehicle_id, &overlay.url).await?;
        overlay_assets.push(MirroredOverlayAsset {
            source_url: overlay.url.clone(),
            mirror_key: mirrored_overlay.mirror_key,
            mirror_relpath: mirrored_overlay.mirror_relpath,
            mime_type: mirrored_overlay.mime_type,
            sha256: mirrored_overlay.sha256,
            overlay: overlay.overlay.clone(),
            z_index: overlay.z_index,
        });
    }

    Ok(serde_json::json!({
        "source_url": source_url,
        "mirror_status": "ready",
        "mirror_key": mirrored.mirror_key,
        "mirror_relpath": mirrored.mirror_relpath,
        "mime_type": mirrored.mime_type,
        "sha256": mirrored.sha256,
        "overlay_mirrors": overlay_assets
    }))
}

fn mirrored_asset_is_valid(config: &crate::config::Config, metadata: &serde_json::Value) -> bool {
    let Some(relpath) = metadata
        .get("mirror_relpath")
        .and_then(|value| value.as_str())
    else {
        return false;
    };
    let Some(expected_sha256) = metadata.get("sha256").and_then(|value| value.as_str()) else {
        return false;
    };
    let Ok(bytes) = std::fs::read(mirror_file_path(config, relpath)) else {
        return false;
    };
    hex::encode(Sha256::digest(&bytes)) == expected_sha256
}

fn vehicle_image_needs_local_mirror(config: &crate::config::Config, row: &VehicleImageRow) -> bool {
    if !row.url.starts_with("http://") && !row.url.starts_with("https://") {
        return false;
    }
    if row
        .metadata
        .get("mirror_status")
        .and_then(|value| value.as_str())
        != Some("ready")
    {
        return true;
    }
    if !mirrored_asset_is_valid(config, &row.metadata) {
        return true;
    }
    row.metadata
        .get("overlay_mirrors")
        .and_then(|value| value.as_array())
        .map(|overlays| {
            overlays
                .iter()
                .any(|overlay| !mirrored_asset_is_valid(config, overlay))
        })
        .unwrap_or_else(|| !overlay_entries_from_value(&row.overlays).is_empty())
}

async fn mirror_vehicle_images(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
) {
    let rows = match sqlx::query_as::<_, VehicleImageRow>(
        "SELECT placement, design, size, resolution, url, overlays, metadata
         FROM riviamigo.vehicle_images
         WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.mirror_rows_failed");
            return;
        }
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    for row in rows {
        if !vehicle_image_needs_local_mirror(config, &row) {
            continue;
        }
        let overlays = overlay_entries_from_value(&row.overlays);
        match mirror_vehicle_image_assets(&client, config, vehicle_id, &row.url, &overlays).await {
            Ok(mirror_metadata) => {
                let merged = merge_metadata(row.metadata.clone(), mirror_metadata);
                let _ = sqlx::query(
                    "UPDATE riviamigo.vehicle_images
                     SET metadata = $3,
                         updated_at = now()
                     WHERE vehicle_id = $1 AND url = $2",
                )
                .bind(vehicle_id)
                .bind(&row.url)
                .bind(merged)
                .execute(pool)
                .await;
            }
            Err(error) => {
                warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.mirror_failed");
                let merged = merge_metadata(
                    row.metadata.clone(),
                    serde_json::json!({
                        "source_url": row.url,
                        "mirror_status": "failed",
                        "mirror_error": error.to_string()
                    }),
                );
                let _ = sqlx::query(
                    "UPDATE riviamigo.vehicle_images
                     SET metadata = $3,
                         updated_at = now()
                     WHERE vehicle_id = $1 AND url = $2",
                )
                .bind(vehicle_id)
                .bind(&row.url)
                .bind(merged)
                .execute(pool)
                .await;
            }
        }
    }
}

fn metadata_has_local_mirror(config: &crate::config::Config, metadata: &serde_json::Value) -> bool {
    metadata
        .get("mirror_status")
        .and_then(|value| value.as_str())
        == Some("ready")
        && mirrored_asset_is_valid(config, metadata)
}

fn artwork_asset_counts(config: &crate::config::Config, rows: &[VehicleImageRow]) -> (i32, i32) {
    let mut total = 0;
    let mut ready = 0;
    for row in rows {
        if !row.url.starts_with("http://") && !row.url.starts_with("https://") {
            continue;
        }
        total += 1;
        if metadata_has_local_mirror(config, &row.metadata) {
            ready += 1;
        }
        for overlay in row
            .metadata
            .get("overlay_mirrors")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            total += 1;
            if mirrored_asset_is_valid(config, overlay) {
                ready += 1;
            }
        }
    }
    (total, ready)
}

async fn mark_vehicle_artwork_repair_attempt(pool: &sqlx::PgPool, vehicle_id: Uuid) {
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_artwork_cache_state
              (vehicle_id, status, attempts, last_repair_attempt_at, updated_at)
           VALUES ($1, 'repairing', 1, now(), now())
           ON CONFLICT (vehicle_id) DO UPDATE SET
             status = 'repairing', attempts = riviamigo.vehicle_artwork_cache_state.attempts + 1,
             last_repair_attempt_at = now(), last_error = NULL, updated_at = now()"#,
    )
    .bind(vehicle_id)
    .execute(pool)
    .await;
}

async fn refresh_vehicle_artwork_cache_state(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
    error: Option<&str>,
) {
    let rows = sqlx::query_as::<_, VehicleImageRow>(
        "SELECT placement, design, size, resolution, url, overlays, metadata
         FROM riviamigo.vehicle_images WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let (asset_count, ready_asset_count) = artwork_asset_counts(config, &rows);
    let ready = asset_count > 0 && asset_count == ready_asset_count;
    let status = if ready {
        "ready"
    } else if error.is_some() {
        "failed"
    } else {
        "pending"
    };
    let sanitized_error = error.map(|_| "Rivian artwork repair failed; retry is scheduled.");
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_artwork_cache_state
              (vehicle_id, status, asset_count, ready_asset_count, last_repair_success_at, last_error, updated_at)
           VALUES ($1, $2, $3, $4, CASE WHEN $2 = 'ready' THEN now() ELSE NULL END, $5, now())
           ON CONFLICT (vehicle_id) DO UPDATE SET
             status = EXCLUDED.status, asset_count = EXCLUDED.asset_count,
             ready_asset_count = EXCLUDED.ready_asset_count,
             last_repair_success_at = CASE WHEN EXCLUDED.status = 'ready' THEN now() ELSE riviamigo.vehicle_artwork_cache_state.last_repair_success_at END,
             last_error = EXCLUDED.last_error, updated_at = now()"#,
    )
    .bind(vehicle_id)
    .bind(status)
    .bind(asset_count)
    .bind(ready_asset_count)
    .bind(sanitized_error)
    .execute(pool)
    .await;
}

async fn vehicle_artwork_cache_state_json(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
) -> serde_json::Value {
    let state = sqlx::query_as::<_, VehicleArtworkCacheStateRow>(
        "SELECT status, asset_count, ready_asset_count, attempts, last_repair_attempt_at,
                last_repair_success_at, last_error
         FROM riviamigo.vehicle_artwork_cache_state WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    match state {
        Some(state) => serde_json::json!({
            "status": state.status,
            "asset_count": state.asset_count,
            "ready_asset_count": state.ready_asset_count,
            "attempts": state.attempts,
            "last_repair_attempt_at": state.last_repair_attempt_at,
            "last_repair_success_at": state.last_repair_success_at,
            "last_error": state.last_error,
        }),
        None => {
            serde_json::json!({ "status": "pending", "asset_count": 0, "ready_asset_count": 0 })
        }
    }
}

fn resolved_image_url(
    _config: &crate::config::Config,
    vehicle_id: Uuid,
    _original_url: &str,
    metadata: &serde_json::Value,
) -> Option<String> {
    if let Some(key) = metadata.get("mirror_key").and_then(|value| value.as_str()) {
        return Some(format!("/v1/vehicle-image-cache/{vehicle_id}/{key}"));
    }
    None
}

fn resolved_overlays(
    config: &crate::config::Config,
    vehicle_id: Uuid,
    row_overlays: &serde_json::Value,
    metadata: &serde_json::Value,
) -> serde_json::Value {
    let overlays = overlay_entries_from_value(row_overlays);
    let Some(mirrors) = metadata
        .get("overlay_mirrors")
        .and_then(|value| value.as_array())
    else {
        return serde_json::json!([]);
    };

    let overlays: Vec<_> = overlays
        .into_iter()
        .filter_map(|mut overlay| {
            let mirror = mirrors.iter().find(|entry| {
                entry.get("source_url").and_then(|value| value.as_str())
                    == Some(overlay.url.as_str())
            })?;
            if let Some(key) = mirror.get("mirror_key").and_then(|value| value.as_str()) {
                if metadata_has_local_mirror(config, mirror) {
                    overlay.url = format!("/v1/vehicle-image-cache/{vehicle_id}/{key}");
                    return Some(overlay);
                }
            }
            None
        })
        .collect();

    serde_json::to_value(overlays).unwrap_or_else(|_| serde_json::json!([]))
}

async fn find_mirrored_asset(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    image_key: &str,
) -> Result<Option<serde_json::Value>, AppError> {
    let metadatas = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT metadata FROM riviamigo.vehicle_images WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    for metadata in metadatas {
        if metadata.get("mirror_key").and_then(|value| value.as_str()) == Some(image_key) {
            return Ok(Some(metadata));
        }

        if let Some(mirrors) = metadata
            .get("overlay_mirrors")
            .and_then(|value| value.as_array())
        {
            if let Some(found) = mirrors.iter().find(|mirror| {
                mirror.get("mirror_key").and_then(|value| value.as_str()) == Some(image_key)
            }) {
                return Ok(Some(found.clone()));
            }
        }
    }

    Ok(None)
}

async fn fetch_vehicle_images_json(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
) -> Result<serde_json::Value, AppError> {
    let rows = sqlx::query_as::<_, VehicleImageRow>(
        r#"
        SELECT placement, design, size, resolution, url, overlays, metadata
        FROM riviamigo.vehicle_images
        WHERE vehicle_id = $1
        ORDER BY
          CASE WHEN size = 'large' THEN 0 ELSE 1 END,
          placement,
          design NULLS LAST,
                    created_at
                "#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let all: Vec<_> = rows
        .iter()
        .filter_map(|row| {
            let resolved_url = resolved_image_url(config, vehicle_id, &row.url, &row.metadata)?;
            let resolved_overlays =
                resolved_overlays(config, vehicle_id, &row.overlays, &row.metadata);
            Some(serde_json::json!({
                "placement": row.placement,
                "design": row.design,
                "size": row.size,
                "resolution": row.resolution,
                "url": resolved_url,
                "overlays": resolved_overlays,
                "metadata": row.metadata,
            }))
        })
        .collect();

    let best = |placement: &str, design: &str| {
        rows.iter()
            .find(|row| {
                normalize_image_placement(&row.placement) == placement
                    && normalize_image_design(row.design.as_deref()) == design
            })
            .or_else(|| {
                rows.iter()
                    .find(|row| normalize_image_placement(&row.placement) == placement)
            })
            .and_then(|row| resolved_image_url(config, vehicle_id, &row.url, &row.metadata))
    };

    Ok(serde_json::json!({
        "all": all,
        "cache": vehicle_artwork_cache_state_json(pool, vehicle_id).await,
        "side": {
            "dark": best("side", "dark"),
            "light": best("side", "light")
        },
        "overhead": {
            "dark": best("overhead", "dark"),
            "light": best("overhead", "light")
        },
        "front": {
            "dark": best("front", "dark"),
            "light": best("front", "light")
        },
        "rear": {
            "dark": best("rear", "dark"),
            "light": best("rear", "light")
        }
    }))
}

async fn vehicle_image_cache_asset(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vehicle_id, image_key)): Path<(Uuid, String)>,
) -> Result<Response, AppError> {
    if !sanitize_image_key(&image_key) {
        return Err(AppError::NotFound);
    }
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vehicle_id).await?;
    let Some(metadata) = find_mirrored_asset(&state.pool, vehicle_id, &image_key).await? else {
        return Ok(vehicle_artwork_placeholder_response());
    };

    let Some(relpath) = metadata
        .get("mirror_relpath")
        .and_then(|value| value.as_str())
    else {
        queue_vehicle_artwork_repair(&state, vehicle_id).await;
        return Ok(vehicle_artwork_restoring_response());
    };
    let mime_type = metadata
        .get("mime_type")
        .and_then(|value| value.as_str())
        .unwrap_or("application/octet-stream");
    let path = mirror_file_path(&state.config, relpath);
    let Ok(bytes) = tokio::fs::read(path).await else {
        queue_vehicle_artwork_repair(&state, vehicle_id).await;
        return Ok(vehicle_artwork_restoring_response());
    };
    let Some(expected_sha256) = metadata.get("sha256").and_then(|value| value.as_str()) else {
        return Ok(vehicle_artwork_placeholder_response());
    };
    if hex::encode(Sha256::digest(&bytes)) != expected_sha256 {
        queue_vehicle_artwork_repair(&state, vehicle_id).await;
        return Ok(vehicle_artwork_restoring_response());
    }

    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=31536000, immutable"),
    );
    Ok(response)
}

fn vehicle_artwork_placeholder_response() -> Response {
    // A compact, first-party neutral fallback for stale browser URLs while the
    // background worker repairs the persistent artwork cache.
    const PLACEHOLDER: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img" aria-label="Vehicle artwork unavailable"><rect width="320" height="180" fill="#1d2430"/><path d="M54 121h212l-16-39c-4-10-13-16-24-16H94c-11 0-20 6-24 16l-16 39Z" fill="#64748b"/><circle cx="94" cy="122" r="18" fill="#0f172a"/><circle cx="226" cy="122" r="18" fill="#0f172a"/></svg>"##;
    let mut response = Response::new(Body::from(PLACEHOLDER));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("image/svg+xml; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response
}

fn vehicle_artwork_restoring_response() -> Response {
    let mut response = vehicle_artwork_placeholder_response();
    *response.status_mut() = axum::http::StatusCode::ACCEPTED;
    response.headers_mut().insert(
        HeaderName::from_static("x-riviamigo-artwork-state"),
        HeaderValue::from_static("restoring"),
    );
    response
}

async fn admin_remirror_vehicle_images(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    require_remote_backed_vehicle(&state.pool, vehicle_id).await?;
    queue_vehicle_artwork_repair_with_mode(&state, vehicle_id, true).await;
    Ok(Json(
        serde_json::json!({ "ok": true, "queued": true, "vehicle_id": vehicle_id }),
    ))
}

async fn admin_purge_vehicle_artwork_cache(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    require_remote_backed_vehicle(&state.pool, vehicle_id).await?;
    let _ = tokio::fs::remove_dir_all(image_cache_root(&state.config).join(vehicle_id.to_string()))
        .await;
    sqlx::query(
        "UPDATE riviamigo.vehicle_images
         SET metadata = jsonb_set(metadata, '{mirror_status}', '\"pending\"'::jsonb, true), updated_at = now()
         WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .execute(&state.pool)
    .await?;
    refresh_vehicle_artwork_cache_state(&state.pool, &state.config, vehicle_id, None).await;
    Ok(Json(
        serde_json::json!({ "ok": true, "vehicle_id": vehicle_id }),
    ))
}

async fn vehicle_artwork_cache_complete(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
) -> bool {
    let rows = sqlx::query_as::<_, VehicleImageRow>(
        "SELECT placement, design, size, resolution, url, overlays, metadata
         FROM riviamigo.vehicle_images WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let (total, ready) = artwork_asset_counts(config, &rows);
    total > 0 && total == ready
}

async fn claim_vehicle_artwork_repair(pool: &sqlx::PgPool, vehicle_id: Uuid) -> bool {
    sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO riviamigo.vehicle_artwork_cache_state
              (vehicle_id, status, next_attempt_at, updated_at)
           VALUES ($1, 'pending', now(), now())
           ON CONFLICT (vehicle_id) DO UPDATE SET
             status = 'pending', next_attempt_at = now(), updated_at = now()
           WHERE riviamigo.vehicle_artwork_cache_state.status <> 'repairing'
              OR riviamigo.vehicle_artwork_cache_state.last_repair_attempt_at < now() - interval '5 minutes'
           RETURNING vehicle_id"#,
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .is_some()
}

async fn queue_vehicle_artwork_repair(state: &AppState, vehicle_id: Uuid) {
    queue_vehicle_artwork_repair_with_mode(state, vehicle_id, false).await;
}

async fn queue_vehicle_artwork_repair_with_mode(
    state: &AppState,
    vehicle_id: Uuid,
    force_manifest_refresh: bool,
) {
    let is_demo = sqlx::query_scalar::<_, String>(
        "SELECT rivian_vehicle_id FROM riviamigo.vehicles WHERE id=$1",
    )
    .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten()
    .is_some_and(|key| is_demo_vehicle_key(&key));
    if is_demo {
        return;
    }
    if !force_manifest_refresh
        && vehicle_artwork_cache_complete(&state.pool, &state.config, vehicle_id).await
    {
        return;
    }
    if !claim_vehicle_artwork_repair(&state.pool, vehicle_id).await {
        return;
    }
    let pool = state.pool.clone();
    let config = state.config.clone();
    let age_key = state.age_key.clone();
    tokio::spawn(async move {
        repair_vehicle_artwork(pool, config, age_key, vehicle_id, force_manifest_refresh).await;
    });
}

async fn repair_vehicle_artwork(
    pool: sqlx::PgPool,
    config: crate::config::Config,
    age_key: String,
    vehicle_id: Uuid,
    force_manifest_refresh: bool,
) {
    for attempt in 0..3 {
        ensure_vehicle_images_cached(&pool, &config, vehicle_id, &age_key, force_manifest_refresh)
            .await;
        if vehicle_artwork_cache_complete(&pool, &config, vehicle_id).await {
            refresh_vehicle_artwork_cache_state(&pool, &config, vehicle_id, None).await;
            return;
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_secs(5 * (attempt + 1))).await;
        }
    }
    refresh_vehicle_artwork_cache_state(
        &pool,
        &config,
        vehicle_id,
        Some("Artwork cache is incomplete."),
    )
    .await;
}

/// Starts a bounded repair pass after the API has loaded its encrypted vehicle
/// credentials. Browser requests only read local files; they never trigger this.
pub fn start_vehicle_artwork_repair_worker(
    pool: sqlx::PgPool,
    config: crate::config::Config,
    age_key: String,
) {
    tokio::spawn(async move {
        let vehicle_ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT v.id FROM riviamigo.vehicles v
             JOIN riviamigo.vehicle_credentials c ON c.vehicle_id = v.id
             WHERE v.rivian_vehicle_id NOT LIKE 'demo-%'",
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        for vehicle_id in vehicle_ids {
            if vehicle_artwork_cache_complete(&pool, &config, vehicle_id).await
                || !claim_vehicle_artwork_repair(&pool, vehicle_id).await
            {
                continue;
            }

            repair_vehicle_artwork(
                pool.clone(),
                config.clone(),
                age_key.clone(),
                vehicle_id,
                false,
            )
            .await;
        }
    });
}

fn normalize_image_placement(value: &str) -> &'static str {
    let normalized = value.to_lowercase();
    if normalized.contains("side") && !is_charging_side_value(value) {
        "side"
    } else if normalized.contains("overhead")
        || normalized.contains("top")
        || normalized.contains("bird")
    {
        "overhead"
    } else if normalized.contains("front") {
        "front"
    } else if normalized.contains("rear") || normalized.contains("back") {
        "rear"
    } else {
        "unknown"
    }
}

fn is_charging_side_value(value: &str) -> bool {
    let normalized = value.to_lowercase();
    normalized.contains("side")
        && (normalized.contains("charging") || normalized.contains("charge"))
}

fn normalize_image_design(value: Option<&str>) -> &'static str {
    let Some(value) = value else {
        return "unknown";
    };
    let normalized = value.to_lowercase();
    if normalized.contains("dark") {
        "dark"
    } else if normalized.contains("light") {
        "light"
    } else {
        "unknown"
    }
}

fn open_closures_json(closures: &[(&str, Option<bool>)]) -> serde_json::Value {
    let any_known = closures.iter().any(|(_, value)| value.is_some());
    if !any_known {
        return serde_json::Value::Null;
    }
    serde_json::Value::Array(
        closures
            .iter()
            .filter_map(|(label, value)| {
                if matches!(value, Some(false)) {
                    Some(serde_json::Value::String((*label).to_string()))
                } else {
                    None
                }
            })
            .collect(),
    )
}

const TELEMETRY_LANES: &[&str] = &[
    "battery", "drive", "location", "climate", "charging", "health",
];

const TELEMETRY_LANES_QUERY: &str = r#"
        SELECT date_bin(make_interval(secs => $4::double precision), t.ts, $2) AS bucket,
               AVG(t.latitude) AS latitude,
               AVG(t.longitude) AS longitude,
               AVG(t.altitude_m) AS altitude_m,
               AVG(t.speed_mph) AS speed_mph,
               AVG(t.battery_level) AS battery_level,
               AVG(t.battery_capacity_wh) AS battery_capacity_wh,
               AVG(t.distance_to_empty_mi) AS distance_to_empty_mi,
               AVG(t.battery_limit) AS battery_limit,
               AVG(t.time_to_end_of_charge_min)::double precision AS time_to_end_of_charge_min,
               AVG(t.cabin_temp_c) AS cabin_temp_c,
               AVG(t.driver_temp_c) AS driver_temp_c,
               AVG(t.outside_temp_c) AS outside_temp_c,
               AVG(t.power_kw) AS power_kw,
               AVG(t.regen_power_kw) AS regen_power_kw,
               AVG(t.heading_deg) AS heading_deg,
               AVG(t.odometer_miles) AS odometer_miles,
               AVG(t.tire_fl_psi) AS tire_fl_psi,
               AVG(t.tire_fr_psi) AS tire_fr_psi,
               AVG(t.tire_rl_psi) AS tire_rl_psi,
               AVG(t.tire_rr_psi) AS tire_rr_psi
        FROM timeseries.telemetry t
        WHERE t.vehicle_id = $1 AND t.ts >= $2 AND t.ts <= $3
        GROUP BY bucket
        ORDER BY bucket
        LIMIT $5
        "#;

async fn telemetry_lanes(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Query(params): Query<TelemetryLaneParams>,
) -> Result<Json<TelemetryLaneFrame>, AppError> {
    require_vehicle_access(&auth, vid)?;
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let requested_lanes = parse_telemetry_lanes(params.lanes.as_deref())?;
    let to = params.to.unwrap_or_else(chrono::Utc::now);
    let from = params
        .from
        .unwrap_or_else(|| to - chrono::Duration::hours(24));
    validate_raw_time_bounds(Some(from), Some(to))?;
    if to - from > chrono::Duration::days(90) {
        return Err(AppError::Validation(
            "telemetry lane windows cannot exceed 90 days".into(),
        ));
    }

    let max_points = params.max_points.unwrap_or(256).clamp(64, 512);
    let resolution_seconds =
        resolve_telemetry_resolution(params.resolution.as_deref(), from, to, max_points)?;
    let rows = sqlx::query_as::<_, TelemetryLaneRow>(TELEMETRY_LANES_QUERY)
        .bind(vid)
        .bind(from)
        .bind(to)
        .bind(resolution_seconds as f64)
        .bind(max_points)
        .fetch_all(&state.pool)
        .await?;

    let mut lanes = BTreeMap::new();
    for lane in requested_lanes {
        let data = match lane {
            "battery" => telemetry_lane(
                &rows,
                &[
                    ("battery_level", |row| row.battery_level),
                    ("battery_capacity_wh", |row| row.battery_capacity_wh),
                    ("distance_to_empty_mi", |row| row.distance_to_empty_mi),
                    ("battery_limit", |row| row.battery_limit),
                ],
            ),
            "drive" => telemetry_lane(
                &rows,
                &[
                    ("speed_mph", |row| row.speed_mph),
                    ("odometer_miles", |row| row.odometer_miles),
                    ("power_kw", |row| row.power_kw),
                    ("regen_power_kw", |row| row.regen_power_kw),
                ],
            ),
            "location" => telemetry_lane(
                &rows,
                &[
                    ("latitude", |row| row.latitude),
                    ("longitude", |row| row.longitude),
                    ("altitude_m", |row| row.altitude_m),
                    ("heading_deg", |row| row.heading_deg),
                ],
            ),
            "climate" => telemetry_lane(
                &rows,
                &[
                    ("cabin_temp_c", |row| row.cabin_temp_c),
                    ("driver_temp_c", |row| row.driver_temp_c),
                    ("outside_temp_c", |row| row.outside_temp_c),
                ],
            ),
            "charging" => telemetry_lane(
                &rows,
                &[
                    ("time_to_end_of_charge_min", |row| {
                        row.time_to_end_of_charge_min
                    }),
                    ("power_kw", |row| row.power_kw),
                    ("regen_power_kw", |row| row.regen_power_kw),
                ],
            ),
            "health" => telemetry_lane(
                &rows,
                &[
                    ("tire_fl_psi", |row| row.tire_fl_psi),
                    ("tire_fr_psi", |row| row.tire_fr_psi),
                    ("tire_rl_psi", |row| row.tire_rl_psi),
                    ("tire_rr_psi", |row| row.tire_rr_psi),
                ],
            ),
            _ => unreachable!("lane names are validated before querying"),
        };
        lanes.insert(lane.to_string(), data);
    }

    Ok(Json(TelemetryLaneFrame {
        vehicle_id: vid,
        window: TelemetryLaneWindow {
            from,
            to,
            resolution_seconds,
            approximate: resolution_seconds > 1,
        },
        spine: rows.iter().map(|row| row.bucket).collect(),
        lanes,
        truncated: rows.len() >= max_points as usize,
    }))
}

fn parse_telemetry_lanes(value: Option<&str>) -> Result<Vec<&'static str>, AppError> {
    let requested = value.unwrap_or("battery,drive");
    let mut lanes = Vec::new();
    for lane in requested
        .split(',')
        .map(str::trim)
        .filter(|lane| !lane.is_empty())
    {
        let Some(&known) = TELEMETRY_LANES.iter().find(|known| **known == lane) else {
            return Err(AppError::Validation(format!(
                "unknown telemetry lane: {lane}"
            )));
        };
        if !lanes.contains(&known) {
            lanes.push(known);
        }
    }
    if lanes.is_empty() || lanes.len() > 4 {
        return Err(AppError::Validation(
            "select between 1 and 4 telemetry lanes".into(),
        ));
    }
    Ok(lanes)
}

fn resolve_telemetry_resolution(
    value: Option<&str>,
    from: chrono::DateTime<chrono::Utc>,
    to: chrono::DateTime<chrono::Utc>,
    max_points: i64,
) -> Result<i64, AppError> {
    match value.unwrap_or("auto") {
        "auto" => Ok(
            ((to - from).num_seconds().max(1) as f64 / max_points as f64)
                .ceil()
                .max(1.0) as i64,
        ),
        "1m" => Ok(60),
        "5m" => Ok(300),
        "1h" => Ok(3600),
        other => Err(AppError::Validation(format!(
            "unsupported telemetry resolution: {other}"
        ))),
    }
}

type TelemetryLaneField = (&'static str, fn(&TelemetryLaneRow) -> Option<f64>);

fn telemetry_lane(rows: &[TelemetryLaneRow], fields: &[TelemetryLaneField]) -> TelemetryLane {
    let numeric = fields
        .iter()
        .map(|(name, value)| {
            (
                (*name).to_string(),
                rows.iter().map(value).collect::<Vec<Option<f64>>>(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let coverage = numeric
        .iter()
        .map(|(name, values)| {
            (
                name.clone(),
                values.iter().filter(|value| value.is_some()).count() as i64,
            )
        })
        .collect();
    TelemetryLane {
        numeric,
        coverage,
        source: "bucketed_normalized_telemetry",
    }
}

async fn raw_vehicle_data(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Query(params): Query<RawDataParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_access(&auth, vid)?;
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    validate_raw_time_bounds(params.from, params.to)?;
    let selected_fields = parse_raw_fields(params.fields.as_deref())?;
    let selected_fields_csv = selected_fields
        .iter()
        .map(|field| (*field).to_string())
        .collect::<Vec<_>>();
    let per_page = params.per_page.or(params.limit).unwrap_or(25).clamp(1, 200);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1).saturating_mul(per_page);
    let search = params
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let where_clause =
        raw_telemetry_where_clause(&selected_fields, params.populated_only.unwrap_or(false));

    let samples = sqlx::query_as::<_, RawVehicleSampleRow>(
        sqlx::AssertSqlSafe(format!(r#"
        SELECT ts, latitude, longitude, altitude_m, speed_mph,
               battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit,
               power_state, charger_state, charger_status, time_to_end_of_charge_min,
               drive_mode, gear_status, cabin_temp_c, driver_temp_c, outside_temp_c,
               hvac_active, power_kw, regen_power_kw, heading_deg, odometer_miles,
               tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
               tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status,
               tire_fl_valid, tire_fr_valid, tire_rl_valid, tire_rr_valid,
               door_front_left_locked, door_front_right_locked, door_rear_left_locked, door_rear_right_locked,
               door_front_left_closed, door_front_right_closed, door_rear_left_closed, door_rear_right_closed,
               closure_frunk_closed, closure_liftgate_closed, closure_tailgate_closed,
               ota_current_version, ota_available_version, ota_status, ota_current_status,
               hv_thermal_event, twelve_volt_health, is_online
        FROM timeseries.telemetry t
        WHERE {where_clause}
        ORDER BY t.ts DESC
        LIMIT $5 OFFSET $6
        "#))
    )
    .bind(vid)
    .bind(params.from)
    .bind(params.to)
    .bind(search)
    .bind(per_page)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    let coverage = sqlx::query_as::<_, RawVehicleCoverageRow>(sqlx::AssertSqlSafe(format!(
        r#"
        SELECT min(ts) AS first_event_at,
               max(ts) AS last_event_at,
               count(*) AS sample_count,
               count(odometer_miles) AS odometer_samples,
               count(battery_level) AS battery_samples,
               count(distance_to_empty_mi) AS range_samples,
               count(outside_temp_c) AS outside_temp_samples,
               count(power_kw) AS power_samples,
               count(regen_power_kw) AS regen_samples,
               greatest(count(tire_fl_psi), count(tire_fl_status)) AS tire_pressure_samples,
               count(door_front_left_locked) AS lock_samples,
               count(ota_status) AS software_samples
        FROM timeseries.telemetry t
        WHERE {where_clause}
        "#
    )))
    .bind(vid)
    .bind(params.from)
    .bind(params.to)
    .bind(search)
    .fetch_one(&state.pool)
    .await?;

    let total: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*)::BIGINT FROM timeseries.telemetry t WHERE {where_clause}",
    )))
    .bind(vid)
    .bind(params.from)
    .bind(params.to)
    .bind(search)
    .fetch_one(&state.pool)
    .await?;

    let field_coverage = sqlx::query_as::<_, RawTelemetryFieldCoverageRow>(sqlx::AssertSqlSafe(
        raw_field_coverage_query(&where_clause),
    ))
    .bind(vid)
    .bind(params.from)
    .bind(params.to)
    .bind(search)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "vehicle_id": vid,
        "coverage": {
            "first_event_at": coverage.first_event_at,
            "last_event_at": coverage.last_event_at,
            "sample_count": coverage.sample_count,
            "odometer_samples": coverage.odometer_samples,
            "battery_samples": coverage.battery_samples,
            "range_samples": coverage.range_samples,
            "outside_temp_samples": coverage.outside_temp_samples,
            "power_samples": coverage.power_samples,
            "regen_samples": coverage.regen_samples,
            "tire_pressure_samples": coverage.tire_pressure_samples,
            "lock_samples": coverage.lock_samples,
            "software_samples": coverage.software_samples
        },
        "samples": samples.into_iter().map(raw_sample_json).collect::<Vec<_>>(),
        "total": total,
        "limit": per_page,
        "offset": offset,
        "page": page,
        "per_page": per_page,
        "selected_fields": selected_fields_csv,
        "field_coverage": field_coverage
    })))
}

async fn raw_vehicle_events(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Query(params): Query<RawEventParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_raw_event_access(&state, &auth, vid).await?;
    validate_raw_time_bounds(params.from, params.to)?;
    let per_page = params.per_page.unwrap_or(25).clamp(1, 100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1).saturating_mul(per_page);
    let event_type = params
        .event_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let message_type = params
        .message_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let items = sqlx::query_as::<_, RawEventSummaryRow>(
        r#"
        SELECT id, received_at, event_type, message_type,
               payload_json IS NOT NULL AS has_json,
               (payload_json IS NOT NULL OR payload_text IS NOT NULL) AS has_payload
        FROM riviamigo.rivian_ws_raw_events
        WHERE vehicle_id = $1
          AND ($2::timestamptz IS NULL OR received_at >= $2)
          AND ($3::timestamptz IS NULL OR received_at <= $3)
          AND ($4::text IS NULL OR event_type = $4)
          AND ($5::text IS NULL OR message_type = $5)
        ORDER BY received_at DESC
        LIMIT $6 OFFSET $7
        "#,
    )
    .bind(vid)
    .bind(params.from)
    .bind(params.to)
    .bind(event_type)
    .bind(message_type)
    .bind(per_page)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    let total: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)::BIGINT
        FROM riviamigo.rivian_ws_raw_events
        WHERE vehicle_id = $1
          AND ($2::timestamptz IS NULL OR received_at >= $2)
          AND ($3::timestamptz IS NULL OR received_at <= $3)
          AND ($4::text IS NULL OR event_type = $4)
          AND ($5::text IS NULL OR message_type = $5)
        "#,
    )
    .bind(vid)
    .bind(params.from)
    .bind(params.to)
    .bind(event_type)
    .bind(message_type)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "vehicle_id": vid,
        "retention_days": state.config.rivian_raw_event_retention_days.max(1),
        "items": items.into_iter().map(raw_event_summary_json).collect::<Vec<_>>(),
        "total": total,
        "page": page,
        "per_page": per_page
    })))
}

async fn raw_vehicle_event(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path((vid, event_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_raw_event_access(&state, &auth, vid).await?;
    let row = sqlx::query_as::<_, RawEventDetailRow>(
        r#"
        SELECT id, received_at, event_type, message_type, payload_json, payload_text
        FROM riviamigo.rivian_ws_raw_events
        WHERE id = $1 AND vehicle_id = $2
        "#,
    )
    .bind(event_id)
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let (payload, payload_format) = match (row.payload_json, row.payload_text) {
        (Some(payload), _) => (payload, "json"),
        (None, Some(payload)) => (serde_json::Value::String(payload), "text"),
        (None, None) => (serde_json::Value::Null, "empty"),
    };
    Ok(Json(serde_json::json!({
        "id": row.id,
        "received_at": row.received_at,
        "event_type": row.event_type,
        "message_type": row.message_type,
        "has_json": payload_format == "json",
        "has_payload": payload_format != "empty",
        "payload": payload,
        "payload_format": payload_format
    })))
}

async fn require_raw_event_access(
    state: &AppState,
    auth: &AuthUser,
    vehicle_id: Uuid,
) -> Result<(), AppError> {
    if auth.api_access_level.is_some() {
        return Err(AppError::Forbidden);
    }
    require_vehicle_role(&state.pool, auth.user_id, vehicle_id, &["owner", "manager"]).await
}

fn validate_raw_time_bounds(
    from: Option<chrono::DateTime<chrono::Utc>>,
    to: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<(), AppError> {
    if from.zip(to).is_some_and(|(from, to)| from > to) {
        return Err(AppError::Validation("from must be before to".into()));
    }
    Ok(())
}

fn parse_raw_fields(fields: Option<&str>) -> Result<Vec<&'static str>, AppError> {
    let Some(fields) = fields.map(str::trim).filter(|fields| !fields.is_empty()) else {
        return Ok(Vec::new());
    };
    let mut selected = Vec::new();
    for field in fields
        .split(',')
        .map(str::trim)
        .filter(|field| !field.is_empty())
    {
        let Some(&known) = RAW_TELEMETRY_FIELDS.iter().find(|known| **known == field) else {
            return Err(AppError::Validation(format!(
                "unknown telemetry field: {field}"
            )));
        };
        if !selected.contains(&known) {
            selected.push(known);
        }
    }
    Ok(selected)
}

fn raw_telemetry_where_clause(selected_fields: &[&str], populated_only: bool) -> String {
    let mut clauses = vec![
        "t.vehicle_id = $1".to_string(),
        "($2::timestamptz IS NULL OR t.ts >= $2)".to_string(),
        "($3::timestamptz IS NULL OR t.ts <= $3)".to_string(),
        "($4::text IS NULL OR to_jsonb(t)::text ILIKE '%' || $4 || '%')".to_string(),
    ];
    let fields = if selected_fields.is_empty() {
        RAW_TELEMETRY_FIELDS
    } else {
        selected_fields
    };
    if populated_only || !selected_fields.is_empty() {
        clauses.push(format!(
            "({})",
            fields
                .iter()
                .map(|field| format!("t.{field} IS NOT NULL"))
                .collect::<Vec<_>>()
                .join(" OR "),
        ));
    }
    clauses.join(" AND ")
}

fn raw_field_coverage_query(where_clause: &str) -> String {
    let field_names = RAW_TELEMETRY_FIELDS
        .iter()
        .map(|field| format!("'{field}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let field_counts = RAW_TELEMETRY_FIELDS
        .iter()
        .map(|field| format!("COUNT(t.{field})"))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "SELECT unnest(ARRAY[{field_names}]::text[]) AS field, \
                unnest(ARRAY[{field_counts}]::bigint[]) AS sample_count \
         FROM timeseries.telemetry t WHERE {where_clause}"
    )
}

fn raw_sample_json(r: RawVehicleSampleRow) -> serde_json::Value {
    serde_json::json!({
        "ts": r.ts,
        "latitude": r.latitude,
        "longitude": r.longitude,
        "altitude_m": r.altitude_m,
        "speed_mph": r.speed_mph,
        "battery_level": r.battery_level,
        "battery_capacity_wh": r.battery_capacity_wh,
        "distance_to_empty_mi": r.distance_to_empty_mi,
        "battery_limit": r.battery_limit,
        "power_state": r.power_state,
        "charger_state": r.charger_state,
        "charger_status": r.charger_status,
        "time_to_end_of_charge_min": r.time_to_end_of_charge_min,
        "drive_mode": r.drive_mode,
        "gear_status": r.gear_status,
        "cabin_temp_c": r.cabin_temp_c,
        "driver_temp_c": r.driver_temp_c,
        "outside_temp_c": r.outside_temp_c,
        "hvac_active": r.hvac_active,
        "power_kw": r.power_kw,
        "regen_power_kw": r.regen_power_kw,
        "heading_deg": r.heading_deg,
        "odometer_miles": r.odometer_miles,
        "tire_fl_psi": r.tire_fl_psi,
        "tire_fr_psi": r.tire_fr_psi,
        "tire_rl_psi": r.tire_rl_psi,
        "tire_rr_psi": r.tire_rr_psi,
        "tire_fl_status": r.tire_fl_status,
        "tire_fr_status": r.tire_fr_status,
        "tire_rl_status": r.tire_rl_status,
        "tire_rr_status": r.tire_rr_status,
        "tire_fl_valid": r.tire_fl_valid,
        "tire_fr_valid": r.tire_fr_valid,
        "tire_rl_valid": r.tire_rl_valid,
        "tire_rr_valid": r.tire_rr_valid,
        "door_front_left_locked": r.door_front_left_locked,
        "door_front_right_locked": r.door_front_right_locked,
        "door_rear_left_locked": r.door_rear_left_locked,
        "door_rear_right_locked": r.door_rear_right_locked,
        "door_front_left_closed": r.door_front_left_closed,
        "door_front_right_closed": r.door_front_right_closed,
        "door_rear_left_closed": r.door_rear_left_closed,
        "door_rear_right_closed": r.door_rear_right_closed,
        "closure_frunk_closed": r.closure_frunk_closed,
        "closure_liftgate_closed": r.closure_liftgate_closed,
        "closure_tailgate_closed": r.closure_tailgate_closed,
        "ota_current_version": r.ota_current_version,
        "ota_available_version": r.ota_available_version,
        "ota_status": r.ota_status,
        "ota_current_status": r.ota_current_status,
        "hv_thermal_event": r.hv_thermal_event,
        "twelve_volt_health": r.twelve_volt_health,
        "is_online": r.is_online
    })
}

fn raw_event_summary_json(row: RawEventSummaryRow) -> serde_json::Value {
    serde_json::json!({
        "id": row.id,
        "received_at": row.received_at,
        "event_type": row.event_type,
        "message_type": row.message_type,
        "has_json": row.has_json,
        "has_payload": row.has_payload
    })
}

#[cfg(test)]
mod tests {
    use super::{
        connect_otp, load_encrypted_redis, map_rivian_login_error, map_rivian_otp_error,
        parse_raw_fields, parse_telemetry_lanes, raw_field_coverage_query,
        raw_telemetry_where_clause, resolve_telemetry_resolution, store_encrypted_redis,
        validate_raw_time_bounds, OtpBody, PendingOtpChallenge, RAW_TELEMETRY_FIELDS,
        TELEMETRY_LANES_QUERY,
    };
    use axum::body::Body;
    use axum::extract::State;
    use axum::Json;
    use http::{Request, StatusCode};
    use tower::ServiceExt;
    use uuid::Uuid;

    #[test]
    fn maps_rejected_rivian_credentials_to_an_actionable_error() {
        assert!(matches!(
            map_rivian_login_error(
                crate::ingestion::rivian_auth::RivianAuthError::InvalidCredentials
            ),
            crate::errors::AppError::RivianCredentialsRejected
        ));
    }

    #[test]
    fn maps_rejected_rivian_otp_to_an_actionable_error() {
        assert!(matches!(
            map_rivian_otp_error(crate::ingestion::rivian_auth::RivianAuthError::InvalidOtp),
            crate::errors::AppError::RivianOtpRejected
        ));
    }

    // Run with: cargo test -- --ignored

    fn make_helper_state(redis_url: String) -> crate::middleware::auth::AppState {
        use std::sync::Arc;

        use crate::middleware::auth::{AppState, JwtKeys};

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy("postgresql://riviamigo:devpassword@127.0.0.1:5432/riviamigo")
            .expect("lazy pool");
        let redis = redis::Client::open(redis_url.clone()).expect("redis client");

        let generated = crate::keys::generate_keys().expect("keys");
        let jwt_keys = Arc::new(
            JwtKeys::new(&generated.jwt_private_pem, &generated.jwt_public_pem).expect("jwt keys"),
        );

        let config = crate::config::Config {
            database_url: "postgresql://riviamigo:devpassword@127.0.0.1:5432/riviamigo".into(),
            redis_url,
            jwt_secret: None,
            jwt_public_key: None,
            age_encryption_key: None,
            port: 3001,
            allowed_origins: vec!["http://localhost:3000".into()],
            s3_endpoint: None,
            s3_access_key: None,
            s3_secret_key: None,
            backup_artifact_dir: std::env::temp_dir()
                .join("riviamigo-route-test-backups")
                .to_string_lossy()
                .into_owned(),
            vehicle_image_cache_dir: std::env::temp_dir()
                .join("riviamigo-route-test-vehicle-images")
                .to_string_lossy()
                .into_owned(),
            backup_driver: "pg_dump".into(),
            backup_poll_interval_seconds: 60,
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: true,
            rivian_parallax_capture_enabled: true,
            rivian_suppress_duplicate_telemetry: true,
            riviamigo_env: None,
            cookie_insecure: None,
            rate_limit: crate::config::RateLimitConfig::default(),
        };

        AppState {
            pool,
            redis,
            jwt_keys,
            age_key: generated.age_key,
            config,
            nominatim_cache: std::sync::Arc::new(tokio::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
            supervisor: crate::ingestion::supervisor::SupervisorHandle::noop(),
        }
    }

    async fn make_app() -> axum::Router {
        use crate::middleware::auth::{AppState, JwtKeys};
        use std::sync::Arc;

        let database_url =
            std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");
        let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".into());

        let pool = crate::db::pool::create_pool(&database_url)
            .await
            .expect("create_pool");
        let redis = redis::Client::open(redis_url).expect("redis client");

        let keys = crate::keys::generate_keys().expect("generate test keys");
        let jwt_keys =
            Arc::new(JwtKeys::new(&keys.jwt_private_pem, &keys.jwt_public_pem).expect("jwt keys"));

        let config = crate::config::Config {
            database_url: database_url.clone(),
            redis_url: "redis://127.0.0.1/".into(),
            jwt_secret: None,
            jwt_public_key: None,
            age_encryption_key: None,
            port: 3001,
            allowed_origins: vec!["http://localhost:3000".into()],
            s3_endpoint: None,
            s3_access_key: None,
            s3_secret_key: None,
            backup_artifact_dir: std::env::temp_dir()
                .join("riviamigo-route-test-backups")
                .to_string_lossy()
                .into_owned(),
            vehicle_image_cache_dir: std::env::temp_dir()
                .join("riviamigo-route-test-vehicle-images")
                .to_string_lossy()
                .into_owned(),
            backup_driver: "pg_dump".into(),
            backup_poll_interval_seconds: 60,
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: true,
            rivian_parallax_capture_enabled: true,
            rivian_suppress_duplicate_telemetry: true,
            riviamigo_env: None,
            cookie_insecure: None,
            rate_limit: crate::config::RateLimitConfig::default(),
        };

        let state = AppState {
            pool,
            redis,
            jwt_keys,
            age_key: "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"
                .to_string(),
            config,
            nominatim_cache: std::sync::Arc::new(tokio::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
            supervisor: crate::ingestion::supervisor::SupervisorHandle::noop(),
        };

        crate::routes::build_router(state)
    }

    async fn get_status(app: axum::Router, uri: &str) -> http::StatusCode {
        let req = Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        app.oneshot(req).await.unwrap().status()
    }

    async fn post_status(
        app: axum::Router,
        uri: &str,
        body: serde_json::Value,
    ) -> http::StatusCode {
        let req = Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        app.oneshot(req).await.unwrap().status()
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn list_vehicles_requires_auth() {
        let app = make_app().await;
        assert_eq!(
            get_status(app, "/v1/vehicles").await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn add_vehicle_requires_auth() {
        let app = make_app().await;
        let status = post_status(
            app,
            "/v1/vehicles",
            serde_json::json!({"rivian_vehicle_id": "test"}),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn demo_vehicle_requires_auth() {
        let app = make_app().await;
        let status = post_status(app, "/v1/vehicles/demo", serde_json::json!({})).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn refresh_demo_vehicle_requires_auth() {
        let app = make_app().await;
        let status = post_status(
            app,
            &format!("/v1/vehicles/{}/demo/refresh", Uuid::new_v4()),
            serde_json::json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn demo_vehicle_keys_are_detected_explicitly() {
        assert!(super::is_demo_vehicle_key("demo-r1t-local"));
        assert!(super::is_demo_vehicle_key("demo-r2s-local"));
        assert!(!super::is_demo_vehicle_key("rivian-1234"));
    }

    #[test]
    fn raw_telemetry_rejects_unknown_field_filters() {
        assert!(parse_raw_fields(Some("battery_level,not_a_telemetry_field")).is_err());
    }

    #[test]
    fn raw_telemetry_selected_fields_are_bounded_to_known_columns() {
        let fields = parse_raw_fields(Some("battery_level,tire_fl_psi,battery_level"))
            .expect("known fields should parse");
        assert_eq!(fields, vec!["battery_level", "tire_fl_psi"]);

        let clause = raw_telemetry_where_clause(&fields, false);
        assert!(clause.contains("t.battery_level IS NOT NULL OR t.tire_fl_psi IS NOT NULL"));
        assert!(clause.contains("to_jsonb(t)::text ILIKE"));
    }

    #[test]
    fn raw_telemetry_field_coverage_uses_typed_rows_not_wide_json() {
        let query = raw_field_coverage_query("t.vehicle_id = $1");

        assert_eq!(RAW_TELEMETRY_FIELDS.len(), 52);
        assert!(query.contains("unnest(ARRAY["));
        assert!(query.contains("AS field"));
        assert!(query.contains("AS sample_count"));
        assert!(!query.contains("jsonb_build_object"));
    }

    #[test]
    fn telemetry_lane_queries_are_bounded_and_allowlisted() {
        let lanes = parse_telemetry_lanes(Some("battery,drive,battery")).expect("known lanes");
        assert_eq!(lanes, vec!["battery", "drive"]);
        assert!(parse_telemetry_lanes(Some("raw_payload")).is_err());

        let from = "2026-07-14T00:00:00Z".parse().expect("valid timestamp");
        let to = "2026-07-14T01:00:00Z".parse().expect("valid timestamp");
        assert_eq!(
            resolve_telemetry_resolution(Some("5m"), from, to, 256).unwrap(),
            300
        );
    }

    #[test]
    fn telemetry_lane_runtime_query_aliases_every_row_field() {
        for field in [
            "latitude",
            "longitude",
            "altitude_m",
            "speed_mph",
            "battery_level",
            "battery_capacity_wh",
            "distance_to_empty_mi",
            "battery_limit",
            "time_to_end_of_charge_min",
            "cabin_temp_c",
            "driver_temp_c",
            "outside_temp_c",
            "power_kw",
            "regen_power_kw",
            "heading_deg",
            "odometer_miles",
            "tire_fl_psi",
            "tire_fr_psi",
            "tire_rl_psi",
            "tire_rr_psi",
        ] {
            assert!(
                TELEMETRY_LANES_QUERY.contains(&format!("AS {field}")),
                "telemetry lane query must alias {field}"
            );
        }
    }

    #[test]
    fn raw_telemetry_rejects_inverted_time_bounds() {
        let from = "2026-07-14T00:00:00Z".parse().expect("valid timestamp");
        let to = "2026-07-13T00:00:00Z".parse().expect("valid timestamp");
        assert!(validate_raw_time_bounds(Some(from), Some(to)).is_err());
    }

    #[test]
    fn resolved_image_url_keeps_a_first_party_path_when_local_file_is_missing() {
        let config = crate::config::Config {
            database_url: "postgres://localhost/test".into(),
            redis_url: "redis://localhost".into(),
            jwt_secret: None,
            jwt_public_key: None,
            age_encryption_key: None,
            port: 3001,
            allowed_origins: vec![],
            s3_endpoint: None,
            s3_access_key: None,
            s3_secret_key: None,
            backup_artifact_dir: std::env::temp_dir()
                .join("riviamigo-test-backups")
                .to_string_lossy()
                .into_owned(),
            vehicle_image_cache_dir: std::env::temp_dir()
                .join("riviamigo-test-missing-mirror")
                .to_string_lossy()
                .into_owned(),
            backup_driver: "pg_dump".into(),
            backup_poll_interval_seconds: 60,
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: true,
            rivian_parallax_capture_enabled: true,
            rivian_suppress_duplicate_telemetry: true,
            riviamigo_env: None,
            cookie_insecure: None,
            rate_limit: crate::config::RateLimitConfig::default(),
        };
        let metadata = serde_json::json!({
            "mirror_status": "ready",
            "mirror_key": "abc.webp",
            "mirror_relpath": "vehicle/abc.webp"
        });

        let url = super::resolved_image_url(
            &config,
            uuid::Uuid::nil(),
            "https://rivian.com/mobile/static/img/example.webp",
            &metadata,
        );

        assert_eq!(
            url,
            Some("/v1/vehicle-image-cache/00000000-0000-0000-0000-000000000000/abc.webp".into())
        );
    }

    #[tokio::test]
    async fn resolved_image_url_keeps_a_first_party_path_for_a_corrupt_local_file() {
        use sha2::{Digest, Sha256};

        let vehicle_id = Uuid::new_v4();
        let mut config = make_helper_state("redis://127.0.0.1/".into()).config;
        config.vehicle_image_cache_dir = std::env::temp_dir()
            .join(format!("riviamigo-artwork-checksum-{vehicle_id}"))
            .to_string_lossy()
            .into_owned();
        let relpath = format!("{vehicle_id}/artwork.webp");
        let path = super::mirror_file_path(&config, &relpath);
        std::fs::create_dir_all(path.parent().expect("cache parent")).expect("cache directory");
        std::fs::write(&path, b"valid-artwork").expect("cache asset");
        let metadata = serde_json::json!({
            "mirror_status": "ready",
            "mirror_key": "artwork.webp",
            "mirror_relpath": relpath,
            "sha256": hex::encode(Sha256::digest(b"valid-artwork"))
        });

        assert_eq!(
            super::resolved_image_url(
                &config,
                vehicle_id,
                "https://rivian.com/artwork.webp",
                &metadata
            ),
            Some(format!("/v1/vehicle-image-cache/{vehicle_id}/artwork.webp"))
        );

        std::fs::write(&path, b"corrupt-artwork").expect("corrupt cache asset");
        assert_eq!(
            super::resolved_image_url(
                &config,
                vehicle_id,
                "https://rivian.com/artwork.webp",
                &metadata
            ),
            Some(format!("/v1/vehicle-image-cache/{vehicle_id}/artwork.webp"))
        );
        let _ = std::fs::remove_dir_all(&config.vehicle_image_cache_dir);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn vehicle_status_requires_auth() {
        let app = make_app().await;
        let status = get_status(
            app,
            &format!("/v1/vehicles/{}/status", uuid::Uuid::new_v4()),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn connect_requires_auth() {
        let app = make_app().await;
        let status = post_status(
            app,
            "/v1/vehicles/connect",
            serde_json::json!({"email": "a@b.com", "password": "x"}),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires REDIS_URL"]
    async fn encrypted_redis_round_trips_connect_tokens_without_plaintext_storage() {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/".into());
        let state = make_helper_state(redis_url);
        let mut conn = state
            .redis
            .get_multiplexed_async_connection()
            .await
            .expect("redis connection");
        let key = format!("test:rivian:connect:{}", Uuid::new_v4());
        let tokens = crate::ingestion::session_store::RivianTokenBundle {
            access_token: "access-token".into(),
            refresh_token: "refresh-token".into(),
            app_session_token: "app-session-token".into(),
            user_session_token: "user-session-token".into(),
            csrf_token: "csrf-token".into(),
            created_at: chrono::Utc::now(),
        };

        store_encrypted_redis(&state, &mut conn, &key, &tokens, 60)
            .await
            .expect("store encrypted connect session");

        let raw: Vec<u8> = redis::AsyncCommands::get(&mut conn, &key)
            .await
            .expect("redis get ciphertext");
        assert_ne!(raw, serde_json::to_vec(&tokens).expect("plain json"));

        let round_trip =
            load_encrypted_redis::<crate::ingestion::session_store::RivianTokenBundle>(
                &state, &mut conn, &key,
            )
            .await
            .expect("load encrypted connect session")
            .expect("stored connect session");

        assert_eq!(round_trip.access_token, tokens.access_token);
        assert_eq!(round_trip.refresh_token, tokens.refresh_token);
        assert_eq!(round_trip.app_session_token, tokens.app_session_token);
        assert_eq!(round_trip.user_session_token, tokens.user_session_token);
        assert_eq!(round_trip.csrf_token, tokens.csrf_token);

        let _: () = redis::AsyncCommands::del(&mut conn, &key)
            .await
            .expect("cleanup redis key");
    }

    #[tokio::test]
    #[ignore = "requires REDIS_URL"]
    async fn connect_otp_rejects_challenges_staged_for_other_users() {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/".into());
        let state = make_helper_state(redis_url);
        let owner_id = Uuid::new_v4();
        let other_user_id = Uuid::new_v4();
        let challenge_id = Uuid::new_v4().to_string();
        let key = format!("rivian:otp:{challenge_id}");
        let pending = PendingOtpChallenge {
            email: "driver@example.com".into(),
            otp_token: "otp-token".into(),
            csrf_token: "csrf-token".into(),
            app_session_token: "app-session-token".into(),
            user_id: owner_id,
        };

        let mut conn = state
            .redis
            .get_multiplexed_async_connection()
            .await
            .expect("redis connection");
        store_encrypted_redis(&state, &mut conn, &key, &pending, 60)
            .await
            .expect("store encrypted otp challenge");
        drop(conn);

        let result = connect_otp(
            State(state.clone()),
            crate::middleware::auth::AuthUser {
                user_id: other_user_id,
                default_vehicle_id: None,
                api_access_level: None,
                api_vehicle_id: None,
            },
            Json(OtpBody {
                challenge_id: challenge_id.clone(),
                otp_code: "123456".into(),
            }),
        )
        .await;

        assert!(matches!(
            result,
            Err(crate::errors::AppError::RivianConnectSessionExpired)
        ));

        let mut conn = state
            .redis
            .get_multiplexed_async_connection()
            .await
            .expect("redis connection");
        let _: () = redis::AsyncCommands::del(&mut conn, &key)
            .await
            .expect("cleanup redis key");
    }
}
