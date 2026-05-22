//! Parses Rivian GraphQL WebSocket subscription messages into TelemetryEvent.
//!
//! Rivian sends partial updates — only changed fields are present.
//! Every field is optional. This function must never panic on any input.

use crate::models::telemetry::TelemetryEvent;
use chrono::{DateTime, Utc};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Missing vehicleState in payload")]
    MissingVehicleState,
    #[error("Invalid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
}

/// Parse a raw WebSocket message. Returns None for non-data messages.
/// Never panics — all field parsing is defensive.
pub fn parse_ws_message(raw: &str, vehicle_id: Uuid) -> Result<Option<TelemetryEvent>, ParseError> {
    let msg: Value = serde_json::from_str(raw)?;

    match msg.get("type").and_then(Value::as_str) {
        Some("next") => {}
        _ => return Ok(None),
    }

    let state = msg
        .pointer("/payload/data/vehicleState")
        .ok_or(ParseError::MissingVehicleState)?;

    let ts = extract_latest_timestamp(state).unwrap_or_else(Utc::now);
    let is_online = state
        .pointer("/cloudConnection/isOnline")
        .and_then(Value::as_bool);

    Ok(Some(TelemetryEvent {
        vehicle_id,
        ts,

        latitude: extract_f64(state, "/gnssLocation/latitude"),
        longitude: extract_f64(state, "/gnssLocation/longitude"),
        altitude_m: extract_f64(state, "/gnssAltitude/value"),
        speed_mph: extract_f64(state, "/gnssSpeed/value").map(ms_to_mph),

        battery_level: extract_f64(state, "/batteryLevel/value"),
        battery_capacity_wh: extract_f64(state, "/batteryCapacity/value").map(kwh_to_wh),
        distance_to_empty_mi: extract_f64(state, "/distanceToEmpty/value").map(km_to_miles),
        battery_limit: extract_f64(state, "/batteryLimit/value"),

        power_state: extract_str(state, "/powerState/value").and_then(|s| s.parse().ok()),
        charger_state: extract_str(state, "/chargerState/value").and_then(|s| s.parse().ok()),
        charger_status: extract_str(state, "/chargerStatus/value").map(String::from),
        time_to_end_of_charge_min: extract_i32(state, "/timeToEndOfCharge/value"),
        drive_mode: extract_str(state, "/driveMode/value").and_then(|s| s.parse().ok()),
        gear_status: extract_str(state, "/gearStatus/value").map(String::from),

        cabin_temp_c: extract_f64(state, "/cabinClimateInteriorTemperature/value"),
        driver_temp_c: extract_f64(state, "/cabinClimateDriverTemperature/value"),
        outside_temp_c: extract_f64(state, "/cabinClimateExteriorTemperature/value"),
        hvac_active: extract_bool(state, "/cabinClimateRunning/value"),

        power_kw: extract_f64(state, "/vehiclePowerOutput/value"),
        regen_power_kw: extract_f64(state, "/regenerativeBrakingPower/value"),

        heading_deg: extract_f64(state, "/gnssBearing/value")
            .or_else(|| extract_f64(state, "/gnssHeading/value")),

        odometer_miles: extract_f64(state, "/vehicleMileage/value").map(meters_to_miles),

        tire_fl_psi: extract_f64(state, "/tirePressureFrontLeft/value").map(bar_to_psi),
        tire_fr_psi: extract_f64(state, "/tirePressureFrontRight/value").map(bar_to_psi),
        tire_rl_psi: extract_f64(state, "/tirePressureRearLeft/value").map(bar_to_psi),
        tire_rr_psi: extract_f64(state, "/tirePressureRearRight/value").map(bar_to_psi),
        tire_fl_status: extract_str(state, "/tirePressureStatusFrontLeft/value").map(String::from),
        tire_fr_status: extract_str(state, "/tirePressureStatusFrontRight/value").map(String::from),
        tire_rl_status: extract_str(state, "/tirePressureStatusRearLeft/value").map(String::from),
        tire_rr_status: extract_str(state, "/tirePressureStatusRearRight/value").map(String::from),

        door_front_left_locked: extract_locked(state, "/doorFrontLeftLocked/value"),
        door_front_right_locked: extract_locked(state, "/doorFrontRightLocked/value"),
        door_rear_left_locked: extract_locked(state, "/doorRearLeftLocked/value"),
        door_rear_right_locked: extract_locked(state, "/doorRearRightLocked/value"),
        door_front_left_closed: extract_closed(state, "/doorFrontLeftClosed/value"),
        door_front_right_closed: extract_closed(state, "/doorFrontRightClosed/value"),
        door_rear_left_closed: extract_closed(state, "/doorRearLeftClosed/value"),
        door_rear_right_closed: extract_closed(state, "/doorRearRightClosed/value"),
        closure_frunk_locked: extract_locked(state, "/closureFrunkLocked/value"),
        closure_frunk_closed: extract_closed(state, "/closureFrunkClosed/value"),
        closure_liftgate_locked: extract_locked(state, "/closureLiftgateLocked/value"),
        closure_liftgate_closed: extract_closed(state, "/closureLiftgateClosed/value"),
        closure_tailgate_locked: extract_locked(state, "/closureTailgateLocked/value"),
        closure_tailgate_closed: extract_closed(state, "/closureTailgateClosed/value"),

        ota_current_version: extract_str(state, "/otaCurrentVersion/value")
            .or_else(|| extract_str(state, "/otaCurrentVersionGitHash/value"))
            .map(String::from),
        ota_available_version: extract_str(state, "/otaAvailableVersion/value")
            .or_else(|| extract_str(state, "/otaAvailableVersionGitHash/value"))
            .map(String::from),
        ota_status: extract_str(state, "/otaStatus/value").map(String::from),
        ota_current_status: extract_str(state, "/otaCurrentStatus/value").map(String::from),

        hv_thermal_event: extract_str(state, "/batteryHvThermalEvent/value").map(String::from),
        twelve_volt_health: extract_str(state, "/twelveVoltBatteryHealth/value").map(String::from),
        is_online,

        charge_port_open: extract_str(state, "/chargePortState/value")
            .map(|s| matches!(s.to_lowercase().as_str(), "open" | "ajar")),
        charger_derate_active: extract_bool(state, "/chargerDerateStatus/value")
            .or_else(|| extract_str(state, "/chargerDerateStatus/value")
                .map(|s| !matches!(s.to_lowercase().as_str(), "inactive" | "none" | "off"))),
        cabin_precon_status: extract_str(state, "/cabinPreconditioningStatus/value")
            .map(String::from),
        cabin_precon_type: extract_str(state, "/cabinPreconditioningType/value")
            .map(String::from),
        pet_mode_active: extract_str(state, "/petModeStatus/value")
            .map(|s| matches!(s.to_lowercase().as_str(), "on" | "active")),
        pet_mode_temp_ok: extract_str(state, "/petModeTemperatureStatus/value")
            .map(|s| matches!(s.to_lowercase().as_str(), "ok" | "safe")),
        defrost_active: extract_str(state, "/defrostDefogStatus/value")
            .map(|s| matches!(s.to_lowercase().as_str(), "on" | "active")),
        steering_wheel_heat: extract_i32(state, "/steeringWheelHeat/value"),
        seat_fl_heat: extract_i32(state, "/seatFrontLeftHeat/value"),
        seat_fr_heat: extract_i32(state, "/seatFrontRightHeat/value"),
        seat_rl_heat: extract_i32(state, "/seatRearLeftHeat/value"),
        seat_rr_heat: extract_i32(state, "/seatRearRightHeat/value"),
        seat_fl_vent: extract_i32(state, "/seatFrontLeftVent/value"),
        seat_fr_vent: extract_i32(state, "/seatFrontRightVent/value"),
        tonneau_locked: extract_locked(state, "/closureTonneauLocked/value"),
        tonneau_closed: extract_closed(state, "/closureTonneauClosed/value"),
        side_bin_left_locked: extract_locked(state, "/closureSideBinLeftLocked/value"),
        side_bin_right_locked: extract_locked(state, "/closureSideBinRightLocked/value"),
        window_fl_closed: extract_closed(state, "/windowFrontLeftClosed/value"),
        window_fr_closed: extract_closed(state, "/windowFrontRightClosed/value"),
        window_rl_closed: extract_closed(state, "/windowRearLeftClosed/value"),
        window_rr_closed: extract_closed(state, "/windowRearRightClosed/value"),
        gear_guard_locked: extract_bool(state, "/gearGuardLocked/value"),
        gear_guard_video_status: extract_str(state, "/gearGuardVideoStatus/value")
            .map(String::from),
        wiper_fluid_low: extract_str(state, "/wiperFluidState/value")
            .map(|s| matches!(s.to_lowercase().as_str(), "low" | "empty" | "critical")),
        brake_fluid_low: extract_bool(state, "/brakeFluidLow/value"),
        alarm_active: extract_str(state, "/alarmSoundStatus/value")
            .map(|s| matches!(s.to_lowercase().as_str(), "active" | "on" | "sounding")),
        service_mode: extract_str(state, "/vehicleInServiceMode/value")
            .map(|s| matches!(s.to_lowercase().as_str(), "on" | "active" | "true")),
    }))
}

