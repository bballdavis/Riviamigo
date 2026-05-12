use std::sync::Arc;
use std::time::Instant;

use axum::{
    body::{to_bytes, Body},
    http::{
        header::{AUTHORIZATION, CONTENT_TYPE, COOKIE, SET_COOKIE},
        HeaderMap, Method, Request, StatusCode,
    },
    Router,
};
use serde_json::{json, Value};
use sqlx::{Executor, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

use riviamigo_api::{
    config::Config,
    keys::bootstrap_keys,
    middleware::auth::{AppState, JwtKeys},
    routes,
};

struct TestResponse {
    status: StatusCode,
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

        let admin = PgPool::connect(&admin_db_url)
            .await
            .expect("admin db connect");
        admin
            .execute(format!("CREATE DATABASE \"{db_name}\"").as_str())
            .await
            .expect("create test database");

        let db_url = replace_database_name(&base_db_url, &db_name);
        let pool = PgPool::connect(&db_url).await.expect("db connect");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrate");

        let keys = bootstrap_keys(&pool, None, None, None)
            .await
            .expect("bootstrap keys");
        let jwt_keys =
            Arc::new(JwtKeys::new(&keys.jwt_private_pem, &keys.jwt_public_pem).expect("jwt keys"));

        let state = AppState {
            pool: pool.clone(),
            redis: redis::Client::open("redis://127.0.0.1:16379/").expect("redis client"),
            jwt_keys,
            age_key: keys.age_key,
            config: Config {
                database_url: db_url,
                redis_url: "redis://127.0.0.1:16379/".into(),
                jwt_secret: None,
                jwt_public_key: None,
                age_encryption_key: None,
                port: 0,
                allowed_origins: vec![],
                s3_endpoint: None,
                s3_access_key: None,
                s3_secret_key: None,
                backup_artifact_dir: std::env::temp_dir().join("riviamigo-auth-test-backups").to_string_lossy().into_owned(),
                backup_driver: "json".into(),
                backup_poll_interval_seconds: 60,
                rivian_ws_reconnect_initial_seconds: 10,
                rivian_ws_reconnect_max_seconds: 900,
                rivian_raw_event_retention_days: 7,
                rivian_persist_raw_events: true,
                rivian_suppress_duplicate_telemetry: true,
            },
            nominatim_next_call: Arc::new(tokio::sync::Mutex::new(Instant::now())),
            nominatim_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
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
        cookie: Option<&str>,
    ) -> TestResponse {
        let mut req = Request::builder().method(method).uri(path);
        if let Some(token) = bearer_token {
            req = req.header(AUTHORIZATION, format!("Bearer {token}"));
        }
        if let Some(cookie_value) = cookie {
            req = req.header(COOKIE, cookie_value);
        }

        let request = if let Some(json_body) = body {
            req.header(CONTENT_TYPE, "application/json")
                .body(Body::from(json_body.to_string()))
                .expect("request body")
        } else {
            req.body(Body::empty()).expect("empty request")
        };

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
            serde_json::from_slice(&bytes).expect("json body")
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
            None,
        )
        .await;

    response.body["access_token"]
        .as_str()
        .expect("access token")
        .to_string()
}

async fn insert_vehicle(pool: &PgPool, user_id: Uuid, rivian_vehicle_id: &str, name: &str) -> Uuid {
    sqlx::query_scalar!(
        "INSERT INTO riviamigo.vehicles (user_id, rivian_vehicle_id, model, name) VALUES ($1, $2, $3, $4) RETURNING id",
        user_id,
        rivian_vehicle_id,
        "R1T",
        name,
    )
    .fetch_one(pool)
    .await
    .expect("insert vehicle")
}

async fn set_default_vehicle(pool: &PgPool, user_id: Uuid, vehicle_id: Uuid) {
    sqlx::query!(
        "UPDATE riviamigo.users SET default_vehicle_id = $1 WHERE id = $2",
        vehicle_id,
        user_id,
    )
    .execute(pool)
    .await
    .expect("set default vehicle");
}

// ── Register ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn register_success_returns_access_token() {
    let app = TestApp::new().await;
    let res = app
        .request(
            Method::POST,
            "/v1/auth/register",
            Some(json!({"email": "alice@example.com", "password": "hunter2hunter2"})),
            None,
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::CREATED);
    assert!(res.body["access_token"].is_string());
    assert!(res.body["expires_in"].is_number());
}

