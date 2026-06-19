//! Rivian WebSocket subscription client with reconnect logic.

use chrono::{DateTime, Utc};
use futures::{SinkExt, StreamExt};
use rand::Rng;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
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
const RIVIAN_NO_ACTIVE_SUBSCRIPTIONS_CODE: u16 = 4410;
const VEHICLE_STATE_FIELD_FAILURE_DISABLE_THRESHOLD: u32 = 2;
const KNOWN_UNSUPPORTED_VEHICLE_STATE_FIELDS: &[&str] = &[
    "cabinClimateExteriorTemperature",
    "cabinClimateRunning",
    "vehiclePowerOutput",
    "regenerativeBrakingPower",
];

#[derive(Debug, Clone, PartialEq, Eq)]
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

#[derive(Debug, Clone, Copy)]
struct VehicleStateField {
    name: &'static str,
    selection: &'static str,
    critical_reason: Option<&'static str>,
}

impl VehicleStateField {
    const fn optional(name: &'static str, selection: &'static str) -> Self {
        Self {
            name,
            selection,
            critical_reason: None,
        }
    }

    const fn critical(
        name: &'static str,
        selection: &'static str,
        critical_reason: &'static str,
    ) -> Self {
        Self {
            name,
            selection,
            critical_reason: Some(critical_reason),
        }
    }
}

