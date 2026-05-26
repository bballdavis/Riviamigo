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
        .route(
            "/vehicles/:vehicle_id/drives/:id/power",
            get(get_power_profile_path),
        )
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
    search: Option<String>,
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
    start_place: Option<String>,
    end_place: Option<String>,
    start_address: Option<String>,
    end_address: Option<String>,
    outside_temp_c: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct TrackPoint {
    ts: DateTime<Utc>,
    lat: Option<f64>,
    lng: Option<f64>,
    speed_mph: Option<f64>,
    altitude_m: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct TripWindowRow {
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    duration_seconds: Option<i32>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct SpeedProfileRow {
    elapsed_s: f64,
    speed_mph: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ElevationPointRow {
    ts: DateTime<Utc>,
    value: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct PowerProfileRow {
    ts: DateTime<Utc>,
    power_kw: Option<f64>,
    regen_power_kw: Option<f64>,
    speed_mph: Option<f64>,
    battery_level: Option<f64>,
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
    let search = p
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|v| v.replace('%', "\\%").replace('_', "\\_"));

    let mut tx = state.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;

    let rows = sqlx::query_as::<_, TripRow>(
        "SELECT t.id, t.started_at, t.ended_at, t.duration_seconds, t.distance_miles, \
                t.efficiency_wh_per_mile, t.max_speed_mph, t.drive_mode, t.soc_start, t.soc_end, \
                t.start_lat, t.start_lng, t.end_lat, t.end_lng, \
                COALESCE(sg.name, NULLIF(CONCAT_WS(', ', sa.road, sa.city), '')) AS start_place, \
                COALESCE(eg.name, NULLIF(CONCAT_WS(', ', ea.road, ea.city), '')) AS end_place, \
                sa.display_name AS start_address, ea.display_name AS end_address, \
                t.outside_temp_c AS outside_temp_c \
         FROM riviamigo.trips t \
         LEFT JOIN riviamigo.geofences sg ON sg.id = t.start_geofence_id \
         LEFT JOIN riviamigo.geofences eg ON eg.id = t.end_geofence_id \
         LEFT JOIN riviamigo.addresses sa ON sa.id = t.start_address_id \
         LEFT JOIN riviamigo.addresses ea ON ea.id = t.end_address_id \
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3 \
         AND ($6::text IS NULL OR \
              COALESCE(sg.name, '') ILIKE '%' || $6 || '%' ESCAPE '\\' OR \
              COALESCE(eg.name, '') ILIKE '%' || $6 || '%' ESCAPE '\\' OR \
              COALESCE(sa.display_name, '') ILIKE '%' || $6 || '%' ESCAPE '\\' OR \
              COALESCE(ea.display_name, '') ILIKE '%' || $6 || '%' ESCAPE '\\' OR \
              COALESCE(CONCAT_WS(', ', sa.road, sa.city), '') ILIKE '%' || $6 || '%' ESCAPE '\\' OR \
              COALESCE(CONCAT_WS(', ', ea.road, ea.city), '') ILIKE '%' || $6 || '%' ESCAPE '\\') \
         ORDER BY t.started_at DESC LIMIT $4 OFFSET $5",
    )
    .bind(vid)
    .bind(from)
    .bind(to)
    .bind(limit)
    .bind(offset)
    .bind(search.as_deref())
    .fetch_all(&mut *tx)
    .await?;

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) \
         FROM riviamigo.trips t \
         LEFT JOIN riviamigo.geofences sg ON sg.id = t.start_geofence_id \
         LEFT JOIN riviamigo.geofences eg ON eg.id = t.end_geofence_id \
         LEFT JOIN riviamigo.addresses sa ON sa.id = t.start_address_id \
         LEFT JOIN riviamigo.addresses ea ON ea.id = t.end_address_id \
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3 \
         AND ($4::text IS NULL OR \
              COALESCE(sg.name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR \
              COALESCE(eg.name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR \
              COALESCE(sa.display_name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR \
              COALESCE(ea.display_name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR \
              COALESCE(CONCAT_WS(', ', sa.road, sa.city), '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR \
              COALESCE(CONCAT_WS(', ', ea.road, ea.city), '') ILIKE '%' || $4 || '%' ESCAPE '\\')",
    )
    .bind(vid)
    .bind(from)
    .bind(to)
    .bind(search.as_deref())
    .fetch_one(&mut *tx)
    .await?;

    tx.rollback().await?;

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

    let row = sqlx::query_as::<_, TripRow>(
        "SELECT t.id, t.started_at, t.ended_at, t.duration_seconds, t.distance_miles, \
                t.efficiency_wh_per_mile, t.max_speed_mph, t.drive_mode, t.soc_start, t.soc_end, \
                t.start_lat, t.start_lng, t.end_lat, t.end_lng, \
                COALESCE(sg.name, NULLIF(CONCAT_WS(', ', sa.road, sa.city), '')) AS start_place, \
                COALESCE(eg.name, NULLIF(CONCAT_WS(', ', ea.road, ea.city), '')) AS end_place, \
                sa.display_name AS start_address, ea.display_name AS end_address, \
                t.outside_temp_c AS outside_temp_c \
         FROM riviamigo.trips t \
         LEFT JOIN riviamigo.geofences sg ON sg.id = t.start_geofence_id \
         LEFT JOIN riviamigo.geofences eg ON eg.id = t.end_geofence_id \
         LEFT JOIN riviamigo.addresses sa ON sa.id = t.start_address_id \
         LEFT JOIN riviamigo.addresses ea ON ea.id = t.end_address_id \
            WHERE t.id=$1 AND t.vehicle_id=$2",
    )
    .bind(id)
    .bind(vid)
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

    let trip = sqlx::query_as::<_, TripWindowRow>(
        "SELECT started_at, ended_at, duration_seconds FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2"
    )
    .bind(id)
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

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
        "1 second" => sqlx::query_as::<_, TrackPoint>(
            "SELECT ts, latitude AS lat, longitude AS lng, speed_mph, altitude_m \
             FROM timeseries.telemetry \
             WHERE vehicle_id=$1 AND ts>=$2 AND ts<=$3 AND latitude IS NOT NULL \
             ORDER BY ts LIMIT 5000",
        )
        .bind(vid)
        .bind(trip.started_at)
        .bind(trip.ended_at)
        .fetch_all(&state.pool)
        .await?,
        _ => sqlx::query_as::<_, TrackPoint>(
            r#"SELECT time_bucket('15 seconds'::interval, ts) AS ts, avg(latitude) AS lat, avg(longitude) AS lng,
                      avg(speed_mph) AS speed_mph, avg(altitude_m) AS altitude_m
               FROM timeseries.telemetry
               WHERE vehicle_id=$1 AND ts>=$2 AND ts<=$3 AND latitude IS NOT NULL
               GROUP BY 1 ORDER BY 1 LIMIT 5000"#,
        )
        .bind(vid)
        .bind(trip.started_at)
        .bind(trip.ended_at)
        .fetch_all(&state.pool)
        .await?,
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

    let trip = sqlx::query_as::<_, TripWindowRow>(
        "SELECT started_at, ended_at, NULL::int4 AS duration_seconds FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2"
    )
    .bind(id)
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let points = sqlx::query_as::<_, SpeedProfileRow>(
        r#"SELECT EXTRACT(EPOCH FROM (time_bucket('10 seconds'::interval, ts) - $3))::float8 AS elapsed_s,
                  avg(speed_mph) AS speed_mph
           FROM timeseries.telemetry
           WHERE vehicle_id=$1
             AND ts>=$3 AND ts<=$4
             AND ($2::uuid IS NULL OR trip_id=$2 OR trip_id IS NULL)
             AND speed_mph IS NOT NULL
           GROUP BY 1
           ORDER BY 1"#
    )
    .bind(vid)
    .bind(id)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(points)))
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

    let trip = sqlx::query_as::<_, TripWindowRow>(
        "SELECT started_at, ended_at, NULL::int4 AS duration_seconds FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2"
    )
    .bind(id)
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let points = sqlx::query_as::<_, ElevationPointRow>(
        r#"SELECT time_bucket('10 seconds'::interval, ts) AS ts, avg(altitude_m) AS value
           FROM timeseries.telemetry
           WHERE vehicle_id=$1 AND ts>=$2 AND ts<=$3 AND altitude_m IS NOT NULL
           GROUP BY 1 ORDER BY 1"#,
    )
    .bind(vid)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(points)))
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

    let trip = sqlx::query_as::<_, TripWindowRow>(
        "SELECT started_at, ended_at, NULL::int4 AS duration_seconds FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2"
    )
    .bind(trip_id)
    .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let points = sqlx::query_as::<_, PowerProfileRow>(
        r#"SELECT time_bucket('10 seconds'::interval, ts) AS ts,
                  avg(power_kw) AS power_kw,
                  avg(regen_power_kw) AS regen_power_kw,
                  avg(speed_mph) AS speed_mph,
                  avg(battery_level) AS battery_level
           FROM timeseries.telemetry
           WHERE vehicle_id=$1 AND trip_id=$2 AND ts>=$3 AND ts<=$4
           GROUP BY 1 ORDER BY 1"#,
    )
    .bind(vehicle_id)
    .bind(trip_id)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(points)))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use http::{Request, StatusCode};
    use tower::ServiceExt;

    // Run with: cargo test -- --ignored

    async fn make_app() -> axum::Router {
        use std::sync::Arc;
        use crate::middleware::auth::{AppState, JwtKeys};
        use rsa::{
            pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
            RsaPrivateKey,
        };

        let database_url = std::env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set for integration tests");
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".into());

        let pool = crate::db::pool::create_pool(&database_url)
            .await
            .expect("create_pool");
        let redis = redis::Client::open(redis_url).expect("redis client");

        let mut rng = rand::thread_rng();
        let priv_key = RsaPrivateKey::new(&mut rng, 2048).expect("rsa key");
        let pub_key = priv_key.to_public_key();
        let private_pem = priv_key.to_pkcs8_pem(LineEnding::LF).expect("pem").to_string();
        let public_pem = pub_key.to_public_key_pem(LineEnding::LF).expect("pem");
        let jwt_keys = Arc::new(JwtKeys::new(&private_pem, &public_pem).expect("jwt keys"));

        let config = crate::config::Config {
            database_url: database_url.clone(),
            redis_url: "redis://127.0.0.1/".into(),
            jwt_secret: None,
            jwt_public_key: None,
            age_encryption_key: None,
            port: 3001,
            allowed_origins: vec!["http://localhost:3000".into()],
            s3_endpoint: None,
            s3_access_key: None,
            s3_secret_key: None,
            backup_artifact_dir: std::env::temp_dir()
                .join("riviamigo-route-test-backups")
                .to_string_lossy()
                .into_owned(),
            backup_driver: "json".into(),
            backup_poll_interval_seconds: 60,
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: true,
            rivian_suppress_duplicate_telemetry: true,
            riviamigo_env: None,
            cookie_insecure: None,
        };

        let state = AppState {
            pool,
            redis,
            jwt_keys,
            age_key: "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"
                .to_string(),
            config,
            nominatim_next_call: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::time::Instant::now(),
            )),
            nominatim_cache: std::sync::Arc::new(tokio::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
            supervisor: crate::ingestion::supervisor::SupervisorHandle::noop(),
        };

        crate::routes::build_router(state)
    }

    async fn get_status(app: axum::Router, uri: &str) -> http::StatusCode {
        let req = Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        app.oneshot(req).await.unwrap().status()
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn list_trips_requires_auth() {
        let app = make_app().await;
        assert_eq!(get_status(app, "/v1/trips").await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn trip_detail_requires_auth() {
        let app = make_app().await;
        let status = get_status(app, &format!("/v1/trips/{}", uuid::Uuid::new_v4())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn trip_track_requires_auth() {
        let app = make_app().await;
        let status =
            get_status(app, &format!("/v1/trips/{}/track", uuid::Uuid::new_v4())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn trip_speed_requires_auth() {
        let app = make_app().await;
        let status =
            get_status(app, &format!("/v1/trips/{}/speed", uuid::Uuid::new_v4())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn trip_elevation_requires_auth() {
        let app = make_app().await;
        let status =
            get_status(app, &format!("/v1/trips/{}/elevation", uuid::Uuid::new_v4())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}
