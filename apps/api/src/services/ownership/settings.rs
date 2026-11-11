//! Per-vehicle ownership settings: purchase and resale figures, comparison
//! choices, maintenance overrides, and the validation and storage around them.

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{
    errors::AppError,
    services::ownership_schedules::{validate_schedule, MaintenanceItem},
};

use super::reference::{reference_vehicles, Powertrain};

const MAX_CUSTOM_VEHICLES: usize = 12;
const MAX_ENABLED_IDS: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CustomVehicle {
    pub id: String,
    pub label: String,
    pub powertrain: Powertrain,
    pub price_usd: f64,
    #[serde(default)]
    pub mpg: Option<f64>,
    #[serde(default)]
    pub kwh_per_mi: Option<f64>,
    #[serde(default)]
    pub premium_fuel: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Comparisons {
    /// `None` until the user changes the selection, which means "use each
    /// reference vehicle's default".
    #[serde(default)]
    pub enabled: Option<Vec<String>>,
    #[serde(default)]
    pub custom: Vec<CustomVehicle>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct OwnershipSettings {
    pub purchase_price_usd: Option<f64>,
    pub purchase_date: Option<NaiveDate>,
    pub resale_value_usd: Option<f64>,
    pub insurance_monthly_usd: Option<f64>,
    pub tire_set_cost_usd: Option<f64>,
    pub gas_price_usd_per_gallon: Option<f64>,
    /// Years of ownership the Projected view covers; `None` means the default.
    #[serde(default)]
    pub projection_years: Option<i16>,
    #[serde(default)]
    pub comparisons: Comparisons,
    /// Edited maintenance schedules by vehicle key; a vehicle that is not
    /// listed uses its built-in schedule.
    #[serde(default)]
    pub maintenance: std::collections::BTreeMap<String, Vec<MaintenanceItem>>,
}

/// Most vehicles a settings row can hold edited schedules for: the tracked
/// vehicle, the built-in references, and the added vehicles, with room to spare.
const MAX_SCHEDULE_VEHICLES: usize = 40;

fn check_amount(name: &str, value: Option<f64>, min: f64, max: f64) -> Result<(), AppError> {
    match value {
        Some(value) if !value.is_finite() || value < min || value > max => Err(
            AppError::Validation(format!("{name} must be between {min} and {max}")),
        ),
        _ => Ok(()),
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Validate and normalize user-supplied settings before they are stored.
const MAX_PROJECTION_YEARS: i16 = 20;

pub fn validate_settings(
    mut settings: OwnershipSettings,
    today: NaiveDate,
) -> Result<OwnershipSettings, AppError> {
    check_amount(
        "purchase_price_usd",
        settings.purchase_price_usd,
        0.0,
        10_000_000.0,
    )?;
    check_amount(
        "resale_value_usd",
        settings.resale_value_usd,
        0.0,
        10_000_000.0,
    )?;
    check_amount(
        "insurance_monthly_usd",
        settings.insurance_monthly_usd,
        0.0,
        100_000.0,
    )?;
    check_amount(
        "tire_set_cost_usd",
        settings.tire_set_cost_usd,
        0.0,
        100_000.0,
    )?;
    check_amount(
        "gas_price_usd_per_gallon",
        settings.gas_price_usd_per_gallon,
        0.01,
        100.0,
    )?;
    if settings.maintenance.len() > MAX_SCHEDULE_VEHICLES {
        return Err(AppError::Validation(format!(
            "maintenance schedules are limited to {MAX_SCHEDULE_VEHICLES} vehicles"
        )));
    }
    for (key, schedule) in settings.maintenance.iter_mut() {
        if !valid_id(key) {
            return Err(AppError::Validation(
                "maintenance schedules must be keyed by a vehicle id".into(),
            ));
        }
        validate_schedule(schedule)?;
    }
    if let Some(years) = settings.projection_years {
        if !(1..=MAX_PROJECTION_YEARS).contains(&years) {
            return Err(AppError::Validation(format!(
                "projection_years must be between 1 and {MAX_PROJECTION_YEARS}"
            )));
        }
    }
    if let Some(date) = settings.purchase_date {
        if date.year() < 2000 || date > today {
            return Err(AppError::Validation(
                "purchase_date must be between 2000 and today".into(),
            ));
        }
    }

    if let Some(enabled) = settings.comparisons.enabled.as_mut() {
        if enabled.len() > MAX_ENABLED_IDS || enabled.iter().any(|id| !valid_id(id)) {
            return Err(AppError::Validation(
                "comparisons.enabled contains an invalid vehicle id".into(),
            ));
        }
        enabled.sort();
        enabled.dedup();
    }

    let custom = &mut settings.comparisons.custom;
    if custom.len() > MAX_CUSTOM_VEHICLES {
        return Err(AppError::Validation(format!(
            "at most {MAX_CUSTOM_VEHICLES} custom comparison vehicles are supported"
        )));
    }
    let reserved: Vec<&str> = reference_vehicles().iter().map(|v| v.id).collect();
    let mut seen = std::collections::HashSet::new();
    for vehicle in custom.iter_mut() {
        vehicle.label = vehicle.label.trim().to_string();
        if !valid_id(&vehicle.id)
            || reserved.contains(&vehicle.id.as_str())
            || !seen.insert(vehicle.id.clone())
        {
            return Err(AppError::Validation(
                "custom comparison vehicle ids must be unique".into(),
            ));
        }
        if vehicle.label.is_empty() || vehicle.label.chars().count() > 80 {
            return Err(AppError::Validation(
                "custom comparison vehicle name must be 1 to 80 characters".into(),
            ));
        }
        check_amount(
            "custom vehicle price",
            Some(vehicle.price_usd),
            0.0,
            10_000_000.0,
        )?;
        match vehicle.powertrain {
            Powertrain::Ev => {
                let Some(kwh) = vehicle.kwh_per_mi else {
                    return Err(AppError::Validation(
                        "an electric comparison vehicle needs kwh_per_mi".into(),
                    ));
                };
                check_amount("kwh_per_mi", Some(kwh), 0.05, 3.0)?;
                vehicle.mpg = None;
                vehicle.premium_fuel = false;
            }
            Powertrain::Hybrid | Powertrain::Gas => {
                let Some(mpg) = vehicle.mpg else {
                    return Err(AppError::Validation(
                        "a gasoline comparison vehicle needs mpg".into(),
                    ));
                };
                check_amount("mpg", Some(mpg), 1.0, 250.0)?;
                vehicle.kwh_per_mi = None;
            }
        }
    }
    Ok(settings)
}

#[derive(FromRow)]
struct SettingsRow {
    purchase_price_usd: Option<f64>,
    purchase_date: Option<NaiveDate>,
    resale_value_usd: Option<f64>,
    insurance_monthly_usd: Option<f64>,
    tire_set_cost_usd: Option<f64>,
    gas_price_usd_per_gallon: Option<f64>,
    projection_years: Option<i16>,
    comparisons: serde_json::Value,
    maintenance: serde_json::Value,
}

pub async fn load_settings(pool: &PgPool, vehicle_id: Uuid) -> Result<OwnershipSettings, AppError> {
    let row = sqlx::query_as::<_, SettingsRow>(
        "SELECT purchase_price_usd, purchase_date, resale_value_usd, insurance_monthly_usd,
                tire_set_cost_usd, gas_price_usd_per_gallon, projection_years, comparisons,
                maintenance
         FROM riviamigo.vehicle_ownership_settings
         WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?;
    Ok(match row {
        None => OwnershipSettings::default(),
        Some(row) => OwnershipSettings {
            purchase_price_usd: row.purchase_price_usd,
            purchase_date: row.purchase_date,
            resale_value_usd: row.resale_value_usd,
            insurance_monthly_usd: row.insurance_monthly_usd,
            tire_set_cost_usd: row.tire_set_cost_usd,
            gas_price_usd_per_gallon: row.gas_price_usd_per_gallon,
            projection_years: row.projection_years,
            // A shape this build cannot read falls back to the defaults
            // rather than making the whole page fail.
            comparisons: serde_json::from_value(row.comparisons).unwrap_or_default(),
            maintenance: serde_json::from_value(row.maintenance).unwrap_or_default(),
        },
    })
}

pub async fn save_settings(
    pool: &PgPool,
    vehicle_id: Uuid,
    user_id: Uuid,
    settings: &OwnershipSettings,
) -> Result<(), AppError> {
    let comparisons = serde_json::to_value(&settings.comparisons)
        .map_err(|error| AppError::Internal(error.into()))?;
    let maintenance = serde_json::to_value(&settings.maintenance)
        .map_err(|error| AppError::Internal(error.into()))?;
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_ownership_settings
           (vehicle_id, purchase_price_usd, purchase_date, resale_value_usd,
            insurance_monthly_usd, tire_set_cost_usd, gas_price_usd_per_gallon,
            projection_years, comparisons, maintenance, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
         ON CONFLICT (vehicle_id) DO UPDATE SET
           purchase_price_usd = EXCLUDED.purchase_price_usd,
           purchase_date = EXCLUDED.purchase_date,
           resale_value_usd = EXCLUDED.resale_value_usd,
           insurance_monthly_usd = EXCLUDED.insurance_monthly_usd,
           tire_set_cost_usd = EXCLUDED.tire_set_cost_usd,
           gas_price_usd_per_gallon = EXCLUDED.gas_price_usd_per_gallon,
           projection_years = EXCLUDED.projection_years,
           comparisons = EXCLUDED.comparisons,
           maintenance = EXCLUDED.maintenance,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by",
    )
    .bind(vehicle_id)
    .bind(settings.purchase_price_usd)
    .bind(settings.purchase_date)
    .bind(settings.resale_value_usd)
    .bind(settings.insurance_monthly_usd)
    .bind(settings.tire_set_cost_usd)
    .bind(settings.gas_price_usd_per_gallon)
    .bind(settings.projection_years)
    .bind(comparisons)
    .bind(maintenance)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}
