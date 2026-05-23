use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_owned,
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new().route("/stats/summary", get(get_summary))
}

#[derive(Deserialize)]
struct Params {
    vehicle_id: Option<Uuid>,
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
    let rate = crate::db::users::get_electricity_rate(&state.pool, auth.user_id).await?;

    let trips = sqlx::query!(
        "SELECT COALESCE(SUM(distance_miles),0) AS total_miles,
                COUNT(*) AS total_trips,
                CASE WHEN SUM(distance_miles) > 0
                     THEN SUM(distance_miles * efficiency_wh_per_mile) / SUM(distance_miles)
                     ELSE NULL END AS lifetime_efficiency
         FROM riviamigo.trips WHERE vehicle_id=$1",
        vid
    )
    .fetch_one(&state.pool)
    .await?;

    let charging = sqlx::query!(
        "SELECT COALESCE(SUM(kwh_added),0) AS total_kwh, COUNT(*) AS sessions
         FROM riviamigo.charge_sessions WHERE vehicle_id=$1",
        vid
    )
    .fetch_one(&state.pool)
    .await?;

    let total_kwh = charging.total_kwh.unwrap_or(0.0);
    Ok(Json(serde_json::json!({
        "total_miles":                trips.total_miles,
        "total_trips":                trips.total_trips,
        "total_kwh_charged":          total_kwh,
        "lifetime_efficiency_wh_mi":  trips.lifetime_efficiency,
        "total_charging_sessions":    charging.sessions,
        "estimated_total_cost_usd":   total_kwh * rate,
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

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn stats_summary_requires_auth() {
        let req = Request::builder()
            .method("GET")
            .uri("/v1/stats/summary")
            .body(Body::empty())
            .unwrap();
        let app = make_app().await;
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}
