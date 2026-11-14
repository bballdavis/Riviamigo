//! Built-in schedules for the Toyota hybrids, the reference class for
//! `class_hybrid`.

use crate::services::ownership_schedules::model::{
    item,
    MaintenanceCategory::{Brakes, Oil, Service, Tires},
    MaintenanceItem,
};

/// Toyota Camry Hybrid: oil every 10,000 mi or yearly, rotation every
/// 5,000 mi, spark plugs at 120,000 mi, engine coolant first at
/// 100,000 mi and inverter coolant at 150,000 mi.
pub(super) fn toyota_camry_hybrid() -> Vec<MaintenanceItem> {
    vec![
        item("oil", "Oil and filter", Oil, Some(10_000.0), Some(12), 80.0),
        item(
            "tire_rotation",
            "Tire rotation",
            Service,
            Some(5_000.0),
            None,
            30.0,
        ),
        item(
            "cabin_filter",
            "Cabin air filter",
            Service,
            Some(30_000.0),
            Some(36),
            70.0,
        ),
        item(
            "engine_air_filter",
            "Engine air filter",
            Service,
            Some(30_000.0),
            Some(36),
            60.0,
        ),
        item(
            "brake_fluid",
            "Brake fluid replacement",
            Service,
            Some(30_000.0),
            Some(36),
            120.0,
        ),
        item(
            "engine_coolant",
            "Engine coolant",
            Service,
            Some(100_000.0),
            Some(120),
            160.0,
        ),
        item(
            "spark_plugs",
            "Spark plugs",
            Service,
            Some(120_000.0),
            None,
            260.0,
        ),
        item(
            "inverter_coolant",
            "Inverter coolant",
            Service,
            Some(150_000.0),
            None,
            200.0,
        ),
        item(
            "brake_pads",
            "Brake pads",
            Brakes,
            Some(70_000.0),
            None,
            400.0,
        ),
        item(
            "tires",
            "Tires (set of 4)",
            Tires,
            Some(50_000.0),
            Some(72),
            800.0,
        ),
    ]
}

/// Toyota Prius: same Toyota hybrid schedule, lighter car and smaller
/// tires; inverter coolant first at 150,000 mi.
pub(super) fn toyota_prius() -> Vec<MaintenanceItem> {
    vec![
        item("oil", "Oil and filter", Oil, Some(10_000.0), Some(12), 75.0),
        item(
            "tire_rotation",
            "Tire rotation",
            Service,
            Some(5_000.0),
            None,
            30.0,
        ),
        item(
            "cabin_filter",
            "Cabin air filter",
            Service,
            Some(30_000.0),
            Some(36),
            70.0,
        ),
        item(
            "engine_air_filter",
            "Engine air filter",
            Service,
            Some(30_000.0),
            Some(36),
            60.0,
        ),
        item(
            "brake_fluid",
            "Brake fluid replacement",
            Service,
            Some(30_000.0),
            Some(36),
            120.0,
        ),
        item(
            "engine_coolant",
            "Engine coolant",
            Service,
            Some(100_000.0),
            Some(120),
            160.0,
        ),
        item(
            "spark_plugs",
            "Spark plugs",
            Service,
            Some(120_000.0),
            None,
            240.0,
        ),
        item(
            "inverter_coolant",
            "Inverter coolant",
            Service,
            Some(150_000.0),
            None,
            200.0,
        ),
        item(
            "brake_pads",
            "Brake pads",
            Brakes,
            Some(80_000.0),
            None,
            380.0,
        ),
        item(
            "tires",
            "Tires (set of 4)",
            Tires,
            Some(50_000.0),
            Some(72),
            750.0,
        ),
    ]
}
