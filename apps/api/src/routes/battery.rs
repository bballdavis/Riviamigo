use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_owned,
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/battery/soc", get(get_soc))
        .route("/battery/range", get(get_range))
        .route("/battery/capacity", get(get_capacity))
        .route("/battery/phantom-drain", get(get_phantom_drain))
        .route("/battery/degradation", get(get_degradation))
}

#[derive(Debug, Deserialize)]
pub struct TimeRangeParams {
    pub vehicle_id: Option<Uuid>,
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TimeSeriesPoint {
    pub ts: DateTime<Utc>,
    pub value: Option<f64>,
}

fn resolution(from: DateTime<Utc>, to: DateTime<Utc>) -> &'static str {
    let hours = (to - from).num_hours();
    if hours <= 48 {
        "1min"
    } else if hours <= 2160 {
        "1hr"
    } else {
        "1day"
    }
}

async fn get_soc(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<TimeRangeParams>,
) -> Result<Json<Vec<TimeSeriesPoint>>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(7));
    let to = p.to.unwrap_or_else(Utc::now);

    let points = match resolution(from, to) {
        "1min" => sqlx::query_as!(TimeSeriesPoint,
            "SELECT bucket AS \"ts!\", avg_soc AS value FROM timeseries.telemetry_1min \
             WHERE vehicle_id=$1 AND bucket>=$2 AND bucket<=$3 AND avg_soc IS NOT NULL ORDER BY bucket",
            vid, from, to).fetch_all(&state.pool).await?,
        "1hr"  => sqlx::query_as!(TimeSeriesPoint,
            "SELECT bucket AS \"ts!\", avg_soc AS value FROM timeseries.telemetry_1hr \
             WHERE vehicle_id=$1 AND bucket>=$2 AND bucket<=$3 AND avg_soc IS NOT NULL ORDER BY bucket",
            vid, from, to).fetch_all(&state.pool).await?,
        _      => sqlx::query_as!(TimeSeriesPoint,
            "SELECT bucket AS \"ts!\", avg_soc AS value FROM timeseries.telemetry_1day \
             WHERE vehicle_id=$1 AND bucket>=$2 AND bucket<=$3 AND avg_soc IS NOT NULL ORDER BY bucket",
            vid, from, to).fetch_all(&state.pool).await?,
    };
    Ok(Json(points))
}

async fn get_range(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<TimeRangeParams>,
) -> Result<Json<Vec<TimeSeriesPoint>>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
    let to = p.to.unwrap_or_else(Utc::now);

    let points = sqlx::query_as!(TimeSeriesPoint,
        "SELECT bucket AS \"ts!\", avg_range_mi AS value FROM timeseries.telemetry_1hr \
         WHERE vehicle_id=$1 AND bucket>=$2 AND bucket<=$3 AND avg_range_mi IS NOT NULL ORDER BY bucket",
        vid, from, to).fetch_all(&state.pool).await?;
    Ok(Json(points))
}

async fn get_capacity(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<TimeRangeParams>,
) -> Result<Json<Vec<TimeSeriesPoint>>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(365));
    let to = p.to.unwrap_or_else(Utc::now);

    let points = sqlx::query_as!(TimeSeriesPoint,
        "SELECT bucket AS \"ts!\", battery_capacity_wh AS value FROM timeseries.telemetry_1day \
         WHERE vehicle_id=$1 AND bucket>=$2 AND bucket<=$3 AND battery_capacity_wh IS NOT NULL ORDER BY bucket",
        vid, from, to).fetch_all(&state.pool).await?;
    Ok(Json(points))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PhantomDrainPoint {
    pub day: Option<DateTime<Utc>>,
    pub total_soc_lost: Option<f64>,
    pub avg_drain_rate: Option<f64>,
    pub hours_parked: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DegradationPoint {
    pub ts: DateTime<Utc>,
    pub usable_kwh: f64,
    pub rated_kwh: Option<f64>,
    pub capacity_pct: Option<f64>,
}

async fn get_degradation(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<TimeRangeParams>,
) -> Result<Json<Vec<DegradationPoint>>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let rows = sqlx::query_as::<_, DegradationPoint>(
        "SELECT snapshotted_at AS ts,
                usable_kwh,
                rated_kwh,
                CASE WHEN rated_kwh > 0 THEN (usable_kwh / rated_kwh * 100.0) ELSE NULL END AS capacity_pct
         FROM riviamigo.battery_capacity_snapshots
         WHERE vehicle_id=$1
         ORDER BY snapshotted_at"
    )
    .bind(vid)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

async fn get_phantom_drain(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<TimeRangeParams>,
) -> Result<Json<Vec<PhantomDrainPoint>>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(90));
    let to = p.to.unwrap_or_else(Utc::now);

    let points = sqlx::query_as!(PhantomDrainPoint,
        "SELECT day, total_soc_lost::float8 AS total_soc_lost, avg_drain_rate::float8 AS avg_drain_rate, total_hours_parked::float8 AS hours_parked \
         FROM timeseries.phantom_drain_daily \
         WHERE vehicle_id=$1 AND day>=$2 AND day<=$3 ORDER BY day",
        vid, from, to).fetch_all(&state.pool).await?;
    Ok(Json(points))
}
