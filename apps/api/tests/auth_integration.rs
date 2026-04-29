/// Integration tests for auth routes.
///
/// Requires Docker for the PostgreSQL testcontainer.
/// Redis is not needed for auth routes; a dummy URL is used.
use std::sync::{Arc, OnceLock};

use axum_test::TestServer;
use serde_json::{json, Value};
use sqlx::PgPool;
use testcontainers::{clients::Cli, Container};
use testcontainers_modules::postgres::Postgres;

use riviamigo_api::{
    config::Config,
    keys::generate_keys,
    middleware::auth::{AppState, JwtKeys},
    routes,
};

// ── Docker client (static so containers get 'static lifetime) ─────────────────

fn docker() -> &'static Cli {
    static DOCKER: OnceLock<Cli> = OnceLock::new();
    DOCKER.get_or_init(Cli::default)
}

// ── Test app builder ──────────────────────────────────────────────────────────

struct TestApp {
    pub server: TestServer,
    pub pool: PgPool,
    // Kept alive to prevent the container from stopping.
    _db: Container<'static, Postgres>,
}

impl TestApp {
    async fn new() -> Self {
        let postgres = docker().run(Postgres::default());
        let port = postgres.get_host_port_ipv4(5432);
        let db_url = format!("postgres://postgres:postgres@127.0.0.1:{}/postgres", port);

        let pool = PgPool::connect(&db_url).await.expect("db connect");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrate");

        let keys = generate_keys().expect("generate_keys");
        let jwt_keys = Arc::new(JwtKeys::new(&keys.jwt_private_pem, &keys.jwt_public_pem).unwrap());

        // Auth routes do not use Redis; point to a dummy address.
        let redis = redis::Client::open("redis://127.0.0.1:16379/").unwrap();

        let config = Config {
            database_url: db_url.clone(),
            redis_url: "redis://127.0.0.1:16379/".into(),
            jwt_secret: None,
            jwt_public_key: None,
            age_encryption_key: None,
            port: 0,
            allowed_origins: vec![],
            s3_endpoint: None,
            s3_access_key: None,
            s3_secret_key: None,
        };

        let state = AppState {
            pool,
            redis,
            jwt_keys,
            age_key: keys.age_key,
            config,
        };
        let app = routes::build_router(state);
        let server = TestServer::new(app).expect("test server");

        TestApp {
            server,
            pool,
            _db: postgres,
        }
    }
}

async fn register_and_login(app: &TestApp, email: &str) -> String {
    let res: Value = app
        .server
        .post("/v1/auth/register")
        .json(&json!({"email": email, "password": "hunter2hunter2"}))
        .await
        .json();

    res["access_token"]
        .as_str()
        .expect("access token")
        .to_string()
}

async fn insert_vehicle(pool: &PgPool, user_id: uuid::Uuid, rivian_vehicle_id: &str, name: &str) -> uuid::Uuid {
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

async fn set_default_vehicle(pool: &PgPool, user_id: uuid::Uuid, vehicle_id: uuid::Uuid) {
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
        .server
        .post("/auth/register")
        .json(&json!({"email": "alice@example.com", "password": "hunter2hunter2"}))
        .await;

    assert_eq!(res.status_code(), 201);
    let body: Value = res.json();
    assert!(
        body["access_token"].is_string(),
        "access_token missing: {body}"
    );
    assert!(body["expires_in"].is_number());
}

#[tokio::test]
async fn register_auto_login_sets_refresh_cookie() {
    let app = TestApp::new().await;
    let res = app
        .server
        .post("/auth/register")
        .json(&json!({"email": "bob@example.com", "password": "hunter2hunter2"}))
        .await;

    assert_eq!(res.status_code(), 201);
    let cookie_header = res.header("Set-Cookie");
    assert!(
        cookie_header
            .to_str()
            .unwrap_or("")
            .contains("refresh_token="),
        "no refresh cookie in Set-Cookie: {cookie_header:?}"
    );
}

#[tokio::test]
async fn register_duplicate_email_returns_validation_error() {
    let app = TestApp::new().await;
    let payload = json!({"email": "carol@example.com", "password": "hunter2hunter2"});

    let first = app.server.post("/auth/register").json(&payload).await;
    assert_eq!(first.status_code(), 201);

    let second = app.server.post("/auth/register").json(&payload).await;
    assert_eq!(second.status_code(), 422);

    let body: Value = second.json();
    assert_eq!(body["error"]["message"], "email already registered");
}

#[tokio::test]
async fn register_short_password_returns_validation_error() {
    let app = TestApp::new().await;
    let res = app
        .server
        .post("/auth/register")
        .json(&json!({"email": "dave@example.com", "password": "short"}))
        .await;

    assert_eq!(res.status_code(), 422);
    let body: Value = res.json();
    assert!(body["error"]["message"].is_string());
}

#[tokio::test]
async fn register_empty_email_returns_validation_error() {
    let app = TestApp::new().await;
    let res = app
        .server
        .post("/auth/register")
        .json(&json!({"email": "", "password": "hunter2hunter2"}))
        .await;

    assert_eq!(res.status_code(), 422);
}

// ── Login ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn login_success_returns_access_token() {
    let app = TestApp::new().await;
    let creds = json!({"email": "eve@example.com", "password": "securepassword"});

    let reg = app.server.post("/auth/register").json(&creds).await;
    assert_eq!(reg.status_code(), 201);

    let login = app.server.post("/auth/login").json(&creds).await;
    assert_eq!(login.status_code(), 200);

    let body: Value = login.json();
    assert!(body["access_token"].is_string());
    assert!(body["expires_in"].is_number());
}

