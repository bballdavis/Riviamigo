use axum::{
    extract::{Query, State},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

use crate::{
    errors::AppError,
    ingestion::rivian_auth::RivianVehicleSummary,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/vehicles/connect", post(connect))
        .route("/vehicles/connect/otp", post(connect_otp))
        .route("/vehicles", post(add_vehicle).get(list_vehicles))
        .route("/vehicles/:id", delete(delete_vehicle))
        .route("/vehicles/:id/credentials", put(refresh_vehicle_credentials))
        .route("/vehicles/:id/status", get(vehicle_status))
        .route("/vehicles/:id/images", get(vehicle_images))
        .route("/vehicles/:id/raw-data", get(raw_vehicle_data))
        .route("/vehicles/:id/battery-config", put(update_battery_config))
        .route("/vehicles/:id/name", put(update_vehicle_name))
}

#[derive(Deserialize)]
struct RawDataParams {
    limit: Option<i64>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingOtpChallenge {
    email: String,
    otp_token: String,
    csrf_token: String,
    app_session_token: String,
    user_id: Uuid,
}

#[derive(Debug, sqlx::FromRow)]
struct LatestVehicleTelemetry {
    ts: Option<chrono::DateTime<chrono::Utc>>,
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
    charger_state_ts: Option<chrono::DateTime<chrono::Utc>>,
    charger_status: Option<String>,
    time_to_end_of_charge_min: Option<i32>,
    drive_mode: Option<String>,
    gear_status: Option<String>,
    cabin_temp_c: Option<f64>,
    driver_temp_c: Option<f64>,
    outside_temp_c: Option<f64>,
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
}

#[derive(Deserialize)]
struct RefreshCredentialsBody {
    rivian_vehicle_id: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct VehicleRuntimeStateRow {
    is_online: Option<bool>,
    last_event_at: Option<chrono::DateTime<chrono::Utc>>,
    worker_health: Option<String>,
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
    worker_health: Option<String>,
    battery_level: Option<f64>,
    range_miles: Option<f64>,
    battery_capacity_kwh: Option<f64>,
    battery_limit: Option<f64>,
    power_state: Option<String>,
    charger_state: Option<String>,
    charger_state_ts: Option<chrono::DateTime<chrono::Utc>>,
    charger_status: Option<String>,
    time_to_end_of_charge_min: Option<i32>,
    speed_mph: Option<f64>,
    altitude_m: Option<f64>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    drive_mode: Option<String>,
    gear_status: Option<String>,
    cabin_temp_c: Option<f64>,
    driver_temp_c: Option<f64>,
    outside_temp_c: Option<f64>,
    heading_deg: Option<f64>,
    odometer_miles: Option<f64>,
    tire_fl_psi: Option<f64>,
    tire_fr_psi: Option<f64>,
    tire_rl_psi: Option<f64>,
    tire_rr_psi: Option<f64>,
    tire_min_psi: Option<f64>,
    tire_fl_status: Option<String>,
    tire_fr_status: Option<String>,
    tire_rl_status: Option<String>,
    tire_rr_status: Option<String>,
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

const PLAUSIBLE_MAX_MI_PER_KWH: f64 = 3.4;

fn normalize_remaining_range_miles(
    raw_range_mi: Option<f64>,
    battery_level_pct: Option<f64>,
    battery_capacity_wh: Option<f64>,
) -> Option<f64> {
    let raw_range_mi = raw_range_mi.filter(|value| value.is_finite())?;
    let battery_level_pct = battery_level_pct.filter(|value| value.is_finite())?;
    if battery_level_pct <= 0.0 {
        return Some(raw_range_mi);
    }

    let battery_capacity_kwh = battery_capacity_wh
        .and_then(|wh| wh.is_finite().then_some(wh))
        .map(|wh| if wh > 1000.0 { wh / 1000.0 } else { wh });
    let Some(battery_capacity_kwh) = battery_capacity_kwh else {
        return Some(raw_range_mi);
    };

    let plausible_max_range = battery_capacity_kwh * PLAUSIBLE_MAX_MI_PER_KWH;
    let raw_max_range = raw_range_mi / battery_level_pct * 100.0;
    if raw_max_range <= plausible_max_range {
        return Some(raw_range_mi);
    }

    let converted_from_km = raw_range_mi / 1.609_344;
    let converted_max_range = converted_from_km / battery_level_pct * 100.0;
    if converted_max_range <= plausible_max_range {
        return Some(converted_from_km);
    }

    Some(raw_range_mi)
}

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

    let _: () = redis::AsyncCommands::set_ex(conn, key, ciphertext, ttl_secs).await?;
    Ok(())
}

async fn load_encrypted_redis<T: DeserializeOwned>(
    state: &AppState,
    conn: &mut redis::aio::MultiplexedConnection,
    key: &str,
) -> Result<Option<T>, AppError> {
    let ciphertext: Option<Vec<u8>> = redis::AsyncCommands::get(conn, key).await?;
    let Some(ciphertext) = ciphertext else {
        return Ok(None);
    };

    let identity = age_identity(state)?;
    let value = crate::ingestion::session_store::decrypt_json::<T>(&ciphertext, &identity)
        .map_err(|_| AppError::Internal(anyhow::anyhow!("corrupt encrypted session")))?;

    Ok(Some(value))
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

    let client = reqwest::Client::new();
    match crate::ingestion::rivian_auth::rivian_login(&client, &body.email, &body.password)
        .await
        .map_err(|e| {
            warn!(user_id = %auth.user_id, error = %e, "vehicle.connect.login_failed");
            AppError::RivianApi("Rivian authentication failed".into())
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
        AppError::Validation("challenge_id expired or invalid".into())
    })?;

    if pending.user_id != auth.user_id {
        warn!(
            user_id = %auth.user_id,
            challenge_id = %body.challenge_id,
            stored_user_id = %pending.user_id,
            "vehicle.connect_otp.challenge_user_mismatch"
        );
        return Err(AppError::Validation("challenge_id expired or invalid".into()));
    }

    let challenge = crate::ingestion::rivian_auth::RivianOtpChallenge {
        email: pending.email,
        otp_token: pending.otp_token,
        csrf_token: pending.csrf_token,
        app_session_token: pending.app_session_token,
    };

    let client = reqwest::Client::new();
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
                AppError::RivianApi("Rivian OTP verification failed".into())
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
        &state,
        &mut conn,
        &key,
    )
    .await?;
    let tokens = tokens.ok_or_else(|| {
        warn!(
            user_id = %auth.user_id,
            connect_key = %key,
            "vehicle.add.missing_connect_session"
        );
        AppError::Validation("complete /vehicles/connect first".into())
    })?;

    let identity = age_identity(&state)?;
    let encrypted = crate::ingestion::session_store::encrypt_tokens(&tokens, &identity)
        .map_err(|e| AppError::Internal(e))?;

    let existing_vehicle_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM riviamigo.vehicles WHERE user_id = $1 AND rivian_vehicle_id = $2",
    )
    .bind(auth.user_id)
    .bind(&rivian_vehicle_id)
    .fetch_optional(&state.pool)
    .await?;

    if existing_vehicle_id.is_some() {
        return Err(AppError::Conflict(
            "vehicle already exists; refresh credentials from vehicle settings".into(),
        ));
    }

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
    .fetch_one(&state.pool)
    .await?;

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
    .execute(&state.pool)
    .await?;

    // Set as default vehicle if user has none
    sqlx::query(
        "UPDATE riviamigo.users SET default_vehicle_id = $1 \
         WHERE id = $2 AND default_vehicle_id IS NULL",
    )
    .bind(vehicle_id)
    .bind(auth.user_id)
    .execute(&state.pool)
    .await?;

    cache_vehicle_images(&state.pool, vehicle_id, &tokens).await;
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_runtime_state (vehicle_id, worker_health, worker_health_msg, updated_at)
         VALUES ($1, 'ok', NULL, now())
         ON CONFLICT (vehicle_id) DO UPDATE
         SET worker_health = 'ok',
             worker_health_msg = NULL,
             updated_at = now()",
    )
    .bind(vehicle_id)
    .execute(&state.pool)
    .await?;

    let _: () = redis::AsyncCommands::del(&mut conn, &key).await?;
    info!(
        user_id = %auth.user_id,
        vehicle_id = %vehicle_id,
        rivian_vehicle_id = %rivian_vehicle_id,
        "vehicle.add.persisted"
    );

    // Spawn worker
    // (supervisor handle is stored in AppState in main — passed via extension)
    Ok(Json(serde_json::json!({"vehicle_id": vehicle_id})))
}

