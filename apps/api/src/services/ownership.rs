//! Ownership cost inputs: per-vehicle purchase settings, monthly usage
//! actuals, reference vehicles, and the locally cached fuel-price series.
//!
//! The month-by-month cost ledger itself is computed in the browser so the
//! horizon, comparison toggles, and cost edits stay interactive. This module
//! owns only the facts that ledger is built from.

use std::time::Duration as StdDuration;

use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{
    errors::AppError,
    services::{
        external_connections as connections,
        outbound::{outbound_client_for_url, read_response_limited},
    },
};

/// Shared, rate-limited key that api.data.gov publishes for evaluation. One
/// daily request stays far inside its allowance; an administrator can store
/// their own free EIA key on the connection instead.
const EIA_DEMO_KEY: &str = "DEMO_KEY";
const EIA_REGULAR_SERIES: &str = "EMM_EPMR_PTE_NUS_DPG";
const EIA_PREMIUM_SERIES: &str = "EMM_EPMP_PTE_NUS_DPG";
const FUEL_PRICE_START: &str = "2012-01";
const FUEL_PRICE_REFRESH_INTERVAL: Duration = Duration::hours(24);
/// After any attempt, successful or not, wait before contacting the provider
/// again so a failing provider is not retried on every page load.
const FUEL_PRICE_RETRY_INTERVAL: Duration = Duration::hours(6);
const FUEL_PRICE_FETCH_TIMEOUT: StdDuration = StdDuration::from_secs(8);

const MAX_CUSTOM_VEHICLES: usize = 12;
const MAX_ENABLED_IDS: usize = 40;

// ---------------------------------------------------------------------------
// Reference vehicles
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Powertrain {
    Ev,
    Hybrid,
    Gas,
}

/// Maintenance and running-cost assumptions for one vehicle. Intervals are in
/// miles; a `None` oil interval means the vehicle has no oil service.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct CostAssumptions {
    /// Share of value kept each year, compounded.
    pub annual_retention: f64,
    pub oil_interval_mi: Option<f64>,
    pub oil_cost_usd: Option<f64>,
    pub brake_interval_mi: f64,
    pub brake_cost_usd: f64,
    pub tire_interval_mi: f64,
    pub tire_cost_usd: f64,
    pub annual_service_usd: f64,
    pub insurance_monthly_usd: f64,
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

const EV_DEFAULTS: CostAssumptions = CostAssumptions {
    annual_retention: 0.85,
    oil_interval_mi: None,
    oil_cost_usd: None,
    brake_interval_mi: 100_000.0,
    brake_cost_usd: 800.0,
    tire_interval_mi: 35_000.0,
    tire_cost_usd: 1_400.0,
    annual_service_usd: 130.0,
    insurance_monthly_usd: 180.0,
};

const HYBRID_DEFAULTS: CostAssumptions = CostAssumptions {
    annual_retention: 0.89,
    oil_interval_mi: Some(10_000.0),
    oil_cost_usd: Some(95.0),
    brake_interval_mi: 80_000.0,
    brake_cost_usd: 650.0,
    tire_interval_mi: 50_000.0,
    tire_cost_usd: 900.0,
    annual_service_usd: 260.0,
    insurance_monthly_usd: 150.0,
};

const GAS_DEFAULTS: CostAssumptions = CostAssumptions {
    annual_retention: 0.86,
    oil_interval_mi: Some(7_500.0),
    oil_cost_usd: Some(120.0),
    brake_interval_mi: 45_000.0,
    brake_cost_usd: 900.0,
    tire_interval_mi: 45_000.0,
    tire_cost_usd: 1_200.0,
    annual_service_usd: 420.0,
    insurance_monthly_usd: 175.0,
};

/// Assumptions for the tracked Rivian itself where the user has not supplied
/// a figure. Heavy EVs wear tires faster than the EV class default.
pub const OWN_VEHICLE_DEFAULTS: CostAssumptions = CostAssumptions {
    annual_retention: 0.85,
    oil_interval_mi: None,
    oil_cost_usd: None,
    brake_interval_mi: 100_000.0,
    brake_cost_usd: 900.0,
    tire_interval_mi: 25_000.0,
    tire_cost_usd: 1_800.0,
    annual_service_usd: 150.0,
    insurance_monthly_usd: 185.0,
};

