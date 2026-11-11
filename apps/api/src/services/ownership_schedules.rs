//! Maintenance schedules for the Ownership dashboard.
//!
//! Each vehicle has its own list of items, each due every so many miles,
//! every so many months, or whichever comes first. The built-in schedules
//! follow the manufacturers' published intervals where they exist (owner's
//! manuals, service manuals and dealer schedules) and typical U.S. dealer or
//! independent-shop prices for the cost. Wear items with no published
//! interval (brake pads, tires) use typical service life for that kind of
//! vehicle: electric vehicles regenerate most of their braking, so their pads
//! last two to three times as long as a gas vehicle's. Owners can edit every
//! schedule in Settings; these are only the starting point.

use serde::{Deserialize, Serialize};

use crate::errors::AppError;

/// Which column of the cost breakdown an item counts toward.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaintenanceCategory {
    /// Engine oil and filter.
    Oil,
    /// Brake pads and rotors. Brake fluid is routine service.
    Brakes,
    /// A full set of replacement tires.
    Tires,
    /// Everything else on the schedule: inspections, rotations, filters,
    /// fluids and spark plugs.
    Service,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MaintenanceItem {
    pub id: String,
    pub label: String,
    pub category: MaintenanceCategory,
    /// Due every this many miles; `None` when only time applies.
    pub interval_mi: Option<f64>,
    /// Due every this many months; `None` when only mileage applies.
    pub interval_months: Option<u16>,
    pub cost_usd: f64,
}

pub const MAX_ITEMS_PER_VEHICLE: usize = 30;
const MAX_INTERVAL_MI: f64 = 500_000.0;
const MAX_INTERVAL_MONTHS: u16 = 240;
const MAX_ITEM_COST_USD: f64 = 100_000.0;

fn item(
    id: &str,
    label: &str,
    category: MaintenanceCategory,
    interval_mi: Option<f64>,
    interval_months: Option<u16>,
    cost_usd: f64,
) -> MaintenanceItem {
    MaintenanceItem {
        id: id.into(),
        label: label.into(),
        category,
        interval_mi,
        interval_months,
        cost_usd,
    }
}

use MaintenanceCategory::{Brakes, Oil, Service, Tires};

/// The built-in schedule for a schedule key: the owner's Rivian (`own`), a
/// reference vehicle id, or a powertrain class (`class_ev`, `class_hybrid`,
/// `class_gas`) used for vehicles the owner adds.
pub fn default_schedule(key: &str) -> Vec<MaintenanceItem> {
    match key {
        // Rivian R1: tire rotation every 9,000 mi, a comprehensive
        // inspection every 18,000 mi or 18 months, brake fluid every 3 years,
        // cabin filter about every 2 years, coolant at 112,500 mi.
        "own" => vec![
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
        ],
        // Tesla Model Y: rotation every 6,250 mi, cabin filter every 2 years,
        // HEPA filter every 3 years, brake fluid checked every 4 years.
        "tesla_model_y" => vec![
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
        ],
        // Kia EV9: cabin filter 16,000 mi or 2 years, brake fluid about every
        // 4 years, reduction gear oil at 60,000 km, coolant at 10 years.
        "kia_ev9" => vec![
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
        ],
        // Chevrolet Tahoe 5.3L V8: oil by the oil-life monitor (about 7,500
        // mi, at least yearly), rotation every 7,500 mi, cabin filter 22,500
        // mi or 2 years, spark plugs and transfer case fluid at 97,500 mi.
        "chevrolet_tahoe" => vec![
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
        ],
        // BMW X7: condition-based oil service (about 10,000 mi or yearly),
        // brake fluid every third oil service, spark plugs every sixth.
        "bmw_x7" => vec![
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
        ],
        // Range Rover P400: service-indicator oil change (about 16,000 mi or
        // yearly), brake fluid every 3 years, spark plugs around 60,000 mi.
        "range_rover" => vec![
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
        ],
        // Porsche Cayenne V6: oil and inspection every 10,000 mi or yearly,
        // brake fluid every 2 years, spark plugs every 40,000 mi or 4 years.
        "porsche_cayenne" => vec![
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
        ],
        // Toyota Camry Hybrid: oil every 10,000 mi or yearly, rotation every
        // 5,000 mi, spark plugs at 120,000 mi, engine coolant first at
        // 100,000 mi and inverter coolant at 150,000 mi.
        "toyota_camry_hybrid" => vec![
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
                None,
                800.0,
            ),
        ],
        // Toyota Prius: same Toyota hybrid schedule, lighter car and smaller
        // tires; inverter coolant first at 150,000 mi.
        "toyota_prius" => vec![
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
                None,
                750.0,
            ),
        ],
        "class_ev" => vec![
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
        ],
        "class_hybrid" => default_schedule("toyota_camry_hybrid"),
        // A typical non-luxury gas vehicle.
        _ => vec![
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
        ],
    }
}

fn valid_item_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Check one edited schedule and tidy its labels.
pub fn validate_schedule(items: &mut [MaintenanceItem]) -> Result<(), AppError> {
    if items.len() > MAX_ITEMS_PER_VEHICLE {
        return Err(AppError::Validation(format!(
            "a maintenance schedule has at most {MAX_ITEMS_PER_VEHICLE} items"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    for entry in items.iter_mut() {
        entry.label = entry.label.trim().to_string();
        if !valid_item_id(&entry.id) || !seen.insert(entry.id.clone()) {
            return Err(AppError::Validation(
                "maintenance item ids must be unique".into(),
            ));
        }
        if entry.label.is_empty() || entry.label.chars().count() > 60 {
            return Err(AppError::Validation(
                "maintenance item names must be 1 to 60 characters".into(),
            ));
        }
        if entry.interval_mi.is_none() && entry.interval_months.is_none() {
            return Err(AppError::Validation(
                "each maintenance item needs a mileage or time interval".into(),
            ));
        }
        if let Some(miles) = entry.interval_mi {
            if !miles.is_finite() || !(100.0..=MAX_INTERVAL_MI).contains(&miles) {
                return Err(AppError::Validation(format!(
                    "maintenance mileage intervals must be between 100 and {MAX_INTERVAL_MI}"
                )));
            }
        }
        if let Some(months) = entry.interval_months {
            if !(1..=MAX_INTERVAL_MONTHS).contains(&months) {
                return Err(AppError::Validation(format!(
                    "maintenance time intervals must be between 1 and {MAX_INTERVAL_MONTHS} months"
                )));
            }
        }
        if !entry.cost_usd.is_finite() || !(0.0..=MAX_ITEM_COST_USD).contains(&entry.cost_usd) {
            return Err(AppError::Validation(format!(
                "maintenance costs must be between 0 and {MAX_ITEM_COST_USD}"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
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
}