#[tokio::test]
async fn register_auto_login_sets_refresh_cookie() {
    let app = TestApp::new().await;
    let res = app
        .request(
            Method::POST,
            "/v1/auth/register",
            Some(json!({"email": "bob@example.com", "password": "hunter2hunter2"})),
            None,
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::CREATED);
    let cookie_header = res
        .headers
        .get(SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    assert!(cookie_header.contains("refresh_token="));
}

#[tokio::test]
async fn register_duplicate_email_returns_validation_error() {
    let app = TestApp::new().await;
    let payload = json!({"email": "carol@example.com", "password": "hunter2hunter2"});

    let first = app
        .request(
            Method::POST,
            "/v1/auth/register",
            Some(payload.clone()),
            None,
            None,
        )
        .await;
    assert_eq!(first.status, StatusCode::CREATED);

    let second = app
        .request(Method::POST, "/v1/auth/register", Some(payload), None, None)
        .await;
    assert_eq!(second.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(second.body["error"]["message"], "email already registered");
}

#[tokio::test]
async fn register_short_password_returns_validation_error() {
    let app = TestApp::new().await;
    let res = app
        .request(
            Method::POST,
            "/v1/auth/register",
            Some(json!({"email": "dave@example.com", "password": "short"})),
            None,
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(res.body["error"]["message"].is_string());
}

#[tokio::test]
async fn register_empty_email_returns_validation_error() {
    let app = TestApp::new().await;
    let res = app
        .request(
            Method::POST,
            "/v1/auth/register",
            Some(json!({"email": "", "password": "hunter2hunter2"})),
            None,
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::UNPROCESSABLE_ENTITY);
}

// ── Login ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn login_success_returns_access_token() {
    let app = TestApp::new().await;
    let creds = json!({"email": "eve@example.com", "password": "securepassword"});

    let reg = app
        .request(
            Method::POST,
            "/v1/auth/register",
            Some(creds.clone()),
            None,
            None,
        )
        .await;
    assert_eq!(reg.status, StatusCode::CREATED);

    let login = app
        .request(Method::POST, "/v1/auth/login", Some(creds), None, None)
        .await;
    assert_eq!(login.status, StatusCode::OK);
    assert!(login.body["access_token"].is_string());
    assert!(login.body["expires_in"].is_number());
}

#[tokio::test]
async fn login_wrong_password_returns_401() {
    let app = TestApp::new().await;
    app.request(
        Method::POST,
        "/v1/auth/register",
        Some(json!({"email": "frank@example.com", "password": "correctpassword"})),
        None,
        None,
    )
    .await;

    let res = app
        .request(
            Method::POST,
            "/v1/auth/login",
            Some(json!({"email": "frank@example.com", "password": "wrongpassword"})),
            None,
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_unknown_email_returns_401() {
    let app = TestApp::new().await;
    let res = app
        .request(
            Method::POST,
            "/v1/auth/login",
            Some(json!({"email": "ghost@example.com", "password": "doesnotmatter"})),
            None,
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_email_is_case_insensitive() {
    let app = TestApp::new().await;
    app.request(
        Method::POST,
        "/v1/auth/register",
        Some(json!({"email": "Grace@Example.COM", "password": "mypassword123"})),
        None,
        None,
    )
    .await;

    let res = app
        .request(
            Method::POST,
            "/v1/auth/login",
            Some(json!({"email": "grace@example.com", "password": "mypassword123"})),
            None,
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::OK);
}

// ── /auth/me ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn me_returns_user_info_with_valid_token() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "henry@example.com").await;

    let res = app
        .request(Method::GET, "/v1/auth/me", None, Some(&token), None)
        .await;

    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.body["email"], "henry@example.com");
}

#[tokio::test]
async fn me_returns_401_without_token() {
    let app = TestApp::new().await;
    let res = app
        .request(Method::GET, "/v1/auth/me", None, None, None)
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
}

// ── Logout + Refresh ──────────────────────────────────────────────────────────

#[tokio::test]
async fn refresh_returns_access_token_when_refresh_cookie_is_present() {
    let app = TestApp::new().await;
    let register = app
        .request(
            Method::POST,
            "/v1/auth/register",
            Some(json!({"email": "jane@example.com", "password": "hunter2hunter2"})),
            None,
            None,
        )
        .await;
    let refresh_cookie = register
        .headers
        .get(SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .expect("refresh cookie")
        .split(';')
        .next()
        .expect("cookie pair")
        .to_string();

    let refresh = app
        .request(
            Method::POST,
            "/v1/auth/refresh",
            None,
            None,
            Some(&refresh_cookie),
        )
        .await;

    assert_eq!(refresh.status, StatusCode::OK);
    assert!(refresh.body["access_token"].is_string());
}

#[tokio::test]
async fn logout_clears_cookie() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "iris@example.com").await;

    let res = app
        .request(Method::POST, "/v1/auth/logout", None, Some(&token), None)
        .await;

    assert_eq!(res.status, StatusCode::NO_CONTENT);
    let cookie = res
        .headers
        .get(SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    assert!(cookie.contains("Max-Age=0"));
}

// ── Error body shape ──────────────────────────────────────────────────────────

#[tokio::test]
async fn error_responses_have_nested_error_field() {
    let app = TestApp::new().await;
    let res = app
        .request(
            Method::POST,
            "/v1/auth/login",
            Some(json!({"email": "nobody@example.com", "password": "whatever"})),
            None,
            None,
        )
        .await;

    assert!(res.body["error"].is_object());
    assert!(res.body["error"]["code"].is_string());
    assert!(res.body["error"]["message"].is_string());
}

#[tokio::test]
async fn vehicles_returns_empty_list_for_new_user() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "vehicles-empty@example.com").await;

    let res = app
        .request(Method::GET, "/v1/vehicles", None, Some(&token), None)
        .await;

    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.body["vehicles"], json!([]));
}

#[tokio::test]
async fn vehicles_only_returns_current_users_vehicles() {
    let app = TestApp::new().await;
    let owner_token = register_and_login(&app, "owner@example.com").await;
    let owner_id: uuid::Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "owner@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("owner id");
    let other_id: uuid::Uuid = sqlx::query_scalar!(
        "INSERT INTO riviamigo.users (email, password_hash) VALUES ($1, $2) RETURNING id",
        "other@example.com",
        "hash"
    )
    .fetch_one(&app.pool)
    .await
    .expect("other user");

    insert_vehicle(&app.pool, owner_id, "owner-vehicle", "Owner Truck").await;
    insert_vehicle(&app.pool, other_id, "other-vehicle", "Other Truck").await;

    let res = app
        .request(Method::GET, "/v1/vehicles", None, Some(&owner_token), None)
        .await;

    assert_eq!(res.status, StatusCode::OK);
    let vehicles = res.body["vehicles"].as_array().expect("vehicles array");
    assert_eq!(vehicles.len(), 1);
    assert_eq!(vehicles[0]["rivian_vehicle_id"], "owner-vehicle");
    assert_eq!(vehicles[0]["display_name"], "Owner Truck");
}

#[tokio::test]
async fn stats_summary_requires_vehicle_id() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "stats-missing@example.com").await;

    let res = app
        .request(Method::GET, "/v1/stats/summary", None, Some(&token), None)
        .await;

    assert_eq!(res.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(res.body["error"]["message"], "vehicle_id required");
}

