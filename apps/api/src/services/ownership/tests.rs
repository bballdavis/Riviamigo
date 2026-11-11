use chrono::NaiveDate;
use serde_json::json;

use super::fuel_prices::{EIA_PREMIUM_SERIES, EIA_REGULAR_SERIES};
use super::*;

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 11, 10).unwrap()
}

#[test]
fn fuel_price_endpoint_requests_both_grades_and_defaults_the_key() {
    let url = fuel_price_endpoint(None, 5000).unwrap();
    assert_eq!(url.host_str(), Some("api.eia.gov"));
    assert_eq!(url.path(), "/v2/petroleum/pri/gnd/data/");
    let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
    assert!(pairs.contains(&("api_key".into(), "DEMO_KEY".into())));
    assert!(pairs.contains(&("facets[series][]".into(), EIA_REGULAR_SERIES.into())));
    assert!(pairs.contains(&("facets[series][]".into(), EIA_PREMIUM_SERIES.into())));

    let url = fuel_price_endpoint(Some("  abc123 "), 1).unwrap();
    assert!(url
        .query_pairs()
        .any(|(key, value)| key == "api_key" && value == "abc123"));
}

#[test]
fn parses_numeric_and_string_prices_and_skips_unknown_rows() {
    let body = json!({ "response": { "data": [
        { "period": "2026-10", "series": EIA_REGULAR_SERIES, "value": 3.21 },
        { "period": "2026-10", "series": EIA_PREMIUM_SERIES, "value": "4.05" },
        { "period": "2026-10", "series": "EMM_EPD2D_PTE_NUS_DPG", "value": 3.9 },
        { "period": "bad", "series": EIA_REGULAR_SERIES, "value": 3.0 },
        { "period": "2026-09", "series": EIA_REGULAR_SERIES, "value": null }
    ] } });
    let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
    assert_eq!(
        parse_fuel_prices(&body),
        vec![(month, "regular", 3.21), (month, "premium", 4.05)]
    );
    assert!(parse_fuel_prices(&json!({ "error": "API_KEY_MISSING" })).is_empty());
}

#[test]
fn lookup_menu_handles_array_single_object_and_null() {
    let many = json!({ "menuItem": [
        { "text": "Kia", "value": "Kia" }, { "text": "BMW", "value": "BMW" }
    ] });
    assert_eq!(parse_lookup_menu(&many).len(), 2);
    let one = json!({ "menuItem": { "text": "Auto (AWD)", "value": "48123" } });
    assert_eq!(
        parse_lookup_menu(&one),
        vec![LookupOption {
            text: "Auto (AWD)".into(),
            value: "48123".into()
        }]
    );
    assert!(parse_lookup_menu(&serde_json::Value::Null).is_empty());
}

#[test]
fn lookup_vehicle_classifies_powertrain_and_fuel() {
    let ev = parse_lookup_vehicle(&json!({
        "id": "47001", "year": "2025", "make": "Kia", "model": "EV9 AWD",
        "atvType": "EV", "fuelType1": "Electricity", "combE": "41.0", "comb08": "83"
    }))
    .unwrap();
    assert_eq!(ev.powertrain, Powertrain::Ev);
    assert_eq!(ev.kwh_per_mi, Some(0.41));
    assert_eq!(ev.mpg, None);

    let premium = parse_lookup_vehicle(&json!({
        "id": 47002, "year": "2025", "make": "BMW", "model": "X7 xDrive40i",
        "atvType": "", "fuelType1": "Premium Gasoline", "comb08": "22"
    }))
    .unwrap();
    assert_eq!(premium.powertrain, Powertrain::Gas);
    assert!(premium.premium_fuel);
    assert_eq!(premium.label, "2025 BMW X7 xDrive40i");

    let hybrid = parse_lookup_vehicle(&json!({
        "id": "47003", "year": "2025", "make": "Toyota", "model": "Camry",
        "atvType": "Hybrid", "fuelType1": "Regular Gasoline", "comb08": "51"
    }))
    .unwrap();
    assert_eq!(hybrid.powertrain, Powertrain::Hybrid);
    assert!(!hybrid.premium_fuel);

    assert!(parse_lookup_vehicle(&json!({ "id": "1", "year": "2025" })).is_none());
}

