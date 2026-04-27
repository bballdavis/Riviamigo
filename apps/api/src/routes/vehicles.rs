use axum::{extract::State, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{errors::AppError, middleware::auth::{AppState, AuthUser}};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/vehicles/connect",     post(connect))
        .route("/vehicles/connect/otp", post(connect_otp))
        .route("/vehicles",             post(add_vehicle).get(list_vehicles))
        .route("/vehicles/:id/status",  get(vehicle_status))
}

#[derive(Deserialize)]
struct ConnectBody { email: String, password: String }

#[derive(Deserialize)]
struct OtpBody { challenge_id: String, otp_code: String }

#[derive(Deserialize)]
struct AddVehicleBody {
    rivian_vehicle_id: String,
    name:              Option<String>,
    home_lat:          Option<f64>,
    home_lng:          Option<f64>,
    model:             Option<String>,
    trim:              Option<String>,
    vin:               Option<String>,
}

async fn connect(
    State(state): State<AppState>,
    auth:         AuthUser,
    Json(body):   Json<ConnectBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let client = reqwest::Client::new();
    match crate::ingestion::rivian_auth::rivian_login(&client, &body.email, &body.password).await
        .map_err(|e| AppError::RivianApi(e.to_string()))?
    {
        crate::ingestion::rivian_auth::LoginResult::Authenticated(tokens) => {
            // Store challenge result in Redis for vehicle add step
            let mut conn = state.redis.get_multiplexed_async_connection().await?;
            let key = format!("rivian:connect:{}", auth.user_id);
            let json = serde_json::to_string(&tokens).unwrap_or_default();
            let _: () = redis::AsyncCommands::set_ex(&mut conn, &key, json, 300).await?;
            Ok(Json(serde_json::json!({"status":"connected"})))
        }
        crate::ingestion::rivian_auth::LoginResult::OtpRequired(challenge) => {
            let challenge_id = Uuid::new_v4().to_string();
            let mut conn = state.redis.get_multiplexed_async_connection().await?;
            let key = format!("rivian:otp:{challenge_id}");
            let val = serde_json::to_string(&serde_json::json!({
                "otp_token":  challenge.otp_token,
                "session_id": challenge.session_id,
                "user_id":    auth.user_id,
            })).unwrap_or_default();
            let _: () = redis::AsyncCommands::set_ex(&mut conn, &key, val, 300).await?;
            Ok(Json(serde_json::json!({"status":"otp_required","challenge_id":challenge_id})))
        }
    }
}

async fn connect_otp(
    State(state): State<AppState>,
    auth:         AuthUser,
    Json(body):   Json<OtpBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut conn = state.redis.get_multiplexed_async_connection().await?;
    let key = format!("rivian:otp:{}", body.challenge_id);
    let raw: Option<String> = redis::AsyncCommands::get(&mut conn, &key).await?;
    let raw = raw.ok_or_else(|| AppError::Validation("challenge_id expired or invalid".into()))?;

    let data: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|_| AppError::Internal(anyhow::anyhow!("corrupt challenge")))?;

    let challenge = crate::ingestion::rivian_auth::RivianOtpChallenge {
        otp_token:  data["otp_token"].as_str().unwrap_or("").to_string(),
        session_id: data["session_id"].as_str().unwrap_or("").to_string(),
    };

    let client = reqwest::Client::new();
    let tokens = crate::ingestion::rivian_auth::rivian_login_otp(&client, &challenge, &body.otp_code)
        .await
        .map_err(|e| AppError::RivianApi(e.to_string()))?;

    let connect_key = format!("rivian:connect:{}", auth.user_id);
    let json = serde_json::to_string(&tokens).unwrap_or_default();
    let _: () = redis::AsyncCommands::set_ex(&mut conn, &connect_key, json, 300).await?;
    let _: () = redis::AsyncCommands::del(&mut conn, &key).await?;

    Ok(Json(serde_json::json!({"status":"connected"})))
}

async fn add_vehicle(
    State(state): State<AppState>,
    auth:         AuthUser,
    Json(body):   Json<AddVehicleBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Retrieve tokens from Redis
    let mut conn = state.redis.get_multiplexed_async_connection().await?;
    let key = format!("rivian:connect:{}", auth.user_id);
    let raw: Option<String> = redis::AsyncCommands::get(&mut conn, &key).await?;
    let raw = raw.ok_or_else(|| AppError::Validation("complete /vehicles/connect first".into()))?;

    let tokens: crate::ingestion::session_store::RivianTokenBundle = serde_json::from_str(&raw)
        .map_err(|_| AppError::Internal(anyhow::anyhow!("corrupt token")))?;

    let identity = state.age_key.parse::<age::x25519::Identity>()
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
        vehicle_id, auth.user_id
    )
    .execute(&state.pool)
    .await?;

    // Spawn worker
    // (supervisor handle is stored in AppState in main — passed via extension)
    Ok(Json(serde_json::json!({"vehicle_id": vehicle_id})))
}

async fn list_vehicles(
    State(state): State<AppState>,
    auth:         AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query!(
        "SELECT id, rivian_vehicle_id, model, trim, name, battery_capacity_wh, \
                home_latitude, home_longitude, created_at \
         FROM riviamigo.vehicles WHERE user_id = $1 ORDER BY created_at",
        auth.user_id
    )
    .fetch_all(&state.pool)
    .await?;

    let vehicles: Vec<_> = rows.iter().map(|r| serde_json::json!({
        "id":                  r.id,
        "rivian_vehicle_id":   r.rivian_vehicle_id,
        "model":               r.model,
        "trim":                r.trim,
        "name":                r.name,
        "battery_capacity_wh": r.battery_capacity_wh,
        "home_latitude":       r.home_latitude,
        "home_longitude":      r.home_longitude,
    })).collect();

    Ok(Json(serde_json::json!({"vehicles": vehicles})))
}

async fn vehicle_status(
    State(state):               State<AppState>,
    auth:                       AuthUser,
    axum::extract::Path(vid):   axum::extract::Path<Uuid>,
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
