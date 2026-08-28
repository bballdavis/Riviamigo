//! Backend live-status WebSocket: JWT via Sec-WebSocket-Protocol, fan-out from Redis.

use axum::{
    extract::{
        ws::{Message, WebSocket},
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

    require_vehicle_membership(&state.pool, claims.sub, vid).await?;

    let redis = state.redis.clone();
    Ok(ws
        .protocols(["bearer"])
        .on_upgrade(move |socket| handle_socket(socket, vid, redis)))
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

async fn handle_socket(socket: WebSocket, vehicle_id: Uuid, redis: redis::Client) {
    let (mut sink, mut stream) = socket.split();
    let topic = format!("vehicle:{vehicle_id}:status");

    let mut pubsub = match redis.get_async_pubsub().await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(err=%e, "redis pubsub connect failed");
            return;
        }
    };
    if let Err(e) = pubsub.subscribe(&topic).await {
        tracing::error!(err=%e, "redis subscribe failed");
        return;
    }

    let mut keepalive_interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
    let mut msg_stream = pubsub.into_on_message();

    loop {
        tokio::select! {
            msg = msg_stream.next() => {
                match msg {
                    Some(m) => {
                        let payload: String = match m.get_payload() {
                            Ok(p) => p,
                            Err(_) => continue,
                        };
                        if sink.send(Message::Text(payload.into())).await.is_err() { break; }
                    }
                    None => break,
                }
            }
            _ = keepalive_interval.tick() => {
                if sink.send(Message::Text(LIVE_KEEPALIVE_MESSAGE.into())).await.is_err() { break; }
                if sink.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
            }
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) if is_live_probe(text.as_str()) => {
                        if sink.send(Message::Text(LIVE_KEEPALIVE_MESSAGE.into())).await.is_err() { break; }
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;
    use uuid::Uuid;

    use crate::{
        keys::generate_keys,
        middleware::auth::{issue_access_token, JwtKeys},
    };

    fn make_keys() -> JwtKeys {
        let k = generate_keys().expect("key generation");
        JwtKeys::new(&k.jwt_private_pem, &k.jwt_public_pem).expect("JwtKeys::new")
    }

    fn headers_with_proto(proto: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            "sec-websocket-protocol",
            proto.parse().expect("header value"),
        );
        h
    }

    #[test]
    fn missing_proto_header_is_unauthorized() {
        let keys = make_keys();
        let result = extract_jwt_from_headers(&HeaderMap::new(), &keys);
        assert!(matches!(result, Err(AppError::Unauthorized)));
    }

    #[test]
    fn proto_without_bearer_prefix_is_unauthorized() {
        let keys = make_keys();
        let result = extract_jwt_from_headers(&headers_with_proto("graphql-ws"), &keys);
        assert!(matches!(result, Err(AppError::Unauthorized)));
    }

    #[test]
    fn malformed_jwt_is_unauthorized() {
        let keys = make_keys();
        let result = extract_jwt_from_headers(&headers_with_proto("bearer.notavalidtoken"), &keys);
        assert!(matches!(result, Err(AppError::Unauthorized)));
    }

    #[test]
    fn jwt_signed_by_different_key_is_unauthorized() {
        let keys = make_keys();
        let other_keys = make_keys();
        let user_id = Uuid::new_v4();
        // Sign with `other_keys`, verify with `keys` → should fail
        let token = issue_access_token(user_id, None, &other_keys).expect("issue_access_token");
        let result =
            extract_jwt_from_headers(&headers_with_proto(&format!("bearer.{token}")), &keys);
        assert!(matches!(result, Err(AppError::Unauthorized)));
    }

    #[test]
    fn valid_jwt_returns_correct_claims() {
        let keys = make_keys();
        let user_id = Uuid::new_v4();
        let vid = Uuid::new_v4();
        let token = issue_access_token(user_id, Some(vid), &keys).expect("issue_access_token");
        let claims =
            extract_jwt_from_headers(&headers_with_proto(&format!("bearer.{token}")), &keys)
                .expect("valid JWT should succeed");
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.iss, "riviamigo.app");
        assert_eq!(claims.default_vehicle_id, Some(vid));
    }

    #[test]
    fn websocket_auth_accepts_standard_access_tokens() {
        let keys = make_keys();
        let user_id = Uuid::new_v4();
        let token = issue_access_token(user_id, None, &keys).expect("issue_access_token");

        let claims =
            extract_jwt_from_headers(&headers_with_proto(&format!("bearer.{token}")), &keys)
                .expect("websocket auth should accept normal API access tokens");

        assert_eq!(claims.sub, user_id);
    }

    #[test]
    fn bearer_with_surrounding_protocols_is_parsed() {
        let keys = make_keys();
        let user_id = Uuid::new_v4();
        let token = issue_access_token(user_id, None, &keys).expect("issue_access_token");
        // Browsers may send multiple subprotocols separated by commas
        let proto = format!("graphql-ws, bearer.{token}, some-other");
        let claims = extract_jwt_from_headers(&headers_with_proto(&proto), &keys)
            .expect("should find bearer. among multiple protocols");
        assert_eq!(claims.sub, user_id);
    }

    #[test]
    fn recognizes_only_probe_control_messages() {
        assert!(is_live_probe(r#"{"type":"probe"}"#));
        assert!(is_live_probe(r#"{"type":"probe","request_id":"ignored"}"#));
        assert!(!is_live_probe(r#"{"type":"keepalive"}"#));
        assert!(!is_live_probe(r#"{"vehicle_id":"not-a-probe"}"#));
        assert!(!is_live_probe("not-json"));
    }

    #[test]
    fn keepalive_message_contains_no_vehicle_data() {
        assert_eq!(LIVE_KEEPALIVE_MESSAGE, r#"{"type":"keepalive"}"#);
    }

    #[test]
    fn live_session_response_returns_200_for_a_snapshot() {
        let response = live_session_response(Some(r#"{"power_kw":9.6}"#.to_string()));
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("application/json")
        );
    }

    #[test]
    fn live_session_response_returns_204_without_a_snapshot() {
        let response = live_session_response(None);
        assert_eq!(response.status(), axum::http::StatusCode::NO_CONTENT);
    }

    #[test]
    fn fresh_parallax_fields_override_legacy_individually() {
        let now = Utc::now();
        let merged = merge_live_session(
            Some(r#"{"power_kw":7.2,"energy_kwh":3.1,"ts":"2026-08-28T10:00:00Z"}"#.into()),
            Some(ActiveLiveSession {
                parallax_live_power_kw: Some(11.4),
                parallax_total_charged_kwh: None,
                parallax_pack_energy_kwh: Some(2.8),
                parallax_thermal_energy_kwh: None,
                parallax_time_remaining_minutes: Some(42),
                parallax_power_observed_at: Some(now),
                parallax_total_energy_observed_at: Some(now),
                parallax_pack_energy_observed_at: Some(now),
                parallax_thermal_energy_observed_at: None,
                parallax_time_observed_at: Some(now),
            }),
            now,
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(value["power_kw"], 11.4);
        assert_eq!(value["energy_kwh"], 3.1);
        assert_eq!(value["pack_energy_kwh"], 2.8);
        assert_eq!(value["provenance"]["power_kw"]["source"], "parallax");
        assert_eq!(
            value["provenance"]["energy_kwh"]["source"],
            "legacy_charging_session"
        );
    }

    #[test]
    fn stale_parallax_never_replaces_legacy_and_no_active_session_returns_none() {
        let now = Utc::now();
        let active = ActiveLiveSession {
            parallax_live_power_kw: Some(99.0),
            parallax_total_charged_kwh: None,
            parallax_pack_energy_kwh: None,
            parallax_thermal_energy_kwh: None,
            parallax_time_remaining_minutes: None,
            parallax_power_observed_at: Some(now - chrono::Duration::minutes(3)),
            parallax_total_energy_observed_at: None,
            parallax_pack_energy_observed_at: None,
            parallax_thermal_energy_observed_at: None,
            parallax_time_observed_at: None,
        };
        let merged =
            merge_live_session(Some(r#"{"power_kw":6.6}"#.into()), Some(active), now).unwrap();
        let value: serde_json::Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(value["power_kw"], 6.6);
        assert!(merge_live_session(Some(r#"{"power_kw":6.6}"#.into()), None, now).is_none());
    }
}
