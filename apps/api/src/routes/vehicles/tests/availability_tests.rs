use crate::routes::vehicles::status::{
    classify_status_field_availability, max_seen_at, StatusFieldAvailabilityReasonCode,
    StatusFieldAvailabilityState,
};
use chrono::{TimeZone, Utc};

#[test]
fn marks_missing_field_as_never_seen() {
    let latest_event_at = Some(Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap());
    let availability = classify_status_field_availability(latest_event_at, None, None);

    assert!(!availability.ever_seen);
    assert_eq!(
        availability.availability,
        StatusFieldAvailabilityState::NeverSeen
    );
    assert_eq!(
        availability.reason_code,
        Some(StatusFieldAvailabilityReasonCode::NeverSeen)
    );
}

#[test]
fn marks_field_as_historical_when_latest_event_is_newer() {
    let latest_event_at = Some(Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap());
    let last_seen_at = Some(Utc.with_ymd_and_hms(2026, 7, 7, 10, 30, 0).unwrap());
    let availability = classify_status_field_availability(latest_event_at, last_seen_at, None);

    assert!(availability.ever_seen);
    assert_eq!(availability.last_seen_at, last_seen_at);
    assert_eq!(
        availability.availability,
        StatusFieldAvailabilityState::Historical
    );
    assert_eq!(
        availability.reason_code,
        Some(StatusFieldAvailabilityReasonCode::MissingRecentPayload)
    );
}

#[test]
fn keeps_latest_field_as_current() {
    let latest_event_at = Some(Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap());
    let availability = classify_status_field_availability(latest_event_at, latest_event_at, None);

    assert_eq!(
        availability.availability,
        StatusFieldAvailabilityState::Current
    );
    assert_eq!(availability.reason_code, None);
}

#[test]
fn preserves_invalid_sensor_reason_for_current_and_historical_fields() {
    let latest_event_at = Some(Utc.with_ymd_and_hms(2026, 7, 7, 12, 0, 0).unwrap());
    let current = classify_status_field_availability(
        latest_event_at,
        latest_event_at,
        Some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );
    let historical = classify_status_field_availability(
        latest_event_at,
        Some(Utc.with_ymd_and_hms(2026, 7, 7, 11, 0, 0).unwrap()),
        Some(StatusFieldAvailabilityReasonCode::InvalidSensor),
    );

    assert_eq!(
        current.reason_code,
        Some(StatusFieldAvailabilityReasonCode::InvalidSensor)
    );
    assert_eq!(
        historical.reason_code,
        Some(StatusFieldAvailabilityReasonCode::InvalidSensor)
    );
}

#[test]
fn returns_latest_seen_timestamp() {
    let a = Utc.with_ymd_and_hms(2026, 7, 7, 8, 0, 0).unwrap();
    let b = Utc.with_ymd_and_hms(2026, 7, 7, 10, 0, 0).unwrap();
    let c = Utc.with_ymd_and_hms(2026, 7, 7, 9, 0, 0).unwrap();

    assert_eq!(max_seen_at([Some(a), Some(b), Some(c)]), Some(b));
}