async fn refresh_vehicle_credentials(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Json(body): Json<RefreshCredentialsBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let rivian_vehicle_id: String = sqlx::query_scalar(
        "SELECT rivian_vehicle_id FROM riviamigo.vehicles WHERE id = $1 AND user_id = $2",
    )
    .bind(vid)
    .bind(auth.user_id)
    .fetch_one(&state.pool)
    .await?;

    if let Some(requested) = body.rivian_vehicle_id.as_deref() {
        if requested != rivian_vehicle_id {
            return Err(AppError::Validation("selected Rivian vehicle does not match this local vehicle".into()));
        }
    }

    let mut conn = state.redis.get_multiplexed_async_connection().await?;
    let key = format!("rivian:connect:{}", auth.user_id);
    let tokens = load_encrypted_redis::<crate::ingestion::session_store::RivianTokenBundle>(
        &state,
        &mut conn,
        &key,
    )
    .await?
    .ok_or_else(|| AppError::Validation("complete /vehicles/connect first".into()))?;

    let client = reqwest::Client::new();
    let account_vehicles = crate::ingestion::rivian_auth::rivian_user_vehicles(&client, &tokens)
        .await
        .map_err(|e| {
            warn!(vehicle_id = %vid, user_id = %auth.user_id, error = %e, "vehicle.refresh_credentials.fetch_user_vehicles_failed");
            AppError::RivianApi("Unable to verify Rivian vehicle access".into())
        })?;
    if !account_vehicles.iter().any(|vehicle| vehicle.id == rivian_vehicle_id) {
        return Err(AppError::Validation("Rivian account does not include this vehicle".into()));
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
        "INSERT INTO riviamigo.vehicle_runtime_state (vehicle_id, worker_health, worker_health_msg, updated_at)
         VALUES ($1, 'ok', NULL, now())
         ON CONFLICT (vehicle_id) DO UPDATE
         SET worker_health = 'ok',
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
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    sqlx::query("DELETE FROM riviamigo.vehicles WHERE id = $1 AND user_id = $2")
        .bind(vid)
        .bind(auth.user_id)
        .execute(&state.pool)
        .await?;

    let next_default: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM riviamigo.vehicles WHERE user_id = $1 ORDER BY created_at LIMIT 1",
    )
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await?;

    sqlx::query("UPDATE riviamigo.users SET default_vehicle_id = $1 WHERE id = $2")
        .bind(next_default)
        .bind(auth.user_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true, "default_vehicle_id": next_default })))
}

