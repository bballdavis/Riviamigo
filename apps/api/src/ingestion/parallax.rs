//! Read-only Parallax protobuf stream capture.
//!
//! This module intentionally does not decode protobuf payloads yet. It keeps
//! the RVM topic, timestamps, and base64 payload intact so schema discovery can
//! happen offline without coupling experimental fields to the telemetry model.

use chrono::{DateTime, TimeZone, Utc};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest, protocol::CloseFrame, Error as WsError, Message,
};
use uuid::Uuid;

use crate::ingestion::session_store::RivianTokenBundle;

const WS_URL: &str = "wss://api.rivian.com/gql-consumer-subscriptions/graphql";
const GRAPHQL_PROTOCOL: &str = "graphql-transport-ws";
const RIVIAN_CONNECTION_TTL_EXPIRED_CODE: u16 = 4420;
const RIVIAN_CONNECTION_TTL_EXPIRED_REASON: &str = "Connection TTL expired";

/// Read-only topics selected for the initial capture pass. These are kept
/// explicit because the server may reject an unknown topic in the whole
/// subscription. More topics can be added after the first capture review.
pub const CAPTURE_RVMS: &[&str] = &[
    "energy.high_voltage.battery_state",
    "energy.high_voltage.battery_characteristics",
    "energy.low_voltage.battery_state",
    "dynamics.vehicle.drive_mode",
    "dynamics.vehicle.gear",
    "dynamics.vehicle.range",
    "dynamics.vehicle.odometer",
    "dynamics.vehicle.gnss",
    "dynamics.vehicle.location",
    "vehicle.power.state",
];