#[test]
fn settings_validation_rejects_out_of_range_and_normalizes_custom_vehicles() {
    let base = OwnershipSettings::default();
    assert!(validate_settings(base.clone(), today()).is_ok());

    let negative = OwnershipSettings {
        purchase_price_usd: Some(-1.0),
        ..base.clone()
    };
    assert!(validate_settings(negative, today()).is_err());

    let future = OwnershipSettings {
        purchase_date: NaiveDate::from_ymd_opt(2026, 11, 11),
        ..base.clone()
    };
    assert!(validate_settings(future, today()).is_err());

    for (years, ok) in [
        (Some(1), true),
        (Some(20), true),
        (Some(0), false),
        (Some(21), false),
    ] {
        let projection = OwnershipSettings {
            projection_years: years,
            ..base.clone()
        };
        assert_eq!(validate_settings(projection, today()).is_ok(), ok);
    }

    let custom = |id: &str, powertrain, mpg, kwh| CustomVehicle {
        id: id.into(),
        label: "  My car ".into(),
        powertrain,
        price_usd: 30_000.0,
        mpg,
        kwh_per_mi: kwh,
        premium_fuel: true,
    };
    let stored = validate_settings(
        OwnershipSettings {
            comparisons: Comparisons {
                enabled: Some(vec!["kia_ev9".into(), "custom-1".into(), "kia_ev9".into()]),
                custom: vec![custom("custom-1", Powertrain::Ev, Some(30.0), Some(0.3))],
            },
            ..base.clone()
        },
        today(),
    )
    .unwrap();
    assert_eq!(stored.comparisons.enabled.as_ref().unwrap().len(), 2);
    let vehicle = &stored.comparisons.custom[0];
    assert_eq!(vehicle.label, "My car");
    assert_eq!(vehicle.mpg, None);
    assert!(!vehicle.premium_fuel);

    for invalid in [
        custom("kia_ev9", Powertrain::Gas, Some(25.0), None),
        custom("bad id", Powertrain::Gas, Some(25.0), None),
        custom("custom-2", Powertrain::Gas, None, None),
        custom("custom-3", Powertrain::Ev, None, None),
    ] {
        let settings = OwnershipSettings {
            comparisons: Comparisons {
                enabled: None,
                custom: vec![invalid],
            },
            ..base.clone()
        };
        assert!(validate_settings(settings, today()).is_err());
    }
}

#[test]
fn reference_vehicles_have_unique_ids_and_the_figures_their_powertrain_needs() {
    let vehicles = reference_vehicles();
    let mut ids: Vec<_> = vehicles.iter().map(|vehicle| vehicle.id).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), vehicles.len());
    for vehicle in &vehicles {
        match vehicle.powertrain {
            Powertrain::Ev => assert!(vehicle.kwh_per_mi.is_some() && vehicle.mpg.is_none()),
            _ => assert!(vehicle.mpg.is_some() && !vehicle.costs.maintenance.is_empty()),
        }
    }
}

#[test]
fn stored_settings_skip_only_the_entries_this_build_cannot_read() {
    use super::settings::{parse_comparisons, parse_maintenance};

    let vehicle_id = uuid::Uuid::new_v4();
    let comparisons = parse_comparisons(
        vehicle_id,
        json!({
            "enabled": ["kia_ev9", 7, "custom-1"],
            "custom": [
                { "id": "custom-1", "label": "Old truck", "powertrain": "gas",
                  "price_usd": 30000.0, "mpg": 18.0 },
                { "id": "custom-2", "label": "Future", "powertrain": "hydrogen",
                  "price_usd": 1.0 },
                { "id": "custom-3", "label": "Commuter", "powertrain": "ev",
                  "price_usd": 25000.0, "kwh_per_mi": 0.3 }
            ]
        }),
    );
    assert_eq!(
        comparisons.enabled,
        Some(vec!["kia_ev9".to_string(), "custom-1".to_string()])
    );
    let ids: Vec<_> = comparisons.custom.iter().map(|v| v.id.as_str()).collect();
    assert_eq!(ids, ["custom-1", "custom-3"]);

    let maintenance = parse_maintenance(
        vehicle_id,
        json!({
            "own": [
                { "id": "rotate", "label": "Rotate tires", "category": "tires",
                  "interval_mi": 7500.0, "interval_months": null, "cost_usd": 40.0 },
                { "id": "laser", "label": "Laser alignment", "category": "lasers",
                  "interval_mi": 1000.0, "interval_months": null, "cost_usd": 1.0 }
            ],
            "kia_ev9": [
                { "id": "bad", "label": "Unreadable", "category": "unknown",
                  "interval_mi": 1000.0, "interval_months": null, "cost_usd": 1.0 }
            ],
            "tesla_model_y": [],
            "bmw_x7": "not a schedule"
        }),
    );
    assert_eq!(maintenance["own"].len(), 1);
    assert_eq!(maintenance["own"][0].id, "rotate");
    // No readable items: fall back to the built-in schedule.
    assert!(!maintenance.contains_key("kia_ev9"));
    // An intentionally emptied schedule stays empty.
    assert!(maintenance["tesla_model_y"].is_empty());
    assert!(!maintenance.contains_key("bmw_x7"));

    assert_eq!(
        parse_comparisons(vehicle_id, json!("garbage")),
        Comparisons::default()
    );
    assert!(parse_maintenance(vehicle_id, serde_json::Value::Null).is_empty());
}

