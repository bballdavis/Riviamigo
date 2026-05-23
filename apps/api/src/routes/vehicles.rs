use axum::{
    extract::{Query, State},
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
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
        .route("/vehicles/:id/status", get(vehicle_status))
        .route("/vehicles/:id/images", get(vehicle_images))
        .route("/vehicles/:id/raw-data", get(raw_vehicle_data))
        .route("/vehicles/:id/battery-config", put(update_battery_config))
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
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, sqlx::FromRow)]
struct VehicleRuntimeStateRow {
    is_online: Option<bool>,
    last_event_at: Option<chrono::DateTime<chrono::Utc>>,
    worker_health: Option<String>,
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
            AppError::RivianApi(e.to_string())
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
                    AppError::RivianApi(e.to_string())
                })?;
            let mut conn = state.redis.get_multiplexed_async_connection().await?;
            let key = format!("rivian:connect:{}", auth.user_id);
            let json = serde_json::to_string(&tokens).unwrap_or_default();
            let _: () = redis::AsyncCommands::set_ex(&mut conn, &key, json, 300).await?;
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
            let val = serde_json::to_string(&serde_json::json!({
                "email":             challenge.email,
                "otp_token":         challenge.otp_token,
                "csrf_token":        challenge.csrf_token,
                "app_session_token": challenge.app_session_token,
                "user_id":           auth.user_id,
            }))
            .unwrap_or_default();
            let _: () = redis::AsyncCommands::set_ex(&mut conn, &key, val, 300).await?;
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
    let raw: Option<String> = redis::AsyncCommands::get(&mut conn, &key).await?;
    let raw = raw.ok_or_else(|| {
        warn!(
            user_id = %auth.user_id,
            challenge_id = %body.challenge_id,
            "vehicle.connect_otp.challenge_missing"
        );
        AppError::Validation("challenge_id expired or invalid".into())
    })?;

    let data: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|_| AppError::Internal(anyhow::anyhow!("corrupt challenge")))?;

    let challenge = crate::ingestion::rivian_auth::RivianOtpChallenge {
        email: data["email"].as_str().unwrap_or("").to_string(),
        otp_token: data["otp_token"].as_str().unwrap_or("").to_string(),
        csrf_token: data["csrf_token"].as_str().unwrap_or("").to_string(),
        app_session_token: data["app_session_token"].as_str().unwrap_or("").to_string(),
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
                AppError::RivianApi(e.to_string())
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
            AppError::RivianApi(e.to_string())
        })?;

    let connect_key = format!("rivian:connect:{}", auth.user_id);
    let json = serde_json::to_string(&tokens).unwrap_or_default();
    let _: () = redis::AsyncCommands::set_ex(&mut conn, &connect_key, json, 300).await?;
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
    let raw: Option<String> = redis::AsyncCommands::get(&mut conn, &key).await?;
    let raw = raw.ok_or_else(|| {
        warn!(
            user_id = %auth.user_id,
            connect_key = %key,
            "vehicle.add.missing_connect_session"
        );
        AppError::Validation("complete /vehicles/connect first".into())
    })?;

    let tokens: crate::ingestion::session_store::RivianTokenBundle = serde_json::from_str(&raw)
        .map_err(|_| AppError::Internal(anyhow::anyhow!("corrupt token")))?;

    let identity = state
        .age_key
        .parse::<age::x25519::Identity>()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("bad age key: {e}")))?;
    let encrypted = crate::ingestion::session_store::encrypt_tokens(&tokens, &identity)
        .map_err(|e| AppError::Internal(e))?;

    let vehicle_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO riviamigo.vehicles
           (user_id, rivian_vehicle_id, model, trim, vin, name, home_latitude, home_longitude)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id"#,
    )
    .bind(auth.user_id)
    .bind(&rivian_vehicle_id)
    .bind(body.model.as_deref().unwrap_or("R1T"))
    .bind(body.trim)
    .bind(body.vin)
    .bind(body.name)
    .bind(body.home_lat)
    .bind(body.home_lng)
    .fetch_one(&state.pool)
    .await?;

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_credentials (vehicle_id, encrypted_tokens, token_created_at) \
         VALUES ($1,$2,now())",
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

async fn list_vehicles(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query_as::<_, VehicleListRow>(
        "SELECT id, rivian_vehicle_id, model, trim, vin, color, name, battery_capacity_wh, \
                created_at \
         FROM riviamigo.vehicles WHERE user_id = $1 ORDER BY created_at",
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
            "id":                    r.id,
            "user_id":               auth.user_id,
            "rivian_vehicle_id":     r.rivian_vehicle_id,
            "vin":                   r.vin,
            "model":                 r.model,
            "year":                  serde_json::Value::Null,
            "trim":                  r.trim,
            "color":                 r.color,
            "battery_capacity_kwh":  r.battery_capacity_wh.map(|w| w / 1000.0),
            "display_name":          r.name.as_deref().unwrap_or(&r.model),
            "created_at":            r.created_at,
            "images":                images,
        }));
    }

    Ok(Json(serde_json::json!({"vehicles": vehicles})))
}

