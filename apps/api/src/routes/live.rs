//! Backend live-status WebSocket: JWT via Sec-WebSocket-Protocol, fan-out from Redis.

use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use futures::{SinkExt, StreamExt};
use jsonwebtoken::{decode, Algorithm, Validation};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    db::vehicles::{require_vehicle_membership, require_vehicle_read_access},
    errors::AppError,
    middleware::auth::{require_vehicle_access, AppState, AuthUser, Claims},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/vehicles/live", get(live_handler))
        .route("/vehicles/{id}/live-session", get(live_session_handler))
}

#[derive(Deserialize)]
struct LiveParams {
    vehicle_id: Option<Uuid>,
}

const LIVE_KEEPALIVE_MESSAGE: &str = r#"{"type":"keepalive"}"#;

#[derive(Deserialize)]
struct LiveClientControlMessage {
    #[serde(rename = "type")]
    message_type: Option<String>,
}

fn is_live_probe(message: &str) -> bool {
    serde_json::from_str::<LiveClientControlMessage>(message)
        .ok()
        .and_then(|control| control.message_type)
        .as_deref()
        == Some("probe")
}

/// Extract and validate a JWT from the `Sec-WebSocket-Protocol: bearer.<token>` header.
/// Returns the decoded claims on success.
pub(crate) fn extract_jwt_from_headers(
    headers: &axum::http::HeaderMap,
    jwt_keys: &crate::middleware::auth::JwtKeys,
) -> Result<Claims, AppError> {
    let proto_header = headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let token = proto_header
        .split(',')
        .map(str::trim)
        .find_map(|p| p.strip_prefix("bearer."))
        .ok_or(AppError::Unauthorized)?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&["riviamigo.app"]);
    validation.leeway = 0;

    decode::<Claims>(token, &jwt_keys.decoding, &validation)
        .map_err(|_| AppError::Unauthorized)
        .map(|d| d.claims)
}

async fn live_handler(
    State(state): State<AppState>,
    Query(p): Query<LiveParams>,
    headers: axum::http::HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;

    let claims = extract_jwt_from_headers(&headers, &state.jwt_keys)?;
    crate::services::sessions::require_enabled_session(&state.pool, &claims).await?;
    require_vehicle_membership(&state.pool, claims.sub, vid).await?;
    let permit = state
        .resources
        .live(claims.sub, vid, &state.config.security)?;
    Ok(ws
        .max_message_size(4096)
        .max_frame_size(4096)
        .protocols(["bearer"])
        .on_upgrade(move |socket| handle_socket(socket, vid, state, claims, permit)))
}

/// GET /v1/vehicles/{id}/live-session
/// Returns the latest live charging session data from Redis (written by run_poll_loop).
/// Returns 204 No Content when no live session is active.
async fn live_session_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_vehicle_access(&auth, vehicle_id)?;
    require_vehicle_read_access(&state.pool, &auth, vehicle_id).await?;

    let key = format!("vehicle:{vehicle_id}:live_session");
    let mut conn = state.redis.get_multiplexed_async_connection().await?;
    let raw: Option<String> = redis::AsyncCommands::get(&mut conn, &key).await?;
    let active = sqlx::query_as::<_, ActiveLiveSession>(
        r#"SELECT parallax_live_power_kw,parallax_total_charged_kwh,
                  parallax_pack_energy_kwh,parallax_thermal_energy_kwh,
                  parallax_time_remaining_minutes,parallax_power_observed_at,
                  parallax_total_energy_observed_at,parallax_pack_energy_observed_at,
                  parallax_thermal_energy_observed_at,parallax_time_observed_at
           FROM riviamigo.charge_sessions
           WHERE vehicle_id=$1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1"#,
    )
    .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await?;

    Ok(live_session_response(merge_live_session(
        raw,
        active,
        Utc::now(),
    )))
}

#[derive(sqlx::FromRow)]
struct ActiveLiveSession {
    parallax_live_power_kw: Option<f64>,
    parallax_total_charged_kwh: Option<f64>,
    parallax_pack_energy_kwh: Option<f64>,
    parallax_thermal_energy_kwh: Option<f64>,
    parallax_time_remaining_minutes: Option<i32>,
    parallax_power_observed_at: Option<DateTime<Utc>>,
    parallax_total_energy_observed_at: Option<DateTime<Utc>>,
    parallax_pack_energy_observed_at: Option<DateTime<Utc>>,
    parallax_thermal_energy_observed_at: Option<DateTime<Utc>>,
    parallax_time_observed_at: Option<DateTime<Utc>>,
}

