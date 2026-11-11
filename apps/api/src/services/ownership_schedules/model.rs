//! Maintenance item types and the constructor the built-in schedules share.

use serde::{Deserialize, Serialize};

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

pub(super) fn item(
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
