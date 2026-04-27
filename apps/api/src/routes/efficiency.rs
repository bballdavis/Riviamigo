use axum::{extract::{Query, State}, routing::get, Json, Router};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use uuid::Uuid;

use crate::{db::vehicles::require_vehicle_owned, errors::AppError, middleware::auth::{AppState, AuthUser}};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/efficiency/summary",      get(get_summary))
        .route("/efficiency/by-mode",      get(get_by_mode))
        .route("/efficiency/range-vs-temp",get(get_range_vs_temp))
}

#[derive(Deserialize)]
struct Params {
    vehicle_id: Option<Uuid>,
    from:       Option<DateTime<Utc>>,
    to:         Option<DateTime<Utc>>,
}

async fn get_summary(
    State(state): State<AppState>,
    auth:         AuthUser,
    Query(p):     Query<Params>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid  = p.vehicle_id.ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p.from.unwrap_or_else(|| Utc::now() - chrono::Duration::days(90));
    let to   = p.to.unwrap_or_else(Utc::now);

    let row = sqlx::query!(
        "SELECT COALESCE(AVG(efficiency_wh_per_mile),0) AS avg_wh_per_mi,
                COALESCE(SUM(distance_miles),0) AS total_miles,
                PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY efficiency_wh_per_mile) AS p10,
                PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY efficiency_wh_per_mile) AS p90
         FROM riviamigo.trips
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
           AND efficiency_wh_per_mile IS NOT NULL",
        vid, from, to
    ).fetch_one(&state.pool).await?;

    Ok(Json(serde_json::json!({
        "avg_wh_per_mi":  row.avg_wh_per_mi,
        "total_miles":    row.total_miles,
        "p10_wh_per_mi":  row.p10,
        "p90_wh_per_mi":  row.p90,
    })))
}

async fn get_by_mode(
    State(state): State<AppState>,
    auth:         AuthUser,
    Query(p):     Query<Params>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid  = p.vehicle_id.ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p.from.unwrap_or_else(|| Utc::now() - chrono::Duration::days(180));
    let to   = p.to.unwrap_or_else(Utc::now);

    let rows = sqlx::query!(
        "SELECT drive_mode, COUNT(*) AS trip_count,
                COALESCE(SUM(distance_miles),0) AS total_miles,
                COALESCE(AVG(efficiency_wh_per_mile),0) AS avg_wh_per_mi
         FROM riviamigo.trips
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
           AND drive_mode IS NOT NULL AND efficiency_wh_per_mile IS NOT NULL
         GROUP BY drive_mode ORDER BY avg_wh_per_mi",
        vid, from, to
    ).fetch_all(&state.pool).await?;

    Ok(Json(serde_json::json!(rows.iter().map(|r| serde_json::json!({
        "drive_mode":   r.drive_mode,
        "trip_count":   r.trip_count,
        "total_miles":  r.total_miles,
        "avg_wh_per_mi":r.avg_wh_per_mi,
    })).collect::<Vec<_>>())))
}

async fn get_range_vs_temp(
    State(state): State<AppState>,
    auth:         AuthUser,
    Query(p):     Query<Params>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid  = p.vehicle_id.ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p.from.unwrap_or_else(|| Utc::now() - chrono::Duration::days(365));
    let to   = p.to.unwrap_or_else(Utc::now);

    let rows = sqlx::query!(
        "SELECT t.id,
                t.distance_miles,
                t.efficiency_wh_per_mile,
                (SELECT AVG(tel.cabin_temp_c)
                 FROM timeseries.telemetry_1hr tel
                 WHERE tel.vehicle_id=t.vehicle_id
                   AND tel.bucket BETWEEN t.started_at AND t.ended_at
                ) AS avg_temp_c
         FROM riviamigo.trips t
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3
           AND t.efficiency_wh_per_mile IS NOT NULL AND t.distance_miles > 1.0
         ORDER BY t.started_at DESC LIMIT 500",
        vid, from, to
    ).fetch_all(&state.pool).await?;

    Ok(Json(serde_json::json!(rows.iter().map(|r| serde_json::json!({
        "trip_id":              r.id,
        "distance_miles":       r.distance_miles,
        "efficiency_wh_per_mi": r.efficiency_wh_per_mile,
        "avg_temp_c":           r.avg_temp_c,
    })).collect::<Vec<_>>())))
}
