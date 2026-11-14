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

async fn insert_matching_session(
    conn: &mut sqlx::PgConnection,
    id: Uuid,
    vehicle_id: Uuid,
    started_at: DateTime<Utc>,
    source: &str,
    alias: &str,
    grouping_key: &str,
) {
    sqlx::query(
        "INSERT INTO riviamigo.charge_sessions (id, vehicle_id, started_at, source)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(id)
    .bind(vehicle_id)
    .bind(started_at)
    .bind(source)
    .execute(&mut *conn)
    .await
    .expect("charge session fixture");
    // Two alias rows per session: a join would see each session twice.
    for suffix in ["txn", "vtxn"] {
        sqlx::query(
            "INSERT INTO riviamigo.charge_session_external_aliases
             (charge_session_id, external_id, alias_kind, transaction_id_grouping_key)
             VALUES ($1, $2, 'txn', $3)",
        )
        .bind(id)
        .bind(format!("{alias}-{suffix}"))
        .bind(grouping_key)
        .execute(&mut *conn)
        .await
        .expect("alias fixture");
    }
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn alias_and_grouping_matches_prefer_priority_then_closest_start_not_lowest_id() {
    let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL"))
        .await
        .expect("test database");
    let mut tx = pool.begin().await.expect("test transaction");
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO riviamigo.users (id, email, password_hash) VALUES ($1, $2, 'unused')")
        .bind(user_id)
        .bind(format!("charge-match-{user_id}@example.test"))
        .execute(&mut *tx)
        .await
        .unwrap();
    let vehicle_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO riviamigo.vehicles (id, user_id, rivian_vehicle_id, model)
         VALUES ($1, $2, $3, 'R1S')",
    )
    .bind(vehicle_id)
    .bind(user_id)
    .bind(format!("provider-{vehicle_id}"))
    .execute(&mut *tx)
    .await
    .unwrap();

    // Give the lowest-priority session the lowest UUID, so ordering by id
    // first (the previous DISTINCT ON behavior) would pick it.
    let mut ids = [Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4()];
    ids.sort();
    let [api_only, far_telemetry, near_telemetry] = ids;
    let summary_start = Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap();
    insert_matching_session(
        &mut tx,
        api_only,
        vehicle_id,
        summary_start,
        CHARGE_SESSION_SOURCE_RIVIAN_API,
        "shared",
        "GK-1",
    )
    .await;
    insert_matching_session(
        &mut tx,
        far_telemetry,
        vehicle_id,
        summary_start - chrono::Duration::minutes(50),
        CHARGE_SESSION_SOURCE_TELEMETRY,
        "shared",
        "GK-1",
    )
    .await;
    insert_matching_session(
        &mut tx,
        near_telemetry,
        vehicle_id,
        summary_start + chrono::Duration::minutes(5),
        CHARGE_SESSION_SOURCE_TELEMETRY,
        "shared",
        "GK-1",
    )
    .await;

    let aliases = [ChargeSessionExternalAlias {
        external_id: "shared-txn".into(),
        alias_kind: ExternalAliasKind::Txn,
        transaction_id_grouping_key: None,
    }];
    let by_alias = find_session_by_external_alias(&mut *tx, vehicle_id, &aliases)
        .await
        .unwrap()
        .expect("alias match");
    // Equal-priority telemetry sessions tie-break on the earliest start.
    assert_eq!(by_alias.id, far_telemetry);

    let by_group =
        find_session_by_grouping_key(&mut *tx, vehicle_id, Some("GK-1"), Some(summary_start))
            .await
            .unwrap()
            .expect("grouping match");
    assert_eq!(by_group.id, near_telemetry);
    assert_eq!(
        by_group.source.as_deref(),
        Some(CHARGE_SESSION_SOURCE_TELEMETRY)
    );

    tx.rollback().await.expect("rollback test fixtures");
}
