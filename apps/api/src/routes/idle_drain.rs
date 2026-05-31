//! Idle (phantom) drain endpoint — queries the `phantom_drain_periods` view
//! to surface resting energy loss events (e.g. Sentry Mode, camp mode, cold
//! weather conditioning).

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
    Router::new().route("/vehicles/:vehicle_id/idle-drain", get(idle_drain))
}

#[derive(Deserialize)]
struct IdleDrainParams {
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    #[serde(default = "default_min_duration_hours")]
    min_duration_hours: f64,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    100
}

fn default_min_duration_hours() -> f64 {
    6.0
}

#[derive(Serialize, sqlx::FromRow)]
struct PhantomPeriod {
    period_start: Option<DateTime<Utc>>,
    period_end: Option<DateTime<Utc>>,
    duration_hours: Option<f64>,
    standby_pct: Option<f64>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
    soc_lost_pct: Option<f64>,
    drain_pct_per_hour: Option<f64>,
    range_start_mi: Option<f64>,
    range_end_mi: Option<f64>,
    range_lost_mi: Option<f64>,
    range_lost_per_hour_mi: Option<f64>,
    energy_drained_kwh: Option<f64>,
    avg_power_w: Option<f64>,
    has_reduced_range: Option<bool>,
}

#[derive(Serialize)]
struct IdleDrainResponse {
    vehicle_id: Uuid,
    periods: Vec<PhantomPeriod>,
}

