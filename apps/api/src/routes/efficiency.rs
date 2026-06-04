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
    routes::efficiency_math::weighted_average_from_totals,
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

#[derive(Debug, sqlx::FromRow)]
struct SummaryRow {
    total_distance_miles: Option<f64>,
    weighted_efficiency_wh_mi: Option<f64>,
    total_miles: f64,
    p10: Option<f64>,
    p90: Option<f64>,
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

    let row = sqlx::query_as::<_, SummaryRow>(
        "SELECT COALESCE(SUM(distance_miles), 0)::float8 AS total_distance_miles,
                COALESCE(SUM(distance_miles * efficiency_wh_per_mile), 0)::float8 AS weighted_efficiency_wh_mi,
                COALESCE(SUM(distance_miles),0) AS total_miles,
                PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY efficiency_wh_per_mile) AS p10,
                PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY efficiency_wh_per_mile) AS p90
         FROM riviamigo.trips
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
           AND efficiency_wh_per_mile IS NOT NULL
           AND distance_miles > 0"
    )
    .bind(vid)
    .bind(from)
    .bind(to)
    .fetch_one(&state.pool)
    .await?;

    let avg_wh_per_mi = weighted_average_from_totals(
        row.total_distance_miles,
        row.weighted_efficiency_wh_mi,
    );

    Ok(Json(serde_json::json!({
        "avg_wh_per_mi":  avg_wh_per_mi,
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
        "WITH daily AS (
           SELECT
             started_at::date AS day,
             avg(efficiency_wh_per_mile) AS day_avg_wh_mi
           FROM riviamigo.trips
           WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
             AND efficiency_wh_per_mile IS NOT NULL
           GROUP BY started_at::date
         )
         SELECT
           day,
           day_avg_wh_mi,
           avg(day_avg_wh_mi) OVER (
             ORDER BY day
             ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
           ) AS rolling_7d_wh_mi
         FROM daily
         ORDER BY 1",
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

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use http::{Request, StatusCode};
    use tower::ServiceExt;

    // Run with: cargo test -- --ignored

    async fn make_app() -> axum::Router {
        use crate::middleware::auth::{AppState, JwtKeys};
        use rsa::{
            pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
            RsaPrivateKey,
        };
        use std::sync::Arc;

        let database_url =
            std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");
        let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".into());

        let pool = crate::db::pool::create_pool(&database_url)
            .await
            .expect("create_pool");
        let redis = redis::Client::open(redis_url).expect("redis client");

        let mut rng = rand::thread_rng();
        let priv_key = RsaPrivateKey::new(&mut rng, 2048).expect("rsa key");
        let pub_key = priv_key.to_public_key();
        let private_pem = priv_key
            .to_pkcs8_pem(LineEnding::LF)
            .expect("pem")
            .to_string();
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
            vehicle_image_cache_dir: std::env::temp_dir()
                .join("riviamigo-route-test-vehicle-images")
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
            rate_limit: crate::config::RateLimitConfig::default(),
        };

        let state = AppState {
            pool,
            redis,
            jwt_keys,
            age_key: "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"
                .to_string(),
            config,
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
    async fn efficiency_summary_requires_auth() {
        let app = make_app().await;
        assert_eq!(
            get_status(app, "/v1/efficiency/summary").await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn efficiency_by_mode_requires_auth() {
        let app = make_app().await;
        assert_eq!(
            get_status(app, "/v1/efficiency/by-mode").await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn efficiency_vs_temp_requires_auth() {
        let app = make_app().await;
        assert_eq!(
            get_status(app, "/v1/efficiency/vs-temp").await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn efficiency_trend_requires_auth() {
        let app = make_app().await;
        assert_eq!(
            get_status(app, "/v1/efficiency/trend").await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn efficiency_range_vs_temp_requires_auth() {
        let app = make_app().await;
        assert_eq!(
            get_status(app, "/v1/efficiency/range-vs-temp").await,
            StatusCode::UNAUTHORIZED
        );
    }
}
