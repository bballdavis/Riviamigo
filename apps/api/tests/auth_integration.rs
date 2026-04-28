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
            _db: postgres,
        }
    }
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
