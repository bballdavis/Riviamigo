//! GPS location heatmap endpoint — returns time-bucketed telemetry lat/lon for
//! rendering a density map in the dashboard.

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{errors::AppError, middleware::auth::{AppState, AuthUser}};

pub fn router() -> Router<AppState> {
    Router::new().route("/vehicles/:vehicle_id/locations", get(locations))
}

#[derive(Deserialize)]
struct LocationParams {
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    /// Bucket interval in seconds (default 300 = 5 min — avoids sending millions of points).
    #[serde(default = "default_bucket_secs")]
    bucket_secs: i64,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_bucket_secs() -> i64 { 300 }
fn default_limit() -> i64 { 5_000 }

#[derive(Serialize, sqlx::FromRow)]
struct LocationPoint {
    bucket: Option<DateTime<Utc>>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    avg_speed_mph: Option<f64>,
    power_state: Option<String>,
}

#[derive(Serialize)]
struct LocationsResponse {
    vehicle_id: Uuid,
    points: Vec<LocationPoint>,
}

async fn locations(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
    Query(params): Query<LocationParams>,
) -> Result<Json<LocationsResponse>, AppError> {
    ensure_owned(&state.pool, vehicle_id, auth.user_id).await?;

    let from = params.from.unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
    let to = params.to.unwrap_or_else(Utc::now);
    let bucket_secs = params.bucket_secs.max(60).min(86400);
    let limit = params.limit.min(20_000);

    let points = sqlx::query_as::<_, LocationPoint>(
        r#"SELECT
               time_bucket(make_interval(secs => $2::float8), ts) AS "bucket: DateTime<Utc>",
               avg(latitude)  AS "latitude: f64",
               avg(longitude) AS "longitude: f64",
               avg(speed_mph) AS "avg_speed_mph: f64",
               mode() WITHIN GROUP (ORDER BY power_state) AS "power_state: String"
           FROM timeseries.telemetry
           WHERE vehicle_id = $1
             AND ts >= $3 AND ts <= $4
             AND latitude IS NOT NULL
             AND longitude IS NOT NULL
           GROUP BY 1
            ORDER BY 1 DESC
            LIMIT $5"#
    )
        .bind(vehicle_id)
        .bind(bucket_secs as f64)
        .bind(from)
        .bind(to)
        .bind(limit)
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(LocationsResponse { vehicle_id, points }))
}

async fn ensure_owned(pool: &sqlx::PgPool, vehicle_id: Uuid, user_id: Uuid) -> Result<(), AppError> {
    let owned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM riviamigo.vehicles WHERE id=$1 AND user_id=$2)"
    )
    .bind(vehicle_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)?;

    if !owned { Err(AppError::NotFound) } else { Ok(()) }
}
