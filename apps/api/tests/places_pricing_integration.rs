//! Saved-place pricing must reach charging history: creating, editing, or
//! deleting a place re-links past automatically located sessions and
//! recomputes their cost. Needs the local TimescaleDB and Redis.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use axum::{
    body::{to_bytes, Body},
    extract::ConnectInfo,
    http::{
        header::{AUTHORIZATION, CONTENT_TYPE},
        HeaderMap, Method, Request, StatusCode,
    },
    Router,
};
use riviamigo_api::{
    config::Config,
    ingestion::supervisor::SupervisorHandle,
    keys::bootstrap_keys,
    middleware::auth::{AppState, JwtKeys},
    routes,
};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, Executor, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

struct TestResponse {
    status: StatusCode,
    #[allow(dead_code)]
    headers: HeaderMap,
    body: Value,
}

struct TestApp {
    router: Router,
    pool: PgPool,
}

impl TestApp {
    async fn new() -> Self {
        let base_db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgresql://riviamigo:devpassword@127.0.0.1:5432/riviamigo".into()
        });
        let admin_db_url = replace_database_name(&base_db_url, "postgres");
        let db_name = format!("riviamigo_test_{}", Uuid::new_v4().simple());

        let admin = PgPoolOptions::new()
            .max_connections(1)
            .connect(&admin_db_url)
            .await
            .expect("admin db connect");
        admin
            .execute(sqlx::AssertSqlSafe(format!(
                "CREATE DATABASE \"{db_name}\""
            )))
            .await
            .expect("create test database");

        let db_url = replace_database_name(&base_db_url, &db_name);
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&db_url)
            .await
            .expect("db connect");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrate schema");

        let keys = bootstrap_keys(&pool, None, None, None)
            .await
            .expect("bootstrap keys");
        let jwt_keys =
            Arc::new(JwtKeys::new(&keys.jwt_private_pem, &keys.jwt_public_pem).expect("jwt keys"));

        let state = AppState {
            pool: pool.clone(),
            redis: redis::Client::open("redis://127.0.0.1:6379/").expect("redis client"),
            jwt_keys,
            age_key: keys.age_key,
            config: Config {
                database_url: db_url,
                redis_url: "redis://127.0.0.1:6379/".into(),
                jwt_secret: None,
                jwt_public_key: None,
                age_encryption_key: None,
                port: 0,
                allowed_origins: vec![],
                s3_endpoint: None,
                s3_access_key: None,
                s3_secret_key: None,
                backup_artifact_dir: std::env::temp_dir()
                    .join("riviamigo-places-pricing-test-backups")
                    .to_string_lossy()
                    .into_owned(),
                backup_driver: "pg_dump".into(),
                backup_poll_interval_seconds: 60,
                restore_agent_url: "http://127.0.0.1:3002".into(),
                restore_agent_key_file: "/backups/.restore-agent-key".into(),
                recovery: riviamigo_api::config::RecoveryConfig::default(),
                origin_bind: riviamigo_api::config::OriginBindConfig::default(),
                security: Default::default(),
                rivian_ws_reconnect_initial_seconds: 10,
                rivian_ws_reconnect_max_seconds: 900,
                rivian_raw_event_retention_days: 7,
                rivian_persist_raw_events: true,
                rivian_suppress_duplicate_telemetry: true,
                riviamigo_env: None,
                cookie_insecure: None,
                allow_insecure_lan_http_auth: false,
                rate_limit: Default::default(),
                vehicle_image_cache_dir: std::env::temp_dir()
                    .join("riviamigo-places-pricing-test-images")
                    .to_string_lossy()
                    .into_owned(),
            },
            nominatim_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
            supervisor: SupervisorHandle::noop(),
            resources: Default::default(),
        };

        Self {
            router: routes::build_router(state),
            pool,
        }
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        bearer_token: Option<&str>,
    ) -> TestResponse {
        let mut req = Request::builder().method(method).uri(path);
        if let Some(token) = bearer_token {
            req = req.header(AUTHORIZATION, format!("Bearer {token}"));
        }

        let mut request = if let Some(json_body) = body {
            req.header(CONTENT_TYPE, "application/json")
                .body(Body::from(json_body.to_string()))
                .expect("request body")
        } else {
            req.body(Body::empty()).expect("empty request")
        };
        request.extensions_mut().insert(ConnectInfo(SocketAddr::new(
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            12345,
        )));

        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("router response");

        let status = response.status();
        let headers = response.headers().clone();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body bytes");
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes).to_string() }))
        };

        TestResponse {
            status,
            headers,
            body,
        }
    }
}

fn replace_database_name(database_url: &str, database_name: &str) -> String {
    let (prefix, _) = database_url
        .rsplit_once('/')
        .expect("database url with db name");
    format!("{prefix}/{database_name}")
}

