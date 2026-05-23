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
        .route("/charging/sessions", get(list_sessions))
        .route("/charging/sessions/:id", get(get_session))
        .route("/charging/summary", get(get_summary))
}

#[derive(Deserialize)]
struct SessionListParams {
    vehicle_id: Option<Uuid>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize)]
struct VehicleParam {
    vehicle_id: Option<Uuid>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct SessionRow {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    location_lat: Option<f64>,
    location_lng: Option<f64>,
    is_home: Option<bool>,
    charger_type: Option<String>,
    kwh_added: Option<f64>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
    max_charge_rate_kw: Option<f64>,
    duration_minutes: Option<i32>,
    cost_usd: Option<f64>,
}

async fn list_sessions(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<SessionListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(90));
    let to = p.to.unwrap_or_else(Utc::now);
    let limit = p.limit.unwrap_or(50).min(200);
    let offset = p.offset.unwrap_or(0);

    // Compute cost per session using user's electricity rate
    let rate = crate::db::users::get_electricity_rate(&state.pool, auth.user_id).await?;

    let rows = sqlx::query_as!(
        SessionRow,
        "SELECT id, started_at, ended_at, location_lat, location_lng, is_home, charger_type, \
                kwh_added, soc_start, soc_end, max_charge_rate_kw, duration_minutes, \
                CASE WHEN kwh_added IS NOT NULL THEN kwh_added * $6 ELSE cost_usd END AS cost_usd \
         FROM riviamigo.charge_sessions \
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3 \
         ORDER BY started_at DESC LIMIT $4 OFFSET $5",
        vid,
        from,
        to,
        limit,
        offset,
        rate
    )
    .fetch_all(&state.pool)
    .await?;

    let total: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3",
        vid, from, to
    ).fetch_one(&state.pool).await?.unwrap_or(0);

    Ok(Json(
        serde_json::json!({"data": rows, "total": total, "limit": limit, "offset": offset}),
    ))
}

async fn get_session(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let session = sqlx::query_as!(
        SessionRow,
        "SELECT id, started_at, ended_at, location_lat, location_lng, is_home, charger_type, \
                kwh_added, soc_start, soc_end, max_charge_rate_kw, duration_minutes, cost_usd \
         FROM riviamigo.charge_sessions WHERE id=$1 AND vehicle_id=$2",
        id,
        vid
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    // Charge curve
    let curve = if let (Some(start), Some(end)) = (Some(session.started_at), session.ended_at) {
        sqlx::query!(
            r#"WITH samples AS (
                SELECT bucket,
                       avg_soc,
                       max(battery_capacity_wh) OVER () AS cap_wh
                FROM timeseries.telemetry_1min
                WHERE vehicle_id=$1 AND bucket>=$2 AND bucket<=$3
               )
               SELECT EXTRACT(EPOCH FROM (bucket - $2))::float8 / 60.0 AS minutes_elapsed,
                      GREATEST(0.0,
                        60.0 * (avg_soc - LAG(avg_soc) OVER (ORDER BY bucket)) / 100.0
                             * cap_wh / 1000.0
                      ) AS charge_rate_kw,
                      avg_soc AS soc
               FROM samples
               WHERE avg_soc IS NOT NULL
               ORDER BY bucket"#,
            vid,
            start,
            end
        )
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| {
            Some(serde_json::json!({
                "minutes_elapsed": r.minutes_elapsed,
                "charge_rate_kw":  r.charge_rate_kw,
                "soc":             r.soc,
            }))
        })
        .collect::<Vec<_>>()
    } else {
        vec![]
    };

    Ok(Json(serde_json::json!({
        "session": session,
        "curve":   curve,
    })))
}

async fn get_summary(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<SessionListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(365));
    let to = p.to.unwrap_or_else(Utc::now);
    let rate = crate::db::users::get_electricity_rate(&state.pool, auth.user_id).await?;


    let agg = sqlx::query!(

        "SELECT COALESCE(SUM(kwh_added),0) AS total_kwh,
                COUNT(*) AS session_count,
                COALESCE(SUM(CASE WHEN is_home THEN kwh_added ELSE 0 END),0) AS home_kwh,
                COALESCE(SUM(CASE WHEN NOT COALESCE(is_home,false) THEN kwh_added ELSE 0 END),0) AS away_kwh,
                COALESCE(SUM(CASE WHEN charger_type='AC'   THEN kwh_added ELSE 0 END),0) AS ac_kwh,
                COALESCE(SUM(CASE WHEN charger_type='DC'   THEN kwh_added ELSE 0 END),0) AS dc_kwh,
                COALESCE(SUM(CASE WHEN charger_type='DCFC' THEN kwh_added ELSE 0 END),0) AS dcfc_kwh
         FROM riviamigo.charge_sessions
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3",
        vid, from, to
    ).fetch_one(&state.pool).await?;

    let weekly = sqlx::query!(
        "SELECT date_trunc('week', started_at) AS week_start,
                COALESCE(SUM(kwh_added),0) AS kwh,
                COUNT(*) AS sessions
         FROM riviamigo.charge_sessions
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
         GROUP BY 1 ORDER BY 1",
        vid,
        from,
        to
    )
    .fetch_all(&state.pool)
    .await?;

    let total_kwh = agg.total_kwh.unwrap_or(0.0);
    Ok(Json(serde_json::json!({
        "total_kwh":       total_kwh,
        "total_cost_usd":  total_kwh * rate,
        "session_count":   agg.session_count,
        "home_kwh":        agg.home_kwh,
        "away_kwh":        agg.away_kwh,
        "by_type": {
            "ac_kwh":   agg.ac_kwh,
            "dc_kwh":   agg.dc_kwh,
            "dcfc_kwh": agg.dcfc_kwh,
        },
        "weekly": weekly.iter().map(|r| serde_json::json!({
            "week_start": r.week_start,
            "kwh":        r.kwh,
            "sessions":   r.sessions,
        })).collect::<Vec<_>>(),
    })))
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

    async fn get_unauthenticated(app: axum::Router, uri: &str) -> http::StatusCode {
        let req = Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        app.oneshot(req).await.unwrap().status()
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn list_sessions_requires_auth() {
        let app = make_app().await;
        let status = get_unauthenticated(app, "/v1/charging/sessions").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn session_detail_requires_auth() {
        let app = make_app().await;
        let status = get_unauthenticated(
            app,
            &format!("/v1/charging/sessions/{}", uuid::Uuid::new_v4()),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn charging_summary_requires_auth() {
        let app = make_app().await;
        let status = get_unauthenticated(app, "/v1/charging/summary").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn session_detail_invalid_uuid() {
        // Without auth header, 401 takes precedence over UUID parse error.
        // This documents the auth-first ordering in the middleware stack.
        let app = make_app().await;
        let status = get_unauthenticated(app, "/v1/charging/sessions/not-a-uuid").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}
