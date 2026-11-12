//! Monthly driving and charging actuals that the ownership cost ledger is
//! built from.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::errors::AppError;

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
    /// The latest odometer reading: the live status when it is ahead of the
    /// last recorded trip. The ledger takes total miles from this, because
    /// recorded trips miss everything driven while nothing was collecting.
    pub odometer_mi: Option<f64>,
}

/// The tracked vehicle's model name, such as `R1S`.
pub async fn load_model(pool: &PgPool, vehicle_id: Uuid) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT model FROM riviamigo.vehicles WHERE id = $1")
            .bind(vehicle_id)
            .fetch_optional(pool)
            .await?,
    )
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
                GREATEST((SELECT MAX(end_odometer_mi) FROM riviamigo.trips WHERE vehicle_id = $1),
                         (SELECT odometer_miles FROM riviamigo.vehicle_latest_status WHERE vehicle_id = $1))",
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
