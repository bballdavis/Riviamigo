use axum::{
    extract::{Path, Query, State},
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
        .route("/trips", get(list_trips))
        .route("/trips/:id", get(get_trip))
        .route("/trips/:id/track", get(get_track))
        .route("/trips/:id/speed", get(get_speed_profile))
        .route("/trips/:id/elevation", get(get_elevation_profile))
    .route("/trips/:id/power", get(get_power_profile))
    .route("/vehicles/:vehicle_id/drives/:id/power", get(get_power_profile_path))
}

#[derive(Deserialize)]
struct TripListParams {
    vehicle_id: Option<Uuid>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    limit: Option<i64>,
    offset: Option<i64>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Deserialize)]
struct VehicleParam {
    vehicle_id: Option<Uuid>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct TripRow {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    duration_seconds: Option<i32>,
    distance_miles: Option<f64>,
    efficiency_wh_per_mile: Option<f64>,
    max_speed_mph: Option<f64>,
    drive_mode: Option<String>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
    start_lat: Option<f64>,
    start_lng: Option<f64>,
    end_lat: Option<f64>,
    end_lng: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct TrackPoint {
    ts: DateTime<Utc>,
    lat: Option<f64>,
    lng: Option<f64>,
    speed_mph: Option<f64>,
    altitude_m: Option<f64>,
}

async fn list_trips(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<TripListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(90));
    let to = p.to.unwrap_or_else(Utc::now);
    let limit = p.per_page.or(p.limit).unwrap_or(50).clamp(1, 200);
    let page = p.page.unwrap_or(1).max(1);
    let offset = p.offset.unwrap_or((page - 1) * limit).max(0);

    let rows = sqlx::query_as!(
        TripRow,
        "SELECT id, started_at, ended_at, duration_seconds, distance_miles, \
                efficiency_wh_per_mile, max_speed_mph, drive_mode, soc_start, soc_end, \
                start_lat, start_lng, end_lat, end_lng \
         FROM riviamigo.trips \
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3 \
         ORDER BY started_at DESC LIMIT $4 OFFSET $5",
        vid,
        from,
        to,
        limit,
        offset
    )
    .fetch_all(&state.pool)
    .await?;

    let total: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM riviamigo.trips WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3",
        vid, from, to
    ).fetch_one(&state.pool).await?.unwrap_or(0);

    Ok(Json(serde_json::json!({
        "data": rows,
        "items": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "page": (offset / limit) + 1,
        "per_page": limit
    })))
}

async fn get_trip(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<TripRow>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let row = sqlx::query_as!(
        TripRow,
        "SELECT id, started_at, ended_at, duration_seconds, distance_miles, \
                efficiency_wh_per_mile, max_speed_mph, drive_mode, soc_start, soc_end, \
                start_lat, start_lng, end_lat, end_lng \
         FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2",
        id,
        vid
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}

async fn get_track(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<Vec<TrackPoint>>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let trip = sqlx::query!(
        "SELECT started_at, ended_at, duration_seconds FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2",
        id, vid
    ).fetch_optional(&state.pool).await?.ok_or(AppError::NotFound)?;

    let duration_min = trip.duration_seconds.unwrap_or(0) / 60;
    let bucket = if duration_min < 15 {
        "1 second"
    } else if duration_min < 60 {
        "5 seconds"
    } else {
        "15 seconds"
    };

    // Dynamically pick bucket — use 1hr agg for very long trips as fallback
    let points: Vec<TrackPoint> = match bucket {
        "1 second" => sqlx::query_as!(TrackPoint,
            "SELECT ts, latitude AS lat, longitude AS lng, speed_mph, altitude_m \
             FROM timeseries.telemetry \
             WHERE vehicle_id=$1 AND ts>=$2 AND ts<=$3 AND latitude IS NOT NULL \
             ORDER BY ts LIMIT 5000",
            vid, trip.started_at, trip.ended_at
        ).fetch_all(&state.pool).await?,
        _ => sqlx::query_as!(TrackPoint,
            r#"SELECT time_bucket('15 seconds'::interval, ts) AS "ts!", avg(latitude) AS lat, avg(longitude) AS lng,
                      avg(speed_mph) AS speed_mph, avg(altitude_m) AS altitude_m
               FROM timeseries.telemetry
               WHERE vehicle_id=$1 AND ts>=$2 AND ts<=$3 AND latitude IS NOT NULL
               GROUP BY 1 ORDER BY 1 LIMIT 5000"#,
            vid, trip.started_at, trip.ended_at
        ).fetch_all(&state.pool).await?,
    };

    Ok(Json(points))
}

async fn get_speed_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let trip = sqlx::query!(
        "SELECT started_at, ended_at FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2",
        id,
        vid
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let points = sqlx::query!(
        "SELECT bucket AS ts, avg_speed_mph AS value FROM timeseries.telemetry_1min \
         WHERE vehicle_id=$1 AND bucket>=$2 AND bucket<=$3 ORDER BY bucket",
        vid,
        trip.started_at,
        trip.ended_at
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(points
        .iter()
        .map(|r| serde_json::json!({"ts":r.ts,"value":r.value}))
        .collect::<Vec<_>>())))
}

async fn get_elevation_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let trip = sqlx::query!(
        "SELECT started_at, ended_at FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2",
        id,
        vid
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let points = sqlx::query!(
        r#"SELECT time_bucket('10 seconds'::interval, ts) AS "ts!", avg(altitude_m) AS value
           FROM timeseries.telemetry
           WHERE vehicle_id=$1 AND ts>=$2 AND ts<=$3 AND altitude_m IS NOT NULL
           GROUP BY 1 ORDER BY 1"#,
        vid,
        trip.started_at,
        trip.ended_at
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(points
        .iter()
        .map(|r| serde_json::json!({"ts":r.ts,"value":r.value}))
        .collect::<Vec<_>>())))
}

async fn get_power_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    power_profile_response(&state, auth.user_id, vid, id).await
}

async fn get_power_profile_path(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vehicle_id, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    power_profile_response(&state, auth.user_id, vehicle_id, id).await
}

async fn power_profile_response(
    state: &AppState,
    user_id: Uuid,
    vehicle_id: Uuid,
    trip_id: Uuid,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_owned(&state.pool, user_id, vehicle_id).await?;

    let trip = sqlx::query!(
        "SELECT started_at, ended_at FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2",
        trip_id,
        vehicle_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let points = sqlx::query!(
        r#"SELECT time_bucket('10 seconds'::interval, ts) AS "ts!",
                  avg(power_kw) AS power_kw,
                  avg(regen_power_kw) AS regen_power_kw,
                  avg(speed_mph) AS speed_mph,
                  avg(battery_level) AS battery_level
           FROM timeseries.telemetry
           WHERE vehicle_id=$1 AND trip_id=$2 AND ts>=$3 AND ts<=$4
           GROUP BY 1 ORDER BY 1"#,
        vehicle_id,
        trip_id,
        trip.started_at,
        trip.ended_at
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(points
        .iter()
        .map(|r| serde_json::json!({
            "ts": r.ts,
            "power_kw": r.power_kw,
            "regen_power_kw": r.regen_power_kw,
            "speed_mph": r.speed_mph,
            "battery_level": r.battery_level,
        }))
        .collect::<Vec<_>>())))
}
