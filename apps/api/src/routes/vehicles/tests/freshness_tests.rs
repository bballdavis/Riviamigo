use crate::routes::vehicles::{
    derive_vehicle_status_freshness, LatestVehicleTelemetry, VehicleRuntimeStateRow,
};
use chrono::{TimeZone, Utc};

#[test]
fn flags_ws_silence_as_stale() {
    let now = Utc.with_ymd_and_hms(2026, 6, 19, 12, 0, 0).unwrap();
    let runtime = VehicleRuntimeStateRow {
        last_ws_received_at: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 40, 0).unwrap()),
        worker_health: Some("connected".to_string()),
        ..Default::default()
    };

    let (worker_health, telemetry_stale, reason) =
        derive_vehicle_status_freshness(now, Some(&runtime), &LatestVehicleTelemetry::default());

    assert_eq!(worker_health.as_deref(), Some("stale"));
    assert!(telemetry_stale);
    assert_eq!(reason.as_deref(), Some("ws_silent"));
}

#[test]
fn flags_old_battery_timestamp_even_when_worker_is_connected() {
    let now = Utc.with_ymd_and_hms(2026, 6, 19, 12, 0, 0).unwrap();
    let runtime = VehicleRuntimeStateRow {
        last_ws_received_at: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
        worker_health: Some("connected".to_string()),
        ..Default::default()
    };
    let latest = LatestVehicleTelemetry {
        ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
        battery_level: Some(71.0),
        battery_level_ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 10, 20, 0).unwrap()),
        ..Default::default()
    };

    let (worker_health, telemetry_stale, reason) =
        derive_vehicle_status_freshness(now, Some(&runtime), &latest);

    assert_eq!(worker_health.as_deref(), Some("connected"));
    assert!(telemetry_stale);
    assert_eq!(reason.as_deref(), Some("battery_stale"));
}

#[test]
fn keeps_connected_feed_healthy_when_range_is_old() {
    let now = Utc.with_ymd_and_hms(2026, 6, 19, 12, 0, 0).unwrap();
    let runtime = VehicleRuntimeStateRow {
        last_ws_received_at: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
        worker_health: Some("connected".to_string()),
        ..Default::default()
    };
    let latest = LatestVehicleTelemetry {
        ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
        distance_to_empty_mi: Some(210.0),
        distance_to_empty_mi_ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 10, 20, 0).unwrap()),
        ..Default::default()
    };

    let (worker_health, telemetry_stale, reason) =
        derive_vehicle_status_freshness(now, Some(&runtime), &latest);

    assert_eq!(worker_health.as_deref(), Some("connected"));
    assert!(telemetry_stale);
    assert_eq!(reason.as_deref(), Some("range_stale"));
}

#[test]
fn keeps_connected_feed_healthy_when_active_charging_data_is_old() {
    let now = Utc.with_ymd_and_hms(2026, 6, 19, 12, 0, 0).unwrap();
    let runtime = VehicleRuntimeStateRow {
        last_ws_received_at: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
        worker_health: Some("connected".to_string()),
        ..Default::default()
    };
    let latest = LatestVehicleTelemetry {
        ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
        charger_state: Some("charging".to_string()),
        charger_state_ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 10, 20, 0).unwrap()),
        ..Default::default()
    };

    let (worker_health, telemetry_stale, reason) =
        derive_vehicle_status_freshness(now, Some(&runtime), &latest);

    assert_eq!(worker_health.as_deref(), Some("connected"));
    assert!(telemetry_stale);
    assert_eq!(reason.as_deref(), Some("charging_stale"));
}

#[test]
fn keeps_recent_runtime_as_healthy() {
    let now = Utc.with_ymd_and_hms(2026, 6, 19, 12, 0, 0).unwrap();
    let runtime = VehicleRuntimeStateRow {
        last_ws_received_at: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
        worker_health: Some("connected".to_string()),
        ..Default::default()
    };
    let latest = LatestVehicleTelemetry {
        ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 59, 0).unwrap()),
        battery_level: Some(71.0),
        battery_level_ts: Some(Utc.with_ymd_and_hms(2026, 6, 19, 11, 58, 30).unwrap()),
        ..Default::default()
    };

    let (worker_health, telemetry_stale, reason) =
        derive_vehicle_status_freshness(now, Some(&runtime), &latest);

    assert_eq!(worker_health.as_deref(), Some("connected"));
    assert!(!telemetry_stale);
    assert_eq!(reason, None);
}