async fn vehicle_status(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
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
          (SELECT twelve_volt_health FROM timeseries.telemetry WHERE vehicle_id = $1 AND twelve_volt_health IS NOT NULL ORDER BY ts DESC LIMIT 1) AS twelve_volt_health
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
    let tire_pressure_status = tire_statuses
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
        });
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
    ]);
    let software_update_status = latest
        .ota_status
        .as_deref()
        .or(latest.ota_current_status.as_deref());
    let normalized_range_miles = normalize_remaining_range_miles(
        latest.distance_to_empty_mi,
        latest.battery_level,
        latest.battery_capacity_wh.or(vehicle),
    );

    Ok(Json(serde_json::json!({
        "vehicle_id": vid,
        "is_online": row.as_ref().and_then(|r| r.is_online).unwrap_or(false),
        "last_event_at": row.as_ref().and_then(|r| r.last_event_at),
        "last_updated": latest.ts.or_else(|| row.as_ref().and_then(|r| r.last_event_at)),
        "worker_health": row.as_ref().and_then(|r| r.worker_health.as_deref()),
        "battery_level": latest.battery_level,
        "range_miles": normalized_range_miles,
        "battery_capacity_kwh": latest.battery_capacity_wh.map(|w| if w > 1000.0 { w / 1000.0 } else { w }),
        "battery_limit": latest.battery_limit,
        "power_state": latest.power_state.as_deref(),
        "charger_state": latest.charger_state.as_deref(),
        "charger_status": latest.charger_status.as_deref(),
        "time_to_end_of_charge_min": latest.time_to_end_of_charge_min,
        "speed_mph": latest.speed_mph,
        "altitude_m": latest.altitude_m,
        "latitude": latest.latitude,
        "longitude": latest.longitude,
        "drive_mode": latest.drive_mode.as_deref(),
        "gear_status": latest.gear_status.as_deref(),
        "cabin_temp_c": latest.cabin_temp_c,
        "driver_temp_c": latest.driver_temp_c,
        "outside_temp_c": latest.outside_temp_c,
        "heading_deg": latest.heading_deg,
        "odometer_miles": latest.odometer_miles,
        "tire_fl_psi": latest.tire_fl_psi,
        "tire_fr_psi": latest.tire_fr_psi,
        "tire_rl_psi": latest.tire_rl_psi,
        "tire_rr_psi": latest.tire_rr_psi,
        "tire_min_psi": tire_min_psi,
        "tire_fl_status": latest.tire_fl_status.as_deref(),
        "tire_fr_status": latest.tire_fr_status.as_deref(),
        "tire_rl_status": latest.tire_rl_status.as_deref(),
        "tire_rr_status": latest.tire_rr_status.as_deref(),
        "door_front_left_locked": latest.door_front_left_locked,
        "door_front_right_locked": latest.door_front_right_locked,
        "door_rear_left_locked": latest.door_rear_left_locked,
        "door_rear_right_locked": latest.door_rear_right_locked,
        "door_front_left_closed": latest.door_front_left_closed,
        "door_front_right_closed": latest.door_front_right_closed,
        "door_rear_left_closed": latest.door_rear_left_closed,
        "door_rear_right_closed": latest.door_rear_right_closed,
        "closure_frunk_locked": latest.closure_frunk_locked,
        "closure_frunk_closed": latest.closure_frunk_closed,
        "closure_liftgate_locked": latest.closure_liftgate_locked,
        "closure_liftgate_closed": latest.closure_liftgate_closed,
        "closure_tailgate_locked": latest.closure_tailgate_locked,
        "closure_tailgate_closed": latest.closure_tailgate_closed,
        "ota_current_version": latest.ota_current_version.as_deref(),
        "ota_available_version": latest.ota_available_version.as_deref(),
        "ota_status": latest.ota_status.as_deref(),
        "ota_current_status": latest.ota_current_status.as_deref(),
        "hv_thermal_event": latest.hv_thermal_event.as_deref(),
        "twelve_volt_health": latest.twelve_volt_health.as_deref(),
        "doors_locked": doors_locked,
        "open_closures": open_closures,
        "tire_pressure_status": tire_pressure_status,
        "software_update_status": software_update_status,
    })))
}

#[cfg(test)]
mod tests {
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
    use axum::body::Body;
    use http::{Request, StatusCode};
    use tower::ServiceExt;

    // Run with: cargo test -- --ignored

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
        };

        let state = AppState {
            pool,
            redis,
            jwt_keys,
            age_key: "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"
                .to_string(),
            config,
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
}
