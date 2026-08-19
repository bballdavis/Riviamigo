//! Pure status freshness and per-field availability decisions.

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, Utc};

use super::{LatestVehicleTelemetry, VehicleRuntimeStateRow};

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum StatusFieldAvailabilityState {
    Current,
    Historical,
    NeverSeen,
}

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum StatusFieldAvailabilityReasonCode {
    MissingRecentPayload,
    NeverSeen,
    InvalidSensor,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub(super) struct StatusFieldAvailability {
    pub(super) ever_seen: bool,
    pub(super) last_seen_at: Option<DateTime<Utc>>,
    pub(super) latest_event_at: Option<DateTime<Utc>>,
    pub(super) availability: StatusFieldAvailabilityState,
    pub(super) reason_code: Option<StatusFieldAvailabilityReasonCode>,
}

const WS_RECEIVE_STALE_AFTER: Duration = Duration::minutes(10);
const BATTERY_STATUS_STALE_AFTER: Duration = Duration::minutes(90);
const RANGE_STATUS_STALE_AFTER: Duration = Duration::minutes(90);
const CHARGING_STATUS_STALE_AFTER: Duration = Duration::minutes(45);

fn timestamp_is_older_than(now: DateTime<Utc>, ts: Option<DateTime<Utc>>, threshold: Duration) -> bool {
    ts.is_some_and(|value| now - value >= threshold)
}

pub(super) fn classify_status_field_availability(
    latest_event_at: Option<DateTime<Utc>>,
    last_seen_at: Option<DateTime<Utc>>,
    reason_override: Option<StatusFieldAvailabilityReasonCode>,
) -> StatusFieldAvailability {
    let availability = match (latest_event_at, last_seen_at) {
        (_, None) => StatusFieldAvailabilityState::NeverSeen,
        (Some(latest_event_at), Some(last_seen_at)) if last_seen_at < latest_event_at => {
            StatusFieldAvailabilityState::Historical
        }
        _ => StatusFieldAvailabilityState::Current,
    };

    let reason_code = match availability {
        StatusFieldAvailabilityState::NeverSeen => {
            Some(StatusFieldAvailabilityReasonCode::NeverSeen)
        }
        StatusFieldAvailabilityState::Historical => {
            Some(reason_override.unwrap_or(StatusFieldAvailabilityReasonCode::MissingRecentPayload))
        }
        StatusFieldAvailabilityState::Current => reason_override,
    };

    StatusFieldAvailability {
        ever_seen: last_seen_at.is_some(),
        last_seen_at,
        latest_event_at,
        availability,
        reason_code,
    }
}

pub(super) fn max_seen_at(
    values: impl IntoIterator<Item = Option<DateTime<Utc>>>,
) -> Option<DateTime<Utc>> {
    values.into_iter().flatten().max()
}

pub(super) fn insert_field_availability(
    availability: &mut BTreeMap<String, StatusFieldAvailability>,
    field: &str,
    latest_event_at: Option<DateTime<Utc>>,
    last_seen_at: Option<DateTime<Utc>>,
    reason_override: Option<StatusFieldAvailabilityReasonCode>,
) {
    availability.insert(
        field.to_string(),
        classify_status_field_availability(latest_event_at, last_seen_at, reason_override),
    );
}

pub(super) fn derive_vehicle_status_freshness(
    now: DateTime<Utc>,
    runtime: Option<&VehicleRuntimeStateRow>,
    latest: &LatestVehicleTelemetry,
) -> (Option<String>, bool, Option<String>) {
    let ws_received_at = runtime.and_then(|row| row.last_ws_received_at);
    let base_health = runtime.and_then(|row| row.worker_health.clone());

    if timestamp_is_older_than(now, ws_received_at, WS_RECEIVE_STALE_AFTER) {
        return (
            Some("stale".to_string()),
            true,
            Some("ws_silent".to_string()),
        );
    }

    let mut telemetry_stale_reason = None;

    if latest.battery_level.is_some()
        && timestamp_is_older_than(
            now,
            latest.battery_level_ts.or(latest.ts),
            BATTERY_STATUS_STALE_AFTER,
        )
    {
        telemetry_stale_reason = Some("battery_stale".to_string());
    }

    if latest.distance_to_empty_mi.is_some()
        && timestamp_is_older_than(
            now,
            latest.distance_to_empty_mi_ts.or(latest.ts),
            RANGE_STATUS_STALE_AFTER,
        )
    {
        telemetry_stale_reason.get_or_insert_with(|| "range_stale".to_string());
    }

    let charging_active = latest
        .charger_state
        .as_deref()
        .is_some_and(|state| state == "charging")
        || latest
            .charger_status
            .as_deref()
            .is_some_and(|status| status.eq_ignore_ascii_case("chrgr_sts_connected_charging"))
        || latest.time_to_end_of_charge_min.is_some();

    if charging_active
        && timestamp_is_older_than(
            now,
            latest
                .charger_status_ts
                .or(latest.charger_state_ts)
                .or(latest.time_to_end_of_charge_min_ts)
                .or(latest.ts),
            CHARGING_STATUS_STALE_AFTER,
        )
    {
        telemetry_stale_reason.get_or_insert_with(|| "charging_stale".to_string());
    }

    (
        base_health,
        telemetry_stale_reason.is_some(),
        telemetry_stale_reason,
    )
}
