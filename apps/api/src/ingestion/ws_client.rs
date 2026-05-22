//! Rivian WebSocket subscription client with reconnect logic.

use chrono::{DateTime, Utc};
use futures::{SinkExt, StreamExt};
use rand::Rng;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest, protocol::CloseFrame, Error as WsError, Message,
};
use uuid::Uuid;

use crate::models::telemetry::TelemetryEvent;
use crate::{
    config::Config,
    ingestion::{parser, session_store::RivianTokenBundle},
};

const WS_URL: &str = "wss://api.rivian.com/gql-consumer-subscriptions/graphql";
const RIVIAN_CONNECTION_TTL_EXPIRED_CODE: u16 = 4420;
const RIVIAN_CONNECTION_TTL_EXPIRED_REASON: &str = "Connection TTL expired";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WsLoopEnd {
    Shutdown,
    ConnectionTtlExpired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WsInboundKind {
    Control,
    Heartbeat,
    Telemetry,
}

impl WsInboundKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Control => "control",
            Self::Heartbeat => "heartbeat",
            Self::Telemetry => "telemetry",
        }
    }
}

#[derive(Debug, Clone)]
pub struct WsInboundEvent {
    pub kind: WsInboundKind,
    pub received_at: DateTime<Utc>,
    pub raw: String,
    pub message_type: Option<String>,
    pub telemetry: Option<TelemetryEvent>,
}

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
    cabinClimateExteriorTemperature { timeStamp value }
    cabinClimateRunning             { timeStamp value }
    batteryHvThermalEvent           { timeStamp value }
    twelveVoltBatteryHealth         { timeStamp value }
    chargePortState                 { timeStamp value }
    chargerDerateStatus             { timeStamp value }
    cabinPreconditioningStatus      { timeStamp value }
    cabinPreconditioningType        { timeStamp value }
    petModeStatus                   { timeStamp value }
    petModeTemperatureStatus        { timeStamp value }
    defrostDefogStatus              { timeStamp value }
    steeringWheelHeat               { timeStamp value }
    seatFrontLeftHeat               { timeStamp value }
    seatFrontRightHeat              { timeStamp value }
    seatRearLeftHeat                { timeStamp value }
    seatRearRightHeat               { timeStamp value }
    seatFrontLeftVent               { timeStamp value }
    seatFrontRightVent              { timeStamp value }
    closureTonneauLocked            { timeStamp value }
    closureTonneauClosed            { timeStamp value }
    closureSideBinLeftLocked        { timeStamp value }
    closureSideBinRightLocked       { timeStamp value }
    windowFrontLeftClosed           { timeStamp value }
    windowFrontRightClosed          { timeStamp value }
    windowRearLeftClosed            { timeStamp value }
    windowRearRightClosed           { timeStamp value }
    gearGuardLocked                 { timeStamp value }
    gearGuardVideoStatus            { timeStamp value }
    wiperFluidState                 { timeStamp value }
    brakeFluidLow                   { timeStamp value }
    alarmSoundStatus                { timeStamp value }
    vehicleInServiceMode            { timeStamp value }
    vehiclePowerOutput              { timeStamp value }
    regenerativeBrakingPower        { timeStamp value }
  }
}
"#;

pub(crate) const DEPARTURE_SCHEDULE_SUBSCRIPTION: &str = r#"
subscription vehicleDepartureSchedules($vehicleID: String!) {
  vehicleDepartureSchedules(vehicleId: $vehicleID) {
    id
    name
    enabled
    occurrence {
      type
      weekDays
      timeOfDayMinutes
    }
    comfortSettings {
      seatFrontLeftHeat
      seatFrontRightHeat
      cabinClimateSetTemp
      defrost
    }
  }
}
"#;

pub async fn run_ws_loop(
    vehicle_id: Uuid,
    rivian_veh_id: String,
    tokens: RivianTokenBundle,
    tx: mpsc::Sender<WsInboundEvent>,
    mut shutdown: tokio::sync::broadcast::Receiver<()>,
    config: Config,
) {
    let initial_backoff = config.rivian_ws_reconnect_initial_seconds.max(1);
    let max_backoff = config.rivian_ws_reconnect_max_seconds.max(initial_backoff);
    let mut backoff_secs = initial_backoff;

    loop {
        match connect_and_subscribe(&vehicle_id, &rivian_veh_id, &tokens, &tx, &mut shutdown).await
        {
            Ok(WsLoopEnd::Shutdown) => {
                tracing::info!(vehicle_id = %vehicle_id, "WS connection closed gracefully");
                break;
            }
            Ok(WsLoopEnd::ConnectionTtlExpired) => {
                tracing::info!(
                    vehicle_id = %vehicle_id,
                    "Rivian WS connection TTL expired; renewing subscription"
                );
                backoff_secs = initial_backoff;
            }
            Err(e) => {
                let delay = jittered_backoff_secs(backoff_secs);
                tracing::warn!(vehicle_id = %vehicle_id, err = %e, backoff = delay, "WS error, reconnecting");
                let _ = tx
                    .send(WsInboundEvent {
                        kind: WsInboundKind::Control,
                        received_at: Utc::now(),
                        raw: json!({"type": "reconnect", "backoff_seconds": delay}).to_string(),
                        message_type: Some("reconnect".into()),
                        telemetry: None,
                    })
                    .await;
                tokio::select! {
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(delay)) => {}
                    _ = shutdown.recv() => { break; }
                }
                backoff_secs = next_backoff_secs(backoff_secs, max_backoff);
            }
        }
    }
}

