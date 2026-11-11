//! Built-in schedules for the gasoline reference vehicles and the typical
//! gasoline vehicle used as the fallback.

use crate::services::ownership_schedules::model::{
    item,
    MaintenanceCategory::{Brakes, Oil, Service, Tires},
    MaintenanceItem,
};

/// Chevrolet Tahoe 5.3L V8: oil by the oil-life monitor (about 7,500
/// mi, at least yearly), rotation every 7,500 mi, cabin filter 22,500
/// mi or 2 years, spark plugs and transfer case fluid at 97,500 mi.
pub(super) fn chevrolet_tahoe() -> Vec<MaintenanceItem> {
    vec![
        item("oil", "Oil and filter", Oil, Some(7_500.0), Some(12), 110.0),
        item(
            "tire_rotation",
            "Tire rotation",
            Service,
            Some(7_500.0),
            None,
            40.0,
        ),
        item(
            "engine_air_filter",
            "Engine air filter",
            Service,
            Some(30_000.0),
            None,
            70.0,
        ),
        item(
            "cabin_filter",
            "Cabin air filter",
            Service,
            Some(22_500.0),
            Some(24),
            80.0,
        ),
        item(
            "brake_fluid",
            "Brake fluid replacement",
            Service,
            None,
            Some(60),
            130.0,
        ),
        item(
            "spark_plugs",
            "Spark plugs",
            Service,
            Some(97_500.0),
            None,
            550.0,
        ),
        item(
            "transfer_case",
            "Transfer case fluid",
            Service,
            Some(97_500.0),
            None,
            160.0,
        ),
        item(
            "brake_pads",
            "Brake pads and rotors",
            Brakes,
            Some(45_000.0),
            None,
            750.0,
        ),
        item(
            "tires",
            "Tires (set of 4)",
            Tires,
            Some(45_000.0),
            None,
            1_500.0,
        ),
    ]
}

/// BMW X7: condition-based oil service (about 10,000 mi or yearly),
/// brake fluid every third oil service, spark plugs every sixth.
pub(super) fn bmw_x7() -> Vec<MaintenanceItem> {
    vec![
        item("oil", "Oil service", Oil, Some(10_000.0), Some(12), 220.0),
        item(
            "cabin_filter",
            "Cabin microfilter",
            Service,
            None,
            Some(24),
            150.0,
        ),
        item(
            "brake_fluid",
            "Brake fluid replacement",
            Service,
            Some(30_000.0),
            Some(36),
            200.0,
        ),
        item(
            "engine_air_filter",
            "Engine air filter",
            Service,
            Some(40_000.0),
            None,
            160.0,
        ),
        item(
            "spark_plugs",
            "Spark plugs",
            Service,
            Some(60_000.0),
            None,
            550.0,
        ),
        item(
            "brake_pads",
            "Brake pads, rotors and sensors",
            Brakes,
            Some(40_000.0),
            None,
            1_400.0,
        ),
        item(
            "tires",
            "Tires (set of 4)",
            Tires,
            Some(35_000.0),
            None,
            2_000.0,
        ),
    ]
}

/// Range Rover P400: service-indicator oil change (about 16,000 mi or
/// yearly), brake fluid every 3 years, spark plugs around 60,000 mi.
pub(super) fn range_rover() -> Vec<MaintenanceItem> {
    vec![
        item("oil", "Oil service", Oil, Some(16_000.0), Some(12), 320.0),
        item(
            "cabin_filter",
            "Cabin air filter",
            Service,
            Some(16_000.0),
            Some(12),
            150.0,
        ),
        item(
            "brake_fluid",
            "Brake fluid replacement",
            Service,
            None,
            Some(36),
            220.0,
        ),
        item(
            "engine_air_filter",
            "Engine air filter",
            Service,
            Some(32_000.0),
            None,
            150.0,
        ),
        item(
            "spark_plugs",
            "Spark plugs",
            Service,
            Some(60_000.0),
            None,
            450.0,
        ),
        item(
            "brake_pads",
            "Brake pads and rotors",
            Brakes,
            Some(40_000.0),
            None,
            1_600.0,
        ),
        item(
            "tires",
            "Tires (set of 4)",
            Tires,
            Some(35_000.0),
            None,
            2_100.0,
        ),
    ]
}

/// Porsche Cayenne V6: oil and inspection every 10,000 mi or yearly,
/// brake fluid every 2 years, spark plugs every 40,000 mi or 4 years.
pub(super) fn porsche_cayenne() -> Vec<MaintenanceItem> {
    vec![
        item(
            "oil",
            "Oil service and inspection",
            Oil,
            Some(10_000.0),
            Some(12),
            450.0,
        ),
        item(
            "brake_fluid",
            "Brake fluid replacement",
            Service,
            None,
            Some(24),
            250.0,
        ),
        item(
            "cabin_filter",
            "Cabin air filter",
            Service,
            Some(20_000.0),
            Some(24),
            150.0,
        ),
        item(
            "engine_air_filter",
            "Engine air filter",
            Service,
            Some(40_000.0),
            Some(48),
            220.0,
        ),
        item(
            "spark_plugs",
            "Spark plugs",
            Service,
            Some(40_000.0),
            Some(48),
            800.0,
        ),
        item(
            "brake_pads",
            "Brake pads and rotors",
            Brakes,
            Some(35_000.0),
            None,
            1_800.0,
        ),
        item(
            "tires",
            "Tires (set of 4)",
            Tires,
            Some(25_000.0),
            None,
            2_000.0,
        ),
    ]
}

/// A typical non-luxury gas vehicle.
pub(super) fn typical_gas() -> Vec<MaintenanceItem> {
    vec![
        item("oil", "Oil and filter", Oil, Some(7_500.0), Some(12), 100.0),
        item(
            "tire_rotation",
            "Tire rotation",
            Service,
            Some(7_500.0),
            None,
            40.0,
        ),
        item(
            "engine_air_filter",
            "Engine air filter",
            Service,
            Some(30_000.0),
            None,
            65.0,
        ),
        item(
            "cabin_filter",
            "Cabin air filter",
            Service,
            Some(20_000.0),
            Some(24),
            80.0,
        ),
        item(
            "brake_fluid",
            "Brake fluid replacement",
            Service,
            None,
            Some(36),
            120.0,
        ),
        item(
            "spark_plugs",
            "Spark plugs",
            Service,
            Some(100_000.0),
            None,
            350.0,
        ),
        item(
            "brake_pads",
            "Brake pads and rotors",
            Brakes,
            Some(45_000.0),
            None,
            650.0,
        ),
        item(
            "tires",
            "Tires (set of 4)",
            Tires,
            Some(45_000.0),
            None,
            1_100.0,
        ),
    ]
}
