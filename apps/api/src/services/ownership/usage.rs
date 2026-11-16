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
    /// Lowest and highest odometer readings on the month's recorded trips.
    /// The ledger takes a month's miles from these where it has them, since
    /// trips that were not recorded still move the odometer.
    pub odometer_start_mi: Option<f64>,
    pub odometer_end_mi: Option<f64>,
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
    /// The earliest and latest odometer readings of the last 365 days, which
    /// set the pace the projection extrapolates.
    pub odometer_readings: Option<OdometerReadings>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct OdometerReadings {
    pub first_at: DateTime<Utc>,
    pub first_mi: f64,
    pub last_at: DateTime<Utc>,
    pub last_mi: f64,
}

/// One time-of-use window of an electricity plan, in minutes after local midnight.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct HomePlanPeriod {
    pub label: String,
    pub start_minute: u16,
    pub end_minute: u16,
    pub rate: f64,
}

/// The electricity plan the tracked vehicle's home charging is priced by.
#[derive(Debug, Clone, Serialize)]
pub struct HomePlan {
    pub name: String,
    /// `per_kwh`, `tou`, `flat`, `per_minute` or `free`.
    pub billing_type: String,
    /// The plan's base rate: per kWh, per minute, or per session by type.
    pub rate: f64,
    pub tou_periods: Vec<HomePlanPeriod>,
}

#[derive(FromRow)]
struct HomePlanRow {
    name: String,
    billing_type: String,
    rate: f64,
    tou_periods: serde_json::Value,
}

/// The plan that priced the vehicle's most recent home session, else the
/// vehicle's default plan.
pub async fn load_home_plan(pool: &PgPool, vehicle_id: Uuid) -> Result<Option<HomePlan>, AppError> {
    let row = sqlx::query_as::<_, HomePlanRow>(
        "SELECT cp.name, cp.billing_type, cp.rate, cp.tou_periods
         FROM riviamigo.cost_profiles cp
         WHERE cp.id = COALESCE(
           (SELECT cs.cost_profile_id FROM riviamigo.charge_sessions cs
            WHERE cs.vehicle_id = $1 AND cs.is_home AND cs.cost_profile_id IS NOT NULL
            ORDER BY cs.started_at DESC LIMIT 1),
           (SELECT v.cost_profile_id FROM riviamigo.vehicles v WHERE v.id = $1))",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|row| HomePlan {
        name: row.name,
        billing_type: row.billing_type,
        rate: row.rate,
        // A malformed period list only loses the window detail, not the plan.
        tou_periods: serde_json::from_value(row.tou_periods).unwrap_or_default(),
    }))
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

/// Odometer readings above this are sensor glitches.
const MAX_ODOMETER_MI: f64 = 2_000_000.0;

pub async fn load_usage(pool: &PgPool, vehicle_id: Uuid) -> Result<Usage, AppError> {
    let months = sqlx::query_as::<_, UsageMonth>(
        "WITH drive AS (
           SELECT date_trunc('month', started_at AT TIME ZONE 'UTC')::date AS month,
                  COALESCE(SUM(distance_miles), 0)::float8 AS miles,
                  (COALESCE(SUM(energy_wh), 0) / 1000.0)::float8 AS drive_energy_kwh,
                  MIN(start_odometer_mi) FILTER (WHERE start_odometer_mi BETWEEN 0 AND $2)::float8 AS odometer_start_mi,
                  MAX(end_odometer_mi) FILTER (WHERE end_odometer_mi BETWEEN 0 AND $2)::float8 AS odometer_end_mi
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
                COALESCE(charge.fast_cost_usd, 0)::float8 AS fast_cost_usd,
                drive.odometer_start_mi,
                drive.odometer_end_mi
         FROM drive
         FULL OUTER JOIN charge ON charge.month = drive.month
         ORDER BY 1",
    )
    .bind(vehicle_id)
    .bind(MAX_ODOMETER_MI)
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
                (WITH trip AS (
                   SELECT MAX(end_odometer_mi) AS mi FROM riviamigo.trips
                   WHERE vehicle_id = $1 AND end_odometer_mi BETWEEN 0 AND $2
                 ), live AS (
                   SELECT odometer_miles AS mi FROM riviamigo.vehicle_latest_status
                   WHERE vehicle_id = $1 AND odometer_miles BETWEEN 0 AND $2
                 )
                 -- A live reading far past the last trip is a glitch, not driving.
                 SELECT CASE
                          WHEN trip.mi IS NULL THEN live.mi
                          WHEN live.mi IS NULL OR live.mi > trip.mi + 10000 THEN trip.mi
                          ELSE GREATEST(trip.mi, live.mi)
                        END
                 FROM trip FULL OUTER JOIN live ON TRUE)",
    )
    .bind(vehicle_id)
    .bind(MAX_ODOMETER_MI)
    .fetch_one(pool)
    .await?;

    let odometer_readings = sqlx::query_as::<_, OdometerReadings>(
        "WITH readings AS (
           SELECT started_at AS at, start_odometer_mi AS mi FROM riviamigo.trips
           WHERE vehicle_id = $1 AND started_at > now() - interval '365 days'
             AND start_odometer_mi BETWEEN 0 AND $2
           UNION ALL
           SELECT ended_at, end_odometer_mi FROM riviamigo.trips
           WHERE vehicle_id = $1 AND ended_at > now() - interval '365 days'
             AND end_odometer_mi BETWEEN 0 AND $2
         ), first AS (
           SELECT at, mi FROM readings ORDER BY at LIMIT 1
         ), last_trip AS (
           SELECT at, mi FROM readings ORDER BY at DESC LIMIT 1
         ), live AS (
           SELECT odometer_miles_ts AS at, odometer_miles AS mi
           FROM riviamigo.vehicle_latest_status
           WHERE vehicle_id = $1 AND odometer_miles_ts IS NOT NULL
             AND odometer_miles BETWEEN 0 AND $2
         ), last AS (
           -- The live reading when it is newer and not a glitch far past the trips.
           SELECT CASE WHEN live.at > last_trip.at AND live.mi BETWEEN last_trip.mi AND last_trip.mi + 10000
                       THEN live.at ELSE last_trip.at END AS at,
                  CASE WHEN live.at > last_trip.at AND live.mi BETWEEN last_trip.mi AND last_trip.mi + 10000
                       THEN live.mi ELSE last_trip.mi END AS mi
           FROM last_trip LEFT JOIN live ON TRUE
         )
         SELECT first.at AS first_at, first.mi AS first_mi, last.at AS last_at, last.mi AS last_mi
         FROM first, last
         WHERE last.at > first.at AND last.mi >= first.mi",
    )
    .bind(vehicle_id)
    .bind(MAX_ODOMETER_MI)
    .fetch_optional(pool)
    .await?;

    Ok(Usage {
        months,
        tracked_from,
        tracked_to,
        odometer_mi,
        odometer_readings,
    })
}