const VEHICLE_STATE_FIELDS: &[VehicleStateField] = &[
    VehicleStateField::critical(
        "cloudConnection",
        "cloudConnection { isOnline lastSync }",
        "online/offline freshness",
    ),
    VehicleStateField::critical(
        "powerState",
        "powerState { timeStamp value }",
        "vehicle state",
    ),
    VehicleStateField::critical(
        "chargerState",
        "chargerState { timeStamp value }",
        "charging state",
    ),
    VehicleStateField::critical(
        "chargerStatus",
        "chargerStatus { timeStamp value }",
        "charging state",
    ),
    VehicleStateField::critical(
        "timeToEndOfCharge",
        "timeToEndOfCharge { timeStamp value }",
        "charging estimates",
    ),
    VehicleStateField::critical(
        "batteryLevel",
        "batteryLevel { timeStamp value }",
        "battery state",
    ),
    VehicleStateField::critical(
        "batteryCapacity",
        "batteryCapacity { timeStamp value }",
        "battery state",
    ),
    VehicleStateField::critical(
        "batteryLimit",
        "batteryLimit { timeStamp value }",
        "battery state",
    ),
    VehicleStateField::critical(
        "distanceToEmpty",
        "distanceToEmpty { timeStamp value }",
        "range state",
    ),
    VehicleStateField::critical(
        "gnssLocation",
        "gnssLocation { timeStamp latitude longitude }",
        "location/trips",
    ),
    VehicleStateField::critical("gnssSpeed", "gnssSpeed { timeStamp value }", "trips"),
    VehicleStateField::optional("gnssAltitude", "gnssAltitude { timeStamp value }"),
    VehicleStateField::optional("gnssBearing", "gnssBearing { timeStamp value }"),
    VehicleStateField::critical("driveMode", "driveMode { timeStamp value }", "trips"),
    VehicleStateField::critical("gearStatus", "gearStatus { timeStamp value }", "trips"),
    VehicleStateField::critical(
        "vehicleMileage",
        "vehicleMileage { timeStamp value }",
        "odometer/trips",
    ),
    VehicleStateField::optional(
        "tirePressureStatusFrontLeft",
        "tirePressureStatusFrontLeft { timeStamp value }",
    ),
    VehicleStateField::optional(
        "tirePressureStatusValidFrontLeft",
        "tirePressureStatusValidFrontLeft { timeStamp value }",
    ),
    VehicleStateField::optional(
        "tirePressureStatusFrontRight",
        "tirePressureStatusFrontRight { timeStamp value }",
    ),
    VehicleStateField::optional(
        "tirePressureStatusValidFrontRight",
        "tirePressureStatusValidFrontRight { timeStamp value }",
    ),
    VehicleStateField::optional(
        "tirePressureStatusRearLeft",
        "tirePressureStatusRearLeft { timeStamp value }",
    ),
    VehicleStateField::optional(
        "tirePressureStatusValidRearLeft",
        "tirePressureStatusValidRearLeft { timeStamp value }",
    ),
    VehicleStateField::optional(
        "tirePressureStatusRearRight",
        "tirePressureStatusRearRight { timeStamp value }",
    ),
    VehicleStateField::optional(
        "tirePressureStatusValidRearRight",
        "tirePressureStatusValidRearRight { timeStamp value }",
    ),
    VehicleStateField::optional(
        "tirePressureFrontLeft",
        "tirePressureFrontLeft { timeStamp value }",
    ),
    VehicleStateField::optional(
        "tirePressureFrontRight",
        "tirePressureFrontRight { timeStamp value }",
    ),
    VehicleStateField::optional(
        "tirePressureRearLeft",
        "tirePressureRearLeft { timeStamp value }",
    ),
    VehicleStateField::optional(
        "tirePressureRearRight",
        "tirePressureRearRight { timeStamp value }",
    ),
    VehicleStateField::optional(
        "doorFrontLeftLocked",
        "doorFrontLeftLocked { timeStamp value }",
    ),
    VehicleStateField::optional(
        "doorFrontRightLocked",
        "doorFrontRightLocked { timeStamp value }",
    ),
    VehicleStateField::optional(
        "doorRearLeftLocked",
        "doorRearLeftLocked { timeStamp value }",
    ),
    VehicleStateField::optional(
        "doorRearRightLocked",
        "doorRearRightLocked { timeStamp value }",
    ),
    VehicleStateField::optional(
        "doorFrontLeftClosed",
        "doorFrontLeftClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "doorFrontRightClosed",
        "doorFrontRightClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "doorRearLeftClosed",
        "doorRearLeftClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "doorRearRightClosed",
        "doorRearRightClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureFrunkLocked",
        "closureFrunkLocked { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureFrunkClosed",
        "closureFrunkClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureLiftgateLocked",
        "closureLiftgateLocked { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureLiftgateClosed",
        "closureLiftgateClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureTailgateLocked",
        "closureTailgateLocked { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureTailgateClosed",
        "closureTailgateClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "otaAvailableVersion",
        "otaAvailableVersion { timeStamp value }",
    ),
    VehicleStateField::optional("otaCurrentVersion", "otaCurrentVersion { timeStamp value }"),
    VehicleStateField::optional("otaStatus", "otaStatus { timeStamp value }"),
    VehicleStateField::optional("otaCurrentStatus", "otaCurrentStatus { timeStamp value }"),
    VehicleStateField::optional(
        "cabinClimateInteriorTemperature",
        "cabinClimateInteriorTemperature { timeStamp value }",
    ),
    VehicleStateField::optional(
        "cabinClimateDriverTemperature",
        "cabinClimateDriverTemperature { timeStamp value }",
    ),
    VehicleStateField::critical(
        "cabinClimateExteriorTemperature",
        "cabinClimateExteriorTemperature { timeStamp value }",
        "trip/efficiency temperature context",
    ),
    VehicleStateField::optional(
        "cabinClimateRunning",
        "cabinClimateRunning { timeStamp value }",
    ),
    VehicleStateField::critical(
        "vehiclePowerOutput",
        "vehiclePowerOutput { timeStamp value }",
        "charging and trip energy integration",
    ),
    VehicleStateField::critical(
        "regenerativeBrakingPower",
        "regenerativeBrakingPower { timeStamp value }",
        "trip energy integration",
    ),
    VehicleStateField::optional(
        "batteryHvThermalEvent",
        "batteryHvThermalEvent { timeStamp value }",
    ),
    VehicleStateField::optional(
        "twelveVoltBatteryHealth",
        "twelveVoltBatteryHealth { timeStamp value }",
    ),
    VehicleStateField::critical(
        "chargePortState",
        "chargePortState { timeStamp value }",
        "charging state",
    ),
    VehicleStateField::optional(
        "chargerDerateStatus",
        "chargerDerateStatus { timeStamp value }",
    ),
    VehicleStateField::optional(
        "cabinPreconditioningStatus",
        "cabinPreconditioningStatus { timeStamp value }",
    ),
    VehicleStateField::optional(
        "cabinPreconditioningType",
        "cabinPreconditioningType { timeStamp value }",
    ),
    VehicleStateField::optional("petModeStatus", "petModeStatus { timeStamp value }"),
    VehicleStateField::optional(
        "petModeTemperatureStatus",
        "petModeTemperatureStatus { timeStamp value }",
    ),
    VehicleStateField::optional(
        "defrostDefogStatus",
        "defrostDefogStatus { timeStamp value }",
    ),
    VehicleStateField::optional("steeringWheelHeat", "steeringWheelHeat { timeStamp value }"),
    VehicleStateField::optional("seatFrontLeftHeat", "seatFrontLeftHeat { timeStamp value }"),
    VehicleStateField::optional(
        "seatFrontRightHeat",
        "seatFrontRightHeat { timeStamp value }",
    ),
    VehicleStateField::optional("seatRearLeftHeat", "seatRearLeftHeat { timeStamp value }"),
    VehicleStateField::optional("seatRearRightHeat", "seatRearRightHeat { timeStamp value }"),
    VehicleStateField::optional("seatFrontLeftVent", "seatFrontLeftVent { timeStamp value }"),
    VehicleStateField::optional(
        "seatFrontRightVent",
        "seatFrontRightVent { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureTonneauLocked",
        "closureTonneauLocked { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureTonneauClosed",
        "closureTonneauClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureSideBinLeftLocked",
        "closureSideBinLeftLocked { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureSideBinLeftClosed",
        "closureSideBinLeftClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureSideBinRightLocked",
        "closureSideBinRightLocked { timeStamp value }",
    ),
    VehicleStateField::optional(
        "closureSideBinRightClosed",
        "closureSideBinRightClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "windowFrontLeftClosed",
        "windowFrontLeftClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "windowFrontRightClosed",
        "windowFrontRightClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "windowRearLeftClosed",
        "windowRearLeftClosed { timeStamp value }",
    ),
    VehicleStateField::optional(
        "windowRearRightClosed",
        "windowRearRightClosed { timeStamp value }",
    ),
    VehicleStateField::optional("gearGuardLocked", "gearGuardLocked { timeStamp value }"),
    VehicleStateField::optional(
        "gearGuardVideoStatus",
        "gearGuardVideoStatus { timeStamp value }",
    ),
    VehicleStateField::optional("wiperFluidState", "wiperFluidState { timeStamp value }"),
    VehicleStateField::optional("brakeFluidLow", "brakeFluidLow { timeStamp value }"),
    VehicleStateField::optional("alarmSoundStatus", "alarmSoundStatus { timeStamp value }"),
    VehicleStateField::optional("serviceMode", "serviceMode { timeStamp value }"),
];

