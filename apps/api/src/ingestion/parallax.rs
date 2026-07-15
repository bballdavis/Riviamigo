//! Read-only Parallax protobuf stream capture.
//!
//! This module intentionally does not decode protobuf payloads yet. It keeps
//! the RVM topic, timestamps, and base64 payload intact so schema discovery can
//! happen offline without coupling experimental fields to the telemetry model.

use chrono::{DateTime, TimeZone, Utc};
use serde_json::{json, Value};

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

pub const PARALLAX_SUBSCRIPTION_ID: &str = "parallax";

#[derive(Debug, Clone)]
pub struct ParallaxEvent {
    pub received_at: DateTime<Utc>,
    pub server_timestamp: Option<DateTime<Utc>>,
    pub rvm: String,
    pub payload_b64: String,
}

pub(crate) fn subscription_message(vehicle_id: &str) -> String {
    json!({
        "id": PARALLAX_SUBSCRIPTION_ID,
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

pub(crate) fn parse_next_message(
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_parallax_subscription_with_correct_vehicle_id_variable() {
        let message: Value = serde_json::from_str(&subscription_message("vehicle-123")).unwrap();
        assert_eq!(message["id"], PARALLAX_SUBSCRIPTION_ID);
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
}
