//! Built-in comparison vehicles and the default running-cost assumptions for
//! each powertrain.

use serde::{Deserialize, Serialize};

use crate::services::ownership_schedules::{default_schedule, MaintenanceItem};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Powertrain {
    Ev,
    Hybrid,
    Gas,
}

/// Value and running-cost assumptions for one vehicle. Maintenance is a
/// schedule of items, each due by mileage, time, or whichever comes first.
#[derive(Debug, Clone, Serialize)]
pub struct CostAssumptions {
    /// Share of value kept each year, compounded.
    pub annual_retention: f64,
    pub insurance_monthly_usd: f64,
    pub maintenance: Vec<MaintenanceItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReferenceVehicle {
    pub id: &'static str,
    pub label: &'static str,
    pub powertrain: Powertrain,
    pub price_usd: f64,
    pub mpg: Option<f64>,
    pub kwh_per_mi: Option<f64>,
    pub premium_fuel: bool,
    pub default_enabled: bool,
    #[serde(flatten)]
    pub costs: CostAssumptions,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClassDefaults {
    pub ev: CostAssumptions,
    pub hybrid: CostAssumptions,
    pub gas: CostAssumptions,
}

fn assumptions(
    annual_retention: f64,
    insurance_monthly_usd: f64,
    schedule: &str,
) -> CostAssumptions {
    CostAssumptions {
        annual_retention,
        insurance_monthly_usd,
        maintenance: default_schedule(schedule),
    }
}

/// Assumptions for the tracked Rivian where the owner has not supplied a figure.
pub fn own_vehicle_defaults() -> CostAssumptions {
    assumptions(0.85, 185.0, "own")
}

/// Assumptions for a vehicle the owner adds, by powertrain.
pub fn class_defaults() -> ClassDefaults {
    ClassDefaults {
        ev: assumptions(0.85, 180.0, "class_ev"),
        hybrid: assumptions(0.89, 150.0, "class_hybrid"),
        gas: assumptions(0.86, 175.0, "class_gas"),
    }
}

/// Built-in comparison vehicles. Prices and running costs are editorial
/// estimates for a recent model year, not quotes; the page labels them so.
pub fn reference_vehicles() -> Vec<ReferenceVehicle> {
    vec![
        ReferenceVehicle {
            id: "kia_ev9",
            label: "Kia EV9",
            powertrain: Powertrain::Ev,
            price_usd: 60_000.0,
            mpg: None,
            kwh_per_mi: Some(0.40),
            premium_fuel: false,
            default_enabled: true,
            costs: assumptions(0.84, 180.0, "kia_ev9"),
        },
        ReferenceVehicle {
            id: "tesla_model_y",
            label: "Tesla Model Y",
            powertrain: Powertrain::Ev,
            price_usd: 49_000.0,
            mpg: None,
            kwh_per_mi: Some(0.27),
            premium_fuel: false,
            default_enabled: true,
            costs: assumptions(0.85, 180.0, "tesla_model_y"),
        },
        ReferenceVehicle {
            id: "chevrolet_tahoe",
            label: "Chevrolet Tahoe",
            powertrain: Powertrain::Gas,
            price_usd: 62_000.0,
            mpg: Some(18.0),
            kwh_per_mi: None,
            premium_fuel: false,
            default_enabled: true,
            costs: assumptions(0.88, 185.0, "chevrolet_tahoe"),
        },
        ReferenceVehicle {
            id: "bmw_x7",
            label: "BMW X7",
            powertrain: Powertrain::Gas,
            price_usd: 84_000.0,
            mpg: Some(22.0),
            kwh_per_mi: None,
            premium_fuel: true,
            default_enabled: true,
            costs: assumptions(0.84, 230.0, "bmw_x7"),
        },
        ReferenceVehicle {
            id: "range_rover",
            label: "Range Rover",
            powertrain: Powertrain::Gas,
            price_usd: 110_000.0,
            mpg: Some(21.0),
            kwh_per_mi: None,
            premium_fuel: true,
            default_enabled: false,
            costs: assumptions(0.82, 260.0, "range_rover"),
        },
        ReferenceVehicle {
            id: "porsche_cayenne",
            label: "Porsche Cayenne",
            powertrain: Powertrain::Gas,
            price_usd: 90_000.0,
            mpg: Some(19.0),
            kwh_per_mi: None,
            premium_fuel: true,
            default_enabled: true,
            costs: assumptions(0.85, 250.0, "porsche_cayenne"),
        },
        ReferenceVehicle {
            id: "toyota_camry_hybrid",
            label: "Toyota Camry Hybrid",
            powertrain: Powertrain::Hybrid,
            price_usd: 36_000.0,
            mpg: Some(51.0),
            kwh_per_mi: None,
            premium_fuel: false,
            default_enabled: true,
            costs: assumptions(0.9, 150.0, "toyota_camry_hybrid"),
        },
        ReferenceVehicle {
            id: "toyota_prius",
            label: "Toyota Prius",
            powertrain: Powertrain::Hybrid,
            price_usd: 33_000.0,
            mpg: Some(57.0),
            kwh_per_mi: None,
            premium_fuel: false,
            default_enabled: false,
            costs: assumptions(0.9, 150.0, "toyota_prius"),
        },
    ]
}