#[tokio::test]
async fn login_wrong_password_returns_401() {
    let app = TestApp::new().await;
    app.server
        .post("/auth/register")
        .json(&json!({"email": "frank@example.com", "password": "correctpassword"}))
        .await;

    let res = app
        .server
        .post("/auth/login")
        .json(&json!({"email": "frank@example.com", "password": "wrongpassword"}))
        .await;

    assert_eq!(res.status_code(), 401);
}

#[tokio::test]
async fn login_unknown_email_returns_401() {
    let app = TestApp::new().await;
    let res = app
        .server
        .post("/auth/login")
        .json(&json!({"email": "ghost@example.com", "password": "doesnotmatter"}))
        .await;

    assert_eq!(res.status_code(), 401);
}

#[tokio::test]
async fn login_email_is_case_insensitive() {
    let app = TestApp::new().await;
    app.server
        .post("/auth/register")
        .json(&json!({"email": "Grace@Example.COM", "password": "mypassword123"}))
        .await;

    let res = app
        .server
        .post("/auth/login")
        .json(&json!({"email": "grace@example.com", "password": "mypassword123"}))
        .await;

    assert_eq!(res.status_code(), 200);
}

// ── /auth/me ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn me_returns_user_info_with_valid_token() {
    let app = TestApp::new().await;
    let reg: Value = app
        .server
        .post("/auth/register")
        .json(&json!({"email": "henry@example.com", "password": "mypassword123"}))
        .await
        .json();

    let token = reg["access_token"].as_str().unwrap();

    let res = app
        .server
        .get("/v1/auth/me")
        .add_header("Authorization", format!("Bearer {token}"))
        .await;

    assert_eq!(res.status_code(), 200);
    let body: Value = res.json();
    assert_eq!(body["email"], "henry@example.com");
}

#[tokio::test]
async fn me_returns_401_without_token() {
    let app = TestApp::new().await;
    let res = app.server.get("/v1/auth/me").await;
    assert_eq!(res.status_code(), 401);
}

// ── Logout + Refresh ──────────────────────────────────────────────────────────

#[tokio::test]
async fn logout_clears_cookie() {
    let app = TestApp::new().await;
    let reg: Value = app
        .server
        .post("/auth/register")
        .json(&json!({"email": "iris@example.com", "password": "mypassword123"}))
        .await
        .json();

    let token = reg["access_token"].as_str().unwrap();

    let res = app
        .server
        .post("/auth/logout")
        .add_header("Authorization", format!("Bearer {token}"))
        .await;

    assert_eq!(res.status_code(), 204);
    let cookie = res.header("Set-Cookie");
    assert!(
        cookie.to_str().unwrap_or("").contains("Max-Age=0"),
        "logout should clear cookie: {cookie:?}"
    );
}

// ── Error body shape ──────────────────────────────────────────────────────────

#[tokio::test]
async fn error_responses_have_nested_error_field() {
    let app = TestApp::new().await;
    let res = app
        .server
        .post("/auth/login")
        .json(&json!({"email": "nobody@example.com", "password": "whatever"}))
        .await;

    let body: Value = res.json();
    assert!(
        body["error"].is_object(),
        "expected {{\"error\":{{...}}}}: {body}"
    );
    assert!(body["error"]["code"].is_string());
    assert!(body["error"]["message"].is_string());
}

#[tokio::test]
async fn vehicles_returns_empty_list_for_new_user() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "vehicles-empty@example.com").await;

    let res = app
        .server
        .get("/v1/vehicles")
        .add_header("Authorization", format!("Bearer {token}"))
        .await;

    assert_eq!(res.status_code(), 200);
    let body: Value = res.json();
    assert_eq!(body["vehicles"], json!([]));
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
        .server
        .get("/v1/vehicles")
        .add_header("Authorization", format!("Bearer {owner_token}"))
        .await;

    assert_eq!(res.status_code(), 200);
    let body: Value = res.json();
    let vehicles = body["vehicles"].as_array().expect("vehicles array");
    assert_eq!(vehicles.len(), 1);
    assert_eq!(vehicles[0]["rivian_vehicle_id"], "owner-vehicle");
    assert_eq!(vehicles[0]["display_name"], "Owner Truck");
}

#[tokio::test]
async fn stats_summary_requires_vehicle_id() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "stats-missing@example.com").await;

    let res = app
        .server
        .get("/v1/stats/summary")
        .add_header("Authorization", format!("Bearer {token}"))
        .await;

    assert_eq!(res.status_code(), 422);
    let body: Value = res.json();
    assert_eq!(body["error"]["message"], "vehicle_id required");
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
    let vehicle_id = insert_vehicle(&app.pool, outsider_id, "outsider-vehicle", "Outsider Truck").await;

    let res = app
        .server
        .get(&format!("/v1/stats/summary?vehicle_id={vehicle_id}"))
        .add_header("Authorization", format!("Bearer {token}"))
        .await;

    assert_eq!(res.status_code(), 404);
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
        .server
        .get(&format!("/v1/stats/summary?vehicle_id={vehicle_id}"))
        .add_header("Authorization", format!("Bearer {token}"))
        .await;

    assert_eq!(res.status_code(), 200);
    let body: Value = res.json();
    assert_eq!(body["total_miles"], json!(30.0));
    assert_eq!(body["total_trips"], json!(2));
    assert_eq!(body["total_kwh_charged"], json!(40.0));
    assert_eq!(body["total_charging_sessions"], json!(1));
    assert_eq!(body["lifetime_efficiency_wh_mi"], json!(400.0));
    assert_eq!(body["estimated_total_cost_usd"], json!(5.2));
}