#[derive(Debug, Clone)]
pub struct ParallaxEvent {
    pub received_at: DateTime<Utc>,
    pub server_timestamp: Option<DateTime<Utc>>,
    pub rvm: String,
    pub payload_b64: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParallaxConnectionEnd {
    Shutdown,
    ConnectionTtlExpired,
}

/// Keep a Parallax connection alive and reconnect it using the same bounded
/// backoff policy as the legacy collector. The task exits only on shutdown.
pub async fn run_loop(
    vehicle_id: Uuid,
    rivian_vehicle_id: String,
    tokens: RivianTokenBundle,
    tx: mpsc::Sender<ParallaxEvent>,
    mut shutdown: broadcast::Receiver<()>,
    reconnect_initial_seconds: u64,
    reconnect_max_seconds: u64,
) {
    let initial_backoff_seconds = reconnect_initial_seconds.max(1);
    let max_backoff_seconds = reconnect_max_seconds.max(initial_backoff_seconds);
    let mut backoff_seconds = initial_backoff_seconds;

    loop {
        match run_connection(vehicle_id, &rivian_vehicle_id, &tokens, &tx, &mut shutdown).await {
            Ok(ParallaxConnectionEnd::Shutdown) => return,
            Ok(ParallaxConnectionEnd::ConnectionTtlExpired) => {
                tracing::info!(
                    vehicle_id = %vehicle_id,
                    "Parallax connection TTL expired; renewing subscription"
                );
                backoff_seconds = initial_backoff_seconds;
                continue;
            }
            Err(error) => {
                tracing::warn!(
                    vehicle_id = %vehicle_id,
                    error = %error,
                    backoff_seconds,
                    "Parallax capture connection failed; retrying"
                );
            }
        }

        tokio::select! {
            _ = shutdown.recv() => return,
            _ = tokio::time::sleep(std::time::Duration::from_secs(backoff_seconds)) => {}
        }
        backoff_seconds = backoff_seconds.saturating_mul(2).min(max_backoff_seconds);
    }
}

async fn run_connection(
    vehicle_id: Uuid,
    rivian_vehicle_id: &str,
    tokens: &RivianTokenBundle,
    tx: &mpsc::Sender<ParallaxEvent>,
    shutdown: &mut broadcast::Receiver<()>,
) -> anyhow::Result<ParallaxConnectionEnd> {
    let mut request = WS_URL.into_client_request()?;
    request
        .headers_mut()
        .insert("Sec-WebSocket-Protocol", GRAPHQL_PROTOCOL.parse()?);
    insert_header(request.headers_mut(), "A-Sess", &tokens.app_session_token)?;
    insert_header(request.headers_mut(), "U-Sess", &tokens.user_session_token)?;
    insert_header(request.headers_mut(), "Csrf-Token", &tokens.csrf_token)?;
    request.headers_mut().insert(
        "Apollographql-Client-Name",
        "com.rivian.android.consumer".parse()?,
    );

    let (mut ws, _) = match tokio_tungstenite::connect_async(request).await {
        Ok(connection) => connection,
        Err(WsError::Http(response)) => {
            anyhow::bail!(
                "Parallax WebSocket handshake rejected with HTTP {}",
                response.status()
            );
        }
        Err(error) => return Err(error.into()),
    };

    ws.send(Message::Text(
        json!({
            "type": "connection_init",
            "payload": {
                "client-name": "com.rivian.android.consumer",
                "u-sess": &tokens.user_session_token
            }
        })
        .to_string(),
    ))
    .await?;

    loop {
        tokio::select! {
            _ = shutdown.recv() => return Ok(ParallaxConnectionEnd::Shutdown),
            message = ws.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        let value: Value = serde_json::from_str(&text).unwrap_or_default();
                        if value.get("type").and_then(Value::as_str) == Some("connection_ack") {
                            break;
                        }
                        if value.get("type").and_then(Value::as_str) == Some("error") {
                            anyhow::bail!("Parallax connection rejected: {}", truncate(&text));
                        }
                    }
                    Some(Ok(Message::Ping(data))) => ws.send(Message::Pong(data)).await?,
                    Some(Ok(Message::Close(frame))) => {
                        if is_connection_ttl_expired(frame.as_ref()) {
                            return Ok(ParallaxConnectionEnd::ConnectionTtlExpired);
                        }
                        anyhow::bail!("Parallax WebSocket closed: {:?}", frame);
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => return Err(error.into()),
                    None => anyhow::bail!("Parallax WebSocket closed before connection_ack"),
                }
            }
        }
    }

    ws.send(Message::Text(subscription_message(rivian_vehicle_id)))
        .await?;
    tracing::info!(
        vehicle_id = %vehicle_id,
        rvm_count = CAPTURE_RVMS.len(),
        "Parallax subscription acknowledged and submitted"
    );

    loop {
        tokio::select! {
            _ = shutdown.recv() => return Ok(ParallaxConnectionEnd::Shutdown),
            message = ws.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        let received_at = Utc::now();
                        let value: Value = serde_json::from_str(&text)?;
                        match value.get("type").and_then(Value::as_str) {
                            Some("next") => {
                                if let Some(event) = parse_next_message(&value, received_at)? {
                                    tx.send(event).await.map_err(|_| anyhow::anyhow!("Parallax capture channel closed"))?;
                                }
                            }
                            Some("error") => anyhow::bail!("Parallax subscription rejected: {}", truncate(&text)),
                            Some("complete") => anyhow::bail!("Parallax subscription completed by server"),
                            _ => {}
                        }
                    }
                    Some(Ok(Message::Ping(data))) => ws.send(Message::Pong(data)).await?,
                    Some(Ok(Message::Close(frame))) => {
                        if is_connection_ttl_expired(frame.as_ref()) {
                            return Ok(ParallaxConnectionEnd::ConnectionTtlExpired);
                        }
                        anyhow::bail!("Parallax WebSocket closed: {:?}", frame);
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => return Err(error.into()),
                    None => anyhow::bail!("Parallax WebSocket closed"),
                }
            }
        }
    }
}

fn is_connection_ttl_expired(frame: Option<&CloseFrame<'_>>) -> bool {
    frame.is_some_and(|frame| {
        u16::from(frame.code) == RIVIAN_CONNECTION_TTL_EXPIRED_CODE
            && frame.reason.as_ref() == RIVIAN_CONNECTION_TTL_EXPIRED_REASON
    })
}

fn insert_header(
    headers: &mut tokio_tungstenite::tungstenite::http::HeaderMap,
    name: &'static str,
    value: &str,
) -> anyhow::Result<()> {
    if !value.is_empty() {
        headers.insert(name, value.parse()?);
    }
    Ok(())
}

