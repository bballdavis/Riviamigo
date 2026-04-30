//! Rivian WebSocket subscription client with reconnect logic.

use futures::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Error as WsError, Message};
use uuid::Uuid;

use crate::ingestion::{parser, session_store::RivianTokenBundle};
use crate::models::telemetry::TelemetryEvent;

const WS_URL: &str = "wss://api.rivian.com/gql-consumer-subscriptions/graphql";

const VEHICLE_STATE_SUBSCRIPTION: &str = r#"
subscription vehicleState($vehicleID: String!) {
  vehicleState(id: $vehicleID) {
    cloudConnection { isOnline lastSync }
    powerState         { timeStamp value }
    chargerState       { timeStamp value }
    chargerStatus      { timeStamp value }
    timeToEndOfCharge  { timeStamp value }
    batteryLevel       { timeStamp value }
    batteryCapacity    { timeStamp value }
    batteryLimit       { timeStamp value }
    distanceToEmpty    { timeStamp value }
    gnssLocation       { timeStamp latitude longitude }
    gnssSpeed          { timeStamp value }
    gnssAltitude       { timeStamp value }
    gnssBearing        { timeStamp value }
    driveMode          { timeStamp value }
    gearStatus         { timeStamp value }
    vehicleMileage     { timeStamp value }
    tirePressureStatusFrontLeft  { timeStamp value }
    tirePressureStatusFrontRight { timeStamp value }
    tirePressureStatusRearLeft   { timeStamp value }
    tirePressureStatusRearRight  { timeStamp value }
    tirePressureFrontLeft        { timeStamp value }
    tirePressureFrontRight       { timeStamp value }
    tirePressureRearLeft         { timeStamp value }
    tirePressureRearRight        { timeStamp value }
    doorFrontLeftLocked  { timeStamp value }
    doorFrontRightLocked { timeStamp value }
    doorRearLeftLocked   { timeStamp value }
    doorRearRightLocked  { timeStamp value }
    doorFrontLeftClosed  { timeStamp value }
    doorFrontRightClosed { timeStamp value }
    doorRearLeftClosed   { timeStamp value }
    doorRearRightClosed  { timeStamp value }
    closureFrunkLocked    { timeStamp value }
    closureFrunkClosed    { timeStamp value }
    closureLiftgateLocked { timeStamp value }
    closureLiftgateClosed { timeStamp value }
    closureTailgateLocked { timeStamp value }
    closureTailgateClosed { timeStamp value }
    otaAvailableVersion { timeStamp value }
    otaCurrentVersion   { timeStamp value }
    otaStatus           { timeStamp value }
    otaCurrentStatus    { timeStamp value }
    cabinClimateInteriorTemperature { timeStamp value }
    cabinClimateDriverTemperature   { timeStamp value }
    batteryHvThermalEvent           { timeStamp value }
    twelveVoltBatteryHealth         { timeStamp value }
  }
}
"#;

pub async fn run_ws_loop(
    vehicle_id: Uuid,
    rivian_veh_id: String,
    tokens: RivianTokenBundle,
    tx: mpsc::Sender<TelemetryEvent>,
    mut shutdown: tokio::sync::broadcast::Receiver<()>,
) {
    let mut backoff_secs = 1u64;

    loop {
        match connect_and_subscribe(&vehicle_id, &rivian_veh_id, &tokens, &tx, &mut shutdown).await
        {
            Ok(()) => {
                tracing::info!(vehicle_id = %vehicle_id, "WS connection closed gracefully");
                break;
            }
            Err(e) => {
                tracing::warn!(vehicle_id = %vehicle_id, err = %e, backoff = backoff_secs, "WS error, reconnecting");
                tokio::select! {
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(backoff_secs)) => {}
                    _ = shutdown.recv() => { break; }
                }
                backoff_secs = (backoff_secs * 2).min(60);
            }
        }
    }
}