#[derive(Debug, thiserror::Error)]
#[error("Rivian WS subscription rejected: {reason}")]
struct RivianSubscriptionRejection {
    reason: String,
    invalid_fields: Vec<String>,
}

#[derive(Debug)]
struct VehicleStateSubscriptionHealth {
    failure_counts: HashMap<String, u32>,
    disabled_fields: HashSet<String>,
}

impl Default for VehicleStateSubscriptionHealth {
    fn default() -> Self {
        Self {
            failure_counts: HashMap::new(),
            disabled_fields: KNOWN_UNSUPPORTED_VEHICLE_STATE_FIELDS
                .iter()
                .map(|field| (*field).to_string())
                .collect(),
        }
    }
}

impl VehicleStateSubscriptionHealth {
    fn build_query(&self) -> String {
        build_vehicle_state_subscription(&self.disabled_fields)
    }

    fn disabled_count(&self) -> usize {
        self.disabled_fields.len()
    }

    fn record_rejection(&mut self, vehicle_id: &Uuid, invalid_fields: &[String]) -> bool {
        let mut disabled_any = false;

        for field_name in invalid_fields {
            let count = self.failure_counts.entry(field_name.clone()).or_default();
            *count += 1;

            let descriptor = vehicle_state_field(field_name);
            if descriptor.is_none() {
                tracing::warn!(
                    vehicle_id = %vehicle_id,
                    field = %field_name,
                    failures = *count,
                    "Rivian WS schema rejected unknown VehicleState field"
                );
                continue;
            }

            if *count >= VEHICLE_STATE_FIELD_FAILURE_DISABLE_THRESHOLD
                && self.disabled_fields.insert(field_name.clone())
            {
                disabled_any = true;
                let field = descriptor.expect("checked above");
                if let Some(reason) = field.critical_reason {
                    tracing::error!(
                        vehicle_id = %vehicle_id,
                        field = %field_name,
                        failures = *count,
                        critical_reason = reason,
                        "Rivian WS VehicleState field disabled after repeated schema rejection"
                    );
                } else {
                    tracing::warn!(
                        vehicle_id = %vehicle_id,
                        field = %field_name,
                        failures = *count,
                        "Rivian WS VehicleState field disabled after repeated schema rejection"
                    );
                }
            } else {
                tracing::warn!(
                    vehicle_id = %vehicle_id,
                    field = %field_name,
                    failures = *count,
                    disable_threshold = VEHICLE_STATE_FIELD_FAILURE_DISABLE_THRESHOLD,
                    "Rivian WS VehicleState field rejected by schema"
                );
            }
        }

        disabled_any
    }
}

