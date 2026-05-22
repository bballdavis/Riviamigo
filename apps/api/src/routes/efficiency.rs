use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_owned,
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/efficiency/summary", get(get_summary))
        .route("/efficiency/by-mode", get(get_by_mode))
        .route("/efficiency/range-vs-temp", get(get_range_vs_temp))
        .route("/efficiency/vs-temp", get(get_vs_temp_binned))
        .route("/efficiency/trend", get(get_trend))
}

#[derive(Deserialize)]
struct Params {
    vehicle_id: Option<Uuid>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct VsTempPoint {
    temp_c_low: f64,
    temp_c_high: f64,
    avg_efficiency_wh_mi: Option<f64>,
    trip_count: i64,
    total_miles: Option<f64>,
    avg_speed_mph: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct TrendPoint {
    day: NaiveDate,
    day_avg_wh_mi: Option<f64>,
    rolling_7d_wh_mi: Option<f64>,
}

async fn get_summary(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Params>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(90));
    let to = p.to.unwrap_or_else(Utc::now);

    let row = sqlx::query!(
        "SELECT COALESCE(AVG(efficiency_wh_per_mile),0) AS avg_wh_per_mi,
                COALESCE(SUM(distance_miles),0) AS total_miles,
                PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY efficiency_wh_per_mile) AS p10,
                PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY efficiency_wh_per_mile) AS p90
         FROM riviamigo.trips
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
           AND efficiency_wh_per_mile IS NOT NULL",
        vid,
        from,
        to
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "avg_wh_per_mi":  row.avg_wh_per_mi,
        "total_miles":    row.total_miles,
        "p10_wh_per_mi":  row.p10.unwrap_or(0.0),
        "p90_wh_per_mi":  row.p90.unwrap_or(0.0),
    })))
}

async fn get_by_mode(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Params>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(180));
    let to = p.to.unwrap_or_else(Utc::now);

    let rows = sqlx::query!(
        "SELECT drive_mode, COUNT(*) AS trip_count,
                COALESCE(SUM(distance_miles),0) AS total_miles,
                COALESCE(AVG(efficiency_wh_per_mile),0) AS avg_wh_per_mi
         FROM riviamigo.trips
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
           AND drive_mode IS NOT NULL AND efficiency_wh_per_mile IS NOT NULL
         GROUP BY drive_mode ORDER BY avg_wh_per_mi",
        vid,
        from,
        to
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(rows
        .iter()
        .map(|r| serde_json::json!({
            "drive_mode":   r.drive_mode,
            "trip_count":   r.trip_count,
            "total_miles":  r.total_miles,
            "avg_wh_per_mi":r.avg_wh_per_mi,
        }))
        .collect::<Vec<_>>())))
}

async fn get_vs_temp_binned(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Params>,
) -> Result<Json<Vec<VsTempPoint>>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(365));
    let to = p.to.unwrap_or_else(Utc::now);

    let rows = sqlx::query_as::<_, VsTempPoint>(
        "SELECT
           (floor((t.outside_temp_c * 9.0/5.0 + 32) / 10.0) * 10 - 32) * 5.0/9.0        AS temp_c_low,
           ((floor((t.outside_temp_c * 9.0/5.0 + 32) / 10.0) + 1) * 10 - 32) * 5.0/9.0  AS temp_c_high,
           avg(t.efficiency_wh_per_mile) AS avg_efficiency_wh_mi,
           count(*) AS trip_count,
           sum(t.distance_miles) AS total_miles,
           CASE WHEN sum(t.duration_seconds) > 0
                THEN sum(t.distance_miles) / (sum(t.duration_seconds) / 3600.0)
                END AS avg_speed_mph
         FROM riviamigo.trips t
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3
           AND t.outside_temp_c IS NOT NULL AND t.efficiency_wh_per_mile IS NOT NULL
         GROUP BY 1, 2 ORDER BY 1",
    )
    .bind(vid)
    .bind(from)
    .bind(to)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

async fn get_trend(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Params>,
) -> Result<Json<Vec<TrendPoint>>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(90));
    let to = p.to.unwrap_or_else(Utc::now);

    let rows = sqlx::query_as::<_, TrendPoint>(
        "SELECT
           started_at::date AS day,
           avg(efficiency_wh_per_mile) AS day_avg_wh_mi,
           avg(avg(efficiency_wh_per_mile)) OVER (
             ORDER BY started_at::date
             ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
           ) AS rolling_7d_wh_mi
         FROM riviamigo.trips
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
           AND efficiency_wh_per_mile IS NOT NULL
         GROUP BY started_at::date ORDER BY 1",
    )
    .bind(vid)
    .bind(from)
    .bind(to)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

async fn get_range_vs_temp(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Params>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(365));
    let to = p.to.unwrap_or_else(Utc::now);

    let rows = sqlx::query!(
        "SELECT t.id,
                t.distance_miles,
                t.efficiency_wh_per_mile,
                t.outside_temp_c AS avg_temp_c
         FROM riviamigo.trips t
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3
           AND t.efficiency_wh_per_mile IS NOT NULL AND t.distance_miles > 1.0
           AND t.outside_temp_c IS NOT NULL
         ORDER BY t.started_at DESC LIMIT 500",
        vid,
        from,
        to
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(rows
        .iter()
        .map(|r| serde_json::json!({
            "trip_id":              r.id,
            "distance_miles":       r.distance_miles,
            "efficiency_wh_per_mi": r.efficiency_wh_per_mile,
            "avg_temp_c":           r.avg_temp_c,
        }))
        .collect::<Vec<_>>())))
}