fn extract_f64(v: &Value, ptr: &str) -> Option<f64> {
    v.pointer(ptr)?.as_f64()
}

fn extract_i32(v: &Value, ptr: &str) -> Option<i32> {
    v.pointer(ptr)?.as_i64().and_then(|n| i32::try_from(n).ok())
}

fn extract_bool(v: &Value, ptr: &str) -> Option<bool> {
    v.pointer(ptr)?.as_bool()
}

fn extract_str<'a>(v: &'a Value, ptr: &str) -> Option<&'a str> {
    v.pointer(ptr)?.as_str()
}

fn extract_locked(v: &Value, ptr: &str) -> Option<bool> {
    match v.pointer(ptr)? {
        Value::Bool(value) => Some(*value),
        Value::String(value) => match value.to_lowercase().as_str() {
            "locked" | "true" => Some(true),
            "unlocked" | "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn extract_closed(v: &Value, ptr: &str) -> Option<bool> {
    match v.pointer(ptr)? {
        Value::Bool(value) => Some(*value),
        Value::String(value) => match value.to_lowercase().as_str() {
            "closed" | "true" => Some(true),
            "open" | "opened" | "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn extract_latest_timestamp(state: &Value) -> Option<DateTime<Utc>> {
    let mut latest: Option<DateTime<Utc>> = None;
    collect_timestamps(state, &mut latest);
    latest
}

fn collect_timestamps(v: &Value, latest: &mut Option<DateTime<Utc>>) {
    match v {
        Value::Object(map) => {
            if let Some(Value::String(ts)) = map.get("timeStamp") {
                if let Ok(dt) = ts.parse::<DateTime<Utc>>() {
                    if latest.map_or(true, |l| dt > l) {
                        *latest = Some(dt);
                    }
                }
            }
            for val in map.values() {
                collect_timestamps(val, latest);
            }
        }
        Value::Array(arr) => {
            for val in arr {
                collect_timestamps(val, latest);
            }
        }
        _ => {}
    }
}

fn ms_to_mph(ms: f64) -> f64 {
    ms * 2.236_94
}

fn meters_to_miles(meters: f64) -> f64 {
    meters / 1609.344
}

fn km_to_miles(km: f64) -> f64 {
    km / 1.609_344
}

fn kwh_to_wh(kwh: f64) -> f64 {
    kwh * 1000.0
}

fn bar_to_psi(bar: f64) -> f64 {
    bar * 14.503_773_8
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::telemetry::{DriveMode, PowerState};

    fn vid() -> Uuid {
        Uuid::new_v4()
    }

    #[test]
    fn connection_ack_returns_none() {
        let msg = r#"{"type":"connection_ack"}"#;
        assert!(parse_ws_message(msg, vid()).unwrap().is_none());
    }

    #[test]
    fn parse_battery_level() {
        let msg = serde_json::json!({
            "type": "next",
            "payload": { "data": { "vehicleState": {
                "batteryLevel": { "timeStamp": "2024-01-15T10:30:00.000Z", "value": 82.5 },
                "powerState":   { "timeStamp": "2024-01-15T10:30:00.000Z", "value": "ready" }
            }}}
        })
        .to_string();
        let ev = parse_ws_message(&msg, vid()).unwrap().unwrap();
        assert_eq!(ev.battery_level, Some(82.5));
        assert_eq!(ev.power_state, Some(PowerState::Ready));
    }

    #[test]
    fn missing_vehicle_state_errors() {
        let msg = serde_json::json!({
            "type": "next",
            "payload": { "data": {} }
        })
        .to_string();
        assert!(matches!(
            parse_ws_message(&msg, vid()),
            Err(ParseError::MissingVehicleState)
        ));
    }

    #[test]
    fn partial_update_leaves_fields_none() {
        let msg = serde_json::json!({
            "type": "next",
            "payload": { "data": { "vehicleState": {
                "batteryLevel": { "timeStamp": "2024-01-15T10:30:00Z", "value": 75.0 }
            }}}
        })
        .to_string();
        let ev = parse_ws_message(&msg, vid()).unwrap().unwrap();
        assert_eq!(ev.battery_level, Some(75.0));
        assert!(ev.latitude.is_none());
        assert!(ev.power_state.is_none());
        assert!(ev.outside_temp_c.is_none());
        assert!(ev.power_kw.is_none());
    }

    #[test]
    fn parses_extended_metrics_when_present() {
        let msg = serde_json::json!({
            "type": "next",
            "payload": { "data": { "vehicleState": {
                "cabinClimateExteriorTemperature": { "timeStamp": "2024-01-15T10:30:00Z", "value": 4.5 },
                "cabinClimateRunning": { "timeStamp": "2024-01-15T10:30:00Z", "value": true },
                "vehiclePowerOutput": { "timeStamp": "2024-01-15T10:30:00Z", "value": 22.1 },
                "regenerativeBrakingPower": { "timeStamp": "2024-01-15T10:30:00Z", "value": -8.4 },
                "gnssHeading": { "timeStamp": "2024-01-15T10:30:00Z", "value": 182.0 },
                "tirePressureFrontLeft": { "timeStamp": "2024-01-15T10:30:00Z", "value": 2.96 },
                "tirePressureFrontRight": { "timeStamp": "2024-01-15T10:30:00Z", "value": 2.95 },
                "tirePressureRearLeft": { "timeStamp": "2024-01-15T10:30:00Z", "value": 3.02 },
                "tirePressureRearRight": { "timeStamp": "2024-01-15T10:30:00Z", "value": 3.01 },
                "tirePressureStatusFrontLeft": { "timeStamp": "2024-01-15T10:30:00Z", "value": "OK" },
                "doorFrontLeftLocked": { "timeStamp": "2024-01-15T10:30:00Z", "value": "locked" },
                "doorFrontLeftClosed": { "timeStamp": "2024-01-15T10:30:00Z", "value": "closed" },
                "closureFrunkClosed": { "timeStamp": "2024-01-15T10:30:00Z", "value": "open" },
                "otaStatus": { "timeStamp": "2024-01-15T10:30:00Z", "value": "up_to_date" },
                "otaCurrentVersion": { "timeStamp": "2024-01-15T10:30:00Z", "value": "2024.11.02" }
            }}}
        }).to_string();

        let ev = parse_ws_message(&msg, vid()).unwrap().unwrap();
        assert_eq!(ev.outside_temp_c, Some(4.5));
        assert_eq!(ev.hvac_active, Some(true));
        assert_eq!(ev.power_kw, Some(22.1));
        assert_eq!(ev.regen_power_kw, Some(-8.4));
        assert_eq!(ev.heading_deg, Some(182.0));
        assert_eq!(
            ev.tire_fl_psi.map(|v| (v * 10.0).round() / 10.0),
            Some(42.9)
        );
        assert_eq!(
            ev.tire_fr_psi.map(|v| (v * 10.0).round() / 10.0),
            Some(42.8)
        );
        assert_eq!(
            ev.tire_rl_psi.map(|v| (v * 10.0).round() / 10.0),
            Some(43.8)
        );
        assert_eq!(
            ev.tire_rr_psi.map(|v| (v * 10.0).round() / 10.0),
            Some(43.7)
        );
        assert_eq!(ev.tire_fl_status.as_deref(), Some("OK"));
        assert_eq!(ev.door_front_left_locked, Some(true));
        assert_eq!(ev.door_front_left_closed, Some(true));
        assert_eq!(ev.closure_frunk_closed, Some(false));
        assert_eq!(ev.ota_status.as_deref(), Some("up_to_date"));
        assert_eq!(ev.ota_current_version.as_deref(), Some("2024.11.02"));
    }

    #[test]
    fn parses_current_drive_mode_values() {
        let msg = serde_json::json!({
            "type": "next",
            "payload": { "data": { "vehicleState": {
                "driveMode": { "timeStamp": "2024-01-15T10:30:00Z", "value": "everyday" }
            }}}
        })
        .to_string();

        let ev = parse_ws_message(&msg, vid()).unwrap().unwrap();
        assert_eq!(ev.drive_mode, Some(DriveMode::AllPurpose));
    }

    #[test]
    fn parses_rivian_bearing_as_heading() {
        let msg = serde_json::json!({
            "type": "next",
            "payload": { "data": { "vehicleState": {
                "gnssBearing": { "timeStamp": "2024-01-15T10:30:00Z", "value": 91.0 }
            }}}
        })
        .to_string();

        let ev = parse_ws_message(&msg, vid()).unwrap().unwrap();
        assert_eq!(ev.heading_deg, Some(91.0));
    }

    #[test]
    fn parses_vehicle_mileage_as_miles() {
        let msg = serde_json::json!({
            "type": "next",
            "payload": { "data": { "vehicleState": {
                "vehicleMileage": { "timeStamp": "2024-01-15T10:30:00Z", "value": 16093.44 }
            }}}
        })
        .to_string();

        let ev = parse_ws_message(&msg, vid()).unwrap().unwrap();
        assert_eq!(ev.odometer_miles, Some(10.0));
    }

    #[test]
    fn parses_distance_to_empty_as_miles() {
        let msg = serde_json::json!({
            "type": "next",
            "payload": { "data": { "vehicleState": {
                "distanceToEmpty": { "timeStamp": "2024-01-15T10:30:00Z", "value": 16.09344 }
            }}}
        })
        .to_string();

        let ev = parse_ws_message(&msg, vid()).unwrap().unwrap();
        assert_eq!(ev.distance_to_empty_mi, Some(10.0));
    }

    #[test]
    fn parses_battery_capacity_as_wh() {
        let msg = serde_json::json!({
            "type": "next",
            "payload": { "data": { "vehicleState": {
                "batteryCapacity": { "timeStamp": "2024-01-15T10:30:00Z", "value": 111.2 }
            }}}
        })
        .to_string();

        let ev = parse_ws_message(&msg, vid()).unwrap().unwrap();
        assert_eq!(ev.battery_capacity_wh, Some(111_200.0));
    }

    #[test]
    fn garbage_json_errors() {
        assert!(parse_ws_message("not json at all", vid()).is_err());
    }

    #[test]
    fn empty_object_returns_none() {
        let msg = r#"{"type":"ping"}"#;
        assert!(parse_ws_message(msg, vid()).unwrap().is_none());
    }
}