async fn connect_and_subscribe(
    vehicle_id: &Uuid,
    rivian_veh_id: &str,
    tokens: &RivianTokenBundle,
    tx: &mpsc::Sender<WsInboundEvent>,
    shutdown: &mut tokio::sync::broadcast::Receiver<()>,
) -> anyhow::Result<WsLoopEnd> {
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
    let _ = tx
        .send(WsInboundEvent {
            kind: WsInboundKind::Control,
            received_at: Utc::now(),
            raw: json!({"type": "connection_open"}).to_string(),
            message_type: Some("connection_open".into()),
            telemetry: None,
        })
        .await;

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
    let _ = tx
        .send(WsInboundEvent {
            kind: WsInboundKind::Control,
            received_at: Utc::now(),
            raw: json!({"type": "connection_init"}).to_string(),
            message_type: Some("connection_init".into()),
            telemetry: None,
        })
        .await;

    // Wait for connection_ack; handle PING frames that may arrive before ack
    loop {
        match ws.next().await {
            Some(Ok(Message::Text(t))) => {
                let v: Value = serde_json::from_str(&t).unwrap_or_default();
                let message_type = message_type(&v);
                let _ = tx
                    .send(WsInboundEvent {
                        kind: WsInboundKind::Control,
                        received_at: Utc::now(),
                        raw: t.clone(),
                        message_type: message_type.clone(),
                        telemetry: None,
                    })
                    .await;
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
    let _ = tx
        .send(WsInboundEvent {
            kind: WsInboundKind::Control,
            received_at: Utc::now(),
            raw: json!({"type": "subscribe"}).to_string(),
            message_type: Some("subscribe".into()),
            telemetry: None,
        })
        .await;

    loop {
        tokio::select! {
            _ = shutdown.recv() => { return Ok(WsLoopEnd::Shutdown); }
            msg = ws.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let value: Value = serde_json::from_str(&text).unwrap_or_default();
                        let message_type = message_type(&value);
                        match classify_text_message(&text, *vehicle_id) {
                            Ok(inbound) => {
                                let _ = tx.send(WsInboundEvent {
                                    received_at: Utc::now(),
                                    raw: text,
                                    message_type,
                                    ..inbound
                                }).await;
                            }
                            Err(e) => {
                                tracing::warn!(vehicle_id = %vehicle_id, err = %e, "parse error");
                                let _ = tx.send(WsInboundEvent {
                                    kind: WsInboundKind::Control,
                                    received_at: Utc::now(),
                                    raw: text,
                                    message_type,
                                    telemetry: None,
                                }).await;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        ws.send(Message::Pong(data)).await?;
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let ttl_expired = is_rivian_connection_ttl_expired(frame.as_ref());
                        if ttl_expired {
                            tracing::info!(
                                vehicle_id = %vehicle_id,
                                close_code = frame.as_ref().map(|f| f.code.to_string()),
                                close_reason = frame.as_ref().map(|f| f.reason.to_string()),
                                "Rivian WS close frame"
                            );
                            return Ok(WsLoopEnd::ConnectionTtlExpired);
                        }
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

fn is_rivian_connection_ttl_expired(frame: Option<&CloseFrame<'_>>) -> bool {
    frame.is_some_and(|f| {
        u16::from(f.code) == RIVIAN_CONNECTION_TTL_EXPIRED_CODE
            && f.reason.as_ref() == RIVIAN_CONNECTION_TTL_EXPIRED_REASON
    })
}

fn build_rivian_ws_request(
) -> anyhow::Result<tokio_tungstenite::tungstenite::handshake::client::Request> {
    let mut request = WS_URL.into_client_request()?;
    request
        .headers_mut()
        .insert("Sec-WebSocket-Protocol", "graphql-transport-ws".parse()?);
    Ok(request)
}

fn classify_text_message(
    raw: &str,
    vehicle_id: Uuid,
) -> Result<WsInboundEvent, parser::ParseError> {
    let telemetry = parser::parse_ws_message(raw, vehicle_id)?;
    let kind = match telemetry.as_ref() {
        Some(event) if event_has_meaningful_payload(event) => WsInboundKind::Telemetry,
        Some(_) => WsInboundKind::Heartbeat,
        None => WsInboundKind::Control,
    };

    Ok(WsInboundEvent {
        kind,
        received_at: Utc::now(),
        raw: raw.to_string(),
        message_type: None,
        telemetry,
    })
}

fn message_type(value: &Value) -> Option<String> {
    value
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn event_has_meaningful_payload(event: &TelemetryEvent) -> bool {
    event.latitude.is_some()
        || event.longitude.is_some()
        || event.altitude_m.is_some()
        || event.speed_mph.is_some()
        || event.battery_level.is_some()
        || event.battery_capacity_wh.is_some()
        || event.distance_to_empty_mi.is_some()
        || event.battery_limit.is_some()
        || event.power_state.is_some()
        || event.charger_state.is_some()
        || event.charger_status.is_some()
        || event.time_to_end_of_charge_min.is_some()
        || event.drive_mode.is_some()
        || event.gear_status.is_some()
        || event.cabin_temp_c.is_some()
        || event.driver_temp_c.is_some()
        || event.outside_temp_c.is_some()
        || event.hvac_active.is_some()
        || event.power_kw.is_some()
        || event.regen_power_kw.is_some()
        || event.heading_deg.is_some()
        || event.odometer_miles.is_some()
        || event.tire_fl_psi.is_some()
        || event.tire_fr_psi.is_some()
        || event.tire_rl_psi.is_some()
        || event.tire_rr_psi.is_some()
        || event.tire_fl_status.is_some()
        || event.tire_fr_status.is_some()
        || event.tire_rl_status.is_some()
        || event.tire_rr_status.is_some()
        || event.door_front_left_locked.is_some()
        || event.door_front_right_locked.is_some()
        || event.door_rear_left_locked.is_some()
        || event.door_rear_right_locked.is_some()
        || event.door_front_left_closed.is_some()
        || event.door_front_right_closed.is_some()
        || event.door_rear_left_closed.is_some()
        || event.door_rear_right_closed.is_some()
        || event.closure_frunk_locked.is_some()
        || event.closure_frunk_closed.is_some()
        || event.closure_liftgate_locked.is_some()
        || event.closure_liftgate_closed.is_some()
        || event.closure_tailgate_locked.is_some()
        || event.closure_tailgate_closed.is_some()
        || event.ota_current_version.is_some()
        || event.ota_available_version.is_some()
        || event.ota_status.is_some()
        || event.ota_current_status.is_some()
        || event.hv_thermal_event.is_some()
        || event.twelve_volt_health.is_some()
}

pub(crate) fn next_backoff_secs(current: u64, max: u64) -> u64 {
    current.saturating_mul(2).min(max.max(1))
}

pub(crate) fn jittered_backoff_secs(base: u64) -> u64 {
    if base <= 1 {
        return 1;
    }
    let jitter = rand::thread_rng().gen_range(0..=base / 4);
    base + jitter
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
    use std::borrow::Cow;
    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

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

    #[test]
    fn classifies_rivian_ttl_close_as_renewable() {
        let frame = CloseFrame {
            code: CloseCode::Library(RIVIAN_CONNECTION_TTL_EXPIRED_CODE),
            reason: Cow::Borrowed(RIVIAN_CONNECTION_TTL_EXPIRED_REASON),
        };

        assert!(is_rivian_connection_ttl_expired(Some(&frame)));
    }

    #[test]
    fn does_not_classify_other_rivian_closes_as_ttl() {
        let no_subscription_frame = CloseFrame {
            code: CloseCode::Library(4410),
            reason: Cow::Borrowed("Socket with no active subscriptions, disconnecting"),
        };
        let wrong_reason_frame = CloseFrame {
            code: CloseCode::Library(RIVIAN_CONNECTION_TTL_EXPIRED_CODE),
            reason: Cow::Borrowed("Something else"),
        };

        assert!(!is_rivian_connection_ttl_expired(Some(
            &no_subscription_frame
        )));
        assert!(!is_rivian_connection_ttl_expired(Some(&wrong_reason_frame)));
        assert!(!is_rivian_connection_ttl_expired(None));
    }

    #[test]
    fn classifies_control_messages() {
        let inbound =
            classify_text_message(r#"{"type":"connection_ack"}"#, Uuid::new_v4()).unwrap();
        assert_eq!(inbound.kind, WsInboundKind::Control);
        assert!(inbound.telemetry.is_none());
    }

    #[test]
    fn classifies_online_only_payload_as_heartbeat() {
        let msg = json!({
            "type": "next",
            "payload": { "data": { "vehicleState": {
                "cloudConnection": { "isOnline": true, "lastSync": "2026-05-04T12:00:00Z" }
            }}}
        })
        .to_string();
        let inbound = classify_text_message(&msg, Uuid::new_v4()).unwrap();
        assert_eq!(inbound.kind, WsInboundKind::Heartbeat);
        assert!(inbound.telemetry.is_some());
    }

    #[test]
    fn classifies_sensor_payload_as_telemetry() {
        let msg = json!({
            "type": "next",
            "payload": { "data": { "vehicleState": {
                "batteryLevel": { "timeStamp": "2026-05-04T12:00:00Z", "value": 72.0 }
            }}}
        })
        .to_string();
        let inbound = classify_text_message(&msg, Uuid::new_v4()).unwrap();
        assert_eq!(inbound.kind, WsInboundKind::Telemetry);
    }

    #[test]
    fn backoff_doubles_to_max() {
        assert_eq!(next_backoff_secs(10, 900), 20);
        assert_eq!(next_backoff_secs(800, 900), 900);
        assert_eq!(next_backoff_secs(900, 900), 900);
    }
}
