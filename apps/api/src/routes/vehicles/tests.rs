//! Route tests for the vehicle API, split by topic. This root module holds the
//! imports and HTTP fixtures shared by the topic modules, which pull them in
//! with `use super::*`.

mod artwork_cache;
mod artwork_urls;
mod availability_tests;
mod connect;
mod freshness_tests;
mod range_tests;
mod telemetry;
mod vehicle_records;

use axum::{body::Body, extract::State, Json};
use http::{Request, StatusCode};
use tower::ServiceExt;
use uuid::Uuid;

use super::{
    canonical_battery_config, canonical_vehicle_model, canonical_vehicle_name, capture_export_body,
    connect_otp, fetch_vehicle_image_rows, is_demo_vehicle_key, list_vehicles,
    load_encrypted_redis, map_rivian_login_error, map_rivian_otp_error, mirror_file_path,
    parse_raw_fields, parse_telemetry_lanes, raw_field_coverage_query, raw_telemetry_where_clause,
    refresh_vehicle_vin, resolve_telemetry_resolution, resolved_image_url, store_encrypted_redis,
    store_vehicle_image_manifest, try_claim_vehicle_artwork_repair, validate_raw_time_bounds,
    vehicle_data_ready, write_vehicle_artwork_cache_state, ArtworkCacheStateUpdate, OtpBody,
    PendingOtpChallenge, ARTWORK_NO_PROVIDER_ARTWORK_ERROR, ARTWORK_REPAIR_FAILED_ERROR,
    RAW_TELEMETRY_FIELDS, TELEMETRY_LANES_QUERY,
};

// Run with: cargo test -- --ignored

fn make_helper_state(redis_url: String) -> crate::middleware::auth::AppState {
    use std::sync::Arc;

    use crate::middleware::auth::{AppState, JwtKeys};

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy("postgresql://riviamigo:devpassword@127.0.0.1:5432/riviamigo")
        .expect("lazy pool");
    let redis = redis::Client::open(redis_url.clone()).expect("redis client");

    let generated = crate::keys::generate_keys().expect("keys");
    let jwt_keys = Arc::new(
        JwtKeys::new(&generated.jwt_private_pem, &generated.jwt_public_pem).expect("jwt keys"),
    );

    let config = crate::config::Config {
        database_url: "postgresql://riviamigo:devpassword@127.0.0.1:5432/riviamigo".into(),
        redis_url,
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
        security: Default::default(),
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

    AppState {
        pool,
        redis,
        jwt_keys,
        age_key: generated.age_key,
        config,
        nominatim_cache: std::sync::Arc::new(tokio::sync::RwLock::new(
            std::collections::HashMap::new(),
        )),
        supervisor: crate::ingestion::supervisor::SupervisorHandle::noop(),
        resources: Default::default(),
    }
}

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
        security: Default::default(),
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
        resources: Default::default(),
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

async fn post_status(app: axum::Router, uri: &str, body: serde_json::Value) -> http::StatusCode {
    let req = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    app.oneshot(req).await.unwrap().status()
}
