use serde_json::json;
use uuid::Uuid;

use super::{
    export::{build_header, export_line},
    writer::{Admit, CapLedger},
    *,
};

#[test]
fn record_is_a_noop_without_a_running_capture() {
    // No capture is registered for this vehicle (lifecycle tests may install
    // the registry, but only register vehicles they create).
    let vehicle_id = Uuid::new_v4();
    assert!(!is_capturing(vehicle_id));
    record(vehicle_id, Kind::Ingestion, json!({ "source": "legacy" }));
    assert!(!is_capturing(vehicle_id));
}

#[test]
fn cap_admits_up_to_the_limit_then_one_truncation_marker() {
    let mut ledger = CapLedger::default();
    let capture = Uuid::new_v4();
    ledger.seed(capture, 1);
    assert!(matches!(ledger.admit(capture, 3), Admit::Store));
    assert!(matches!(ledger.admit(capture, 3), Admit::Store));
    assert!(matches!(ledger.admit(capture, 3), Admit::Truncate));
    assert!(matches!(ledger.admit(capture, 3), Admit::Drop));
    assert!(matches!(ledger.admit(capture, 3), Admit::Drop));
    // Another capture has its own budget.
    assert!(matches!(ledger.admit(Uuid::new_v4(), 3), Admit::Store));
}

#[test]
fn sanitize_strips_identity_location_and_credentials_at_any_depth() {
    let cleaned = sanitize(json!({
        "vehicle_id": "x",
        "topic": "body.closures.states",
        "decoded": {
            "latitude": 1.0,
            "longitude": 2.0,
            "speed_mph": 3.0,
            "door_front_left_closed": false,
        },
        "fields": { "gnssLocation": { "latitude": 1.0 }, "doorFrontLeftClosed": { "value": "open" } },
        "headers": { "U-Sess": "secret", "csrfToken": "t", "appSessionToken": "t" },
        "entries": [{ "vin": "7PD", "position": 1 }],
    }));
    assert_eq!(
        cleaned,
        json!({
            "topic": "body.closures.states",
            "decoded": { "speed_mph": 3.0, "door_front_left_closed": false },
            "fields": { "doorFrontLeftClosed": { "value": "open" } },
            "headers": {},
            "entries": [{ "position": 1 }],
        })
    );
}

#[test]
fn export_lines_omit_vehicle_id_and_coordinates() {
    let line = export_line(
        "2026-09-30T21:10:47.988Z".parse().unwrap(),
        "parallax_envelope",
        json!({ "vehicle_id": "x", "decoded": { "latitude": 1.0, "speed_mph": 0.0 } }),
    );
    assert_eq!(
        line,
        json!({
            "recorded_at": "2026-09-30T21:10:47.988Z",
            "kind": "parallax_envelope",
            "fields": { "decoded": { "speed_mph": 0.0 } },
        })
    );
}

#[test]
fn present_fields_drops_nulls_and_identity() {
    #[derive(serde::Serialize)]
    struct Sample {
        vehicle_id: Uuid,
        latitude: Option<f64>,
        speed_mph: Option<f64>,
        power_state: Option<&'static str>,
    }
    let value = present_fields(&Sample {
        vehicle_id: Uuid::nil(),
        latitude: Some(1.0),
        speed_mph: None,
        power_state: Some("ready"),
    });
    assert_eq!(value, json!({ "power_state": "ready" }));
}

#[test]
fn header_is_shareable_and_complete() {
    let header = build_header(
        Some("R1S"),
        "2026-09-30T21:10:00Z".parse().unwrap(),
        Some("2026-09-30T21:25:00Z".parse().unwrap()),
        Some("user"),
        &[
            ("legacy_frame".into(), 12),
            ("parallax_envelope".into(), 30),
        ],
        42,
        0,
        false,
    );
    assert_eq!(header["kind"], "header");
    assert_eq!(header["format_version"], FORMAT_VERSION);
    assert_eq!(header["model"], "R1S");
    assert_eq!(header["stopped_at"], "2026-09-30T21:25:00.000Z");
    assert_eq!(header["counts_by_kind"]["parallax_envelope"], 30);
    assert_eq!(header["event_count"], 42);
    let keys: Vec<&str> = header
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert!(!keys
        .iter()
        .any(|key| key.contains("vehicle") || *key == "vin" || *key == "name"));
}

#[test]
fn filename_uses_model_and_start_time() {
    assert_eq!(
        export_filename(Some("R1S"), "2026-09-30T21:10:12Z".parse().unwrap()),
        "riviamigo-capture-r1s-20260930T2110Z.jsonl"
    );
    assert_eq!(
        export_filename(None, "2026-09-30T21:10:12Z".parse().unwrap()),
        "riviamigo-capture-vehicle-20260930T2110Z.jsonl"
    );
}

mod lifecycle_order {
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        time::Duration,
    };

    use chrono::Utc;
    use uuid::Uuid;

    use super::super::{
        lifecycle::{close_capture, replace_capture},
        registry::{install_for_tests, register, registered_capture},
    };

    fn later() -> chrono::DateTime<Utc> {
        Utc::now() + chrono::Duration::hours(1)
    }

    #[tokio::test]
    async fn a_failed_start_keeps_the_previous_capture_registered() {
        install_for_tests();
        let vehicle_id = Uuid::new_v4();
        let previous = Uuid::new_v4();
        register(vehicle_id, previous, later());

        let result = replace_capture(vehicle_id, || async {
            anyhow::bail!("transaction failed before commit")
        })
        .await;

        assert!(result.is_err());
        assert_eq!(registered_capture(vehicle_id), Some(previous));
    }

    #[tokio::test]
    async fn concurrent_starts_register_in_commit_order() {
        install_for_tests();
        let vehicle_id = Uuid::new_v4();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let first_committed = Arc::new(AtomicBool::new(false));

        let first_flag = Arc::clone(&first_committed);
        let slow = tokio::spawn(replace_capture(vehicle_id, move || async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            first_flag.store(true, Ordering::SeqCst);
            Ok((first, later()))
        }));
        // Let the slow start take the lifecycle lock first.
        tokio::time::sleep(Duration::from_millis(20)).await;
        let second_flag = Arc::clone(&first_committed);
        let fast = tokio::spawn(replace_capture(vehicle_id, move || async move {
            assert!(
                second_flag.load(Ordering::SeqCst),
                "the second start must not commit before the first has finished"
            );
            Ok((second, later()))
        }));

        slow.await.unwrap().unwrap();
        fast.await.unwrap().unwrap();
        assert_eq!(registered_capture(vehicle_id), Some(second));
    }

    #[tokio::test]
    async fn a_failed_stop_restores_the_capture_for_a_retry() {
        install_for_tests();
        let vehicle_id = Uuid::new_v4();
        let capture = Uuid::new_v4();
        register(vehicle_id, capture, later());

        let failed = close_capture(vehicle_id, |_| async {
            anyhow::bail!("update failed before commit")
        })
        .await;
        assert!(failed.is_err());
        assert_eq!(registered_capture(vehicle_id), Some(capture));

        let stopped = close_capture(vehicle_id, |_| async { Ok(true) })
            .await
            .unwrap();
        assert!(stopped);
        assert_eq!(registered_capture(vehicle_id), None);
    }
}
