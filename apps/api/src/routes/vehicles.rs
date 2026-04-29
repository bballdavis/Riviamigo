use axum::{
    extract::State,
    routing::{get, post},
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

    let vehicle_id: Uuid = sqlx::query_scalar!(
        r#"INSERT INTO riviamigo.vehicles
           (user_id, rivian_vehicle_id, model, trim, vin, name, home_latitude, home_longitude)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id"#,
        auth.user_id,
        body.rivian_vehicle_id,
        body.model.as_deref().unwrap_or("R1T"),
        body.trim,
        body.vin,
        body.name,
        body.home_lat,
        body.home_lng,
    )
    .fetch_one(&state.pool)
    .await?;

    sqlx::query!(
        "INSERT INTO riviamigo.vehicle_credentials (vehicle_id, encrypted_tokens, token_created_at) \
         VALUES ($1,$2,now())",
        vehicle_id, encrypted.as_slice()
    )
    .execute(&state.pool)
    .await?;

    // Set as default vehicle if user has none
    sqlx::query!(
        "UPDATE riviamigo.users SET default_vehicle_id = $1 \
         WHERE id = $2 AND default_vehicle_id IS NULL",
        vehicle_id,
        auth.user_id
    )
    .execute(&state.pool)
    .await?;

    let _: () = redis::AsyncCommands::del(&mut conn, &key).await?;
    info!(
        user_id = %auth.user_id,
        vehicle_id = %vehicle_id,
        rivian_vehicle_id = %body.rivian_vehicle_id,
        "vehicle.add.persisted"
    );

    // Spawn worker
    // (supervisor handle is stored in AppState in main — passed via extension)
    Ok(Json(serde_json::json!({"vehicle_id": vehicle_id})))
}

async fn list_vehicles(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query!(
        "SELECT id, rivian_vehicle_id, model, trim, name, battery_capacity_wh, \
                home_latitude, home_longitude, created_at \
         FROM riviamigo.vehicles WHERE user_id = $1 ORDER BY created_at",
        auth.user_id
    )
    .fetch_all(&state.pool)
    .await?;

    let vehicles: Vec<_> = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id":                    r.id,
                "user_id":               auth.user_id,
                "rivian_vehicle_id":     r.rivian_vehicle_id,
                "vin":                   serde_json::Value::Null,
                "model":                 r.model,
                "year":                  serde_json::Value::Null,
                "trim":                  r.trim,
                "color":                 serde_json::Value::Null,
                "battery_capacity_kwh":  r.battery_capacity_wh.map(|w| w / 1000.0),
                "display_name":          r.name.as_deref().unwrap_or(&r.model),
                "created_at":            r.created_at,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({"vehicles": vehicles})))
}

async fn vehicle_status(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::db::vehicles::require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let row = sqlx::query!(
        "SELECT is_online, last_event_at, worker_health FROM riviamigo.vehicle_runtime_state \
         WHERE vehicle_id = $1",
        vid
    )
    .fetch_optional(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "vehicle_id":   vid,
        "is_online":    row.as_ref().and_then(|r| r.is_online).unwrap_or(false),
        "last_event_at":row.as_ref().and_then(|r| r.last_event_at),
        "worker_health":row.as_ref().and_then(|r| r.worker_health.as_deref()),
    })))
}