#[derive(Deserialize)]
struct UpdateBatteryConfigBody {
    battery_capacity_kwh: Option<f64>,
    battery_config: Option<String>,
}

async fn update_battery_config(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Json(body): Json<UpdateBatteryConfigBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let capacity_wh = body.battery_capacity_kwh.map(|kwh| kwh * 1000.0);
    sqlx::query(
        "UPDATE riviamigo.vehicles
         SET battery_capacity_wh = COALESCE($2, battery_capacity_wh),
             battery_config = COALESCE($3, battery_config)
         WHERE id = $1",
    )
    .bind(vid)
    .bind(capacity_wh)
    .bind(body.battery_config)
    .execute(&state.pool)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
struct UpdateVehicleNameBody {
    name: String,
}

async fn update_vehicle_name(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Json(body): Json<UpdateVehicleNameBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let trimmed = body.name.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Validation("name must not be blank".into()));
    }
    sqlx::query("UPDATE riviamigo.vehicles SET name = $2 WHERE id = $1")
        .bind(vid)
        .bind(trimmed)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn list_vehicles(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query_as::<_, VehicleListRow>(
        "SELECT v.id, v.rivian_vehicle_id, v.model, v.trim, v.vin, v.color, v.name, v.battery_capacity_wh, \
                v.battery_config, v.created_at, v.interior_color, v.wheel_option, v.max_vehicle_power_kw, \
                v.charge_port_type, v.battery_cell_type, v.supported_features, \
                v.history_backfill_status, v.history_backfilled_at, v.history_session_count, \
                vrs.worker_health, vrs.worker_health_msg \
         FROM riviamigo.vehicles v \
         LEFT JOIN riviamigo.vehicle_runtime_state vrs ON vrs.vehicle_id = v.id \
         WHERE v.user_id = $1 ORDER BY v.created_at",
    )
    .bind(auth.user_id)
    .fetch_all(&state.pool)
    .await?;

    let mut vehicles = Vec::with_capacity(rows.len());
    for r in rows {
        let images = fetch_vehicle_images_json(&state.pool, r.id)
            .await
            .unwrap_or_else(|_| serde_json::json!({ "all": [] }));
        if images
            .get("all")
            .and_then(|all| all.as_array())
            .is_some_and(|all| all.is_empty())
        {
            let pool = state.pool.clone();
            let age_key = state.age_key.clone();
            let vehicle_id = r.id;
            tokio::spawn(async move {
                ensure_vehicle_images_cached(&pool, vehicle_id, &age_key).await;
            });
        }
        vehicles.push(serde_json::json!({
            "id":                       r.id,
            "user_id":                  auth.user_id,
            "rivian_vehicle_id":        r.rivian_vehicle_id,
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
            "battery_config":           r.battery_config,
            "display_name":             r.name.as_deref().unwrap_or(&r.model),
            "created_at":               r.created_at,
            "images":                   images,
            "history_backfill_status":  r.history_backfill_status,
            "history_backfilled_at":    r.history_backfilled_at,
            "history_session_count":    r.history_session_count,
            "worker_health":            r.worker_health,
            "worker_health_msg":        r.worker_health_msg,
        }));
    }

    Ok(Json(serde_json::json!({"vehicles": vehicles})))
}

