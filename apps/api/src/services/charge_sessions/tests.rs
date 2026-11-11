use super::*;
use chrono::TimeZone;

#[test]
fn charge_summary_classifies_upstream_vehicle_identity() {
    for (vehicle_id, expected) in [
        (serde_json::json!("vehicle-a"), SummaryVehicleMatch::Match),
        (serde_json::json!("vehicle-b"), SummaryVehicleMatch::Foreign),
        // Exact comparison: no case folding or trimming of real IDs.
        (serde_json::json!("VEHICLE-A"), SummaryVehicleMatch::Foreign),
        (
            serde_json::json!(" vehicle-a"),
            SummaryVehicleMatch::Foreign,
        ),
        (serde_json::Value::Null, SummaryVehicleMatch::Unidentified),
        (serde_json::json!(""), SummaryVehicleMatch::Unidentified),
        (serde_json::json!("  "), SummaryVehicleMatch::Unidentified),
    ] {
        let summary: ChargeSessionSummaryPayload =
            serde_json::from_value(serde_json::json!({ "vehicleId": vehicle_id })).unwrap();
        assert_eq!(summary.vehicle_match("vehicle-a"), expected, "{vehicle_id}");
    }
    let missing: ChargeSessionSummaryPayload =
        serde_json::from_value(serde_json::json!({})).unwrap();
    assert_eq!(
        missing.vehicle_match("vehicle-a"),
        SummaryVehicleMatch::Unidentified
    );
}

#[test]
fn summary_attribution_admits_unidentified_only_when_allowed() {
    let mut counts = SummaryAttributionCounts::default();
    assert!(counts.admit(SummaryVehicleMatch::Match, false));
    assert!(counts.admit(SummaryVehicleMatch::Match, true));
    assert!(!counts.admit(SummaryVehicleMatch::Foreign, false));
    assert!(!counts.admit(SummaryVehicleMatch::Foreign, true));
    assert!(!counts.admit(SummaryVehicleMatch::Unidentified, false));
    assert!(counts.admit(SummaryVehicleMatch::Unidentified, true));
    assert_eq!(
        counts,
        SummaryAttributionCounts {
            skipped_foreign: 2,
            skipped_unidentified: 1,
            accepted_unidentified: 1,
        }
    );
    assert!(SummaryAttributionCounts::default().is_empty());
}

#[test]
fn normalizes_grouping_keys_stably() {
    assert_eq!(
        normalize_grouping_key(Some("VTXN-2, TXN-1,TXN-1")),
        Some("TXN-1,VTXN-2".to_string())
    );
}

#[test]
fn prefers_txn_alias_over_vtxn_alias() {
    let summary = ChargeSessionSummaryPayload {
        transaction_id: Some("d284".to_string()),
        start_instant: Some(Utc.with_ymd_and_hms(2026, 6, 20, 15, 17, 0).unwrap()),
        end_instant: Some(Utc.with_ymd_and_hms(2026, 6, 20, 16, 1, 0).unwrap()),
        charger_type: Some("dcfc".to_string()),
        currency_code: Some("USD".to_string()),
        total_energy_kwh: Some(45.2),
        range_added_km: Some(120.0),
        city: Some("Austin".to_string()),
        vehicle_id: Some("veh-1".to_string()),
        vehicle_name: Some("R1S".to_string()),
        vendor: Some("Rivian".to_string()),
        paid_total: Some(18.4),
        is_public: Some(true),
        is_home_charger: Some(false),
        is_roaming_network: Some(false),
        meta: Some(ChargeSessionSummaryMeta {
            transaction_id_grouping_key: Some("8fbf,d284".to_string()),
            data_sources: Some(vec![
                "VTXN:d284".to_string(),
                "TXN:8fbf".to_string(),
                "CDRS:USCPI123".to_string(),
            ]),
        }),
    };

    let aliases = parse_summary_aliases(&summary);
    let preferred = preferred_external_alias(&aliases).expect("preferred alias");
    assert_eq!(preferred.alias_kind, ExternalAliasKind::Cdrs);
    assert_eq!(preferred.external_id, "USCPI123");
    assert!(aliases
        .iter()
        .any(|alias| alias.alias_kind == ExternalAliasKind::Txn));
    assert!(aliases
        .iter()
        .any(|alias| alias.alias_kind == ExternalAliasKind::Vtxn));
}

#[test]
fn recent_only_insert_policy_respects_lookback() {
    let now = Utc.with_ymd_and_hms(2026, 6, 21, 12, 0, 0).unwrap();
    assert!(should_insert_unmatched_session(
        UnmatchedInsertPolicy::RecentOnly {
            now,
            lookback_days: 30,
        },
        Some(Utc.with_ymd_and_hms(2026, 6, 10, 12, 0, 0).unwrap()),
    ));
    assert!(!should_insert_unmatched_session(
        UnmatchedInsertPolicy::RecentOnly {
            now,
            lookback_days: 30,
        },
        Some(Utc.with_ymd_and_hms(2026, 4, 10, 12, 0, 0).unwrap()),
    ));
}