pub fn class_defaults() -> ClassDefaults {
    ClassDefaults {
        ev: EV_DEFAULTS,
        hybrid: HYBRID_DEFAULTS,
        gas: GAS_DEFAULTS,
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
            costs: CostAssumptions {
                annual_retention: 0.84,
                tire_cost_usd: 1_300.0,
                ..EV_DEFAULTS
            },
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
            costs: EV_DEFAULTS,
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
            costs: CostAssumptions {
                annual_retention: 0.88,
                oil_cost_usd: Some(130.0),
                brake_interval_mi: 40_000.0,
                brake_cost_usd: 1_000.0,
                tire_interval_mi: 40_000.0,
                tire_cost_usd: 1_500.0,
                annual_service_usd: 450.0,
                insurance_monthly_usd: 185.0,
                ..GAS_DEFAULTS
            },
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
            costs: CostAssumptions {
                annual_retention: 0.84,
                oil_interval_mi: Some(10_000.0),
                oil_cost_usd: Some(220.0),
                brake_interval_mi: 40_000.0,
                brake_cost_usd: 1_400.0,
                tire_interval_mi: 35_000.0,
                tire_cost_usd: 1_900.0,
                annual_service_usd: 650.0,
                insurance_monthly_usd: 230.0,
            },
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
            costs: CostAssumptions {
                annual_retention: 0.82,
                oil_interval_mi: Some(10_000.0),
                oil_cost_usd: Some(260.0),
                brake_interval_mi: 40_000.0,
                brake_cost_usd: 1_600.0,
                tire_interval_mi: 35_000.0,
                tire_cost_usd: 2_100.0,
                annual_service_usd: 800.0,
                insurance_monthly_usd: 260.0,
            },
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
            costs: CostAssumptions {
                annual_retention: 0.85,
                oil_interval_mi: Some(10_000.0),
                oil_cost_usd: Some(350.0),
                brake_interval_mi: 35_000.0,
                brake_cost_usd: 1_800.0,
                tire_interval_mi: 25_000.0,
                tire_cost_usd: 2_000.0,
                annual_service_usd: 900.0,
                insurance_monthly_usd: 250.0,
            },
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
            costs: CostAssumptions {
                annual_retention: 0.90,
                ..HYBRID_DEFAULTS
            },
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
            costs: CostAssumptions {
                annual_retention: 0.90,
                tire_cost_usd: 800.0,
                ..HYBRID_DEFAULTS
            },
        },
    ]
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

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
}

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
}

