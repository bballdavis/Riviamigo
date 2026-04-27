//! Backend live-status WebSocket: JWT via Sec-WebSocket-Protocol, fan-out from Redis.

use axum::{
    extract::{Query, State, WebSocketUpgrade, ws::{Message, WebSocket}},
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
    middleware::auth::{AppState, Claims},
};

pub fn router() -> Router<AppState> {
    Router::new().route("/vehicles/live", get(live_handler))
}

#[derive(Deserialize)]
struct LiveParams { vehicle_id: Option<Uuid> }

async fn live_handler(
    State(state): State<AppState>,
    Query(p):     Query<LiveParams>,
    headers:      axum::http::HeaderMap,
    ws:           WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    let vid = p.vehicle_id.ok_or(AppError::Validation("vehicle_id required".into()))?;

    // Extract JWT from Sec-WebSocket-Protocol: bearer.<token>
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
    validation.set_issuer(&["riviamigo"]);

    let claims = decode::<Claims>(token, &state.jwt_keys.decoding, &validation)
        .map_err(|_| AppError::Unauthorized)?
        .claims;

    require_vehicle_owned(&state.pool, claims.sub, vid).await?;

    let redis = state.redis.clone();
    Ok(ws
        .protocols(["bearer"])
        .on_upgrade(move |socket| handle_socket(socket, vid, redis)))
}

async fn handle_socket(socket: WebSocket, vehicle_id: Uuid, redis: redis::Client) {
    let (mut sink, mut stream) = socket.split();
    let topic = format!("vehicle:{}:status", vehicle_id);

    let mut pubsub = match redis.get_async_pubsub().await {
        Ok(c) => c,
        Err(e) => { tracing::error!(err=%e, "redis pubsub connect failed"); return; }
    };
    if let Err(e) = pubsub.subscribe(&topic).await {
        tracing::error!(err=%e, "redis subscribe failed"); return;
    }

    let mut ping_interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
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
                        if sink.send(Message::Text(payload)).await.is_err() { break; }
                    }
                    None => break,
                }
            }
            _ = ping_interval.tick() => {
                if sink.send(Message::Ping(vec![])).await.is_err() { break; }
            }
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}