#[test]
fn fuel_price_refresh_decision_serves_fresh_or_recently_attempted_copies() {
    use super::fuel_prices::{refresh_decision, RefreshDecision};
    use chrono::{Duration, TimeZone, Utc};

    let now = Utc.with_ymd_and_hms(2026, 11, 10, 12, 0, 0).unwrap();
    let ago = |hours| Some(now - Duration::hours(hours));

    // Stored within a day: serve it.
    assert_eq!(
        refresh_decision(now, ago(30), ago(30), false, ago(2)),
        RefreshDecision::Serve {
            refresh_failed: false
        }
    );
    // Stale, but a failed attempt an hour ago holds the retry back.
    assert_eq!(
        refresh_decision(now, ago(1), ago(40), true, ago(40)),
        RefreshDecision::Serve {
            refresh_failed: true
        }
    );
    // Stale and the last attempt is old: refresh, remembering the failure.
    assert_eq!(
        refresh_decision(now, ago(7), ago(40), true, ago(40)),
        RefreshDecision::Refresh {
            previously_failed: true
        }
    );
    // Nothing stored yet and only a connection test recorded an attempt.
    assert_eq!(
        refresh_decision(now, ago(1), None, false, None),
        RefreshDecision::Refresh {
            previously_failed: false
        }
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn fuel_price_refresh_claim_admits_one_refresh_per_observed_attempt() {
    use super::fuel_prices::claim_fuel_price_refresh;

    let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL"))
        .await
        .expect("test database");
    let mut tx = pool.begin().await.expect("test transaction");
    // A private activity row keeps the real fuel-price connection untouched.
    let connection_id = format!("test-fuel-claim-{}", uuid::Uuid::new_v4());
    let last_attempt = || {
        sqlx::query_scalar::<_, Option<chrono::DateTime<chrono::Utc>>>(
            "SELECT last_attempt_at FROM riviamigo.external_connection_activity
             WHERE connection_id = $1",
        )
        .bind(&connection_id)
    };

    // No row yet: the first claimant creates it and wins; a second claimant
    // that read the same empty state loses.
    assert!(claim_fuel_price_refresh(&mut *tx, &connection_id, None)
        .await
        .unwrap());
    assert!(!claim_fuel_price_refresh(&mut *tx, &connection_id, None)
        .await
        .unwrap());

    // A claimant that read the winner's attempt can claim the next refresh;
    // anyone holding the older observation still loses.
    let observed = last_attempt().fetch_one(&mut *tx).await.unwrap();
    assert!(observed.is_some());
    sqlx::query(
        "UPDATE riviamigo.external_connection_activity
         SET last_attempt_at = last_attempt_at - interval '1 day'
         WHERE connection_id = $1",
    )
    .bind(&connection_id)
    .execute(&mut *tx)
    .await
    .unwrap();
    assert!(
        !claim_fuel_price_refresh(&mut *tx, &connection_id, observed)
            .await
            .unwrap()
    );
    let observed = last_attempt().fetch_one(&mut *tx).await.unwrap();
    assert!(claim_fuel_price_refresh(&mut *tx, &connection_id, observed)
        .await
        .unwrap());
    assert!(
        !claim_fuel_price_refresh(&mut *tx, &connection_id, observed)
            .await
            .unwrap()
    );

    tx.rollback().await.expect("rollback test fixtures");
}
