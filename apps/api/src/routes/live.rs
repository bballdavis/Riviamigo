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
use futures::{SinkExt, StreamExt};
use jsonwebtoken::{decode, Algorithm, Validation};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_owned,
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

    require_vehicle_owned(&state.pool, claims.sub, vid).await?;

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
    require_vehicle_owned(&state.pool, auth.user_id, vehicle_id).await?;

    let key = format!("vehicle:{vehicle_id}:live_session");
    let mut conn = state.redis.get_multiplexed_async_connection().await?;
    let raw: Option<String> = redis::AsyncCommands::get(&mut conn, &key).await?;

    Ok(live_session_response(raw))
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
}