async fn register_and_login(app: &TestApp, email: &str) -> String {
    let response = app
        .request(
            Method::POST,
            "/v1/auth/register",
            Some(json!({"email": email, "password": "hunter2hunter2"})),
            None,
        )
        .await;

    assert!(
        response.status == StatusCode::OK || response.status == StatusCode::CREATED,
        "register failed: status={} body={}",
        response.status,
        response.body
    );

    response.body["access_token"]
        .as_str()
        .expect("access token")
        .to_string()
}

async fn insert_vehicle(pool: &PgPool, user_id: Uuid, rivian_vehicle_id: &str, name: &str) -> Uuid {
    let vehicle_id: Uuid = sqlx::query_scalar(
        "INSERT INTO riviamigo.vehicles (user_id, rivian_vehicle_id, model, name)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
    )
    .bind(user_id)
    .bind(rivian_vehicle_id)
    .bind("R1T")
    .bind(name)
    .fetch_one(pool)
    .await
    .expect("insert vehicle");

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
         VALUES ($1, $2, 'owner', TRUE)
         ON CONFLICT (vehicle_id, user_id) DO UPDATE
         SET role = EXCLUDED.role,
             is_default = EXCLUDED.is_default,
             updated_at = now()",
    )
    .bind(vehicle_id)
    .bind(user_id)
    .execute(pool)
    .await
    .expect("insert vehicle membership");

    sqlx::query("UPDATE riviamigo.users SET default_vehicle_id = $1 WHERE id = $2")
        .bind(vehicle_id)
        .bind(user_id)
        .execute(pool)
        .await
        .expect("set default vehicle");

    vehicle_id
}

async fn lookup_user_id(pool: &PgPool, email: &str) -> Uuid {
    sqlx::query_scalar("SELECT id FROM riviamigo.users WHERE email = $1")
        .bind(email)
        .fetch_one(pool)
        .await
        .expect("user id")
}

const HOME_LAT: f64 = 37.4419;
const HOME_LNG: f64 = -122.1430;

async fn insert_session(
    pool: &PgPool,
    vehicle_id: Uuid,
    started_at: &str,
    lat: f64,
    lng: f64,
    cost_override: Option<f64>,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO riviamigo.charge_sessions
           (vehicle_id, started_at, ended_at, source, kwh_added, duration_minutes,
            location_lat, location_lng, source_location_lat, source_location_lng,
            cost_override_mode, cost_override_usd)
           VALUES ($1, $2::timestamptz, $2::timestamptz + interval '3 hours', 'telemetry', 50.0, 180,
                   $3, $4, $3, $4,
                   CASE WHEN $5::float8 IS NULL THEN 'automatic' ELSE 'manual' END, $5)
           RETURNING id"#,
    )
    .bind(vehicle_id)
    .bind(started_at)
    .bind(lat)
    .bind(lng)
    .bind(cost_override)
    .fetch_one(pool)
    .await
    .expect("insert charge session")
}

