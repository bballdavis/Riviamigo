//! Rivian WebSocket subscription client with reconnect logic.

use futures::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async_tls_with_config, tungstenite::Message};
use uuid::Uuid;

use crate::ingestion::{parser, session_store::RivianTokenBundle};
use crate::models::telemetry::TelemetryEvent;

const WS_URL: &str = "wss://api.rivian.com/gql-consumer-subscriptions/graphql";

const VEHICLE_STATE_SUBSCRIPTION: &str = r#"
subscription VehicleState($vehicleID: ID!) {
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
    driveMode          { timeStamp value }
    gearStatus         { timeStamp value }
    vehicleMileage     { timeStamp value }
    cabinClimateInteriorTemperature { timeStamp value }
    cabinClimateDriverTemperature   { timeStamp value }
    batteryHvThermalEvent           { timeStamp value }
    twelveVoltBatteryHealth         { timeStamp value }
  }
}
"#;

pub async fn run_ws_loop(
    vehicle_id:    Uuid,
    rivian_veh_id: String,
    tokens:        RivianTokenBundle,
    tx:            mpsc::Sender<TelemetryEvent>,
    mut shutdown:  tokio::sync::broadcast::Receiver<()>,
) {
    let mut backoff_secs = 1u64;

    loop {
        match connect_and_subscribe(&vehicle_id, &rivian_veh_id, &tokens, &tx, &mut shutdown).await {
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
    vehicle_id:    &Uuid,
    rivian_veh_id: &str,
    tokens:        &RivianTokenBundle,
    tx:            &mpsc::Sender<TelemetryEvent>,
    shutdown:      &mut tokio::sync::broadcast::Receiver<()>,
) -> anyhow::Result<()> {
    use http::header::{HeaderMap, HeaderValue};
    let mut headers = HeaderMap::new();
    headers.insert("a-sess",     HeaderValue::from_str(&tokens.a_sess)?);
    headers.insert("u-sess",     HeaderValue::from_str(&tokens.u_sess)?);
    headers.insert("csrf-token", HeaderValue::from_str(&tokens.csrf_token)?);

    let request = tokio_tungstenite::tungstenite::handshake::client::Request::builder()
        .uri(WS_URL)
        .header("a-sess", &tokens.a_sess)
        .header("u-sess", &tokens.u_sess)
        .header("csrf-token", &tokens.csrf_token)
        .header("Sec-WebSocket-Protocol", "graphql-transport-ws")
        .body(())?;

    let (mut ws, _) = tokio_tungstenite::connect_async(request).await?;

    // connection_init
    ws.send(Message::Text(json!({"type":"connection_init","payload":{}}).to_string())).await?;

    // Wait for connection_ack
    loop {
        match ws.next().await {
            Some(Ok(Message::Text(t))) => {
                let v: serde_json::Value = serde_json::from_str(&t).unwrap_or_default();
                if v.get("type").and_then(|x| x.as_str()) == Some("connection_ack") { break; }
            }
            _ => anyhow::bail!("Did not receive connection_ack"),
        }
    }

    // Subscribe
    let sub = json!({
        "id": "1",
        "type": "subscribe",
        "payload": {
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
                            Ok(None) => {}
                            Err(e) => tracing::warn!(err = %e, "parse error"),
                        }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        ws.send(Message::Pong(data)).await?;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        anyhow::bail!("WS closed");
                    }
                    _ => {}
                }
            }
        }
    }
}
