use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_read_access,
    errors::AppError,
    middleware::auth::{require_vehicle_access, AppState, AuthUser},
    routes::efficiency_math::weighted_average_from_totals,
    routes::trip_tag_filter::{parse_tag_filter, require_known_vehicle_tags, sql_predicate, TripTagMatch},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/efficiency/summary", get(get_summary))
        .route("/efficiency/by-mode", get(get_by_mode))
        .route("/efficiency/by-tag", get(get_by_tag))
        .route("/efficiency/range-vs-temp", get(get_range_vs_temp))
        .route("/efficiency/vs-temp", get(get_vs_temp_binned))
        .route("/efficiency/trend", get(get_trend))
}

#[derive(Deserialize)]
struct Params {
    vehicle_id: Option<Uuid>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    lifetime: Option<bool>,
    tag_ids: Option<String>,
    tag_match: Option<TripTagMatch>,
    untagged: Option<bool>,
}

#[cfg(test)]
mod timeframe_tests {
    use chrono::{TimeZone, Utc};

    #[test]
    fn lifetime_time_bounds_use_epoch_instead_of_default_window() {
        let to = Utc.with_ymd_and_hms(2026, 7, 2, 12, 0, 0).unwrap();
        let (from, resolved_to) = super::resolve_time_bounds(None, Some(to), true, 90);

        assert_eq!(resolved_to, to);
        assert_eq!(from, chrono::DateTime::<Utc>::from_timestamp(0, 0).unwrap());
    }

    #[test]
    fn explicit_time_bounds_are_preserved() {
        let from = Utc.with_ymd_and_hms(2026, 6, 1, 0, 0, 0).unwrap();
        let to = Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap();

        assert_eq!(
            super::resolve_time_bounds(Some(from), Some(to), false, 90),
            (from, to)
        );
    }

    #[test]
    fn trend_keeps_each_same_day_trip_and_weights_the_24_hour_average_by_distance() {
        let first = Utc.with_ymd_and_hms(2026, 7, 1, 9, 0, 0).unwrap();
        let second = Utc.with_ymd_and_hms(2026, 7, 1, 17, 0, 0).unwrap();
        let points = super::with_rolling_24h(vec![
            super::TrendSample {
                ts: first,
                trip_efficiency_wh_mi: 300.0,
                distance_miles: 10.0,
            },
            super::TrendSample {
                ts: second,
                trip_efficiency_wh_mi: 400.0,
                distance_miles: 30.0,
            },
        ]);

        assert_eq!(points.len(), 2);
        assert_eq!(points[0].ts, first);
        assert_eq!(points[1].ts, second);
        assert_eq!(points[0].rolling_24h_wh_mi, Some(300.0));
        assert_eq!(points[1].rolling_24h_wh_mi, Some(375.0));
    }
}