async fn session_cost(
    pool: &PgPool,
    id: Uuid,
) -> (Option<Uuid>, Option<Uuid>, Option<f64>, Option<String>) {
    sqlx::query_as(
        "SELECT geofence_id, cost_profile_id, cost_usd, cost_method
           FROM riviamigo.charge_sessions WHERE id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .expect("session cost")
}

fn place_body(rate: f64, radius_m: f64) -> Value {
    json!({
        "name": "Home",
        "radius_m": radius_m,
        "is_home": true,
        "address": { "display_name": "1 Home St", "latitude": HOME_LAT, "longitude": HOME_LNG },
        "charging": { "billing_type": "flat", "rate": rate }
    })
}

fn assert_cost(actual: Option<f64>, expected: f64) {
    let actual = actual.expect("cost computed");
    assert!(
        (actual - expected).abs() < 1e-6,
        "cost {actual} != {expected}"
    );
}

#[tokio::test]
async fn place_price_applies_to_charging_history() {
    let app = TestApp::new().await;
    let email = "places-pricing@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    let vehicle_id = insert_vehicle(&app.pool, user_id, "rivian-places-pricing", "Truck").await;

    // Recompute stores whichever profile it resolved, so an old session can
    // carry a stale pinned profile that must not outrank the new place.
    let stale_profile: Uuid = sqlx::query_scalar(
        "INSERT INTO riviamigo.cost_profiles (user_id, name, billing_type, rate)
         VALUES ($1, 'Old default', 'per_kwh', 0.05) RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&app.pool)
    .await
    .expect("stale profile");

    let at_home = insert_session(
        &app.pool,
        vehicle_id,
        "2026-08-01T02:00:00Z",
        HOME_LAT,
        HOME_LNG,
        None,
    )
    .await;
    sqlx::query("UPDATE riviamigo.charge_sessions SET cost_profile_id = $1 WHERE id = $2")
        .bind(stale_profile)
        .bind(at_home)
        .execute(&app.pool)
        .await
        .expect("pin stale profile");
    let manual = insert_session(
        &app.pool,
        vehicle_id,
        "2026-08-02T02:00:00Z",
        HOME_LAT,
        HOME_LNG,
        Some(4.0),
    )
    .await;
    let elsewhere = insert_session(
        &app.pool,
        vehicle_id,
        "2026-08-03T02:00:00Z",
        37.7749,
        -122.4194,
        None,
    )
    .await;

    // Creating the place prices sessions that happened before it existed.
    let created = app
        .request(
            Method::POST,
            "/v1/places",
            Some(place_body(0.20, 100.0)),
            Some(&token),
        )
        .await;
    assert_eq!(
        created.status,
        StatusCode::OK,
        "create place: {}",
        created.body
    );
    let place_id: Uuid = created.body["id"]
        .as_str()
        .expect("place id")
        .parse()
        .expect("uuid");
    let place_profile: Uuid =
        sqlx::query_scalar("SELECT cost_profile_id FROM riviamigo.geofences WHERE id = $1")
            .bind(place_id)
            .fetch_one(&app.pool)
            .await
            .expect("place profile");

    let (geofence, profile, cost, method) = session_cost(&app.pool, at_home).await;
    assert_eq!(geofence, Some(place_id));
    assert_eq!(profile, Some(place_profile));
    assert_eq!(method.as_deref(), Some("profile"));
    assert_cost(cost, 10.0);
    let is_home: Option<bool> =
        sqlx::query_scalar("SELECT is_home FROM riviamigo.charge_sessions WHERE id = $1")
            .bind(at_home)
            .fetch_one(&app.pool)
            .await
            .expect("is_home");
    assert_eq!(is_home, Some(true));

    // A manual cost override keeps precedence; a far-away session is untouched.
    let (_, _, manual_cost, manual_method) = session_cost(&app.pool, manual).await;
    assert_eq!(manual_method.as_deref(), Some("user_manual"));
    assert_cost(manual_cost, 4.0);
    let (elsewhere_geofence, _, elsewhere_cost, _) = session_cost(&app.pool, elsewhere).await;
    assert_eq!(elsewhere_geofence, None);
    assert_eq!(elsewhere_cost, None);

    // Editing the rate reprices history.
    let updated = app
        .request(
            Method::PUT,
            &format!("/v1/places/{place_id}"),
            Some(place_body(0.30, 100.0)),
            Some(&token),
        )
        .await;
    assert_eq!(
        updated.status,
        StatusCode::OK,
        "update place: {}",
        updated.body
    );
    assert_cost(session_cost(&app.pool, at_home).await.2, 15.0);

    // Editing the profile directly through the cost-profile API reprices too.
    let profile_update = app
        .request(
            Method::PUT,
            &format!("/v1/cost-profiles/{place_profile}"),
            Some(json!({ "rate": 0.40 })),
            Some(&token),
        )
        .await;
    assert_eq!(
        profile_update.status,
        StatusCode::OK,
        "update profile: {}",
        profile_update.body
    );
    assert_cost(session_cost(&app.pool, at_home).await.2, 20.0);

    // Deleting a place with linked sessions succeeds and unprices them.
    let deleted = app
        .request(
            Method::DELETE,
            &format!("/v1/places/{place_id}"),
            None,
            Some(&token),
        )
        .await;
    assert_eq!(
        deleted.status,
        StatusCode::OK,
        "delete place: {}",
        deleted.body
    );
    let (geofence, profile, cost, method) = session_cost(&app.pool, at_home).await;
    assert_eq!(geofence, None);
    assert_eq!(profile, None);
    assert_eq!(cost, None);
    assert_eq!(method.as_deref(), Some("unknown"));
}

#[tokio::test]
async fn shrinking_a_place_releases_sessions_outside_its_radius() {
    let app = TestApp::new().await;
    let email = "places-radius@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    let vehicle_id = insert_vehicle(&app.pool, user_id, "rivian-places-radius", "Truck").await;

    // Roughly 250 m north of the place center.
    let edge = insert_session(
        &app.pool,
        vehicle_id,
        "2026-08-01T02:00:00Z",
        HOME_LAT + 0.00225,
        HOME_LNG,
        None,
    )
    .await;

    let created = app
        .request(
            Method::POST,
            "/v1/places",
            Some(place_body(0.20, 400.0)),
            Some(&token),
        )
        .await;
    assert_eq!(
        created.status,
        StatusCode::OK,
        "create place: {}",
        created.body
    );
    let place_id: Uuid = created.body["id"]
        .as_str()
        .expect("place id")
        .parse()
        .expect("uuid");
    assert_eq!(session_cost(&app.pool, edge).await.0, Some(place_id));

    let updated = app
        .request(
            Method::PUT,
            &format!("/v1/places/{place_id}"),
            Some(place_body(0.20, 100.0)),
            Some(&token),
        )
        .await;
    assert_eq!(
        updated.status,
        StatusCode::OK,
        "update place: {}",
        updated.body
    );
    let (geofence, _, cost, _) = session_cost(&app.pool, edge).await;
    assert_eq!(geofence, None);
    assert_eq!(cost, None);
}
