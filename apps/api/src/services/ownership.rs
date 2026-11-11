//! Ownership cost inputs: per-vehicle purchase settings, monthly usage
//! actuals, reference vehicles, and the locally cached fuel-price series.
//!
//! The month-by-month cost ledger itself is computed in the browser so the
//! horizon, comparison toggles, and cost edits stay interactive. This module
//! owns only the facts that ledger is built from.

mod fuel_prices;
mod lookup;
mod reference;
mod settings;
mod usage;

pub use fuel_prices::{
    fuel_price_endpoint, fuel_prices, parse_fuel_prices, FuelPriceMonth, FuelPrices,
};
pub use lookup::{
    lookup_json, parse_lookup_menu, parse_lookup_vehicle, LookupOption, LookupVehicle,
};
pub use reference::{
    class_defaults, own_vehicle_defaults, reference_vehicles, ClassDefaults, CostAssumptions,
    Powertrain, ReferenceVehicle,
};
pub use settings::{
    load_settings, save_settings, validate_settings, Comparisons, CustomVehicle, OwnershipSettings,
};
pub use usage::{load_usage, Usage, UsageMonth};

#[cfg(test)]
mod tests;