fn vehicle_state_field(field_name: &str) -> Option<&'static VehicleStateField> {
    VEHICLE_STATE_FIELDS
        .iter()
        .find(|field| field.name == field_name)
}

fn build_vehicle_state_subscription(disabled_fields: &HashSet<String>) -> String {
    let mut query = String::from(
        "subscription vehicleState($vehicleID: String!) {\n  vehicleState(id: $vehicleID) {\n",
    );
    for field in VEHICLE_STATE_FIELDS {
        if disabled_fields.contains(field.name) {
            continue;
        }
        query.push_str("    ");
        query.push_str(field.selection);
        query.push('\n');
    }
    query.push_str("  }\n}\n");
    query
}

// Forward-declared for the departure-schedule WS subscription (wired in a follow-up).
#[allow(dead_code)]
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
    let mut subscription_health = VehicleStateSubscriptionHealth::default();
    if subscription_health.disabled_count() > 0 {
        tracing::info!(
            vehicle_id = %vehicle_id,
            disabled_fields = subscription_health.disabled_count(),
            "Rivian WS starting with known-unsupported VehicleState fields disabled"
        );
    }

    loop {
        let subscription_query = subscription_health.build_query();
        match connect_and_subscribe(
            &vehicle_id,
            &rivian_veh_id,
            &tokens,
            &tx,
            &mut shutdown,
            &subscription_query,
            subscription_health.disabled_count(),
        )
        .await
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
                if let Some(rejection) = e.downcast_ref::<RivianSubscriptionRejection>() {
                    let healed = subscription_health
                        .record_rejection(&vehicle_id, &rejection.invalid_fields);
                    if healed {
                        tracing::warn!(
                            vehicle_id = %vehicle_id,
                            disabled_fields = subscription_health.disabled_count(),
                            "Rivian WS subscription query degraded after schema rejection"
                        );
                        let _ = tx
                            .send(WsInboundEvent {
                                kind: WsInboundKind::Control,
                                received_at: Utc::now(),
                                raw: json!({
                                    "type": "ws_schema_degraded",
                                    "disabled_vehicle_state_fields": subscription_health.disabled_count(),
                                    "invalid_fields": rejection.invalid_fields,
                                })
                                .to_string(),
                                message_type: Some("ws_schema_degraded".into()),
                                telemetry: None,
                            })
                            .await;
                    }
                }
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
    subscription_query: &str,
    disabled_field_count: usize,
) -> anyhow::Result<WsLoopEnd> {
    let request = build_rivian_ws_request()?;

    let (mut ws, _) = match tokio_tungstenite::connect_async(request).await {
        Ok(connection) => connection,
        Err(WsError::Http(response)) => {
            let status = response.status();
            let _ = tx
                .send(WsInboundEvent {
                    kind: WsInboundKind::Control,
                    received_at: Utc::now(),
                    raw: json!({
                        "type": "ws_handshake_rejected",
                        "http_status": status.as_u16(),
                    })
                    .to_string(),
                    message_type: Some("ws_handshake_rejected".into()),
                    telemetry: None,
                })
                .await;
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
            "query": subscription_query,
            "variables": { "vehicleID": rivian_veh_id }
        }
    });
    ws.send(Message::Text(sub.to_string())).await?;
    let _ = tx
        .send(WsInboundEvent {
            kind: WsInboundKind::Control,
            received_at: Utc::now(),
            raw:
                json!({"type": "subscribe", "disabled_vehicle_state_fields": disabled_field_count})
                    .to_string(),
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
                        if matches!(message_type.as_deref(), Some("error") | Some("complete")) {
                            // Rivian sometimes rejects a single field by name in the error body.
                            // Surface the full message so we can diagnose which field is at fault
                            // rather than silently downgrading to a degraded subscription.
                            let reason = truncate_ws_message(&text);
                            let invalid_fields = rejected_vehicle_state_fields(&value);
                            tracing::error!(
                                vehicle_id = %vehicle_id,
                                message_type = message_type.as_deref().unwrap_or("unknown"),
                                message = %reason,
                                invalid_fields = ?invalid_fields,
                                "Rivian WS subscription rejected by VehicleState schema"
                            );
                            let _ = tx.send(WsInboundEvent {
                                kind: WsInboundKind::Control,
                                received_at: Utc::now(),
                                raw: json!({
                                    "type": "ws_schema_rejected",
                                    "reason": reason,
                                    "invalid_fields": invalid_fields,
                                }).to_string(),
                                message_type: Some("ws_schema_rejected".into()),
                                telemetry: None,
                            }).await;
                            return Err(RivianSubscriptionRejection {
                                reason,
                                invalid_fields,
                            }
                            .into());
                        }
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
                        if is_rivian_no_active_subscriptions(frame.as_ref()) {
                            let reason = frame
                                .as_ref()
                                .map(|f| f.reason.to_string())
                                .unwrap_or_else(|| "no active subscriptions".into());
                            let _ = tx.send(WsInboundEvent {
                                kind: WsInboundKind::Control,
                                received_at: Utc::now(),
                                raw: json!({
                                    "type": "ws_no_active_subscriptions",
                                    "reason": reason,
                                }).to_string(),
                                message_type: Some("ws_no_active_subscriptions".into()),
                                telemetry: None,
                            }).await;
                            tracing::warn!(
                                vehicle_id = %vehicle_id,
                                close_code = frame.as_ref().map(|f| f.code.to_string()),
                                close_reason = %reason,
                                "Rivian WS subscription closed (4410) — reconnecting"
                            );
                            anyhow::bail!("Rivian WS subscription closed: {reason}");
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

fn is_rivian_no_active_subscriptions(frame: Option<&CloseFrame<'_>>) -> bool {
    frame.is_some_and(|f| u16::from(f.code) == RIVIAN_NO_ACTIVE_SUBSCRIPTIONS_CODE)
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
        || event.tire_fl_valid.is_some()
        || event.tire_fr_valid.is_some()
        || event.tire_rl_valid.is_some()
        || event.tire_rr_valid.is_some()
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
        || event.charge_port_open.is_some()
        || event.charger_derate_active.is_some()
        || event.cabin_precon_status.is_some()
        || event.cabin_precon_type.is_some()
        || event.pet_mode_active.is_some()
        || event.pet_mode_temp_ok.is_some()
        || event.defrost_active.is_some()
        || event.steering_wheel_heat.is_some()
        || event.seat_fl_heat.is_some()
        || event.seat_fr_heat.is_some()
        || event.seat_rl_heat.is_some()
        || event.seat_rr_heat.is_some()
        || event.seat_fl_vent.is_some()
        || event.seat_fr_vent.is_some()
        || event.tonneau_locked.is_some()
        || event.tonneau_closed.is_some()
        || event.side_bin_left_locked.is_some()
        || event.side_bin_right_locked.is_some()
        || event.side_bin_left_closed.is_some()
        || event.side_bin_right_closed.is_some()
        || event.window_fl_closed.is_some()
        || event.window_fr_closed.is_some()
        || event.window_rl_closed.is_some()
        || event.window_rr_closed.is_some()
        || event.gear_guard_locked.is_some()
        || event.gear_guard_video_status.is_some()
        || event.wiper_fluid_low.is_some()
        || event.brake_fluid_low.is_some()
        || event.alarm_active.is_some()
        || event.service_mode.is_some()
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

fn rejected_vehicle_state_fields(value: &Value) -> Vec<String> {
    let Some(payload) = value.get("payload").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut fields = Vec::new();
    let mut seen = HashSet::new();
    for error in payload {
        let Some(message) = error.get("message").and_then(Value::as_str) else {
            continue;
        };
        let Some(field) = rejected_vehicle_state_field(message) else {
            continue;
        };
        if seen.insert(field.clone()) {
            fields.push(field);
        }
    }
    fields
}

fn rejected_vehicle_state_field(message: &str) -> Option<String> {
    let prefix = "Cannot query field \"";
    let suffix = "\" on type \"VehicleState\"";
    let start = message.find(prefix)? + prefix.len();
    let rest = &message[start..];
    let end = rest.find(suffix)?;
    Some(rest[..end].to_string())
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
    fn classifies_no_active_subscription_close() {
        let frame = CloseFrame {
            code: CloseCode::Library(RIVIAN_NO_ACTIVE_SUBSCRIPTIONS_CODE),
            reason: Cow::Borrowed("Socket with no active subscriptions, disconnecting"),
        };

        assert!(is_rivian_no_active_subscriptions(Some(&frame)));
        assert!(!is_rivian_no_active_subscriptions(None));
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
    fn extracts_rejected_vehicle_state_fields() {
        let msg = json!({
            "id": "1",
            "type": "error",
            "payload": [
                {
                    "message": "Cannot query field \"cabinClimateExteriorTemperature\" on type \"VehicleState\". Did you mean \"cabinClimateInteriorTemperature\"?",
                    "locations": [{ "line": 48, "column": 5 }]
                },
                {
                    "message": "Cannot query field \"vehiclePowerOutput\" on type \"VehicleState\".",
                    "locations": [{ "line": 50, "column": 5 }]
                },
                {
                    "message": "Cannot query field \"vehiclePowerOutput\" on type \"VehicleState\".",
                    "locations": [{ "line": 50, "column": 5 }]
                }
            ]
        });

        assert_eq!(
            rejected_vehicle_state_fields(&msg),
            vec![
                "cabinClimateExteriorTemperature".to_string(),
                "vehiclePowerOutput".to_string()
            ]
        );
    }

    #[test]
    fn vehicle_state_subscription_omits_disabled_fields() {
        let disabled_fields = HashSet::from(["vehiclePowerOutput".to_string()]);
        let query = build_vehicle_state_subscription(&disabled_fields);

        assert!(!query.contains("vehiclePowerOutput { timeStamp value }"));
        assert!(query.contains("batteryLevel { timeStamp value }"));
        assert!(query.contains("subscription vehicleState"));
    }

    #[test]
    fn default_subscription_omits_known_unsupported_regen_field() {
        let query = VehicleStateSubscriptionHealth::default().build_query();

        assert!(!query.contains("regenerativeBrakingPower { timeStamp value }"));
    }

    #[test]
    fn subscription_health_disables_repeatedly_rejected_known_fields() {
        let vehicle_id = Uuid::new_v4();
        let mut health = VehicleStateSubscriptionHealth::default();
        let rejected = vec!["vehiclePowerOutput".to_string()];
        let baseline_disabled = health.disabled_count();

        assert!(!health.record_rejection(&vehicle_id, &rejected));
        assert_eq!(health.disabled_count(), baseline_disabled);

        assert!(!health.record_rejection(&vehicle_id, &rejected));
        assert_eq!(health.disabled_count(), baseline_disabled);
        assert!(!health.build_query().contains("vehiclePowerOutput"));
    }

    #[test]
    fn backoff_doubles_to_max() {
        assert_eq!(next_backoff_secs(10, 900), 20);
        assert_eq!(next_backoff_secs(800, 900), 900);
        assert_eq!(next_backoff_secs(900, 900), 900);
    }
}
