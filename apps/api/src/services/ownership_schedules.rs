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

mod defaults;
mod model;
mod validation;

pub use defaults::default_schedule;
pub use model::{MaintenanceCategory, MaintenanceItem};
pub use validation::{validate_schedule, MAX_ITEMS_PER_VEHICLE};

#[cfg(test)]
mod tests;