pub async fn load_settings(pool: &PgPool, vehicle_id: Uuid) -> Result<OwnershipSettings, AppError> {
    let row = sqlx::query_as::<_, SettingsRow>(
        "SELECT purchase_price_usd, purchase_date, resale_value_usd, insurance_monthly_usd,
                tire_set_cost_usd, gas_price_usd_per_gallon, projection_years, comparisons
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
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_ownership_settings
           (vehicle_id, purchase_price_usd, purchase_date, resale_value_usd,
            insurance_monthly_usd, tire_set_cost_usd, gas_price_usd_per_gallon,
            projection_years, comparisons, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)
         ON CONFLICT (vehicle_id) DO UPDATE SET
           purchase_price_usd = EXCLUDED.purchase_price_usd,
           purchase_date = EXCLUDED.purchase_date,
           resale_value_usd = EXCLUDED.resale_value_usd,
           insurance_monthly_usd = EXCLUDED.insurance_monthly_usd,
           tire_set_cost_usd = EXCLUDED.tire_set_cost_usd,
           gas_price_usd_per_gallon = EXCLUDED.gas_price_usd_per_gallon,
           projection_years = EXCLUDED.projection_years,
           comparisons = EXCLUDED.comparisons,
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
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Usage actuals
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct UsageMonth {
    /// First day of the calendar month, UTC.
    pub month: NaiveDate,
    pub miles: f64,
    pub drive_energy_kwh: f64,
    pub charged_kwh: f64,
    /// The part of `charged_kwh` from sessions that have a cost. Sessions
    /// without a matching price carry no cost, so they must not dilute the rate.
    pub priced_kwh: f64,
    pub charging_cost_usd: f64,
    /// DC fast charging, a subset of the totals above. Fast charging costs
    /// several times what home charging does, so the two are priced apart.
    pub fast_kwh: f64,
    pub fast_priced_kwh: f64,
    pub fast_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Usage {
    pub months: Vec<UsageMonth>,
    /// First and last moments with recorded driving or charging.
    pub tracked_from: Option<DateTime<Utc>>,
    pub tracked_to: Option<DateTime<Utc>>,
    pub odometer_mi: Option<f64>,
}

pub async fn load_usage(pool: &PgPool, vehicle_id: Uuid) -> Result<Usage, AppError> {
    let months = sqlx::query_as::<_, UsageMonth>(
        "WITH drive AS (
           SELECT date_trunc('month', started_at AT TIME ZONE 'UTC')::date AS month,
                  COALESCE(SUM(distance_miles), 0)::float8 AS miles,
                  (COALESCE(SUM(energy_wh), 0) / 1000.0)::float8 AS drive_energy_kwh
           FROM riviamigo.trips
           WHERE vehicle_id = $1
           GROUP BY 1
         ), charge AS (
           SELECT date_trunc('month', started_at AT TIME ZONE 'UTC')::date AS month,
                  COALESCE(SUM(COALESCE(energy_added_wh / 1000.0, kwh_added)), 0)::float8 AS charged_kwh,
                  COALESCE(SUM(COALESCE(energy_added_wh / 1000.0, kwh_added))
                           FILTER (WHERE cost_usd IS NOT NULL), 0)::float8 AS priced_kwh,
                  COALESCE(SUM(cost_usd), 0)::float8 AS charging_cost_usd,
                  COALESCE(SUM(COALESCE(energy_added_wh / 1000.0, kwh_added))
                           FILTER (WHERE charger_type = 'dc' OR cost_method = 'rivian_paid_total'), 0)::float8 AS fast_kwh,
                  COALESCE(SUM(COALESCE(energy_added_wh / 1000.0, kwh_added))
                           FILTER (WHERE (charger_type = 'dc' OR cost_method = 'rivian_paid_total')
                                     AND cost_usd IS NOT NULL), 0)::float8 AS fast_priced_kwh,
                  COALESCE(SUM(cost_usd)
                           FILTER (WHERE charger_type = 'dc' OR cost_method = 'rivian_paid_total'), 0)::float8 AS fast_cost_usd
           FROM riviamigo.charge_sessions
           WHERE vehicle_id = $1 AND ended_at IS NOT NULL
           GROUP BY 1
         )
         SELECT COALESCE(drive.month, charge.month) AS month,
                COALESCE(drive.miles, 0)::float8 AS miles,
                COALESCE(drive.drive_energy_kwh, 0)::float8 AS drive_energy_kwh,
                COALESCE(charge.charged_kwh, 0)::float8 AS charged_kwh,
                COALESCE(charge.priced_kwh, 0)::float8 AS priced_kwh,
                COALESCE(charge.charging_cost_usd, 0)::float8 AS charging_cost_usd,
                COALESCE(charge.fast_kwh, 0)::float8 AS fast_kwh,
                COALESCE(charge.fast_priced_kwh, 0)::float8 AS fast_priced_kwh,
                COALESCE(charge.fast_cost_usd, 0)::float8 AS fast_cost_usd
         FROM drive
         FULL OUTER JOIN charge ON charge.month = drive.month
         ORDER BY 1",
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let (tracked_from, tracked_to, odometer_mi) = sqlx::query_as::<
        _,
        (Option<DateTime<Utc>>, Option<DateTime<Utc>>, Option<f64>),
    >(
        "SELECT LEAST((SELECT MIN(started_at) FROM riviamigo.trips WHERE vehicle_id = $1),
                      (SELECT MIN(started_at) FROM riviamigo.charge_sessions WHERE vehicle_id = $1)),
                GREATEST((SELECT MAX(ended_at) FROM riviamigo.trips WHERE vehicle_id = $1),
                         (SELECT MAX(ended_at) FROM riviamigo.charge_sessions WHERE vehicle_id = $1)),
                (SELECT MAX(end_odometer_mi) FROM riviamigo.trips WHERE vehicle_id = $1)",
    )
    .bind(vehicle_id)
    .fetch_one(pool)
    .await?;

    Ok(Usage {
        months,
        tracked_from,
        tracked_to,
        odometer_mi,
    })
}

// ---------------------------------------------------------------------------
// Fuel prices
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FuelPriceMonth {
    pub month: NaiveDate,
    pub regular_usd: Option<f64>,
    pub premium_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FuelPrices {
    /// Whether the fuel-price connection may contact its provider.
    pub connection_enabled: bool,
    pub months: Vec<FuelPriceMonth>,
    pub last_updated_at: Option<DateTime<Utc>>,
    /// True when the most recent refresh attempt failed and stored months are
    /// being served instead.
    pub refresh_failed: bool,
}

/// Build the EIA v2 request for the two national retail gasoline series.
pub fn fuel_price_endpoint(api_key: Option<&str>, length: u32) -> Result<Url, AppError> {
    let mut url = Url::parse(connections::FUEL_PRICES_BASE_URL)
        .and_then(|base| base.join("v2/petroleum/pri/gnd/data/"))
        .map_err(|_| AppError::Validation("fuel price endpoint is invalid".into()))?;
    url.query_pairs_mut()
        .append_pair(
            "api_key",
            api_key
                .map(str::trim)
                .filter(|key| !key.is_empty())
                .unwrap_or(EIA_DEMO_KEY),
        )
        .append_pair("frequency", "monthly")
        .append_pair("data[0]", "value")
        .append_pair("facets[series][]", EIA_REGULAR_SERIES)
        .append_pair("facets[series][]", EIA_PREMIUM_SERIES)
        .append_pair("start", FUEL_PRICE_START)
        .append_pair("sort[0][column]", "period")
        .append_pair("sort[0][direction]", "desc")
        .append_pair("length", &length.to_string());
    Ok(url)
}

/// Parse an EIA v2 response into `(month, grade, price)` rows, skipping rows
/// this build does not understand.
pub fn parse_fuel_prices(body: &serde_json::Value) -> Vec<(NaiveDate, &'static str, f64)> {
    let Some(rows) = body
        .get("response")
        .and_then(|response| response.get("data"))
        .and_then(|data| data.as_array())
    else {
        return Vec::new();
    };
    rows.iter()
        .filter_map(|row| {
            let grade = match row.get("series")?.as_str()? {
                EIA_REGULAR_SERIES => "regular",
                EIA_PREMIUM_SERIES => "premium",
                _ => return None,
            };
            let month = NaiveDate::parse_from_str(
                &format!("{}-01", row.get("period")?.as_str()?),
                "%Y-%m-%d",
            )
            .ok()?;
            // EIA has returned this field both as a number and as a string.
            let value = row.get("value")?;
            let price = value
                .as_f64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))?;
            (price.is_finite() && price > 0.0 && price < 100.0).then_some((month, grade, price))
        })
        .collect()
}

fn decrypt_api_key(age_key: &str, encrypted: Option<&[u8]>) -> Option<String> {
    let identity = age_key.parse::<age::x25519::Identity>().ok()?;
    crate::ingestion::session_store::decrypt_json::<String>(encrypted?, &identity).ok()
}

async fn fetch_fuel_prices(
    api_key: Option<&str>,
) -> Result<Vec<(NaiveDate, &'static str, f64)>, String> {
    let endpoint = fuel_price_endpoint(api_key, 5000).map_err(|error| error.to_string())?;
    let response = outbound_client_for_url(&endpoint, &[])
        .await
        .map_err(|error| error.to_string())?
        .get(endpoint)
        .send()
        .await
        // The request URL carries the API key; never let it reach a log or
        // the stored error text.
        .map_err(|error| error.without_url().to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let bytes = read_response_limited(response, 4 * 1024 * 1024, "Fuel prices")
        .await
        .map_err(|error| error.to_string())?;
    let body: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "unreadable provider response".to_string())?;
    let rows = parse_fuel_prices(&body);
    if rows.is_empty() {
        return Err("provider returned no price rows".into());
    }
    Ok(rows)
}

async fn store_fuel_prices(
    pool: &PgPool,
    rows: &[(NaiveDate, &'static str, f64)],
) -> Result<(), AppError> {
    let months: Vec<NaiveDate> = rows.iter().map(|row| row.0).collect();
    let grades: Vec<&str> = rows.iter().map(|row| row.1).collect();
    let prices: Vec<f64> = rows.iter().map(|row| row.2).collect();
    sqlx::query(
        "INSERT INTO riviamigo.fuel_price_months (month, grade, price_usd_per_gallon, fetched_at)
         SELECT month, grade, price, now()
         FROM UNNEST($1::date[], $2::text[], $3::float8[]) AS incoming(month, grade, price)
         ON CONFLICT (month, grade) DO UPDATE SET
           price_usd_per_gallon = EXCLUDED.price_usd_per_gallon,
           fetched_at = EXCLUDED.fetched_at",
    )
    .bind(months)
    .bind(grades)
    .bind(prices)
    .execute(pool)
    .await?;
    Ok(())
}

/// Refresh the stored series when the connection is enabled and the stored
/// copy is stale. Failures are recorded on the connection and never surface
/// as a request error: the page keeps working from stored months.
async fn refresh_fuel_prices_if_stale(
    pool: &PgPool,
    age_key: &str,
) -> Result<(bool, bool), AppError> {
    let settings = match connections::load(pool, connections::FUEL_PRICES).await {
        Ok(settings) => settings,
        Err(AppError::NotFound) => return Ok((false, false)),
        Err(error) => return Err(error),
    };
    if !settings.is_active() {
        return Ok((false, false));
    }

    let (last_attempt_at, last_success_at, last_error) =
        sqlx::query_as::<_, (Option<DateTime<Utc>>, Option<DateTime<Utc>>, Option<String>)>(
            "SELECT last_attempt_at, last_success_at, last_error
         FROM riviamigo.external_connection_activity
         WHERE connection_id = $1",
        )
        .bind(connections::FUEL_PRICES)
        .fetch_optional(pool)
        .await?
        .unwrap_or((None, None, None));
    let last_stored_at = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        "SELECT MAX(fetched_at) FROM riviamigo.fuel_price_months",
    )
    .fetch_one(pool)
    .await?;

    let now = Utc::now();
    let previously_failed = last_error.is_some()
        && last_attempt_at.is_some()
        && last_success_at.is_none_or(|success| last_attempt_at > Some(success));
    let fresh = last_stored_at.is_some_and(|at| now - at < FUEL_PRICE_REFRESH_INTERVAL);
    // A connection test also records an attempt. Until something is stored,
    // only a failed attempt may hold the first download back.
    let recently_attempted = last_attempt_at.is_some_and(|at| now - at < FUEL_PRICE_RETRY_INTERVAL)
        && (last_stored_at.is_some() || previously_failed);
    if fresh || recently_attempted {
        return Ok((true, !fresh && previously_failed));
    }

    connections::record_attempt(pool, connections::FUEL_PRICES).await;
    let api_key = decrypt_api_key(age_key, settings.api_key_encrypted.as_deref());
    let fetched = tokio::time::timeout(
        FUEL_PRICE_FETCH_TIMEOUT,
        fetch_fuel_prices(api_key.as_deref()),
    )
    .await
    .unwrap_or_else(|_| Err("request timed out".into()));
    let stored = match fetched {
        Ok(rows) => store_fuel_prices(pool, &rows)
            .await
            .map_err(|_| "could not store the downloaded prices".to_string()),
        Err(message) => Err(message),
    };
    match stored {
        Ok(()) => {
            connections::record_success(pool, connections::FUEL_PRICES).await;
            Ok((true, false))
        }
        Err(message) => {
            tracing::warn!(error = %message, "fuel price refresh failed");
            connections::record_failure(pool, connections::FUEL_PRICES, &message).await;
            Ok((true, true))
        }
    }
}

/// Stored monthly prices, refreshed first when the connection allows it.
/// Stored months are returned even while the connection is disabled.
pub async fn fuel_prices(pool: &PgPool, age_key: &str) -> Result<FuelPrices, AppError> {
    let (connection_enabled, refresh_failed) = refresh_fuel_prices_if_stale(pool, age_key).await?;
    let rows = sqlx::query_as::<_, (NaiveDate, Option<f64>, Option<f64>, Option<DateTime<Utc>>)>(
        "SELECT month,
                MAX(price_usd_per_gallon) FILTER (WHERE grade = 'regular') AS regular_usd,
                MAX(price_usd_per_gallon) FILTER (WHERE grade = 'premium') AS premium_usd,
                MAX(fetched_at) AS fetched_at
         FROM riviamigo.fuel_price_months
         GROUP BY month
         ORDER BY month",
    )
    .fetch_all(pool)
    .await?;
    let last_updated_at = rows.iter().filter_map(|row| row.3).max();
    Ok(FuelPrices {
        connection_enabled,
        months: rows
            .into_iter()
            .map(|row| FuelPriceMonth {
                month: row.0,
                regular_usd: row.1,
                premium_usd: row.2,
            })
            .collect(),
        last_updated_at,
        refresh_failed,
    })
}

// ---------------------------------------------------------------------------
// Vehicle lookup (fueleconomy.gov)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LookupOption {
    pub text: String,
    pub value: String,
}

/// fueleconomy.gov returns `null` for no matches, a bare object for exactly
/// one match, and an array otherwise.
pub fn parse_lookup_menu(body: &serde_json::Value) -> Vec<LookupOption> {
    let to_option = |item: &serde_json::Value| {
        Some(LookupOption {
            text: item.get("text")?.as_str()?.to_string(),
            value: item.get("value")?.as_str()?.to_string(),
        })
    };
    match body.get("menuItem") {
        Some(serde_json::Value::Array(items)) => items.iter().filter_map(to_option).collect(),
        Some(item @ serde_json::Value::Object(_)) => to_option(item).into_iter().collect(),
        _ => Vec::new(),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LookupVehicle {
    pub epa_id: String,
    pub label: String,
    pub powertrain: Powertrain,
    pub mpg: Option<f64>,
    pub kwh_per_mi: Option<f64>,
    pub premium_fuel: bool,
    pub fuel_description: String,
}

fn text_field<'a>(body: &'a serde_json::Value, key: &str) -> &'a str {
    body.get(key).and_then(|value| value.as_str()).unwrap_or("")
}

fn number_field(body: &serde_json::Value, key: &str) -> Option<f64> {
    let value = body.get(key)?;
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
        .filter(|number: &f64| number.is_finite() && *number > 0.0)
}

/// Reduce a fueleconomy.gov vehicle record to the figures the cost model uses.
pub fn parse_lookup_vehicle(body: &serde_json::Value) -> Option<LookupVehicle> {
    let epa_id = body.get("id").and_then(|id| {
        id.as_str()
            .map(str::to_string)
            .or_else(|| id.as_i64().map(|n| n.to_string()))
    })?;
    let fuel = text_field(body, "fuelType1");
    let alternative = text_field(body, "atvType");
    let label = [
        text_field(body, "year"),
        text_field(body, "make"),
        text_field(body, "model"),
    ]
    .iter()
    .filter(|part| !part.is_empty())
    .copied()
    .collect::<Vec<_>>()
    .join(" ");
    if label.is_empty() {
        return None;
    }

    let electric =
        alternative.eq_ignore_ascii_case("EV") || fuel.eq_ignore_ascii_case("Electricity");
    if electric {
        // combE is kWh per 100 miles.
        let kwh_per_mi = number_field(body, "combE")? / 100.0;
        return Some(LookupVehicle {
            epa_id,
            label,
            powertrain: Powertrain::Ev,
            mpg: None,
            kwh_per_mi: Some((kwh_per_mi * 1000.0).round() / 1000.0),
            premium_fuel: false,
            fuel_description: "Electricity".into(),
        });
    }
    let mpg = number_field(body, "comb08")?;
    let hybrid = alternative.to_ascii_lowercase().contains("hybrid");
    Some(LookupVehicle {
        epa_id,
        label,
        powertrain: if hybrid {
            Powertrain::Hybrid
        } else {
            Powertrain::Gas
        },
        mpg: Some(mpg),
        kwh_per_mi: None,
        premium_fuel: fuel.to_ascii_lowercase().contains("premium"),
        fuel_description: if fuel.is_empty() {
            "Gasoline".into()
        } else {
            fuel.to_string()
        },
    })
}

/// Fetch one JSON document from the vehicle-lookup provider, recording the
/// attempt against the connection. Fails with `ExternalConnectionDisabled`
/// when an administrator has turned the connection off.
pub async fn lookup_json(
    pool: &PgPool,
    path: &str,
    query: &[(&str, String)],
) -> Result<serde_json::Value, AppError> {
    let id = connections::VEHICLE_LOOKUP;
    connections::require_enabled(pool, id).await?;
    let mut endpoint = Url::parse(&format!("{}/{path}", connections::VEHICLE_LOOKUP_BASE_URL))
        .map_err(|_| AppError::Validation("vehicle lookup endpoint is invalid".into()))?;
    for (key, value) in query {
        endpoint.query_pairs_mut().append_pair(key, value);
    }
    connections::record_attempt(pool, id).await;
    let response = outbound_client_for_url(&endpoint, &[])
        .await?
        .get(endpoint)
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(StdDuration::from_secs(10))
        .send()
        .await
        .map_err(|error| {
            AppError::DependencyUnavailable(format!(
                "vehicle lookup failed: {}",
                error.without_url()
            ))
        });
    let response = match response {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            connections::record_failure(pool, id, &format!("HTTP {}", response.status())).await;
            return Err(AppError::DependencyUnavailable(
                "vehicle lookup provider returned an error".into(),
            ));
        }
        Err(error) => {
            connections::record_failure(pool, id, "request failed").await;
            return Err(error);
        }
    };
    let bytes = read_response_limited(response, 2 * 1024 * 1024, "Vehicle lookup").await?;
    connections::record_success(pool, id).await;
    // The provider answers "no matches" with the JSON literal `null`.
    Ok(serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 10).unwrap()
    }

    #[test]
    fn fuel_price_endpoint_requests_both_grades_and_defaults_the_key() {
        let url = fuel_price_endpoint(None, 5000).unwrap();
        assert_eq!(url.host_str(), Some("api.eia.gov"));
        assert_eq!(url.path(), "/v2/petroleum/pri/gnd/data/");
        let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        assert!(pairs.contains(&("api_key".into(), "DEMO_KEY".into())));
        assert!(pairs.contains(&("facets[series][]".into(), EIA_REGULAR_SERIES.into())));
        assert!(pairs.contains(&("facets[series][]".into(), EIA_PREMIUM_SERIES.into())));

        let url = fuel_price_endpoint(Some("  abc123 "), 1).unwrap();
        assert!(url
            .query_pairs()
            .any(|(key, value)| key == "api_key" && value == "abc123"));
    }

    #[test]
    fn parses_numeric_and_string_prices_and_skips_unknown_rows() {
        let body = json!({ "response": { "data": [
            { "period": "2026-10", "series": EIA_REGULAR_SERIES, "value": 3.21 },
            { "period": "2026-10", "series": EIA_PREMIUM_SERIES, "value": "4.05" },
            { "period": "2026-10", "series": "EMM_EPD2D_PTE_NUS_DPG", "value": 3.9 },
            { "period": "bad", "series": EIA_REGULAR_SERIES, "value": 3.0 },
            { "period": "2026-09", "series": EIA_REGULAR_SERIES, "value": null }
        ] } });
        let month = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        assert_eq!(
            parse_fuel_prices(&body),
            vec![(month, "regular", 3.21), (month, "premium", 4.05)]
        );
        assert!(parse_fuel_prices(&json!({ "error": "API_KEY_MISSING" })).is_empty());
    }

    #[test]
    fn lookup_menu_handles_array_single_object_and_null() {
        let many = json!({ "menuItem": [
            { "text": "Kia", "value": "Kia" }, { "text": "BMW", "value": "BMW" }
        ] });
        assert_eq!(parse_lookup_menu(&many).len(), 2);
        let one = json!({ "menuItem": { "text": "Auto (AWD)", "value": "48123" } });
        assert_eq!(
            parse_lookup_menu(&one),
            vec![LookupOption {
                text: "Auto (AWD)".into(),
                value: "48123".into()
            }]
        );
        assert!(parse_lookup_menu(&serde_json::Value::Null).is_empty());
    }

    #[test]
    fn lookup_vehicle_classifies_powertrain_and_fuel() {
        let ev = parse_lookup_vehicle(&json!({
            "id": "47001", "year": "2025", "make": "Kia", "model": "EV9 AWD",
            "atvType": "EV", "fuelType1": "Electricity", "combE": "41.0", "comb08": "83"
        }))
        .unwrap();
        assert_eq!(ev.powertrain, Powertrain::Ev);
        assert_eq!(ev.kwh_per_mi, Some(0.41));
        assert_eq!(ev.mpg, None);

        let premium = parse_lookup_vehicle(&json!({
            "id": 47002, "year": "2025", "make": "BMW", "model": "X7 xDrive40i",
            "atvType": "", "fuelType1": "Premium Gasoline", "comb08": "22"
        }))
        .unwrap();
        assert_eq!(premium.powertrain, Powertrain::Gas);
        assert!(premium.premium_fuel);
        assert_eq!(premium.label, "2025 BMW X7 xDrive40i");

        let hybrid = parse_lookup_vehicle(&json!({
            "id": "47003", "year": "2025", "make": "Toyota", "model": "Camry",
            "atvType": "Hybrid", "fuelType1": "Regular Gasoline", "comb08": "51"
        }))
        .unwrap();
        assert_eq!(hybrid.powertrain, Powertrain::Hybrid);
        assert!(!hybrid.premium_fuel);

        assert!(parse_lookup_vehicle(&json!({ "id": "1", "year": "2025" })).is_none());
    }

    #[test]
    fn settings_validation_rejects_out_of_range_and_normalizes_custom_vehicles() {
        let base = OwnershipSettings::default();
        assert!(validate_settings(base.clone(), today()).is_ok());

        let negative = OwnershipSettings {
            purchase_price_usd: Some(-1.0),
            ..base.clone()
        };
        assert!(validate_settings(negative, today()).is_err());

        let future = OwnershipSettings {
            purchase_date: NaiveDate::from_ymd_opt(2026, 11, 11),
            ..base.clone()
        };
        assert!(validate_settings(future, today()).is_err());

        for (years, ok) in [
            (Some(1), true),
            (Some(20), true),
            (Some(0), false),
            (Some(21), false),
        ] {
            let projection = OwnershipSettings {
                projection_years: years,
                ..base.clone()
            };
            assert_eq!(validate_settings(projection, today()).is_ok(), ok);
        }

        let custom = |id: &str, powertrain, mpg, kwh| CustomVehicle {
            id: id.into(),
            label: "  My car ".into(),
            powertrain,
            price_usd: 30_000.0,
            mpg,
            kwh_per_mi: kwh,
            premium_fuel: true,
        };
        let stored = validate_settings(
            OwnershipSettings {
                comparisons: Comparisons {
                    enabled: Some(vec!["kia_ev9".into(), "custom-1".into(), "kia_ev9".into()]),
                    custom: vec![custom("custom-1", Powertrain::Ev, Some(30.0), Some(0.3))],
                },
                ..base.clone()
            },
            today(),
        )
        .unwrap();
        assert_eq!(stored.comparisons.enabled.as_ref().unwrap().len(), 2);
        let vehicle = &stored.comparisons.custom[0];
        assert_eq!(vehicle.label, "My car");
        assert_eq!(vehicle.mpg, None);
        assert!(!vehicle.premium_fuel);

        for invalid in [
            custom("kia_ev9", Powertrain::Gas, Some(25.0), None),
            custom("bad id", Powertrain::Gas, Some(25.0), None),
            custom("custom-2", Powertrain::Gas, None, None),
            custom("custom-3", Powertrain::Ev, None, None),
        ] {
            let settings = OwnershipSettings {
                comparisons: Comparisons {
                    enabled: None,
                    custom: vec![invalid],
                },
                ..base.clone()
            };
            assert!(validate_settings(settings, today()).is_err());
        }
    }

    #[test]
    fn reference_vehicles_have_unique_ids_and_the_figures_their_powertrain_needs() {
        let vehicles = reference_vehicles();
        let mut ids: Vec<_> = vehicles.iter().map(|vehicle| vehicle.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), vehicles.len());
        for vehicle in &vehicles {
            match vehicle.powertrain {
                Powertrain::Ev => assert!(vehicle.kwh_per_mi.is_some() && vehicle.mpg.is_none()),
                _ => assert!(vehicle.mpg.is_some() && vehicle.costs.oil_interval_mi.is_some()),
            }
        }
    }
}
