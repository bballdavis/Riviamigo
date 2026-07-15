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

use crate::{
    db::vehicles::require_vehicle_owned,
    errors::AppError,
    middleware::auth::{require_vehicle_access, AppState, AuthUser},
};

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

fn default_bucket_secs() -> i64 {
    300
}
fn default_limit() -> i64 {
    5_000
}

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
    require_vehicle_access(&auth, vehicle_id)?;
    require_vehicle_owned(&state.pool, auth.user_id, vehicle_id).await?;

    let from = params
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
    let to = params.to.unwrap_or_else(Utc::now);
    let bucket_secs = params.bucket_secs.clamp(60, 86400);
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
            LIMIT $5"#,
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
