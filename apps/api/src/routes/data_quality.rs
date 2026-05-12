//! Data quality endpoint — surfaces telemetry coverage gaps, missing-field
//! rates, and duplicate row counts for a vehicle.

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new().route("/vehicles/:vehicle_id/data-quality", get(data_quality))
}

#[derive(Deserialize)]
struct DataQualityParams {
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct DataQualityResponse {
    vehicle_id: Uuid,
    window_from: DateTime<Utc>,
    window_to: DateTime<Utc>,
    total_samples: i64,
    samples_with_location: i64,
    samples_with_battery: i64,
    samples_with_power_kw: i64,
    samples_with_odometer: i64,
    coverage_pct: Option<f64>,
    gap_count: i64,
}

#[derive(sqlx::FromRow)]
struct DataQualityCountsRow {
    total_samples: i64,
    samples_with_location: i64,
    samples_with_battery: i64,
    samples_with_power_kw: i64,
    samples_with_odometer: i64,
}

async fn data_quality(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
    Query(params): Query<DataQualityParams>,
) -> Result<Json<DataQualityResponse>, AppError> {
    ensure_owned(&state.pool, vehicle_id, auth.user_id).await?;

    let from = params
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
    let to = params.to.unwrap_or_else(Utc::now);

    // Field presence counts
    let row = sqlx::query_as::<_, DataQualityCountsRow>(
        r#"SELECT
               COUNT(*)                                              AS total_samples,
               COUNT(*) FILTER (WHERE latitude IS NOT NULL
                                  AND longitude IS NOT NULL)        AS samples_with_location,
               COUNT(*) FILTER (WHERE battery_level IS NOT NULL)    AS samples_with_battery,
               COUNT(*) FILTER (WHERE power_kw IS NOT NULL)         AS samples_with_power_kw,
               COUNT(*) FILTER (WHERE odometer_miles IS NOT NULL)   AS samples_with_odometer
            FROM timeseries.telemetry
            WHERE vehicle_id = $1 AND ts >= $2 AND ts <= $3"#,
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .fetch_one(&state.pool)
    .await
    .map_err(AppError::from)?;

    let total = row.total_samples;
    let with_loc = row.samples_with_location;
    let with_bat = row.samples_with_battery;
    let with_pwr = row.samples_with_power_kw;
    let with_odo = row.samples_with_odometer;

    // Coverage: what fraction of 30-second intervals have at least one sample
    let window_secs = (to - from).num_seconds().max(1);
    let expected_intervals = window_secs / 30;
    let coverage = if expected_intervals > 0 && total > 0 {
        Some((total as f64 / expected_intervals as f64 * 100.0).min(100.0))
    } else {
        None
    };

    // Count gaps > 5 minutes (300 s) between consecutive samples
    let gap_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM (
               SELECT ts - LAG(ts) OVER (ORDER BY ts) AS gap
               FROM timeseries.telemetry
               WHERE vehicle_id = $1 AND ts >= $2 AND ts <= $3
           ) sub
           WHERE gap > interval '5 minutes'"#,
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .fetch_one(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(DataQualityResponse {
        vehicle_id,
        window_from: from,
        window_to: to,
        total_samples: total,
        samples_with_location: with_loc,
        samples_with_battery: with_bat,
        samples_with_power_kw: with_pwr,
        samples_with_odometer: with_odo,
        coverage_pct: coverage,
        gap_count,
    }))
}

async fn ensure_owned(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let owned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM riviamigo.vehicles WHERE id=$1 AND user_id=$2)",
    )
    .bind(vehicle_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)?;

    if !owned {
        Err(AppError::NotFound)
    } else {
        Ok(())
    }
}
