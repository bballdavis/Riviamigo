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
