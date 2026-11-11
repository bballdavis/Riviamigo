//! Validation for edited maintenance schedules.

use crate::errors::AppError;

use super::model::MaintenanceItem;

pub const MAX_ITEMS_PER_VEHICLE: usize = 30;
const MAX_INTERVAL_MI: f64 = 500_000.0;
const MAX_INTERVAL_MONTHS: u16 = 240;
const MAX_ITEM_COST_USD: f64 = 100_000.0;

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