fn subscription_message(vehicle_id: &str) -> String {
    json!({
        "id": format!("parallax-{}", Uuid::new_v4()),
        "type": "subscribe",
        "payload": {
            "operationName": "ParallaxMessages",
            "variables": {
                "vehicleId": vehicle_id,
                "rvms": CAPTURE_RVMS
            },
            "query": "subscription ParallaxMessages($vehicleId: String!, $rvms: [String!]) { parallaxMessages(vehicleId: $vehicleId, rvms: $rvms) { payload timestamp rvm } }"
        }
    })
    .to_string()
}

fn parse_next_message(
    value: &Value,
    received_at: DateTime<Utc>,
) -> anyhow::Result<Option<ParallaxEvent>> {
    let Some(message) = value.pointer("/payload/data/parallaxMessages") else {
        return Ok(None);
    };
    let Some(rvm) = message.get("rvm").and_then(Value::as_str) else {
        return Ok(None);
    };
    let Some(payload_b64) = message.get("payload").and_then(Value::as_str) else {
        return Ok(None);
    };

    Ok(Some(ParallaxEvent {
        received_at,
        server_timestamp: parse_timestamp(message.get("timestamp")),
        rvm: rvm.to_string(),
        payload_b64: payload_b64.to_string(),
    }))
}

fn parse_timestamp(value: Option<&Value>) -> Option<DateTime<Utc>> {
    let millis = value
        .and_then(Value::as_i64)
        .or_else(|| value.and_then(Value::as_str)?.parse::<i64>().ok())?;
    Utc.timestamp_millis_opt(millis).single()
}

fn truncate(value: &str) -> String {
    const MAX_LEN: usize = 500;
    if value.len() <= MAX_LEN {
        value.to_string()
    } else {
        format!("{}...", &value[..MAX_LEN])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_parallax_subscription_with_correct_vehicle_id_variable() {
        let message: Value = serde_json::from_str(&subscription_message("vehicle-123")).unwrap();
        assert_eq!(message["payload"]["operationName"], "ParallaxMessages");
        assert_eq!(message["payload"]["variables"]["vehicleId"], "vehicle-123");
        assert!(message["payload"]["variables"]["rvms"]
            .as_array()
            .is_some_and(|rvms| rvms.iter().any(|rvm| rvm == "vehicle.power.state")));
    }

    #[test]
    fn parses_binary_payload_envelope_without_decoding_it() {
        let value = json!({
            "type": "next",
            "payload": {
                "data": {
                    "parallaxMessages": {
                        "rvm": "energy.high_voltage.battery_state",
                        "timestamp": 1700000000000_i64,
                        "payload": "CkIKBAAAADMzT0A="
                    }
                }
            }
        });

        let event = parse_next_message(&value, Utc::now()).unwrap().unwrap();
        assert_eq!(event.rvm, "energy.high_voltage.battery_state");
        assert_eq!(event.payload_b64, "CkIKBAAAADMzT0A=");
        assert_eq!(event.server_timestamp.unwrap().timestamp(), 1_700_000_000);
    }

    #[test]
    fn accepts_empty_payloads_for_raw_capture() {
        let value = json!({
            "type": "next",
            "payload": {
                "data": {
                    "parallaxMessages": {
                        "rvm": "vehicle.power.state",
                        "timestamp": "1700000000000",
                        "payload": ""
                    }
                }
            }
        });

        let event = parse_next_message(&value, Utc::now()).unwrap().unwrap();
        assert!(event.payload_b64.is_empty());
    }

    #[test]
    fn classifies_rivian_ttl_close_as_renewable() {
        let frame = CloseFrame {
            code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Library(
                RIVIAN_CONNECTION_TTL_EXPIRED_CODE,
            ),
            reason: RIVIAN_CONNECTION_TTL_EXPIRED_REASON.into(),
        };

        assert!(is_connection_ttl_expired(Some(&frame)));
    }

    #[test]
    fn does_not_classify_other_close_as_ttl() {
        let frame = CloseFrame {
            code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Library(4410),
            reason: "Socket with no active subscriptions, disconnecting".into(),
        };

        assert!(!is_connection_ttl_expired(Some(&frame)));
        assert!(!is_connection_ttl_expired(None));
    }
}