async fn connect_and_subscribe(
    vehicle_id: &Uuid,
    rivian_veh_id: &str,
    tokens: &RivianTokenBundle,
    tx: &mpsc::Sender<TelemetryEvent>,
    shutdown: &mut tokio::sync::broadcast::Receiver<()>,
) -> anyhow::Result<()> {
    let request = build_rivian_ws_request()?;

    let (mut ws, _) = match tokio_tungstenite::connect_async(request).await {
        Ok(connection) => connection,
        Err(WsError::Http(response)) => {
            let status = response.status();
            tracing::warn!(
                vehicle_id = %vehicle_id,
                rivian_vehicle_id = %rivian_veh_id,
                http_status = status.as_u16(),
                "Rivian WS handshake rejected"
            );
            anyhow::bail!("Rivian WS handshake rejected with HTTP {}", status);
        }
        Err(e) => return Err(e.into()),
    };

    // connection_init
    ws.send(Message::Text(
        json!({
            "type": "connection_init",
            "payload": {
                "client-name": "com.rivian.ios.consumer-apollo-ios",
                "client-version": "1.13.0-1494",
                "dc-cid": format!("m-ios-{}", uuid::Uuid::new_v4()),
                "u-sess": &tokens.user_session_token
            }
        })
        .to_string(),
    ))
    .await?;

    // Wait for connection_ack; handle PING frames that may arrive before ack
    loop {
        match ws.next().await {
            Some(Ok(Message::Text(t))) => {
                let v: serde_json::Value = serde_json::from_str(&t).unwrap_or_default();
                if v.get("type").and_then(|x| x.as_str()) == Some("connection_ack") {
                    break;
                }
                tracing::warn!(
                    vehicle_id = %vehicle_id,
                    message = %truncate_ws_message(&t),
                    "Rivian WS message before ack"
                );
            }
            Some(Ok(Message::Ping(data))) => {
                ws.send(Message::Pong(data)).await?;
            }
            Some(Ok(_)) => {}
            _ => anyhow::bail!("connection closed before ack"),
        }
    }

    // Subscribe
    let sub = json!({
        "id": "1",
        "type": "subscribe",
        "payload": {
            "operationName": "vehicleState",
            "query": VEHICLE_STATE_SUBSCRIPTION,
            "variables": { "vehicleID": rivian_veh_id }
        }
    });
    ws.send(Message::Text(sub.to_string())).await?;

    loop {
        tokio::select! {
            _ = shutdown.recv() => { return Ok(()); }
            msg = ws.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match parser::parse_ws_message(&text, *vehicle_id) {
                            Ok(Some(event)) => { let _ = tx.send(event).await; }
                            Ok(None) => tracing::warn!(
                                vehicle_id = %vehicle_id,
                                message = %truncate_ws_message(&text),
                                "Rivian WS non-data message"
                            ),
                            Err(e) => tracing::warn!(err = %e, "parse error"),
                        }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        ws.send(Message::Pong(data)).await?;
                    }
                    Some(Ok(Message::Close(frame))) => {
                        tracing::warn!(
                            vehicle_id = %vehicle_id,
                            close_code = frame.as_ref().map(|f| f.code.to_string()),
                            close_reason = frame.as_ref().map(|f| f.reason.to_string()),
                            "Rivian WS close frame"
                        );
                        anyhow::bail!("WS closed");
                    }
                    None => {
                        anyhow::bail!("WS closed");
                    }
                    _ => {}
                }
            }
        }
    }
}

fn build_rivian_ws_request(
) -> anyhow::Result<tokio_tungstenite::tungstenite::handshake::client::Request> {
    let mut request = WS_URL.into_client_request()?;
    request
        .headers_mut()
        .insert("Sec-WebSocket-Protocol", "graphql-transport-ws".parse()?);
    Ok(request)
}

fn truncate_ws_message(value: &str) -> String {
    const MAX_LEN: usize = 500;
    if value.len() <= MAX_LEN {
        return value.to_string();
    }
    format!("{}...", &value[..MAX_LEN])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rivian_ws_request_includes_required_handshake_headers() {
        let request = build_rivian_ws_request().expect("request");
        let headers = request.headers();

        assert_eq!(
            headers
                .get("Sec-WebSocket-Protocol")
                .and_then(|v| v.to_str().ok()),
            Some("graphql-transport-ws")
        );
        assert!(headers.contains_key("Host"));
        assert!(headers.contains_key("Connection"));
        assert!(headers.contains_key("Upgrade"));
        assert!(headers.contains_key("Sec-WebSocket-Version"));
        assert!(headers.contains_key("Sec-WebSocket-Key"));
    }
}
