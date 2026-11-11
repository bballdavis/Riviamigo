//! Built-in schedules for the electric vehicles: the owner's Rivian, the Tesla
//! and Kia references, and the generic electric class.

use crate::services::ownership_schedules::model::{
    item,
    MaintenanceCategory::{Brakes, Service, Tires},
    MaintenanceItem,
};

/// Rivian R1: tire rotation every 9,000 mi, a comprehensive
/// inspection every 18,000 mi or 18 months, brake fluid every 3 years,
/// cabin filter about every 2 years, coolant at 112,500 mi.
pub(super) fn rivian_own() -> Vec<MaintenanceItem> {
    vec![
        item(
            "tire_rotation",
            "Tire rotation",
            Service,
            Some(9_000.0),
            None,
            80.0,
        ),
        item(
            "inspection",
            "Comprehensive inspection",
            Service,
            Some(18_000.0),
            Some(18),
            180.0,
        ),
        item(
            "brake_fluid",
            "Brake fluid replacement",
            Service,
            None,
            Some(36),
            180.0,
        ),
        item(
            "cabin_filter",
            "Cabin air filter",
            Service,
            None,
            Some(24),
            120.0,
        ),
        item(
            "coolant",
            "Coolant replacement",
            Service,
            Some(112_500.0),
            None,
            450.0,
        ),
        item(
            "brake_pads",
            "Brake pads",
            Brakes,
            Some(75_000.0),
            None,
            900.0,
        ),
        item(
            "tires",
            "Tires (set of 4)",
            Tires,
            Some(30_000.0),
            None,
            1_800.0,
        ),
    ]
}

/// Tesla Model Y: rotation every 6,250 mi, cabin filter every 2 years,
/// HEPA filter every 3 years, brake fluid checked every 4 years.
pub(super) fn tesla_model_y() -> Vec<MaintenanceItem> {
    vec![
        item(
            "tire_rotation",
            "Tire rotation",
            Service,
            Some(6_250.0),
            None,
            60.0,
        ),
        item(
            "cabin_filter",
            "Cabin air filter",
            Service,
            None,
            Some(24),
            80.0,
        ),
        item("hepa_filter", "HEPA filter", Service, None, Some(36), 180.0),
        item(
            "brake_fluid",
            "Brake fluid check and flush",
            Service,
            None,
            Some(48),
            130.0,
        ),
        item(
            "brake_pads",
            "Brake pads",
            Brakes,
            Some(80_000.0),
            None,
            600.0,
        ),
        item(
            "tires",
            "Tires (set of 4)",
            Tires,
            Some(40_000.0),
            None,
            1_300.0,
        ),
    ]
}

/// Kia EV9: cabin filter 16,000 mi or 2 years, brake fluid about every
/// 4 years, reduction gear oil at 60,000 km, coolant at 10 years.
pub(super) fn kia_ev9() -> Vec<MaintenanceItem> {
    vec![
        item(
            "tire_rotation",
            "Tire rotation",
            Service,
            Some(8_000.0),
            None,
            50.0,
        ),
        item(
            "cabin_filter",
            "Cabin air filter",
            Service,
            Some(16_000.0),
            Some(24),
            90.0,
        ),
        item(
            "brake_fluid",
            "Brake fluid replacement",
            Service,
            None,
            Some(48),
            150.0,
        ),
        item(
            "gear_oil",
            "Reduction gear oil",
            Service,
            Some(37_500.0),
            None,
            220.0,
        ),
        item(
            "coolant",
            "Battery and motor coolant",
            Service,
            Some(120_000.0),
            Some(120),
            400.0,
        ),
        item(
            "brake_pads",
            "Brake pads",
            Brakes,
            Some(70_000.0),
            None,
            650.0,
        ),
        item(
            "tires",
            "Tires (set of 4)",
            Tires,
            Some(40_000.0),
            None,
            1_400.0,
        ),
    ]
}

pub(super) fn class_ev() -> Vec<MaintenanceItem> {
    vec![
        item(
            "tire_rotation",
            "Tire rotation",
            Service,
            Some(7_500.0),
            None,
            50.0,
        ),
        item(
            "cabin_filter",
            "Cabin air filter",
            Service,
            None,
            Some(24),
            90.0,
        ),
        item(
            "brake_fluid",
            "Brake fluid replacement",
            Service,
            None,
            Some(36),
            140.0,
        ),
        item(
            "coolant",
            "Battery coolant",
            Service,
            Some(120_000.0),
            Some(120),
            400.0,
        ),
        item(
            "brake_pads",
            "Brake pads",
            Brakes,
            Some(75_000.0),
            None,
            650.0,
        ),
        item(
            "tires",
            "Tires (set of 4)",
            Tires,
            Some(40_000.0),
            None,
            1_300.0,
        ),
    ]
}