async fn idle_drain(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
    Query(params): Query<IdleDrainParams>,
) -> Result<Json<IdleDrainResponse>, AppError> {
    ensure_owned(&state.pool, vehicle_id, auth.user_id).await?;

    let from = params
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
    let to = params.to.unwrap_or_else(Utc::now);
    let min_duration_hours = params.min_duration_hours.max(0.0);
    let limit = params.limit.min(500);

    let periods = sqlx::query_as::<_, PhantomPeriod>(
        r#"SELECT
                             p.period_start,
                             p.period_end,
                             (EXTRACT(EPOCH FROM (p.period_end - p.period_start)) / 3600.0)::float8 AS duration_hours,
                             CASE
                                 WHEN EXTRACT(EPOCH FROM (p.period_end - p.period_start)) > 0
                                 THEN COALESCE(state_overlap.sleep_or_offline_seconds, 0)::float8
                                      / EXTRACT(EPOCH FROM (p.period_end - p.period_start))
                                 ELSE NULL
                             END AS standby_pct,
                             p.soc_start,
                             p.soc_end,
                             p.soc_lost_pct::float8 AS soc_lost_pct,
                             p.drain_pct_per_hour::float8 AS drain_pct_per_hour,
                             start_sample.range_mi AS range_start_mi,
                             end_sample.range_mi AS range_end_mi,
                             CASE
                                 WHEN start_sample.range_mi IS NOT NULL AND end_sample.range_mi IS NOT NULL
                                 THEN GREATEST(start_sample.range_mi - end_sample.range_mi, 0)::float8
                                 ELSE NULL
                             END AS range_lost_mi,
                             CASE
                                 WHEN EXTRACT(EPOCH FROM (p.period_end - p.period_start)) > 0
                                            AND start_sample.range_mi IS NOT NULL
                                            AND end_sample.range_mi IS NOT NULL
                                 THEN (GREATEST(start_sample.range_mi - end_sample.range_mi, 0)::float8
                                       / (EXTRACT(EPOCH FROM (p.period_end - p.period_start)) / 3600.0))
                                 ELSE NULL
                             END AS range_lost_per_hour_mi,
                             CASE
                                 WHEN cap_sample.capacity_wh IS NOT NULL
                                 THEN (p.soc_lost_pct::float8 / 100.0) * (cap_sample.capacity_wh / 1000.0)
                                 ELSE NULL
                             END AS energy_drained_kwh,
                             CASE
                                 WHEN EXTRACT(EPOCH FROM (p.period_end - p.period_start)) > 0
                                      AND cap_sample.capacity_wh IS NOT NULL
                                 THEN (((p.soc_lost_pct::float8 / 100.0) * (cap_sample.capacity_wh / 1000.0))
                                       / (EXTRACT(EPOCH FROM (p.period_end - p.period_start)) / 3600.0)) * 1000.0
                                 ELSE NULL
                             END AS avg_power_w,
                             reduced_signal.has_reduced_range AS has_reduced_range
                     FROM timeseries.phantom_drain_periods p
                     LEFT JOIN LATERAL (
                         SELECT t.distance_to_empty_mi::float8 AS range_mi
                         FROM timeseries.telemetry t
                         WHERE t.vehicle_id = $1
                             AND t.ts <= p.period_start
                             AND t.distance_to_empty_mi IS NOT NULL
                         ORDER BY t.ts DESC
                         LIMIT 1
                     ) start_sample ON TRUE
                     LEFT JOIN LATERAL (
                         SELECT t.distance_to_empty_mi::float8 AS range_mi
                         FROM timeseries.telemetry t
                         WHERE t.vehicle_id = $1
                             AND t.ts >= p.period_end
                             AND t.distance_to_empty_mi IS NOT NULL
                         ORDER BY t.ts ASC
                         LIMIT 1
                     ) end_sample ON TRUE
                     LEFT JOIN LATERAL (
                         SELECT t.odometer_miles::float8 AS odometer_mi
                         FROM timeseries.telemetry t
                         WHERE t.vehicle_id = $1
                             AND t.ts <= p.period_start
                             AND t.odometer_miles IS NOT NULL
                         ORDER BY t.ts DESC
                         LIMIT 1
                     ) start_odometer ON TRUE
                     LEFT JOIN LATERAL (
                         SELECT t.odometer_miles::float8 AS odometer_mi
                         FROM timeseries.telemetry t
                         WHERE t.vehicle_id = $1
                             AND t.ts >= p.period_end
                             AND t.odometer_miles IS NOT NULL
                         ORDER BY t.ts ASC
                         LIMIT 1
                     ) end_odometer ON TRUE
                     LEFT JOIN LATERAL (
                         SELECT t.battery_capacity_wh::float8 AS capacity_wh
                         FROM timeseries.telemetry t
                         WHERE t.vehicle_id = $1
                             AND t.ts <= p.period_end
                             AND t.battery_capacity_wh IS NOT NULL
                             AND t.battery_capacity_wh > 10000
                         ORDER BY t.ts DESC
                         LIMIT 1
                     ) cap_sample ON TRUE
                     LEFT JOIN LATERAL (
                         SELECT
                             CASE
                                 WHEN COUNT(*) = 0 THEN NULL
                                 ELSE BOOL_OR(
                                     (t.outside_temp_c IS NOT NULL AND t.outside_temp_c < -5)
                                     OR COALESCE(t.hvac_active, FALSE)
                                 )
                             END AS has_reduced_range
                         FROM timeseries.telemetry t
                         WHERE t.vehicle_id = $1
                             AND t.ts >= p.period_start
                             AND t.ts <= p.period_end
                     ) reduced_signal ON TRUE
                     LEFT JOIN LATERAL (
                         SELECT SUM(
                             EXTRACT(
                                 EPOCH FROM (
                                     LEAST(COALESCE(v.ended_at, NOW()), p.period_end)
                                     - GREATEST(v.started_at, p.period_start)
                                 )
                             )
                         ) AS sleep_or_offline_seconds
                         FROM riviamigo.vehicle_state_periods v
                         WHERE v.vehicle_id = $1
                             AND v.state IN ('sleep', 'offline')
                             AND v.started_at < p.period_end
                             AND COALESCE(v.ended_at, NOW()) > p.period_start
                     ) state_overlap ON TRUE
                     WHERE p.vehicle_id = $1
                         AND p.period_start >= $2
                         AND p.period_start <= $3
                         AND (EXTRACT(EPOCH FROM (p.period_end - p.period_start)) / 3600.0) >= $4
                         AND (
                             start_odometer.odometer_mi IS NULL
                             OR end_odometer.odometer_mi IS NULL
                             OR end_odometer.odometer_mi - start_odometer.odometer_mi < 1.0
                         )
                     ORDER BY p.period_start DESC
                     LIMIT $5"#,
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
        .bind(min_duration_hours)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(IdleDrainResponse {
        vehicle_id,
        periods,
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

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use http::{Request, StatusCode};
    use tower::ServiceExt;

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
    async fn idle_drain_requires_auth() {
        let app = make_app().await;
        assert_eq!(
            get_status(
                app,
                "/v1/vehicles/00000000-0000-0000-0000-000000000000/idle-drain",
            )
            .await,
            StatusCode::UNAUTHORIZED,
        );
    }

    #[test]
    fn min_duration_default_is_six_hours() {
        assert_eq!(super::default_min_duration_hours(), 6.0);
    }
}
