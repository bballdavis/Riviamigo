use super::model::{
    item,
    MaintenanceCategory::{Oil, Service, Tires},
};
use super::*;

#[test]
fn built_in_schedules_are_valid_and_gas_ones_change_oil() {
    for key in [
        "own",
        "tesla_model_y",
        "kia_ev9",
        "chevrolet_tahoe",
        "bmw_x7",
        "range_rover",
        "porsche_cayenne",
        "toyota_camry_hybrid",
        "toyota_prius",
        "class_ev",
        "class_hybrid",
        "class_gas",
    ] {
        let mut schedule = default_schedule(key);
        validate_schedule(&mut schedule).unwrap_or_else(|_| panic!("{key} is invalid"));
        let has_oil = schedule.iter().any(|entry| entry.category == Oil);
        let electric = matches!(key, "own" | "tesla_model_y" | "kia_ev9" | "class_ev");
        assert_eq!(has_oil, !electric, "{key}");
        assert!(
            schedule.iter().any(|entry| entry.category == Tires),
            "{key}"
        );
    }
}

#[test]
fn rejects_items_without_an_interval_or_with_duplicate_ids() {
    let mut none = vec![item("x", "X", Service, None, None, 10.0)];
    assert!(validate_schedule(&mut none).is_err());
    let mut twice = vec![
        item("x", "X", Service, Some(1_000.0), None, 10.0),
        item("x", "Y", Service, Some(1_000.0), None, 10.0),
    ];
    assert!(validate_schedule(&mut twice).is_err());
    let mut padded = vec![item("x", "  Oil  ", Oil, Some(5_000.0), Some(6), 90.0)];
    validate_schedule(&mut padded).unwrap();
    assert_eq!(padded[0].label, "Oil");
}

#[test]
fn rejects_item_names_with_control_characters() {
    for label in ["Oil\nchange", "Oil\tchange", "Oil\u{1b}[2J"] {
        let mut schedule = vec![item("x", label, Oil, Some(5_000.0), None, 90.0)];
        assert!(validate_schedule(&mut schedule).is_err(), "{label:?}");
    }
    let mut trailing = vec![item("x", "Oil change\n", Oil, Some(5_000.0), None, 90.0)];
    validate_schedule(&mut trailing).unwrap();
    assert_eq!(trailing[0].label, "Oil change");
}