fn resolve_time_bounds(
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    lifetime: bool,
    default_days: i64,
) -> (DateTime<Utc>, DateTime<Utc>) {
    let resolved_to = to.unwrap_or_else(Utc::now);
    let resolved_from = if lifetime {
        DateTime::<Utc>::from_timestamp(0, 0).unwrap_or(resolved_to - chrono::Duration::days(3650))
    } else {
        from.unwrap_or_else(|| Utc::now() - chrono::Duration::days(default_days))
    };
    (resolved_from, resolved_to)
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
    ts: DateTime<Utc>,
    trip_efficiency_wh_mi: Option<f64>,
    rolling_24h_wh_mi: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct TrendSample {
    ts: DateTime<Utc>,
    trip_efficiency_wh_mi: f64,
    distance_miles: f64,
}

fn with_rolling_24h(samples: Vec<TrendSample>) -> Vec<TrendPoint> {
    let mut window = VecDeque::new();
    let mut distance_total = 0.0;
    let mut weighted_efficiency_total = 0.0;

    samples
        .into_iter()
        .map(|sample| {
            window.push_back((
                sample.ts,
                sample.distance_miles,
                sample.trip_efficiency_wh_mi,
            ));
            distance_total += sample.distance_miles;
            weighted_efficiency_total += sample.distance_miles * sample.trip_efficiency_wh_mi;

            while window
                .front()
                .is_some_and(|(ts, _, _)| *ts < sample.ts - chrono::Duration::hours(24))
            {
                let (_, distance_miles, efficiency_wh_mi) = window.pop_front().unwrap();
                distance_total -= distance_miles;
                weighted_efficiency_total -= distance_miles * efficiency_wh_mi;
            }

            TrendPoint {
                ts: sample.ts,
                trip_efficiency_wh_mi: Some(sample.trip_efficiency_wh_mi),
                rolling_24h_wh_mi: (distance_total > 0.0)
                    .then_some(weighted_efficiency_total / distance_total),
            }
        })
        .collect()
}

#[derive(Debug, sqlx::FromRow)]
struct SummaryRow {
    total_distance_miles: Option<f64>,
    weighted_efficiency_wh_mi: Option<f64>,
    total_miles: f64,
    efficiency_miles: f64,
    p10: Option<f64>,
    p90: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ByTagRow {
    tag_id: Option<Uuid>,
    tag_name: String,
    trip_count: i64,
    total_miles: f64,
    efficiency_miles: f64,
    weighted_efficiency_wh_mi: f64,
}

#[derive(Debug, sqlx::FromRow)]
struct RangeVsTempRow {
    id: Uuid,
    distance_miles: f64,
    efficiency_wh_per_mile: f64,
    avg_temp_c: f64,
}

async fn resolve_tag_filter(
    state: &AppState,
    vehicle_id: Uuid,
    p: &Params,
) -> Result<crate::routes::trip_tag_filter::TripTagFilter, AppError> {
    let filter = parse_tag_filter(p.tag_ids.as_deref(), p.tag_match, p.untagged)?;
    require_known_vehicle_tags(&state.pool, vehicle_id, &filter).await?;
    Ok(filter)
}

async fn get_summary(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Params>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_read_access(&state.pool, &auth, vid).await?;
    let tag_filter = resolve_tag_filter(&state, vid, &p).await?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 90);

    let sql = format!("SELECT COALESCE(SUM(t.distance_miles) FILTER (WHERE t.efficiency_wh_per_mile IS NOT NULL), 0)::float8 AS total_distance_miles,
                COALESCE(SUM(distance_miles * efficiency_wh_per_mile) FILTER (WHERE efficiency_wh_per_mile IS NOT NULL), 0)::float8 AS weighted_efficiency_wh_mi,
                COALESCE(SUM(distance_miles), 0)::float8 AS total_miles,
                COALESCE(SUM(distance_miles) FILTER (WHERE efficiency_wh_per_mile IS NOT NULL), 0)::float8 AS efficiency_miles,
                PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY efficiency_wh_per_mile) FILTER (WHERE efficiency_wh_per_mile IS NOT NULL) AS p10,
                PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY efficiency_wh_per_mile) FILTER (WHERE efficiency_wh_per_mile IS NOT NULL) AS p90
         FROM riviamigo.trips t
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3
           AND t.distance_miles > 0{}", sql_predicate("t", 4, 5, 6));
    let row = sqlx::query_as::<_, SummaryRow>(sqlx::AssertSqlSafe(sql.as_str()))
    .bind(vid)
    .bind(from)
    .bind(to)
    .bind(tag_filter.tag_ids)
    .bind(tag_filter.match_all)
    .bind(tag_filter.untagged)
    .fetch_one(&state.pool)
    .await?;

    let avg_wh_per_mi =
        weighted_average_from_totals(row.total_distance_miles, row.weighted_efficiency_wh_mi);

    Ok(Json(serde_json::json!({
        "avg_wh_per_mi":  avg_wh_per_mi,
        "total_miles":    row.total_miles,
        "efficiency_miles": row.efficiency_miles,
        "coverage_percent": if row.total_miles > 0.0 { row.efficiency_miles / row.total_miles * 100.0 } else { 0.0 },
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
    require_vehicle_access(&auth, vid)?;
    require_vehicle_read_access(&state.pool, &auth, vid).await?;
    let tag_filter = resolve_tag_filter(&state, vid, &p).await?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 180);

    #[derive(sqlx::FromRow)]
    struct ModeRow {
        drive_mode: String,
        trip_count: i64,
        total_miles: Option<f64>,
        avg_wh_per_mi: Option<f64>,
    }

    let sql = format!("SELECT t.drive_mode, COUNT(*) AS trip_count,
                COALESCE(SUM(distance_miles), 0)::float8 AS total_miles,
                (SUM(distance_miles * efficiency_wh_per_mile) / NULLIF(SUM(distance_miles), 0))::float8 AS avg_wh_per_mi
         FROM riviamigo.trips t
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3
           AND t.drive_mode IS NOT NULL AND t.efficiency_wh_per_mile IS NOT NULL AND t.distance_miles > 0{}
         GROUP BY t.drive_mode ORDER BY avg_wh_per_mi", sql_predicate("t", 4, 5, 6));
    let rows = sqlx::query_as::<_, ModeRow>(sqlx::AssertSqlSafe(sql.as_str()))
    .bind(vid)
    .bind(from)
    .bind(to)
    .bind(tag_filter.tag_ids)
    .bind(tag_filter.match_all)
    .bind(tag_filter.untagged)
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
    require_vehicle_access(&auth, vid)?;
    require_vehicle_read_access(&state.pool, &auth, vid).await?;
    let tag_filter = resolve_tag_filter(&state, vid, &p).await?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 365);

    let sql = format!("SELECT
           (floor((t.outside_temp_c * 9.0/5.0 + 32) / 10.0) * 10 - 32) * 5.0/9.0        AS temp_c_low,
           ((floor((t.outside_temp_c * 9.0/5.0 + 32) / 10.0) + 1) * 10 - 32) * 5.0/9.0  AS temp_c_high,
           (sum(t.distance_miles * t.efficiency_wh_per_mile) / nullif(sum(t.distance_miles), 0)) AS avg_efficiency_wh_mi,
           count(*) AS trip_count,
           sum(t.distance_miles) AS total_miles,
           CASE WHEN sum(t.duration_seconds) > 0
                THEN sum(t.distance_miles) / (sum(t.duration_seconds) / 3600.0)
                END AS avg_speed_mph
         FROM riviamigo.trips t
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3
           AND t.outside_temp_c IS NOT NULL AND t.efficiency_wh_per_mile IS NOT NULL
           AND t.distance_miles > 0
         {} GROUP BY 1, 2 ORDER BY 1", sql_predicate("t", 4, 5, 6));
    let rows = sqlx::query_as::<_, VsTempPoint>(sqlx::AssertSqlSafe(sql.as_str()))
    .bind(vid)
    .bind(from)
    .bind(to)
    .bind(tag_filter.tag_ids)
    .bind(tag_filter.match_all)
    .bind(tag_filter.untagged)
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
    require_vehicle_access(&auth, vid)?;
    require_vehicle_read_access(&state.pool, &auth, vid).await?;
    let tag_filter = resolve_tag_filter(&state, vid, &p).await?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 90);

    let sql = format!("SELECT
             t.started_at AS ts,
             t.efficiency_wh_per_mile AS trip_efficiency_wh_mi,
             t.distance_miles
         FROM riviamigo.trips t
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3
           AND t.efficiency_wh_per_mile IS NOT NULL
           AND t.distance_miles > 0
         {} ORDER BY t.started_at", sql_predicate("t", 4, 5, 6));
    let samples = sqlx::query_as::<_, TrendSample>(sqlx::AssertSqlSafe(sql.as_str()))
    .bind(vid)
    .bind(from)
    .bind(to)
    .bind(tag_filter.tag_ids)
    .bind(tag_filter.match_all)
    .bind(tag_filter.untagged)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(with_rolling_24h(samples)))
}

async fn get_range_vs_temp(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Params>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_read_access(&state.pool, &auth, vid).await?;
    let tag_filter = resolve_tag_filter(&state, vid, &p).await?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 365);

    let sql = format!("SELECT t.id,
                t.distance_miles,
                t.efficiency_wh_per_mile,
                t.outside_temp_c AS avg_temp_c
         FROM riviamigo.trips t
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3
           AND t.efficiency_wh_per_mile IS NOT NULL AND t.distance_miles > 1.0
           AND t.outside_temp_c IS NOT NULL
         {} ORDER BY t.started_at DESC LIMIT 500", sql_predicate("t", 4, 5, 6));
    let rows = sqlx::query_as::<_, RangeVsTempRow>(sqlx::AssertSqlSafe(sql.as_str()))
    .bind(vid)
    .bind(from)
    .bind(to)
    .bind(tag_filter.tag_ids)
    .bind(tag_filter.match_all)
    .bind(tag_filter.untagged)
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

async fn get_by_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Params>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    let vid = p.vehicle_id.ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_read_access(&state.pool, &auth, vid).await?;
    let tag_filter = resolve_tag_filter(&state, vid, &p).await?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 365);
    let predicate = sql_predicate("t", 4, 5, 6);
    let sql = format!(
        "WITH cohort AS (
           SELECT t.* FROM riviamigo.trips t
           WHERE t.vehicle_id=$1 AND t.started_at >= $2 AND t.started_at <= $3
             AND t.distance_miles > 0 {predicate}
         ), grouped AS (
           SELECT tt.id AS tag_id, tt.name AS tag_name, c.id AS trip_id,
                  c.distance_miles, c.efficiency_wh_per_mile
           FROM cohort c
           JOIN riviamigo.trip_tag_assignments tta ON tta.trip_id=c.id
           JOIN riviamigo.trip_tags tt ON tt.id=tta.tag_id
           UNION ALL
           SELECT NULL::uuid, 'Untagged'::text, c.id, c.distance_miles, c.efficiency_wh_per_mile
           FROM cohort c
           WHERE NOT EXISTS (SELECT 1 FROM riviamigo.trip_tag_assignments tta WHERE tta.trip_id=c.id)
         )
         SELECT tag_id, tag_name, COUNT(*)::bigint AS trip_count,
                COALESCE(SUM(distance_miles), 0)::float8 AS total_miles,
                COALESCE(SUM(distance_miles) FILTER (WHERE efficiency_wh_per_mile IS NOT NULL), 0)::float8 AS efficiency_miles,
                COALESCE(SUM(distance_miles * efficiency_wh_per_mile) FILTER (WHERE efficiency_wh_per_mile IS NOT NULL), 0)::float8 AS weighted_efficiency_wh_mi
         FROM grouped GROUP BY tag_id, tag_name
         ORDER BY tag_id IS NULL, lower(tag_name), tag_id"
    );
    let rows = sqlx::query_as::<_, ByTagRow>(sqlx::AssertSqlSafe(sql.as_str()))
    .bind(vid).bind(from).bind(to)
    .bind(tag_filter.tag_ids).bind(tag_filter.match_all).bind(tag_filter.untagged)
    .fetch_all(&state.pool).await?;

    Ok(Json(rows.into_iter().map(|row| {
        let average = (row.efficiency_miles > 0.0)
            .then_some(row.weighted_efficiency_wh_mi / row.efficiency_miles);
        serde_json::json!({
            "tag_id": row.tag_id,
            "tag_name": row.tag_name,
            "trip_count": row.trip_count,
            "total_miles": row.total_miles,
            "efficiency_miles": row.efficiency_miles,
            "avg_efficiency_wh_mi": average,
            "coverage": if row.total_miles > 0.0 { row.efficiency_miles / row.total_miles } else { 0.0 },
        })
    }).collect()))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use http::{Request, StatusCode};
    use tower::ServiceExt;

    // Run with: cargo test -- --ignored

    async fn make_app() -> axum::Router {
        use crate::middleware::auth::{AppState, JwtKeys};
        use std::sync::Arc;

        let database_url =
            std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");
        let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".into());

        let pool = crate::db::pool::create_pool(&database_url)
            .await
            .expect("create_pool");
        let redis = redis::Client::open(redis_url).expect("redis client");

        let keys = crate::keys::generate_keys().expect("generate test keys");
        let jwt_keys =
            Arc::new(JwtKeys::new(&keys.jwt_private_pem, &keys.jwt_public_pem).expect("jwt keys"));

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
            backup_driver: "pg_dump".into(),
            backup_poll_interval_seconds: 60,
            restore_agent_url: "http://127.0.0.1:3002".into(),
            restore_agent_key_file: "/backups/.restore-agent-key".into(),
            recovery: crate::config::RecoveryConfig::default(),
            origin_bind: crate::config::OriginBindConfig::default(),
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: true,
            rivian_suppress_duplicate_telemetry: true,
            riviamigo_env: None,
            cookie_insecure: None,
            allow_insecure_lan_http_auth: false,
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