async fn vehicle_status(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
) -> Result<Json<VehicleStatusResponse>, AppError> {
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let vehicle = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT battery_capacity_wh FROM riviamigo.vehicles WHERE id = $1",
    )
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .flatten();

    let row = sqlx::query_as::<_, VehicleRuntimeStateRow>(
        "SELECT is_online, last_event_at, worker_health FROM riviamigo.vehicle_runtime_state \
         WHERE vehicle_id = $1",
    )
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?;

    let latest = sqlx::query_as::<_, LatestVehicleTelemetry>(
        r#"
        SELECT
          (SELECT ts FROM timeseries.telemetry WHERE vehicle_id = $1 ORDER BY ts DESC LIMIT 1) AS ts,
          (SELECT latitude FROM timeseries.telemetry WHERE vehicle_id = $1 AND latitude IS NOT NULL ORDER BY ts DESC LIMIT 1) AS latitude,
          (SELECT longitude FROM timeseries.telemetry WHERE vehicle_id = $1 AND longitude IS NOT NULL ORDER BY ts DESC LIMIT 1) AS longitude,
          (SELECT altitude_m FROM timeseries.telemetry WHERE vehicle_id = $1 AND altitude_m IS NOT NULL ORDER BY ts DESC LIMIT 1) AS altitude_m,
          (SELECT speed_mph FROM timeseries.telemetry WHERE vehicle_id = $1 AND speed_mph IS NOT NULL ORDER BY ts DESC LIMIT 1) AS speed_mph,
          (SELECT battery_level FROM timeseries.telemetry WHERE vehicle_id = $1 AND battery_level IS NOT NULL ORDER BY ts DESC LIMIT 1) AS battery_level,
          (SELECT battery_capacity_wh FROM timeseries.telemetry WHERE vehicle_id = $1 AND battery_capacity_wh IS NOT NULL ORDER BY ts DESC LIMIT 1) AS battery_capacity_wh,
          (SELECT distance_to_empty_mi FROM timeseries.telemetry WHERE vehicle_id = $1 AND distance_to_empty_mi IS NOT NULL ORDER BY ts DESC LIMIT 1) AS distance_to_empty_mi,
          (SELECT battery_limit FROM timeseries.telemetry WHERE vehicle_id = $1 AND battery_limit IS NOT NULL ORDER BY ts DESC LIMIT 1) AS battery_limit,
          (SELECT power_state FROM timeseries.telemetry WHERE vehicle_id = $1 AND power_state IS NOT NULL ORDER BY ts DESC LIMIT 1) AS power_state,
          (SELECT charger_state FROM timeseries.telemetry WHERE vehicle_id = $1 AND charger_state IS NOT NULL ORDER BY ts DESC LIMIT 1) AS charger_state,
          (SELECT ts FROM timeseries.telemetry WHERE vehicle_id = $1 AND charger_state IS NOT NULL ORDER BY ts DESC LIMIT 1) AS charger_state_ts,
          (SELECT charger_status FROM timeseries.telemetry WHERE vehicle_id = $1 AND charger_status IS NOT NULL ORDER BY ts DESC LIMIT 1) AS charger_status,
          (SELECT time_to_end_of_charge_min FROM timeseries.telemetry WHERE vehicle_id = $1 AND time_to_end_of_charge_min IS NOT NULL ORDER BY ts DESC LIMIT 1) AS time_to_end_of_charge_min,
          (SELECT drive_mode FROM timeseries.telemetry WHERE vehicle_id = $1 AND drive_mode IS NOT NULL ORDER BY ts DESC LIMIT 1) AS drive_mode,
          (SELECT gear_status FROM timeseries.telemetry WHERE vehicle_id = $1 AND gear_status IS NOT NULL ORDER BY ts DESC LIMIT 1) AS gear_status,
          (SELECT cabin_temp_c FROM timeseries.telemetry WHERE vehicle_id = $1 AND cabin_temp_c IS NOT NULL ORDER BY ts DESC LIMIT 1) AS cabin_temp_c,
          (SELECT driver_temp_c FROM timeseries.telemetry WHERE vehicle_id = $1 AND driver_temp_c IS NOT NULL ORDER BY ts DESC LIMIT 1) AS driver_temp_c,
          (SELECT outside_temp_c FROM timeseries.telemetry WHERE vehicle_id = $1 AND outside_temp_c IS NOT NULL ORDER BY ts DESC LIMIT 1) AS outside_temp_c,
          (SELECT heading_deg FROM timeseries.telemetry WHERE vehicle_id = $1 AND heading_deg IS NOT NULL ORDER BY ts DESC LIMIT 1) AS heading_deg,
          (SELECT odometer_miles FROM timeseries.telemetry WHERE vehicle_id = $1 AND odometer_miles IS NOT NULL ORDER BY ts DESC LIMIT 1) AS odometer_miles,
          (SELECT tire_fl_psi FROM timeseries.telemetry WHERE vehicle_id = $1 AND tire_fl_psi IS NOT NULL ORDER BY ts DESC LIMIT 1) AS tire_fl_psi,
          (SELECT tire_fr_psi FROM timeseries.telemetry WHERE vehicle_id = $1 AND tire_fr_psi IS NOT NULL ORDER BY ts DESC LIMIT 1) AS tire_fr_psi,
          (SELECT tire_rl_psi FROM timeseries.telemetry WHERE vehicle_id = $1 AND tire_rl_psi IS NOT NULL ORDER BY ts DESC LIMIT 1) AS tire_rl_psi,
          (SELECT tire_rr_psi FROM timeseries.telemetry WHERE vehicle_id = $1 AND tire_rr_psi IS NOT NULL ORDER BY ts DESC LIMIT 1) AS tire_rr_psi,
          (SELECT tire_fl_status FROM timeseries.telemetry WHERE vehicle_id = $1 AND tire_fl_status IS NOT NULL ORDER BY ts DESC LIMIT 1) AS tire_fl_status,
          (SELECT tire_fr_status FROM timeseries.telemetry WHERE vehicle_id = $1 AND tire_fr_status IS NOT NULL ORDER BY ts DESC LIMIT 1) AS tire_fr_status,
          (SELECT tire_rl_status FROM timeseries.telemetry WHERE vehicle_id = $1 AND tire_rl_status IS NOT NULL ORDER BY ts DESC LIMIT 1) AS tire_rl_status,
          (SELECT tire_rr_status FROM timeseries.telemetry WHERE vehicle_id = $1 AND tire_rr_status IS NOT NULL ORDER BY ts DESC LIMIT 1) AS tire_rr_status,
          (SELECT door_front_left_locked FROM timeseries.telemetry WHERE vehicle_id = $1 AND door_front_left_locked IS NOT NULL ORDER BY ts DESC LIMIT 1) AS door_front_left_locked,
          (SELECT door_front_right_locked FROM timeseries.telemetry WHERE vehicle_id = $1 AND door_front_right_locked IS NOT NULL ORDER BY ts DESC LIMIT 1) AS door_front_right_locked,
          (SELECT door_rear_left_locked FROM timeseries.telemetry WHERE vehicle_id = $1 AND door_rear_left_locked IS NOT NULL ORDER BY ts DESC LIMIT 1) AS door_rear_left_locked,
          (SELECT door_rear_right_locked FROM timeseries.telemetry WHERE vehicle_id = $1 AND door_rear_right_locked IS NOT NULL ORDER BY ts DESC LIMIT 1) AS door_rear_right_locked,
          (SELECT door_front_left_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND door_front_left_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS door_front_left_closed,
          (SELECT door_front_right_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND door_front_right_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS door_front_right_closed,
          (SELECT door_rear_left_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND door_rear_left_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS door_rear_left_closed,
          (SELECT door_rear_right_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND door_rear_right_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS door_rear_right_closed,
          (SELECT closure_frunk_locked FROM timeseries.telemetry WHERE vehicle_id = $1 AND closure_frunk_locked IS NOT NULL ORDER BY ts DESC LIMIT 1) AS closure_frunk_locked,
          (SELECT closure_frunk_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND closure_frunk_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS closure_frunk_closed,
          (SELECT closure_liftgate_locked FROM timeseries.telemetry WHERE vehicle_id = $1 AND closure_liftgate_locked IS NOT NULL ORDER BY ts DESC LIMIT 1) AS closure_liftgate_locked,
          (SELECT closure_liftgate_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND closure_liftgate_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS closure_liftgate_closed,
          (SELECT closure_tailgate_locked FROM timeseries.telemetry WHERE vehicle_id = $1 AND closure_tailgate_locked IS NOT NULL ORDER BY ts DESC LIMIT 1) AS closure_tailgate_locked,
          (SELECT closure_tailgate_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND closure_tailgate_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS closure_tailgate_closed,
          (SELECT ota_current_version FROM timeseries.telemetry WHERE vehicle_id = $1 AND ota_current_version IS NOT NULL ORDER BY ts DESC LIMIT 1) AS ota_current_version,
          (SELECT ota_available_version FROM timeseries.telemetry WHERE vehicle_id = $1 AND ota_available_version IS NOT NULL ORDER BY ts DESC LIMIT 1) AS ota_available_version,
          (SELECT ota_status FROM timeseries.telemetry WHERE vehicle_id = $1 AND ota_status IS NOT NULL ORDER BY ts DESC LIMIT 1) AS ota_status,
          (SELECT ota_current_status FROM timeseries.telemetry WHERE vehicle_id = $1 AND ota_current_status IS NOT NULL ORDER BY ts DESC LIMIT 1) AS ota_current_status,
          (SELECT hv_thermal_event FROM timeseries.telemetry WHERE vehicle_id = $1 AND hv_thermal_event IS NOT NULL ORDER BY ts DESC LIMIT 1) AS hv_thermal_event,
          (SELECT twelve_volt_health FROM timeseries.telemetry WHERE vehicle_id = $1 AND twelve_volt_health IS NOT NULL ORDER BY ts DESC LIMIT 1) AS twelve_volt_health,
          (SELECT charge_port_open FROM timeseries.telemetry WHERE vehicle_id = $1 AND charge_port_open IS NOT NULL ORDER BY ts DESC LIMIT 1) AS charge_port_open,
          (SELECT charger_derate_active FROM timeseries.telemetry WHERE vehicle_id = $1 AND charger_derate_active IS NOT NULL ORDER BY ts DESC LIMIT 1) AS charger_derate_active,
          (SELECT cabin_precon_status FROM timeseries.telemetry WHERE vehicle_id = $1 AND cabin_precon_status IS NOT NULL ORDER BY ts DESC LIMIT 1) AS cabin_precon_status,
          (SELECT cabin_precon_type FROM timeseries.telemetry WHERE vehicle_id = $1 AND cabin_precon_type IS NOT NULL ORDER BY ts DESC LIMIT 1) AS cabin_precon_type,
          (SELECT pet_mode_active FROM timeseries.telemetry WHERE vehicle_id = $1 AND pet_mode_active IS NOT NULL ORDER BY ts DESC LIMIT 1) AS pet_mode_active,
          (SELECT pet_mode_temp_ok FROM timeseries.telemetry WHERE vehicle_id = $1 AND pet_mode_temp_ok IS NOT NULL ORDER BY ts DESC LIMIT 1) AS pet_mode_temp_ok,
          (SELECT defrost_active FROM timeseries.telemetry WHERE vehicle_id = $1 AND defrost_active IS NOT NULL ORDER BY ts DESC LIMIT 1) AS defrost_active,
          (SELECT steering_wheel_heat FROM timeseries.telemetry WHERE vehicle_id = $1 AND steering_wheel_heat IS NOT NULL ORDER BY ts DESC LIMIT 1) AS steering_wheel_heat,
          (SELECT seat_fl_heat FROM timeseries.telemetry WHERE vehicle_id = $1 AND seat_fl_heat IS NOT NULL ORDER BY ts DESC LIMIT 1) AS seat_fl_heat,
          (SELECT seat_fr_heat FROM timeseries.telemetry WHERE vehicle_id = $1 AND seat_fr_heat IS NOT NULL ORDER BY ts DESC LIMIT 1) AS seat_fr_heat,
          (SELECT seat_rl_heat FROM timeseries.telemetry WHERE vehicle_id = $1 AND seat_rl_heat IS NOT NULL ORDER BY ts DESC LIMIT 1) AS seat_rl_heat,
          (SELECT seat_rr_heat FROM timeseries.telemetry WHERE vehicle_id = $1 AND seat_rr_heat IS NOT NULL ORDER BY ts DESC LIMIT 1) AS seat_rr_heat,
          (SELECT seat_fl_vent FROM timeseries.telemetry WHERE vehicle_id = $1 AND seat_fl_vent IS NOT NULL ORDER BY ts DESC LIMIT 1) AS seat_fl_vent,
          (SELECT seat_fr_vent FROM timeseries.telemetry WHERE vehicle_id = $1 AND seat_fr_vent IS NOT NULL ORDER BY ts DESC LIMIT 1) AS seat_fr_vent,
          (SELECT tonneau_locked FROM timeseries.telemetry WHERE vehicle_id = $1 AND tonneau_locked IS NOT NULL ORDER BY ts DESC LIMIT 1) AS tonneau_locked,
          (SELECT tonneau_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND tonneau_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS tonneau_closed,
          (SELECT side_bin_left_locked FROM timeseries.telemetry WHERE vehicle_id = $1 AND side_bin_left_locked IS NOT NULL ORDER BY ts DESC LIMIT 1) AS side_bin_left_locked,
          (SELECT side_bin_right_locked FROM timeseries.telemetry WHERE vehicle_id = $1 AND side_bin_right_locked IS NOT NULL ORDER BY ts DESC LIMIT 1) AS side_bin_right_locked,
          (SELECT window_fl_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND window_fl_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS window_fl_closed,
          (SELECT window_fr_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND window_fr_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS window_fr_closed,
          (SELECT window_rl_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND window_rl_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS window_rl_closed,
          (SELECT window_rr_closed FROM timeseries.telemetry WHERE vehicle_id = $1 AND window_rr_closed IS NOT NULL ORDER BY ts DESC LIMIT 1) AS window_rr_closed,
          (SELECT gear_guard_locked FROM timeseries.telemetry WHERE vehicle_id = $1 AND gear_guard_locked IS NOT NULL ORDER BY ts DESC LIMIT 1) AS gear_guard_locked,
          (SELECT gear_guard_video_status FROM timeseries.telemetry WHERE vehicle_id = $1 AND gear_guard_video_status IS NOT NULL ORDER BY ts DESC LIMIT 1) AS gear_guard_video_status,
          (SELECT wiper_fluid_low FROM timeseries.telemetry WHERE vehicle_id = $1 AND wiper_fluid_low IS NOT NULL ORDER BY ts DESC LIMIT 1) AS wiper_fluid_low,
          (SELECT brake_fluid_low FROM timeseries.telemetry WHERE vehicle_id = $1 AND brake_fluid_low IS NOT NULL ORDER BY ts DESC LIMIT 1) AS brake_fluid_low,
          (SELECT alarm_active FROM timeseries.telemetry WHERE vehicle_id = $1 AND alarm_active IS NOT NULL ORDER BY ts DESC LIMIT 1) AS alarm_active,
          (SELECT service_mode FROM timeseries.telemetry WHERE vehicle_id = $1 AND service_mode IS NOT NULL ORDER BY ts DESC LIMIT 1) AS service_mode
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
    let tire_pressure_status: Option<String> = tire_statuses
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
        .map(str::to_string);
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
        ("Left side bin", latest.side_bin_left_locked.map(|v| !v)),
        ("Right side bin", latest.side_bin_right_locked.map(|v| !v)),
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
    let normalized_range_miles = normalize_remaining_range_miles(
        latest.distance_to_empty_mi,
        latest.battery_level,
        latest.battery_capacity_wh.or(vehicle),
    );

    Ok(Json(VehicleStatusResponse {
        vehicle_id: vid,
        is_online: row.as_ref().and_then(|r| r.is_online).unwrap_or(false),
        last_event_at: row.as_ref().and_then(|r| r.last_event_at),
        last_updated: latest.ts.or_else(|| row.as_ref().and_then(|r| r.last_event_at)),
        worker_health: row.as_ref().and_then(|r| r.worker_health.clone()),
        battery_level: latest.battery_level,
        range_miles: normalized_range_miles,
        battery_capacity_kwh: latest.battery_capacity_wh.map(|w| if w > 1000.0 { w / 1000.0 } else { w }),
        battery_limit: latest.battery_limit,
        power_state: latest.power_state,
        charger_state: latest.charger_state,
        charger_state_ts: latest.charger_state_ts,
        charger_status: latest.charger_status,
        time_to_end_of_charge_min: latest.time_to_end_of_charge_min,
        speed_mph: latest.speed_mph,
        altitude_m: latest.altitude_m,
        latitude: latest.latitude,
        longitude: latest.longitude,
        drive_mode: latest.drive_mode,
        gear_status: latest.gear_status,
        cabin_temp_c: latest.cabin_temp_c,
        driver_temp_c: latest.driver_temp_c,
        outside_temp_c: latest.outside_temp_c,
        heading_deg: latest.heading_deg,
        odometer_miles: latest.odometer_miles,
        tire_fl_psi: latest.tire_fl_psi,
        tire_fr_psi: latest.tire_fr_psi,
        tire_rl_psi: latest.tire_rl_psi,
        tire_rr_psi: latest.tire_rr_psi,
        tire_min_psi,
        tire_fl_status: latest.tire_fl_status,
        tire_fr_status: latest.tire_fr_status,
        tire_rl_status: latest.tire_rl_status,
        tire_rr_status: latest.tire_rr_status,
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
    }))
}

#[cfg(test)]
mod range_tests {
    use super::normalize_remaining_range_miles;

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

async fn vehicle_images(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    Ok(Json(fetch_vehicle_images_json(&state.pool, vid).await?))
}

async fn cache_vehicle_images(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    tokens: &crate::ingestion::session_store::RivianTokenBundle,
) {
    let client = reqwest::Client::new();
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
                .bind(image.url)
                .bind(image.overlays)
                .bind(serde_json::json!({
                    "source": image.source,
                    "vehicle_version": image.vehicle_version,
                    "rivian_vehicle_id": image.vehicle_id,
                    "rivian_order_id": image.order_id,
                    "extension": image.extension
                }))
                .execute(pool)
                .await;
            }
            info!(vehicle_id = %vehicle_id, image_count, "vehicle.images.cached");
        }
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.add.image_cache_failed");
        }
    }
}

async fn ensure_vehicle_images_cached(pool: &sqlx::PgPool, vehicle_id: Uuid, age_key: &str) {
    let existing: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM riviamigo.vehicle_images WHERE vehicle_id = $1")
            .bind(vehicle_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    if existing > 0 {
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
        Ok(tokens) => cache_vehicle_images(pool, vehicle_id, &tokens).await,
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.backfill_decrypt_failed");
        }
    }
}

async fn fetch_vehicle_images_json(
    pool: &sqlx::PgPool,
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
        .map(|row| {
            serde_json::json!({
                "placement": row.placement,
                "design": row.design,
                "size": row.size,
                "resolution": row.resolution,
                "url": row.url,
                "overlays": row.overlays,
                "metadata": row.metadata,
            })
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
            .map(|row| row.url.clone())
    };

    Ok(serde_json::json!({
        "all": all,
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

fn normalize_image_placement(value: &str) -> &'static str {
    let normalized = value.to_lowercase();
    if normalized.contains("side") {
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

async fn raw_vehicle_data(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
    Query(params): Query<RawDataParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let limit = params.limit.unwrap_or(25).clamp(1, 100);

    let samples = sqlx::query_as::<_, RawVehicleSampleRow>(
        r#"
        SELECT ts, latitude, longitude, altitude_m, speed_mph,
               battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit,
               power_state, charger_state, charger_status, time_to_end_of_charge_min,
               drive_mode, gear_status, cabin_temp_c, driver_temp_c, outside_temp_c,
               hvac_active, power_kw, regen_power_kw, heading_deg, odometer_miles,
               tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
               tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status,
               door_front_left_locked, door_front_right_locked, door_rear_left_locked, door_rear_right_locked,
               door_front_left_closed, door_front_right_closed, door_rear_left_closed, door_rear_right_closed,
               closure_frunk_closed, closure_liftgate_closed, closure_tailgate_closed,
               ota_current_version, ota_available_version, ota_status, ota_current_status,
               hv_thermal_event, twelve_volt_health, is_online
        FROM timeseries.telemetry
        WHERE vehicle_id = $1
        ORDER BY ts DESC
        LIMIT $2
        "#
    )
    .bind(vid)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    let coverage = sqlx::query_as::<_, RawVehicleCoverageRow>(
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
        FROM timeseries.telemetry
        WHERE vehicle_id = $1
        "#,
    )
    .bind(vid)
    .fetch_one(&state.pool)
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
        "samples": samples.into_iter().map(|r| serde_json::json!({
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
        })).collect::<Vec<_>>()
    })))
}

#[cfg(test)]
mod tests {
    use super::{connect_otp, load_encrypted_redis, store_encrypted_redis, OtpBody, PendingOtpChallenge};
    use axum::body::Body;
    use axum::extract::State;
    use axum::Json;
    use http::{Request, StatusCode};
    use tower::ServiceExt;
    use uuid::Uuid;

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
            JwtKeys::new(&generated.jwt_private_pem, &generated.jwt_public_pem)
                .expect("jwt keys"),
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
            backup_driver: "json".into(),
            backup_poll_interval_seconds: 60,
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: true,
            rivian_suppress_duplicate_telemetry: true,
        };

        AppState {
            pool,
            redis,
            jwt_keys,
            age_key: generated.age_key,
            config,
            nominatim_next_call: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::time::Instant::now(),
            )),
            nominatim_cache: std::sync::Arc::new(tokio::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
        }
    }

    async fn make_app() -> axum::Router {
        use std::sync::Arc;
        use crate::middleware::auth::{AppState, JwtKeys};
        use rsa::{
            pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
            RsaPrivateKey,
        };

        let database_url = std::env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set for integration tests");
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".into());

        let pool = crate::db::pool::create_pool(&database_url)
            .await
            .expect("create_pool");
        let redis = redis::Client::open(redis_url).expect("redis client");

        let mut rng = rand::thread_rng();
        let priv_key = RsaPrivateKey::new(&mut rng, 2048).expect("rsa key");
        let pub_key = priv_key.to_public_key();
        let private_pem = priv_key.to_pkcs8_pem(LineEnding::LF).expect("pem").to_string();
        let public_pem = pub_key.to_public_key_pem(LineEnding::LF).expect("pem");
        let jwt_keys = Arc::new(JwtKeys::new(&private_pem, &public_pem).expect("jwt keys"));

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
            backup_driver: "json".into(),
            backup_poll_interval_seconds: 60,
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: true,
            rivian_suppress_duplicate_telemetry: true,
        };

        let state = AppState {
            pool,
            redis,
            jwt_keys,
            age_key: "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"
                .to_string(),
            config,
            nominatim_next_call: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::time::Instant::now(),
            )),
            nominatim_cache: std::sync::Arc::new(tokio::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
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

    async fn post_status(app: axum::Router, uri: &str, body: serde_json::Value) -> http::StatusCode {
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
        assert_eq!(get_status(app, "/v1/vehicles").await, StatusCode::UNAUTHORIZED);
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
        let redis_url = std::env::var("REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379/".into());
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

        let round_trip = load_encrypted_redis::<crate::ingestion::session_store::RivianTokenBundle>(
            &state,
            &mut conn,
            &key,
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
        let redis_url = std::env::var("REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379/".into());
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
            },
            Json(OtpBody {
                challenge_id: challenge_id.clone(),
                otp_code: "123456".into(),
            }),
        )
        .await;

        match result {
            Err(crate::errors::AppError::Validation(message)) => {
                assert_eq!(message, "challenge_id expired or invalid");
            }
            other => panic!("expected validation error, got {other:?}"),
        }

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