#[tokio::test]
async fn stats_summary_rejects_unowned_vehicle() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "stats-owner@example.com").await;
    let outsider_id: uuid::Uuid = sqlx::query_scalar!(
        "INSERT INTO riviamigo.users (email, password_hash) VALUES ($1, $2) RETURNING id",
        "outsider@example.com",
        "hash"
    )
    .fetch_one(&app.pool)
    .await
    .expect("outsider id");
    let vehicle_id =
        insert_vehicle(&app.pool, outsider_id, "outsider-vehicle", "Outsider Truck").await;

    let res = app
        .request(
            Method::GET,
            &format!("/v1/stats/summary?vehicle_id={vehicle_id}"),
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn stats_summary_returns_aggregated_trip_and_charge_values() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "stats-happy@example.com").await;
    let user_id: uuid::Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "stats-happy@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("user id");
    let vehicle_id = insert_vehicle(&app.pool, user_id, "happy-vehicle", "Happy Truck").await;
    set_default_vehicle(&app.pool, user_id, vehicle_id).await;

    sqlx::query!(
        "INSERT INTO riviamigo.trips (vehicle_id, started_at, ended_at, distance_miles, duration_seconds, efficiency_wh_per_mile) VALUES ($1, now() - interval '2 day', now() - interval '2 day' + interval '1 hour', $2, $3, $4)",
        vehicle_id,
        10.0_f64,
        3600_i32,
        300.0_f64,
    )
    .execute(&app.pool)
    .await
    .expect("trip one");
    sqlx::query!(
        "INSERT INTO riviamigo.trips (vehicle_id, started_at, ended_at, distance_miles, duration_seconds, efficiency_wh_per_mile) VALUES ($1, now() - interval '1 day', now() - interval '1 day' + interval '30 minutes', $2, $3, $4)",
        vehicle_id,
        20.0_f64,
        1800_i32,
        450.0_f64,
    )
    .execute(&app.pool)
    .await
    .expect("trip two");
    sqlx::query!(
        "INSERT INTO riviamigo.charge_sessions (vehicle_id, started_at, ended_at, kwh_added, duration_minutes, cost_usd) VALUES ($1, now() - interval '1 day', now(), $2, $3, $4)",
        vehicle_id,
        40.0_f64,
        45_i32,
        5.2_f64,
    )
    .execute(&app.pool)
    .await
    .expect("charge session");

    let res = app
        .request(
            Method::GET,
            &format!("/v1/stats/summary?vehicle_id={vehicle_id}"),
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.body["total_miles"], json!(30.0));
    assert_eq!(res.body["total_trips"], json!(2));
    assert_eq!(res.body["total_kwh_charged"], json!(40.0));
    assert_eq!(res.body["total_charging_sessions"], json!(1));
    assert_eq!(res.body["lifetime_efficiency_wh_mi"], json!(400.0));
    assert_eq!(res.body["estimated_total_cost_usd"], json!(5.2));
}
