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

/// Returns the vehicle's stored factory capacity (from vehicles.battery_capacity_wh), falling
/// back to the max ever observed value in telemetry. Used as the "new" baseline for health %.
async fn resolve_usable_new_wh(
    pool: &sqlx::PgPool,
    vehicle_id: uuid::Uuid,
) -> Result<Option<f64>, crate::errors::AppError> {
    let stored: Option<f64> =
        sqlx::query_scalar("SELECT battery_capacity_wh FROM riviamigo.vehicles WHERE id = $1")
            .bind(vehicle_id)
            .fetch_optional(pool)
            .await?
            .flatten();

    if let Some(w) = stored.filter(|&w| w > 10000.0) {
        return Ok(Some(w));
    }

    let max_ever: Option<f64> = sqlx::query_scalar(
        "SELECT max(battery_capacity_wh) FROM timeseries.telemetry \
         WHERE vehicle_id = $1 AND battery_capacity_wh > 10000",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?
    .flatten();

    Ok(max_ever)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/battery/soc", get(get_soc))
        .route("/battery/range", get(get_range))
        .route("/battery/capacity", get(get_capacity))
        .route("/battery/health", get(get_health))
        .route("/battery/mileage", get(get_mileage))
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
    pub day: Option<NaiveDate>,
    pub total_soc_lost: Option<f64>,
    pub avg_drain_rate: Option<f64>,
    pub hours_parked: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DegradationPoint {
    pub ts: DateTime<Utc>,
    pub odometer_mi: Option<f64>,
    pub usable_kwh: f64,
    pub rated_kwh: Option<f64>,
    pub capacity_pct: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BatteryMileagePoint {
    pub ts: DateTime<Utc>,
    pub odometer_mi: Option<f64>,
    pub usable_kwh: Option<f64>,
    pub range_mi: Option<f64>,
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

    let usable_new_wh = resolve_usable_new_wh(&state.pool, vid).await?;

    let rows = sqlx::query_as::<_, DegradationPoint>(
        "SELECT
             time_bucket('1 week', ts) AS ts,
             max(odometer_miles) AS odometer_mi,
             COALESCE(max(battery_capacity_wh) / 1000.0, 0.0) AS usable_kwh,
             NULL::float8 AS rated_kwh,
             CASE WHEN $2 > 0
                  THEN max(battery_capacity_wh) / $2 * 100.0
                  ELSE NULL END AS capacity_pct
         FROM timeseries.telemetry
         WHERE vehicle_id = $1 AND battery_capacity_wh > 10000
         GROUP BY time_bucket('1 week', ts)
         ORDER BY 1",
    )
    .bind(vid)
    .bind(usable_new_wh.unwrap_or(0.0))
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

async fn get_health(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<TimeRangeParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let usable_new_wh = resolve_usable_new_wh(&state.pool, vid).await?;

    // Average of daily-peak capacity readings over the last 30 days
    let usable_now_wh: Option<f64> = sqlx::query_scalar(
        "SELECT avg(daily_max) FROM (
             SELECT max(battery_capacity_wh) AS daily_max
             FROM timeseries.telemetry
             WHERE vehicle_id = $1
               AND battery_capacity_wh > 10000
               AND ts >= now() - INTERVAL '30 days'
             GROUP BY date_trunc('day', ts)
         ) sub",
    )
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .flatten();

    let charges = sqlx::query!(
        "SELECT COUNT(*) AS charge_count,
                SUM(COALESCE(kwh_added, energy_added_wh / 1000.0)) AS total_added_kwh,
                SUM(GREATEST(COALESCE(kwh_added, energy_added_wh / 1000.0), COALESCE(energy_used_wh / 1000.0, 0))) AS total_used_kwh
         FROM riviamigo.charge_sessions
         WHERE vehicle_id=$1 AND COALESCE(kwh_added, energy_added_wh / 1000.0) > 0.01",
        vid
    )
    .fetch_one(&state.pool)
    .await?;

    let usable_now_kwh = usable_now_wh.map(|w| w / 1000.0);
    let usable_new_kwh = usable_new_wh.map(|w| w / 1000.0);
    let total_added = charges.total_added_kwh;
    let total_used = charges.total_used_kwh;
    let battery_health_pct = match (usable_now_kwh, usable_new_kwh) {
        (Some(now), Some(new)) if new > 0.0 => Some((now / new * 100.0).min(100.0)),
        _ => None,
    };
    let charging_cycles = match (total_added, usable_new_kwh) {
        (Some(added), Some(new)) if new > 0.0 => Some((added / new).floor()),
        _ => None,
    };
    let charging_efficiency_pct = match (total_added, total_used) {
        (Some(added), Some(used)) if used > 0.0 => Some(added / used * 100.0),
        _ => None,
    };

    Ok(Json(serde_json::json!({
        "usable_now_kwh": usable_now_kwh,
        "usable_new_kwh": usable_new_kwh,
        "battery_health_pct": battery_health_pct,
        "estimated_degradation_pct": battery_health_pct.map(|pct| (100.0 - pct).max(0.0)),
        "charging_cycles": charging_cycles,
        "charge_count": charges.charge_count,
        "total_energy_added_kwh": total_added,
        "total_energy_used_kwh": total_used,
        "charging_efficiency_pct": charging_efficiency_pct,
    })))
}

async fn get_mileage(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<TimeRangeParams>,
) -> Result<Json<Vec<BatteryMileagePoint>>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let rows = sqlx::query_as::<_, BatteryMileagePoint>(
        "SELECT
             time_bucket('1 week', ts) AS ts,
             max(odometer_miles) AS odometer_mi,
             max(battery_capacity_wh) / 1000.0 AS usable_kwh,
             avg(distance_to_empty_mi) AS range_mi
         FROM timeseries.telemetry
         WHERE vehicle_id = $1 AND battery_capacity_wh > 10000
         GROUP BY time_bucket('1 week', ts)
         ORDER BY max(odometer_miles) NULLS LAST",
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
    let from_day = from.date_naive();
    let to_day = to.date_naive();

    let points = sqlx::query_as!(PhantomDrainPoint,
        "SELECT day, soc_lost_pct_total::float8 AS total_soc_lost, avg_drain_pct_per_hour::float8 AS avg_drain_rate, hours_idle::float8 AS hours_parked \
         FROM timeseries.phantom_drain_daily \
         WHERE vehicle_id=$1 AND day>=$2 AND day<=$3 ORDER BY day",
        vid, from_day, to_day).fetch_all(&state.pool).await?;
    Ok(Json(points))
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
    async fn battery_soc_requires_auth() {
        let app = make_app().await;
        assert_eq!(get_status(app, "/v1/battery/soc").await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn battery_range_requires_auth() {
        let app = make_app().await;
        assert_eq!(get_status(app, "/v1/battery/range").await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn battery_capacity_requires_auth() {
        let app = make_app().await;
        assert_eq!(
            get_status(app, "/v1/battery/capacity").await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn battery_phantom_drain_requires_auth() {
        let app = make_app().await;
        assert_eq!(
            get_status(app, "/v1/battery/phantom-drain").await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn battery_degradation_requires_auth() {
        let app = make_app().await;
        assert_eq!(
            get_status(app, "/v1/battery/degradation").await,
            StatusCode::UNAUTHORIZED
        );
    }

    // ── pure unit tests (no DB needed) ───────────────────────────────────────

    #[test]
    fn resolution_returns_1min_for_short_range() {
        use super::resolution;
        let from = chrono::Utc::now() - chrono::Duration::hours(24);
        let to = chrono::Utc::now();
        assert_eq!(resolution(from, to), "1min");
    }

    #[test]
    fn resolution_returns_1hr_for_medium_range() {
        use super::resolution;
        let from = chrono::Utc::now() - chrono::Duration::days(30);
        let to = chrono::Utc::now();
        assert_eq!(resolution(from, to), "1hr");
    }

    #[test]
    fn resolution_returns_1day_for_long_range() {
        use super::resolution;
        let from = chrono::Utc::now() - chrono::Duration::days(180);
        let to = chrono::Utc::now();
        assert_eq!(resolution(from, to), "1day");
    }
}
