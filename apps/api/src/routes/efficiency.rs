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
    temp_c_low: i32,
    temp_c_high: i32,
    avg_efficiency_wh_mi: Option<f64>,
    trip_count: i64,
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
        "p10_wh_per_mi":  row.p10,
        "p90_wh_per_mi":  row.p90,
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
           width_bucket(t.outside_temp_c, -20, 45, 13) AS bucket,
           round(((-20 + (width_bucket(t.outside_temp_c, -20, 45, 13) - 1) * 5))::numeric, 0)::int AS temp_c_low,
           round(((-20 + (width_bucket(t.outside_temp_c, -20, 45, 13)) * 5))::numeric, 0)::int      AS temp_c_high,
           avg(t.efficiency_wh_per_mile) AS avg_efficiency_wh_mi,
           count(*) AS trip_count
         FROM riviamigo.trips t
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3
           AND t.outside_temp_c IS NOT NULL AND t.efficiency_wh_per_mile IS NOT NULL
         GROUP BY 1, 2, 3 ORDER BY 2",
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
                                (SELECT AVG(tel.avg_cabin_temp_c)
                 FROM timeseries.telemetry_1hr tel
                 WHERE tel.vehicle_id=t.vehicle_id
                   AND tel.bucket BETWEEN t.started_at AND t.ended_at
                ) AS avg_temp_c
         FROM riviamigo.trips t
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3
           AND t.efficiency_wh_per_mile IS NOT NULL AND t.distance_miles > 1.0
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
        };

        let state = AppState {
            pool,
            redis,
            jwt_keys,
            age_key: "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"
                .to_string(),
            config,
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