fn merge_live_session(
    raw: Option<String>,
    active: Option<ActiveLiveSession>,
    now: DateTime<Utc>,
) -> Option<String> {
    let active = active?;
    let mut value = raw
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    let object = value.as_object_mut().expect("object initialized above");
    let legacy_at = object
        .get("ts")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let mut provenance = serde_json::Map::new();
    for field in ["power_kw", "energy_kwh", "time_remaining_min"] {
        if object.get(field).is_some_and(|value| !value.is_null()) {
            provenance.insert(
                field.into(),
                serde_json::json!({"source":"legacy_charging_session","observed_at":legacy_at}),
            );
        }
    }
    let fresh = |observed: Option<DateTime<Utc>>| {
        observed.filter(|ts| *ts >= now - chrono::Duration::seconds(120))
    };
    if let Some(observed) = fresh(active.parallax_power_observed_at) {
        if let Some(power) = active.parallax_live_power_kw {
            object.insert("power_kw".into(), serde_json::json!(power));
            provenance.insert(
                "power_kw".into(),
                serde_json::json!({"source":"parallax","observed_at":observed}),
            );
        }
    }
    for (field, field_value, observed_at) in [
        (
            "energy_kwh",
            active.parallax_total_charged_kwh,
            active.parallax_total_energy_observed_at,
        ),
        (
            "pack_energy_kwh",
            active.parallax_pack_energy_kwh,
            active.parallax_pack_energy_observed_at,
        ),
        (
            "thermal_energy_kwh",
            active.parallax_thermal_energy_kwh,
            active.parallax_thermal_energy_observed_at,
        ),
    ] {
        if let (Some(field_value), Some(observed)) = (field_value, fresh(observed_at)) {
            object.insert(field.into(), serde_json::json!(field_value));
            provenance.insert(
                field.into(),
                serde_json::json!({"source":"parallax","observed_at":observed}),
            );
        }
    }
    if let Some(observed) = fresh(active.parallax_time_observed_at) {
        if let Some(minutes) = active.parallax_time_remaining_minutes {
            object.insert("time_remaining_min".into(), serde_json::json!(minutes));
            provenance.insert(
                "time_remaining_min".into(),
                serde_json::json!({"source":"parallax","observed_at":observed}),
            );
        }
    }
    if !provenance.is_empty() {
        object.insert("provenance".into(), provenance.into());
    }
    if object.is_empty() {
        None
    } else {
        serde_json::to_string(&value).ok()
    }
}

fn live_session_response(raw: Option<String>) -> axum::response::Response {
    match raw {
        Some(json) => {
            let value: serde_json::Value =
                serde_json::from_str(&json).unwrap_or(serde_json::Value::Null);
            axum::response::Response::builder()
                .status(200)
                .header("content-type", "application/json")
                .body(axum::body::Body::from(
                    serde_json::to_string(&value).unwrap_or_default(),
                ))
                .unwrap()
        }
        None => axum::response::Response::builder()
            .status(204)
            .body(axum::body::Body::empty())
            .unwrap(),
    }
}

async fn handle_socket(
    socket: WebSocket,
    vehicle_id: Uuid,
    state: AppState,
    claims: Claims,
    _permit: crate::services::resource_limits::ResourcePermit,
) {
    let (mut sink, mut stream) = socket.split();
    let topic = format!("vehicle:{vehicle_id}:status");
    let remaining = chrono::DateTime::from_timestamp(claims.exp, 0)
        .map(|expires| (expires - Utc::now()).to_std().unwrap_or_default())
        .unwrap_or_default();
    let expiry = tokio::time::Instant::now() + remaining;

    let mut pubsub = match tokio::time::timeout_at(
        expiry.min(tokio::time::Instant::now() + std::time::Duration::from_secs(5)),
        state.redis.get_async_pubsub(),
    )
    .await
    {
        Ok(Ok(c)) => c,
        _ => {
            tracing::error!("redis pubsub connect failed or timed out");
            return;
        }
    };
    if !matches!(
        tokio::time::timeout_at(
            expiry.min(tokio::time::Instant::now() + std::time::Duration::from_secs(5)),
            pubsub.subscribe(&topic)
        )
        .await,
        Ok(Ok(()))
    ) {
        tracing::error!("redis subscribe failed");
        return;
    }

    let mut keepalive_interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
    let mut msg_stream = pubsub.into_on_message();

    loop {
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(expiry) => {
                close_live(&mut sink, 4401, "Session expired").await;
                break;
            }
            msg = msg_stream.next() => {
                match msg {
                    Some(m) => {
                        let payload: String = match m.get_payload() {
                            Ok(p) => p,
                            Err(_) => continue,
                        };
                        if !send_live(&mut sink, Message::Text(payload.into()), expiry).await { break; }
                    }
                    None => break,
                }
            }
            _ = keepalive_interval.tick() => {
                let authorization = tokio::time::timeout_at(expiry.min(tokio::time::Instant::now() + std::time::Duration::from_secs(5)), async {
                    crate::services::sessions::require_enabled_session(&state.pool, &claims).await
                        .map_err(|error| match error { AppError::Forbidden | AppError::Unauthorized => (4401, "Session ended"), _ => (1011, "Authorization unavailable") })?;
                    require_vehicle_membership(&state.pool, claims.sub, vehicle_id).await
                        .map_err(|error| match error { AppError::Forbidden | AppError::NotFound => (4403, "Vehicle access removed"), _ => (1011, "Authorization unavailable") })
                }).await;
                match authorization {
                    Ok(Ok(_)) => {},
                    Ok(Err((code, reason))) => {
                        close_live(&mut sink, code, reason).await;
                        break;
                    }
                    _ => { close_live(&mut sink, 1011, "Authorization unavailable").await; break; }
                }
                if !send_live(&mut sink, Message::Text(LIVE_KEEPALIVE_MESSAGE.into()), expiry).await { break; }
                if !send_live(&mut sink, Message::Ping(Vec::new().into()), expiry).await { break; }
            }
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) if is_live_probe(text.as_str()) => {
                        if !send_live(&mut sink, Message::Text(LIVE_KEEPALIVE_MESSAGE.into()), expiry).await { break; }
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

async fn send_live(
    sink: &mut futures::stream::SplitSink<WebSocket, Message>,
    message: Message,
    expiry: tokio::time::Instant,
) -> bool {
    matches!(
        tokio::time::timeout_at(
            expiry.min(tokio::time::Instant::now() + std::time::Duration::from_secs(5)),
            sink.send(message)
        )
        .await,
        Ok(Ok(()))
    )
}

async fn close_live(
    sink: &mut futures::stream::SplitSink<WebSocket, Message>,
    code: u16,
    reason: &'static str,
) {
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        sink.send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        }))),
    )
    .await;
}

#[cfg(test)]
mod tests;
