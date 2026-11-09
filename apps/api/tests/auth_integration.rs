use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};
use axum::{
    body::{to_bytes, Body},
    extract::ConnectInfo,
    http::{
        header::{
            ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_REQUEST_HEADERS,
            ACCESS_CONTROL_REQUEST_METHOD, AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, COOKIE,
            ETAG, IF_MATCH, ORIGIN, SET_COOKIE, VARY,
        },
        HeaderMap, Method, Request, StatusCode,
    },
    Router,
};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, Executor, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

use riviamigo_api::{
    config::{Config, OriginBindConfig, RateLimitConfig, RecoveryConfig, SecurityConfig},
    ingestion::supervisor::SupervisorHandle,
    keys::bootstrap_keys,
    middleware::auth::{AppState, JwtKeys},
    models::cost_profile::compute_cost,
    routes,
    services::cost::resolve_profile,
    services::geofences::match_geofence,
};

struct TestResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: Value,
}

struct TestApp {
    router: Router,
    pool: PgPool,
    state: AppState,
}

impl TestApp {
    async fn new() -> Self {
        Self::new_with_rate_limit(RateLimitConfig::default()).await
    }

    async fn new_with_rate_limit(rate_limit: RateLimitConfig) -> Self {
        Self::new_with_rate_limit_and_pool_size(rate_limit, 1).await
    }

    async fn new_with_rate_limit_and_pool_size(
        rate_limit: RateLimitConfig,
        max_connections: u32,
    ) -> Self {
        Self::new_with_security(rate_limit, max_connections, SecurityConfig::default()).await
    }

    async fn new_with_security(
        rate_limit: RateLimitConfig,
        max_connections: u32,
        security: SecurityConfig,
    ) -> Self {
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
            .max_connections(max_connections)
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
            redis: redis::Client::open(
                std::env::var("RIVIAMIGO_TEST_REDIS_URL")
                    .unwrap_or_else(|_| "redis://127.0.0.1:6379/".into()),
            )
            .expect("redis client"),
            jwt_keys,
            age_key: keys.age_key,
            config: Config {
                database_url: db_url,
                redis_url: "redis://127.0.0.1:6379/".into(),
                jwt_secret: None,
                jwt_public_key: None,
                age_encryption_key: None,
                port: 0,
                allowed_origins: vec!["http://localhost:3000".into()],
                s3_endpoint: None,
                s3_access_key: None,
                s3_secret_key: None,
                backup_artifact_dir: std::env::temp_dir()
                    .join("riviamigo-auth-test-backups")
                    .to_string_lossy()
                    .into_owned(),
                backup_driver: "pg_dump".into(),
                backup_poll_interval_seconds: 60,
                restore_agent_url: "http://127.0.0.1:3002".into(),
                restore_agent_key_file: "/backups/.restore-agent-key".into(),
                recovery: RecoveryConfig::default(),
                origin_bind: OriginBindConfig::default(),
                security,
                rivian_ws_reconnect_initial_seconds: 10,
                rivian_ws_reconnect_max_seconds: 900,
                rivian_raw_event_retention_days: 7,
                rivian_persist_raw_events: true,
                rivian_suppress_duplicate_telemetry: true,
                riviamigo_env: None,
                cookie_insecure: None,
                allow_insecure_lan_http_auth: false,
                rate_limit,
                vehicle_image_cache_dir: std::env::temp_dir()
                    .join("riviamigo-auth-test-images")
                    .to_string_lossy()
                    .into_owned(),
            },
            nominatim_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
            supervisor: SupervisorHandle::noop(),
            resources: Default::default(),
        };

        Self {
            router: routes::build_router(state.clone()),
            pool,
            state,
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

    async fn request_with_forwarded_ip(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        bearer_token: Option<&str>,
        cookie: Option<&str>,
        forwarded_ip: Option<&str>,
    ) -> TestResponse {
        let mut req = Request::builder().method(method).uri(path);
        if let Some(token) = bearer_token {
            req = req.header(AUTHORIZATION, format!("Bearer {token}"));
        }
        if let Some(cookie_value) = cookie {
            req = req.header(COOKIE, cookie_value);
        }
        if let Some(ip) = forwarded_ip {
            req = req.header("x-forwarded-for", ip);
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

    async fn request_with_if_match(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        bearer_token: &str,
        if_match: &str,
    ) -> TestResponse {
        self.request_with_resource_etags(method, path, body, bearer_token, if_match, None)
            .await
    }

    async fn request_with_resource_etags(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        bearer_token: &str,
        if_match: &str,
        preference_if_match: Option<&str>,
    ) -> TestResponse {
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            .header(AUTHORIZATION, format!("Bearer {bearer_token}"))
            .header(IF_MATCH, if_match);
        if let Some(preference_etag) = preference_if_match {
            req = req.header("x-theme-preferences-if-match", preference_etag);
        }
        let mut request = if let Some(json_body) = body {
            req = req.header(CONTENT_TYPE, "application/json");
            req.body(Body::from(json_body.to_string()))
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

fn deterministic_rate_limit_config() -> RateLimitConfig {
    RateLimitConfig {
        auth_public_per_minute: 1,
        auth_public_burst: 2,
        auth_metadata_per_minute: 1,
        auth_metadata_burst: 1,
        heavy_read_per_minute: 1,
        heavy_read_burst: 1,
        ..RateLimitConfig::default()
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

    if response.status != StatusCode::OK && response.status != StatusCode::CREATED {
        panic!(
            "register failed: status={} body={}",
            response.status, response.body
        );
    }

    response.body["access_token"]
        .as_str()
        .unwrap_or_else(|| panic!("missing access token: body={}", response.body))
        .to_string()
}

async fn insert_user_and_login(app: &TestApp, email: &str, password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("hash password")
        .to_string();
    sqlx::query("INSERT INTO riviamigo.users (email, password_hash) VALUES ($1, $2)")
        .bind(email)
        .bind(password_hash)
        .execute(&app.pool)
        .await
        .expect("insert user");

    let response = app
        .request(
            Method::POST,
            "/v1/auth/login",
            Some(json!({"email": email, "password": password})),
            None,
            None,
        )
        .await;
    assert_eq!(
        response.status,
        StatusCode::OK,
        "login failed: {}",
        response.body
    );
    response.body["access_token"]
        .as_str()
        .expect("access token")
        .to_string()
}

async fn insert_vehicle(pool: &PgPool, user_id: Uuid, rivian_vehicle_id: &str, name: &str) -> Uuid {
    let vehicle_id = sqlx::query_scalar!(
        "INSERT INTO riviamigo.vehicles (user_id, rivian_vehicle_id, model, name) VALUES ($1, $2, $3, $4) RETURNING id",
        user_id,
        rivian_vehicle_id,
        "R1T",
        name,
    )
    .fetch_one(pool)
    .await
    .expect("insert vehicle");
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
         VALUES ($1, $2, 'owner', FALSE)",
    )
    .bind(vehicle_id)
    .bind(user_id)
    .execute(pool)
    .await
    .expect("insert vehicle membership");
    vehicle_id
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

async fn insert_trip(
    pool: &PgPool,
    vehicle_id: Uuid,
    started_at: chrono::DateTime<chrono::Utc>,
    ended_at: chrono::DateTime<chrono::Utc>,
) -> Uuid {
    sqlx::query_scalar!(
        "INSERT INTO riviamigo.trips (vehicle_id, started_at, ended_at) VALUES ($1, $2, $3) RETURNING id",
        vehicle_id,
        started_at,
        ended_at,
    )
    .fetch_one(pool)
    .await
    .expect("insert trip")
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
    assert_eq!(second.status, StatusCode::FORBIDDEN);
    assert_eq!(second.body["error"]["message"], "Forbidden");
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

#[tokio::test]
async fn v2_themes_are_account_scoped_revision_pinned_and_v1_compatible() {
    let app = TestApp::new().await;
    let mut preflight = Request::builder()
        .method(Method::OPTIONS)
        .uri("/v2/themes/example/rollback")
        .header(ORIGIN, "http://localhost:3000")
        .header(ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .header(
            ACCESS_CONTROL_REQUEST_HEADERS,
            "content-type,if-match,x-theme-preferences-if-match",
        )
        .body(Body::empty())
        .expect("preflight request");
    preflight
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::new(
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            12345,
        )));
    let preflight_response = app
        .router
        .clone()
        .oneshot(preflight)
        .await
        .expect("preflight response");
    assert!(preflight_response.status().is_success());
    let allowed_headers = preflight_response
        .headers()
        .get(ACCESS_CONTROL_ALLOW_HEADERS)
        .and_then(|value| value.to_str().ok())
        .expect("allowed CORS headers");
    assert!(allowed_headers.split(',').any(|value| value
        .trim()
        .eq_ignore_ascii_case("x-theme-preferences-if-match")));
    let owner_token = register_and_login(&app, "theme-owner@example.com").await;
    let other_token =
        insert_user_and_login(&app, "theme-other@example.com", "correctpassword123").await;

    let defaults = app
        .request(
            Method::GET,
            "/v2/auth/preferences/theme",
            None,
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(defaults.status, StatusCode::OK);
    assert_eq!(defaults.body["mode"], "dark");
    assert_eq!(defaults.body["selection"]["themeId"], "classic");
    assert!(defaults.headers.get(ETAG).is_some());
    assert_eq!(
        defaults
            .headers
            .get(CACHE_CONTROL)
            .and_then(|v| v.to_str().ok()),
        Some("private, no-store")
    );
    let vary = defaults
        .headers
        .get(VARY)
        .and_then(|v| v.to_str().ok())
        .expect("identity Vary");
    assert!(vary
        .split(',')
        .any(|v| v.trim().eq_ignore_ascii_case("authorization")));
    assert!(vary
        .split(',')
        .any(|v| v.trim().eq_ignore_ascii_case("cookie")));
    let default_preference_etag = defaults
        .headers
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .expect("default preference ETag")
        .to_owned();

    let created = app
        .request(
            Method::POST,
            "/v2/themes",
            Some(json!({ "name": "My telemetry theme", "baseThemeId": "classic" })),
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(created.status, StatusCode::OK, "{}", created.body);
    let theme_id = created.body["themeId"].as_str().expect("theme id");
    let create_etag = created
        .headers
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .expect("create ETag");

    let saved = app
        .request_with_if_match(
            Method::POST,
            &format!("/v2/themes/{theme_id}/revisions"),
            Some(json!({
                "definition": {
                    "theme": "classic",
                    "tokens": { "accent": { "light": "#123456", "dark": "#abcdef" } },
                    "series": { "series-16": { "light": "#224466", "dark": "#6688aa" } }
                }
            })),
            &owner_token,
            create_etag,
        )
        .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.body);
    assert_eq!(saved.body["revision"], 1);
    let saved_etag = saved
        .headers
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .expect("revision ETag");

    let stale_write = app
        .request_with_if_match(
            Method::POST,
            &format!("/v2/themes/{theme_id}/revisions"),
            Some(json!({ "definition": { "theme": "classic" } })),
            &owner_token,
            create_etag,
        )
        .await;
    assert_eq!(stale_write.status, StatusCode::CONFLICT);

    let published = app
        .request_with_resource_etags(
            Method::POST,
            &format!("/v2/themes/{theme_id}/revisions/1/publish"),
            Some(json!({ "apply": true })),
            &owner_token,
            saved_etag,
            Some(&default_preference_etag),
        )
        .await;
    assert_eq!(published.status, StatusCode::OK, "{}", published.body);
    assert_eq!(published.body["applied"], true);

    let selected = app
        .request(
            Method::GET,
            "/v2/auth/preferences/theme",
            None,
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(selected.body["selection"]["kind"], "custom");
    assert_eq!(selected.body["selection"]["revision"], 1);
    assert_eq!(
        selected.body["selection"]["definition"]["tokens"]["accent"]["dark"],
        "#abcdef"
    );

    let published_etag = published
        .headers
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .expect("published theme ETag");
    let saved_second = app
        .request_with_if_match(
            Method::POST,
            &format!("/v2/themes/{theme_id}/revisions"),
            Some(json!({
                "definition": {
                    "theme": "classic",
                    "tokens": { "accent": { "light": "#654321", "dark": "#fedcba" } }
                }
            })),
            &owner_token,
            published_etag,
        )
        .await;
    assert_eq!(saved_second.status, StatusCode::OK, "{}", saved_second.body);
    let saved_second_etag = saved_second
        .headers
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .expect("second revision ETag");
    let published_second = app
        .request_with_if_match(
            Method::POST,
            &format!("/v2/themes/{theme_id}/revisions/2/publish"),
            Some(json!({ "apply": false })),
            &owner_token,
            saved_second_etag,
        )
        .await;
    assert_eq!(
        published_second.status,
        StatusCode::OK,
        "{}",
        published_second.body
    );
    let still_pinned = app
        .request(
            Method::GET,
            "/v2/auth/preferences/theme",
            None,
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(still_pinned.body["selection"]["revision"], 1);

    let published_second_etag = published_second
        .headers
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .expect("second publication ETag");
    let current_preference_etag = still_pinned
        .headers
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .expect("current preference ETag");
    let stale_rollback = app
        .request_with_resource_etags(
            Method::POST,
            &format!("/v2/themes/{theme_id}/rollback"),
            Some(json!({ "revision": 2 })),
            &owner_token,
            published_second_etag,
            Some(&default_preference_etag),
        )
        .await;
    assert_eq!(stale_rollback.status, StatusCode::CONFLICT);
    let rolled_back = app
        .request_with_resource_etags(
            Method::POST,
            &format!("/v2/themes/{theme_id}/rollback"),
            Some(json!({ "revision": 2 })),
            &owner_token,
            published_second_etag,
            Some(current_preference_etag),
        )
        .await;
    assert_eq!(rolled_back.status, StatusCode::OK, "{}", rolled_back.body);
    assert_eq!(rolled_back.body["mode"], "dark");
    assert_eq!(rolled_back.body["selection"]["revision"], 2);
    assert_eq!(
        rolled_back.body["selection"]["definition"]["tokens"]["accent"]["dark"],
        "#fedcba"
    );

    let catalog = app
        .request(
            Method::GET,
            "/v2/themes/catalog",
            None,
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(catalog.status, StatusCode::OK);
    assert_eq!(
        catalog.body["customThemes"][0]["publishedDefinition"]["tokens"]["accent"]["dark"],
        "#fedcba"
    );

    let legacy_mode_only = app
        .request(
            Method::PUT,
            "/v1/auth/preferences",
            Some(json!({ "theme": { "mode": "system", "palette": "classic" } })),
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(legacy_mode_only.status, StatusCode::OK);
    let preserved = app
        .request(
            Method::GET,
            "/v2/auth/preferences/theme",
            None,
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(preserved.body["mode"], "system");
    assert_eq!(preserved.body["selection"]["kind"], "custom");

    let forbidden = app
        .request(
            Method::GET,
            &format!("/v2/themes/{theme_id}"),
            None,
            Some(&other_token),
            None,
        )
        .await;
    assert_eq!(forbidden.status, StatusCode::NOT_FOUND);

    let switched = app
        .request(
            Method::PUT,
            "/v1/auth/preferences",
            Some(json!({ "theme": { "mode": "dark", "palette": "rad" } })),
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(switched.status, StatusCode::OK);
    let builtin = app
        .request(
            Method::GET,
            "/v2/auth/preferences/theme",
            None,
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(builtin.body["selection"]["kind"], "builtin");
    assert_eq!(builtin.body["selection"]["themeId"], "rad");
}

#[tokio::test]
async fn concurrent_theme_creation_enforces_the_per_account_limit() {
    let app = TestApp::new_with_rate_limit_and_pool_size(RateLimitConfig::default(), 4).await;
    let owner_token = register_and_login(&app, "theme-limit-owner@example.com").await;
    let owner_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM riviamigo.users WHERE email = 'theme-limit-owner@example.com'",
    )
    .fetch_one(&app.pool)
    .await
    .expect("owner id");

    for index in 0..19 {
        sqlx::query(
            "INSERT INTO riviamigo.user_themes (owner_id, name, base_theme_id)
             VALUES ($1, $2, 'classic')",
        )
        .bind(owner_id)
        .bind(format!("Seed theme {index}"))
        .execute(&app.pool)
        .await
        .expect("seed theme");
    }

    let (first, second) = tokio::join!(
        app.request(
            Method::POST,
            "/v2/themes",
            Some(json!({ "name": "Concurrent theme A", "baseThemeId": "classic" })),
            Some(&owner_token),
            None,
        ),
        app.request(
            Method::POST,
            "/v2/themes",
            Some(json!({ "name": "Concurrent theme B", "baseThemeId": "classic" })),
            Some(&owner_token),
            None,
        ),
    );

    let statuses = [first.status, second.status];
    assert!(statuses.contains(&StatusCode::OK), "statuses: {statuses:?}");
    assert!(
        statuses.contains(&StatusCode::UNPROCESSABLE_ENTITY),
        "statuses: {statuses:?}"
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM riviamigo.user_themes WHERE owner_id = $1 AND retired_at IS NULL",
    )
    .bind(owner_id)
    .fetch_one(&app.pool)
    .await
    .expect("theme count");
    assert_eq!(count, 20);
}

#[tokio::test]
async fn deleting_theme_owner_cleans_history_but_direct_revision_mutation_is_rejected() {
    let app = TestApp::new().await;
    let admin_token = register_and_login(&app, "theme-delete-admin@example.com").await;
    let owner_token =
        insert_user_and_login(&app, "theme-delete-owner@example.com", "correctpassword123").await;
    let owner_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM riviamigo.users WHERE email = 'theme-delete-owner@example.com'",
    )
    .fetch_one(&app.pool)
    .await
    .expect("owner id");
    let created = app
        .request(
            Method::POST,
            "/v2/themes",
            Some(json!({"name":"Delete me","baseThemeId":"classic"})),
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(created.status, StatusCode::OK, "{}", created.body);
    let theme_id: Uuid = created.body["themeId"]
        .as_str()
        .expect("theme id")
        .parse()
        .expect("uuid");
    let create_etag = created
        .headers
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .expect("create ETag");
    let saved = app.request_with_if_match(Method::POST, &format!("/v2/themes/{theme_id}/revisions"), Some(json!({"definition":{"theme":"classic","tokens":{"accent":{"light":"#123456","dark":"#abcdef"}}}})), &owner_token, create_etag).await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.body);
    let direct_update = sqlx::query(
        "UPDATE riviamigo.user_theme_revisions SET definition = definition WHERE theme_id = $1",
    )
    .bind(theme_id)
    .execute(&app.pool)
    .await;
    assert!(direct_update
        .expect_err("revision update must be rejected")
        .to_string()
        .contains("append-only"));
    let direct_delete = sqlx::query(
        "DELETE FROM riviamigo.user_theme_revisions WHERE theme_id = $1 AND revision = 1",
    )
    .bind(theme_id)
    .execute(&app.pool)
    .await;
    assert!(direct_delete
        .expect_err("revision delete must be rejected")
        .to_string()
        .contains("append-only"));
    let revision_etag = saved
        .headers
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .expect("revision ETag");
    let preferences = app
        .request(
            Method::GET,
            "/v2/auth/preferences/theme",
            None,
            Some(&owner_token),
            None,
        )
        .await;
    let preference_etag = preferences
        .headers
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .expect("preference ETag");
    let published = app
        .request_with_resource_etags(
            Method::POST,
            &format!("/v2/themes/{theme_id}/revisions/1/publish"),
            Some(json!({"apply":true})),
            &owner_token,
            revision_etag,
            Some(preference_etag),
        )
        .await;
    assert_eq!(published.status, StatusCode::OK, "{}", published.body);
    let deleted = app
        .request(
            Method::DELETE,
            &format!("/v1/admin/users/{owner_id}"),
            None,
            Some(&admin_token),
            None,
        )
        .await;
    assert_eq!(deleted.status, StatusCode::OK, "{}", deleted.body);
    let remaining: (i64, i64, i64, i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM riviamigo.users WHERE id = $1), (SELECT count(*) FROM riviamigo.user_preferences WHERE user_id = $1), (SELECT count(*) FROM riviamigo.user_themes WHERE id = $2), (SELECT count(*) FROM riviamigo.user_theme_revisions WHERE theme_id = $2), (SELECT count(*) FROM riviamigo.user_theme_publications WHERE theme_id = $2)").bind(owner_id).bind(theme_id).fetch_one(&app.pool).await.expect("cleanup counts");
    assert_eq!(remaining, (0, 0, 0, 0, 0));
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

fn response_cookie(response: &TestResponse) -> String {
    response
        .headers
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn full_metric_stream_preserves_points_across_cursor_chunks_and_compact_samples() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "metrics-stream@example.com").await;
    let user: Uuid = sqlx::query_scalar(
        "SELECT id FROM riviamigo.users WHERE email='metrics-stream@example.com'",
    )
    .fetch_one(&app.pool)
    .await
    .unwrap();
    let vehicle = insert_vehicle(&app.pool, user, "metrics-fixture", "Metrics").await;
    sqlx::query("INSERT INTO timeseries.telemetry (vehicle_id, ts, battery_level) SELECT $1, '2026-01-01T00:00:00Z'::timestamptz + n * interval '1 second', (n % 100)::float8 FROM generate_series(0, 25004) n")
        .bind(vehicle).execute(&app.pool).await.unwrap();
    let path = format!("/v1/metrics/series?vehicle_id={vehicle}&metric=battery_level&bucket=raw&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z");
    let full = app
        .request(Method::GET, &path, None, Some(&token), None)
        .await;
    assert_eq!(full.status, StatusCode::OK, "{}", full.body);
    let points = full.body.as_array().expect("complete JSON array");
    assert_eq!(points.len(), 25005);
    assert_eq!(points[0]["value"], 0.0);
    assert_eq!(points[25004]["value"], 4.0);
    let batch = app.request(Method::POST, "/v1/metrics/batch", Some(json!({"vehicle_id":vehicle,"metrics":[{"metric":"battery_level","include_series":true,"include_latest":false}],"bucket":"raw","density":"compact","max_points":200,"from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"})), Some(&token), None).await;
    assert_eq!(batch.status, StatusCode::OK, "{}", batch.body);
    let sampled = batch.body["series"][0]["points"]
        .as_array()
        .expect("series points");
    assert_eq!(sampled.len(), 96);
    for (index, point) in sampled.iter().enumerate() {
        assert_eq!(point, &points[index * 25004 / 95]);
    }
    let full_batch = app.request(Method::POST, "/v1/metrics/batch", Some(json!({"vehicle_id":vehicle,"metrics":[{"metric":"battery_level","include_series":true,"include_latest":false}],"density":"full","from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"})), Some(&token), None).await;
    assert_eq!(full_batch.body["series"][0]["points"], full.body);
    // A slow/disconnected client must release both the snapshot connection and
    // heavy-read admission; it cannot pin a pool slot indefinitely.
    use futures::StreamExt;
    let request = Request::builder()
        .uri(&path)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let mut body = response.into_body().into_data_stream();
    assert!(body.next().await.unwrap().is_ok());
    drop(body);
    let connection = tokio::time::timeout(std::time::Duration::from_secs(3), app.pool.acquire())
        .await
        .unwrap()
        .unwrap();
    drop(connection);
    let mut permits = Vec::new();
    for _ in 0..app.state.config.security.metrics_max_per_user {
        permits.push(
            app.state
                .resources
                .heavy(user, &app.state.config.security)
                .unwrap(),
        );
    }
    assert!(app
        .state
        .resources
        .heavy(user, &app.state.config.security)
        .is_err());
}

#[tokio::test]
async fn cancelled_metric_and_grafana_reads_cancel_active_database_work_before_releasing_quota() {
    let app = TestApp::new_with_security(
        RateLimitConfig::default(),
        4,
        SecurityConfig {
            metrics_timeout_seconds: 2,
            ..Default::default()
        },
    )
    .await;
    let token = register_and_login(&app, "active-query-cancel@example.com").await;
    let user: Uuid = sqlx::query_scalar(
        "SELECT id FROM riviamigo.users WHERE email='active-query-cancel@example.com'",
    )
    .fetch_one(&app.pool)
    .await
    .unwrap();
    let vehicle = insert_vehicle(&app.pool, user, "active-query-cancel", "Cancellation").await;
    for route in ["series", "value", "grafana"] {
        let mut blocker = app.pool.begin().await.unwrap();
        sqlx::query("LOCK TABLE timeseries.telemetry IN ACCESS EXCLUSIVE MODE")
            .execute(&mut *blocker)
            .await
            .unwrap();
        let request = if route == "grafana" {
            Request::builder().method(Method::POST).uri("/v1/grafana/query")
                .header(CONTENT_TYPE, "application/json").header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(json!({"range":{"from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"},"targets":[{"target":"battery_level","vehicleId":vehicle}]}).to_string())).unwrap()
        } else {
            Request::builder().uri(format!("/v1/metrics/{route}?vehicle_id={vehicle}&metric=battery_level&bucket=raw&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z"))
                .header(AUTHORIZATION, format!("Bearer {token}")).body(Body::empty()).unwrap()
        };
        let router = app.router.clone();
        let waiter = tokio::spawn(async move {
            let response = router.oneshot(request).await.unwrap();
            // For a stream, leave body consumption pending on the blocked SQL.
            to_bytes(response.into_body(), usize::MAX).await
        });
        let pid = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let pid: Option<i32> = sqlx::query_scalar("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND query LIKE '%timeseries.telemetry%' LIMIT 1")
                    .fetch_optional(&app.pool).await.unwrap();
                if let Some(pid) = pid { break pid; }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }).await.expect("actual database statement reached the lock");
        let held: Vec<_> = (1..app.state.config.security.metrics_max_per_user)
            .map(|_| {
                app.state
                    .resources
                    .heavy(user, &app.state.config.security)
                    .unwrap()
            })
            .collect();
        waiter.abort();
        assert!(waiter.await.unwrap_err().is_cancelled());
        tokio::task::yield_now().await;
        // Cleanup owns the last permit while cancellation/drain is pending.
        assert!(
            app.state
                .resources
                .heavy(user, &app.state.config.security)
                .is_err(),
            "{route}"
        );
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let active: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND state='active')",
                )
                .bind(pid)
                .fetch_one(&app.pool)
                .await
                .unwrap();
                let permit = app.state.resources.heavy(user, &app.state.config.security);
                if active {
                    assert!(
                        permit.is_err(),
                        "active {route} backend must retain admission"
                    );
                }
                if !active && permit.is_ok() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("cancelled backend drained and quota released");
        // The table lock remains held: completion proves cancellation, rather
        // than the blocked query simply becoming able to run.
        blocker.rollback().await.unwrap();
        drop(held);
    }
    // The database deadline must also end an actively blocked Grafana query
    // when its client keeps waiting, rather than only timing out its future.
    let mut blocker = app.pool.begin().await.unwrap();
    sqlx::query("LOCK TABLE timeseries.telemetry IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .unwrap();
    let timed = tokio::time::timeout(std::time::Duration::from_secs(4), app.request(
        Method::POST, "/v1/grafana/query",
        Some(json!({"range":{"from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"},"targets":[{"target":"battery_level","vehicleId":vehicle}]})),
        Some(&token), None,
    )).await.expect("database deadline returns while table is still locked");
    assert!(!timed.status.is_success());
    let pending: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND query LIKE '%timeseries.telemetry%'")
        .fetch_one(&app.pool).await.unwrap();
    assert_eq!(pending, 0, "Grafana server statement ended at its deadline");
    blocker.rollback().await.unwrap();
}

#[tokio::test]
async fn replay_revokes_the_rotated_descendant_and_its_access_token() {
    let app = TestApp::new().await;
    let register = app
        .request(
            Method::POST,
            "/v1/auth/register",
            Some(json!({"email":"replay@example.com","password":"hunter2hunter2"})),
            None,
            None,
        )
        .await;
    let original = response_cookie(&register);
    let rotation = app
        .request(
            Method::POST,
            "/v1/auth/refresh",
            None,
            None,
            Some(&original),
        )
        .await;
    assert_eq!(rotation.status, StatusCode::OK);
    let descendant = response_cookie(&rotation);
    let token = rotation.body["access_token"].as_str().unwrap();
    assert_eq!(
        app.request(Method::GET, "/v1/auth/me", None, Some(token), None)
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        app.request(
            Method::POST,
            "/v1/auth/refresh",
            None,
            None,
            Some(&original)
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.request(
            Method::POST,
            "/v1/auth/refresh",
            None,
            None,
            Some(&descendant)
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.request(Method::GET, "/v1/auth/me", None, Some(token), None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let active: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM riviamigo.refresh_tokens WHERE revoked_at IS NULL",
    )
    .fetch_one(&app.pool)
    .await
    .unwrap();
    assert_eq!(active, 0);
}

#[tokio::test]
async fn disabled_and_deleted_accounts_fail_closed_for_existing_access_tokens() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "missing@example.com").await;
    sqlx::query(
        "UPDATE riviamigo.users SET is_disabled = TRUE WHERE email = 'missing@example.com'",
    )
    .execute(&app.pool)
    .await
    .unwrap();
    assert_eq!(
        app.request(Method::GET, "/v1/auth/me", None, Some(&token), None)
            .await
            .status,
        StatusCode::FORBIDDEN
    );
    sqlx::query("DELETE FROM riviamigo.users WHERE email = 'missing@example.com'")
        .execute(&app.pool)
        .await
        .unwrap();
    assert_eq!(
        app.request(Method::GET, "/v1/auth/me", None, Some(&token), None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn administrative_disablement_revokes_sessions_after_reenable() {
    let app = TestApp::new().await;
    let administrator = register_and_login(&app, "disable-admin@example.com").await;
    let existing =
        insert_user_and_login(&app, "disable-target@example.com", "hunter2hunter2").await;
    let login = app
        .request(
            Method::POST,
            "/v1/auth/login",
            Some(json!({
                "email":"disable-target@example.com", "password":"hunter2hunter2"
            })),
            None,
            None,
        )
        .await;
    assert_eq!(login.status, StatusCode::OK);
    let cookie = response_cookie(&login);
    let target: Uuid = sqlx::query_scalar("SELECT id FROM riviamigo.users WHERE email=$1")
        .bind("disable-target@example.com")
        .fetch_one(&app.pool)
        .await
        .unwrap();
    let path = format!("/v1/admin/users/{target}");
    for disabled in [true, false] {
        assert_eq!(
            app.request(
                Method::PATCH,
                &path,
                Some(json!({"is_disabled":disabled})),
                Some(&administrator),
                None
            )
            .await
            .status,
            StatusCode::OK
        );
    }
    assert_eq!(
        app.request(Method::GET, "/v1/auth/me", None, Some(&existing), None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.request(Method::POST, "/v1/auth/refresh", None, None, Some(&cookie))
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let active: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM riviamigo.session_families WHERE user_id=$1 AND revoked_at IS NULL",
    )
    .bind(target)
    .fetch_one(&app.pool)
    .await
    .unwrap();
    assert_eq!(active, 0);
    let fresh = app
        .request(
            Method::POST,
            "/v1/auth/login",
            Some(json!({
                "email":"disable-target@example.com", "password":"hunter2hunter2"
            })),
            None,
            None,
        )
        .await;
    assert_eq!(fresh.status, StatusCode::OK);
    assert_eq!(
        app.request(
            Method::GET,
            "/v1/auth/me",
            None,
            fresh.body["access_token"].as_str(),
            None
        )
        .await
        .status,
        StatusCode::OK
    );
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
async fn external_connections_loads_without_rivian_credentials() {
    let app = TestApp::new().await;
    riviamigo_api::services::external_connections::ensure_defaults(&app.pool)
        .await
        .expect("seed external connection defaults");
    let token = register_and_login(&app, "external-connections-empty@example.com").await;

    let credential_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM riviamigo.vehicle_credentials")
            .fetch_one(&app.pool)
            .await
            .expect("credential count");
    assert_eq!(credential_count, 0, "test requires a fresh Rivian account");

    let response = app
        .request(
            Method::GET,
            "/v1/settings/external-connections",
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(
        response.status,
        StatusCode::OK,
        "response: {}",
        response.body
    );
    let connections = response.body["connections"]
        .as_array()
        .expect("connections array");
    let ids: Vec<&str> = connections
        .iter()
        .map(|connection| connection["id"].as_str().expect("connection id"))
        .collect();
    assert_eq!(
        ids,
        vec![
            "rivian_account",
            "open_meteo",
            "nominatim",
            "basemap",
            "iconify",
            "s3_backup",
        ]
    );

    let rivian = connections
        .iter()
        .find(|connection| connection["id"] == "rivian_account")
        .expect("Rivian account connection");
    assert!(rivian["credential_issued_at"].is_null());
    assert!(rivian["expected_renewal_at"].is_null());
    assert!(rivian["renewal_state"].is_null());
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
async fn admin_vehicle_options_require_an_admin_role_and_return_picker_safe_fields() {
    let app = TestApp::new().await;
    let user_token = register_and_login(&app, "vehicle-picker@example.com").await;
    let user_id: Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "vehicle-picker@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("user id");
    let vehicle_id = insert_vehicle(&app.pool, user_id, "picker-vehicle", "Family R1S").await;

    sqlx::query!(
        "UPDATE riviamigo.users SET role = 'user' WHERE id = $1",
        user_id
    )
    .execute(&app.pool)
    .await
    .expect("demote to regular user");

    let denied = app
        .request(
            Method::GET,
            "/v1/admin/vehicles",
            None,
            Some(&user_token),
            None,
        )
        .await;
    assert_eq!(denied.status, StatusCode::FORBIDDEN);

    sqlx::query!(
        "UPDATE riviamigo.users SET role = 'admin' WHERE id = $1",
        user_id
    )
    .execute(&app.pool)
    .await
    .expect("promote to admin");

    let allowed = app
        .request(
            Method::GET,
            "/v1/admin/vehicles",
            None,
            Some(&user_token),
            None,
        )
        .await;
    assert_eq!(allowed.status, StatusCode::OK);
    let vehicles = allowed.body["vehicles"]
        .as_array()
        .expect("vehicle options");
    let option = vehicles
        .iter()
        .find(|option| option["id"] == serde_json::json!(vehicle_id))
        .expect("created vehicle option");
    assert_eq!(option["display_name"], "Family R1S");
    assert_eq!(option["model"], "R1T");
    assert_eq!(option.as_object().expect("option object").len(), 3);
}

#[tokio::test]
async fn account_invitation_can_assign_viewer_vehicle_access_on_acceptance() {
    let app = TestApp::new().await;
    let admin_token = register_and_login(&app, "account-inviter@example.com").await;
    let admin_id: Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "account-inviter@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("admin id");
    let vehicle_id = insert_vehicle(&app.pool, admin_id, "invite-vehicle", "Family R1S").await;

    let invalid = app
        .request(
            Method::POST,
            "/v1/admin/account-invitations",
            Some(json!({ "email": "invalid-vehicle@example.com", "vehicle_id": Uuid::new_v4() })),
            Some(&admin_token),
            None,
        )
        .await;
    assert_eq!(invalid.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        invalid.body["error"]["message"],
        "one or more vehicles not found"
    );

    let created = app
        .request(
            Method::POST,
            "/v1/admin/account-invitations",
            Some(json!({ "email": "viewer-invitee@example.com", "vehicle_id": vehicle_id })),
            Some(&admin_token),
            None,
        )
        .await;
    assert_eq!(created.status, StatusCode::OK);
    assert_eq!(created.body["auth_methods"], "password");
    let activation_token = created.body["activation_token"]
        .as_str()
        .expect("activation token");

    let listed = app
        .request(
            Method::GET,
            "/v1/admin/account-invitations",
            None,
            Some(&admin_token),
            None,
        )
        .await;
    assert_eq!(listed.status, StatusCode::OK);
    let listed_invitation = listed.body["invitations"]
        .as_array()
        .expect("invitations")
        .iter()
        .find(|invitation| invitation["invitee_email"] == "viewer-invitee@example.com")
        .expect("listed invitation");
    assert_eq!(listed_invitation["vehicle_id"], json!(vehicle_id));
    assert_eq!(listed_invitation["vehicle_name"], "Family R1S");
    assert_eq!(listed_invitation["auth_methods"], "password");

    let accepted = app
        .request(
            Method::POST,
            "/v1/auth/account-invitations/accept",
            Some(json!({ "token": activation_token, "password": "invitepassword" })),
            None,
            None,
        )
        .await;
    assert_eq!(accepted.status, StatusCode::CREATED);
    let invitee_id: Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "viewer-invitee@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("invitee id");
    let auth_methods: String =
        sqlx::query_scalar("SELECT auth_methods FROM riviamigo.users WHERE id=$1")
            .bind(invitee_id)
            .fetch_one(&app.pool)
            .await
            .expect("invited account policy");
    assert_eq!(auth_methods, "password");
    let membership: (String, bool) = sqlx::query_as(
        "SELECT role, is_default FROM riviamigo.vehicle_memberships WHERE vehicle_id = $1 AND user_id = $2",
    )
    .bind(vehicle_id)
    .bind(invitee_id)
    .fetch_one(&app.pool)
    .await
    .expect("viewer membership");
    assert_eq!(membership.0, "viewer");
    assert!(!membership.1);
    let settings_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM riviamigo.vehicle_user_settings WHERE vehicle_id = $1 AND user_id = $2",
    )
    .bind(vehicle_id)
    .bind(invitee_id)
    .fetch_one(&app.pool)
    .await
    .expect("vehicle settings count");
    assert_eq!(settings_count, 1);

    let viewer_token = accepted.body["access_token"]
        .as_str()
        .expect("viewer access token");
    let viewer_read = app
        .request(
            Method::GET,
            &format!("/v1/vehicles/{vehicle_id}/charging-schedule"),
            None,
            Some(viewer_token),
            None,
        )
        .await;
    assert_eq!(viewer_read.status, StatusCode::OK);

    for (method, path, body) in [
        (
            Method::PUT,
            format!("/v1/vehicles/{vehicle_id}/charging-schedule"),
            Some(json!({"enabled": false})),
        ),
        (
            Method::POST,
            format!("/v1/vehicles/{vehicle_id}/departure-schedules"),
            Some(json!({"enabled": false})),
        ),
        (
            Method::POST,
            format!("/v1/vehicles/{vehicle_id}/backfill"),
            None,
        ),
    ] {
        let response = app
            .request(method, &path, body, Some(viewer_token), None)
            .await;
        assert_eq!(
            response.status,
            StatusCode::FORBIDDEN,
            "viewer must not mutate {path}"
        );
    }

    sqlx::query("UPDATE riviamigo.vehicle_memberships SET role = 'manager' WHERE vehicle_id = $1 AND user_id = $2")
        .bind(vehicle_id)
        .bind(invitee_id)
        .execute(&app.pool)
        .await
        .expect("promote viewer to manager");
    let manager_write = app
        .request(
            Method::PUT,
            &format!("/v1/vehicles/{vehicle_id}/name"),
            Some(json!({"name": "Manager-approved name"})),
            Some(viewer_token),
            None,
        )
        .await;
    assert_eq!(manager_write.status, StatusCode::OK);

    let no_vehicle_created = app
        .request(
            Method::POST,
            "/v1/admin/account-invitations",
            Some(json!({ "email": "no-vehicle-invitee@example.com", "vehicle_id": null })),
            Some(&admin_token),
            None,
        )
        .await;
    assert_eq!(no_vehicle_created.status, StatusCode::OK);
    let no_vehicle_token = no_vehicle_created.body["activation_token"]
        .as_str()
        .expect("no-vehicle activation token");
    let no_vehicle_accepted = app
        .request(
            Method::POST,
            "/v1/auth/account-invitations/accept",
            Some(json!({ "token": no_vehicle_token, "password": "invitepassword" })),
            None,
            None,
        )
        .await;
    assert_eq!(no_vehicle_accepted.status, StatusCode::CREATED);
    let no_vehicle_id: Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "no-vehicle-invitee@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("no-vehicle invitee id");
    let no_membership_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM riviamigo.vehicle_memberships WHERE user_id = $1")
            .bind(no_vehicle_id)
            .fetch_one(&app.pool)
            .await
            .expect("no membership count");
    assert_eq!(no_membership_count, 0);
}

#[tokio::test]
async fn login_audit_failure_rolls_back_refresh_token_insert() {
    let app = TestApp::new().await;
    let email = "audit-login-failure@example.com";
    let _ = register_and_login(&app, email).await;
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM riviamigo.refresh_tokens")
        .fetch_one(&app.pool)
        .await
        .expect("refresh token count before login");

    sqlx::query(
        r#"
        CREATE FUNCTION public.reject_login_success_audit() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.event_type = 'login_success' THEN
                RAISE EXCEPTION 'intentional login audit failure';
            END IF;
            RETURN NEW;
        END;
        $$;
        "#,
    )
    .execute(&app.pool)
    .await
    .expect("install login audit failure function");
    sqlx::query(
        "CREATE TRIGGER reject_login_success_audit BEFORE INSERT ON riviamigo.security_events FOR EACH ROW EXECUTE FUNCTION public.reject_login_success_audit()",
    )
    .execute(&app.pool)
    .await
    .expect("install login audit failure trigger");

    let response = app
        .request(
            Method::POST,
            "/v1/auth/login",
            Some(json!({ "email": email, "password": "hunter2hunter2" })),
            None,
            None,
        )
        .await;
    assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);

    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM riviamigo.refresh_tokens")
        .fetch_one(&app.pool)
        .await
        .expect("refresh token count after login");
    assert_eq!(after, before);
    let successful_logins: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM riviamigo.security_events WHERE event_type = 'login_success'",
    )
    .fetch_one(&app.pool)
    .await
    .expect("successful login audit count");
    assert_eq!(successful_logins, 0);
}

#[tokio::test]
async fn invitation_audit_failure_rolls_back_account_acceptance() {
    let app = TestApp::new().await;
    let admin_token = register_and_login(&app, "audit-inviter@example.com").await;
    let created = app
        .request(
            Method::POST,
            "/v1/admin/account-invitations",
            Some(json!({ "email": "audit-invitee@example.com", "vehicle_id": null })),
            Some(&admin_token),
            None,
        )
        .await;
    assert_eq!(created.status, StatusCode::OK);
    let activation_token = created.body["activation_token"]
        .as_str()
        .expect("activation token");

    sqlx::query(
        r#"
        CREATE FUNCTION public.reject_invitation_acceptance_audit() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.event_type = 'account_invitation_accepted' THEN
                RAISE EXCEPTION 'intentional invitation audit failure';
            END IF;
            RETURN NEW;
        END;
        $$;
        "#,
    )
    .execute(&app.pool)
    .await
    .expect("install invitation audit failure function");
    sqlx::query(
        "CREATE TRIGGER reject_invitation_acceptance_audit BEFORE INSERT ON riviamigo.security_events FOR EACH ROW EXECUTE FUNCTION public.reject_invitation_acceptance_audit()",
    )
    .execute(&app.pool)
    .await
    .expect("install invitation audit failure trigger");

    let response = app
        .request(
            Method::POST,
            "/v1/auth/account-invitations/accept",
            Some(json!({ "token": activation_token, "password": "invitepassword" })),
            None,
            None,
        )
        .await;
    assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);

    let user_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM riviamigo.users WHERE email = 'audit-invitee@example.com'",
    )
    .fetch_one(&app.pool)
    .await
    .expect("invitee count");
    assert_eq!(user_count, 0);
    let invitation_state: (Option<chrono::DateTime<chrono::Utc>>, Option<Uuid>) = sqlx::query_as(
        "SELECT accepted_at, created_user_id FROM riviamigo.account_invitations WHERE invitee_email = 'audit-invitee@example.com'",
    )
    .fetch_one(&app.pool)
    .await
    .expect("invitation state");
    assert!(invitation_state.0.is_none());
    assert!(invitation_state.1.is_none());
}

#[tokio::test]
async fn stats_summary_requires_vehicle_id() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "stats-missing@example.com").await;

    let res = app
        .request(
            Method::GET,
            "/v1/charging/summary",
            None,
            Some(&token),
            None,
        )
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
            &format!("/v1/charging/summary?vehicle_id={vehicle_id}"),
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
            &format!("/v1/charging/summary?vehicle_id={vehicle_id}"),
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.body["total_kwh"], json!(40.0));
    assert_eq!(res.body["session_count"], json!(1));
    assert_eq!(res.body["total_cost_usd"], json!(5.2));
}

#[tokio::test]
async fn trip_track_omits_zero_zero_coordinates() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "trip-track-zero@example.com").await;
    let user_id: uuid::Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "trip-track-zero@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("user id");
    let vehicle_id =
        insert_vehicle(&app.pool, user_id, "trip-track-zero-vehicle", "Track Truck").await;
    sqlx::query!(
        "INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
         VALUES ($1, $2, 'owner', TRUE)
         ON CONFLICT (vehicle_id, user_id) DO UPDATE
         SET role = EXCLUDED.role,
             is_default = EXCLUDED.is_default,
             updated_at = now()",
        vehicle_id,
        user_id,
    )
    .execute(&app.pool)
    .await
    .expect("seed vehicle membership");

    let started_at = chrono::Utc::now() - chrono::Duration::minutes(20);
    let ended_at = started_at + chrono::Duration::minutes(10);
    let trip_id = insert_trip(&app.pool, vehicle_id, started_at, ended_at).await;

    for (offset, lat, lng) in [
        (0_i64, 0.0_f64, 0.0_f64),
        (120_i64, 30.267_f64, -97.743_f64),
        (240_i64, 0.0_f64, 0.0_f64),
        (360_i64, 30.268_f64, -97.742_f64),
    ] {
        sqlx::query!(
            "INSERT INTO timeseries.telemetry (ts, vehicle_id, latitude, longitude) VALUES ($1, $2, $3, $4)",
            started_at + chrono::Duration::seconds(offset),
            vehicle_id,
            lat,
            lng,
        )
        .execute(&app.pool)
        .await
        .expect("insert telemetry");
    }

    let res = app
        .request(
            Method::GET,
            &format!("/v1/trips/{trip_id}/track?vehicle_id={vehicle_id}"),
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::OK);
    let points = res.body.as_array().expect("track array");
    assert_eq!(points.len(), 2);
    assert!(points
        .iter()
        .all(|point| point["lat"] != json!(0.0) && point["lng"] != json!(0.0)));
}

#[tokio::test]
async fn charging_sessions_surface_home_geofence_location() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "charging-home@example.com").await;
    let user_id: uuid::Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "charging-home@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("user id");
    let vehicle_id =
        insert_vehicle(&app.pool, user_id, "charging-home-vehicle", "Home Truck").await;

    let address_id = sqlx::query_scalar!(
        r#"INSERT INTO riviamigo.addresses
           (display_name, latitude, longitude)
           VALUES ($1, $2, $3)
           RETURNING id"#,
        "123 Home Garage",
        29.8182846_f64,
        -95.3881685_f64,
    )
    .fetch_one(&app.pool)
    .await
    .expect("address");

    let cost_profile_id = sqlx::query_scalar!(
        r#"INSERT INTO riviamigo.cost_profiles
           (user_id, name, billing_type, rate, session_fee, currency, timezone, tou_periods)
           VALUES ($1, $2, 'per_kwh', $3, $4, 'USD', 'UTC', '[]'::jsonb)
           RETURNING id"#,
        user_id,
        "Home - Test Charging",
        0.20_f64,
        0.0_f64,
    )
    .fetch_one(&app.pool)
    .await
    .expect("cost profile");

    let geofence_id = sqlx::query_scalar!(
        r#"INSERT INTO riviamigo.geofences
           (user_id, name, latitude, longitude, radius_m, address_id, is_home, is_work, cost_profile_id)
           VALUES ($1, $2, $3, $4, $5, $6, true, false, $7)
           RETURNING id"#,
        user_id,
        "Home - Test",
        29.8182846_f64,
        -95.3881685_f64,
        80.0_f64,
        address_id,
        cost_profile_id,
    )
    .fetch_one(&app.pool)
    .await
    .expect("geofence");

    let matched = match_geofence(&app.pool, user_id, 29.8185291_f64, -95.3882141_f64)
        .await
        .expect("geofence match")
        .expect("home geofence should match");
    assert_eq!(matched.id, geofence_id);
    assert!(matched.is_home);

    let resolved_profile = resolve_profile(
        &app.pool,
        None,
        Some(geofence_id),
        vehicle_id,
        chrono::Utc::now(),
    )
    .await
    .expect("resolve cost profile")
    .expect("home geofence cost profile should resolve");
    assert_eq!(resolved_profile.id, cost_profile_id);

    let resolved_cost = compute_cost(
        &resolved_profile,
        Some(24.5_f64),
        None,
        120_i32,
        chrono::Utc::now() - chrono::Duration::days(1),
        Some(chrono::Utc::now() - chrono::Duration::days(1) + chrono::Duration::hours(2)),
    )
    .expect("profile cost");
    assert!((resolved_cost - 4.9_f64).abs() < 0.001);

    sqlx::query!(
        r#"INSERT INTO riviamigo.charge_sessions
           (vehicle_id, started_at, ended_at, location_lat, location_lng,
            geofence_id, address_id, is_home, kwh_added, duration_minutes,
            cost_profile_id, cost_method, cost_usd)
           VALUES ($1, now() - interval '1 day', now() - interval '1 day' + interval '2 hours',
                   $2, $3, $4, $5, true, $6, $7, $8, 'profile', $9)"#,
        vehicle_id,
        29.8185291_f64,
        -95.3882141_f64,
        geofence_id,
        address_id,
        24.5_f64,
        120_i32,
        cost_profile_id,
        resolved_cost,
    )
    .execute(&app.pool)
    .await
    .expect("charge session");

    let res = app
        .request(
            Method::GET,
            &format!("/v1/vehicles/{vehicle_id}/charging-sessions"),
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.body["data"][0]["location_name"], json!("Home - Test"));
    assert_eq!(res.body["data"][0]["is_home"], json!(true));
    assert_eq!(res.body["data"][0]["cost_usd"], json!(4.9));

    let cost_res = app
        .request(
            Method::GET,
            &format!("/v1/vehicles/{vehicle_id}/costs"),
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(cost_res.status, StatusCode::OK);
    assert_eq!(cost_res.body["total_cost_usd"], json!(4.9));
}

#[tokio::test]
async fn charging_sessions_use_the_local_start_date() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "charging-daykey@example.com").await;
    let user_id: uuid::Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "charging-daykey@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("user id");

    let vehicle_id = insert_vehicle(
        &app.pool,
        user_id,
        "charging-daykey-vehicle",
        "DayKey Truck",
    )
    .await;

    sqlx::query(
        "INSERT INTO riviamigo.system_config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    .bind("app_timezone")
    .bind("America/Chicago")
    .execute(&app.pool)
    .await
    .expect("update timezone");

    // 2026-05-24 00:30 in America/Chicago => the session date should be 2026-05-24.
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-24T05:30:00Z")
        .expect("parse started_at")
        .with_timezone(&chrono::Utc);
    let ended_at = chrono::DateTime::parse_from_rfc3339("2026-05-24T07:00:00Z")
        .expect("parse ended_at")
        .with_timezone(&chrono::Utc);

    sqlx::query!(
        r#"INSERT INTO riviamigo.charge_sessions
           (vehicle_id, started_at, ended_at, kwh_added, duration_minutes)
           VALUES ($1, $2, $3, $4, $5)"#,
        vehicle_id,
        started_at,
        ended_at,
        18.0_f64,
        90_i32,
    )
    .execute(&app.pool)
    .await
    .expect("insert charge session");

    let res = app
        .request(
            Method::GET,
            &format!(
                "/v1/vehicles/{vehicle_id}/charging-sessions?from=2026-05-24T00:00:00Z&to=2026-05-25T00:00:00Z"
            ),
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(
        res.body["data"][0]["session_day_local"],
        json!("2026-05-24")
    );
}

#[tokio::test]
async fn charging_curve_analysis_uses_fallback_history_for_longer_windows() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "charging-curve-fallback@example.com").await;
    let user_id: uuid::Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "charging-curve-fallback@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("user id");

    let vehicle_id = insert_vehicle(
        &app.pool,
        user_id,
        "charging-curve-fallback-vehicle",
        "Fallback Truck",
    )
    .await;

    sqlx::query!(
        r#"INSERT INTO riviamigo.vehicle_memberships
           (vehicle_id, user_id, role, is_default)
           VALUES ($1, $2, 'owner', TRUE)
           ON CONFLICT (vehicle_id, user_id) DO UPDATE
           SET role = EXCLUDED.role,
               is_default = EXCLUDED.is_default"#,
        vehicle_id,
        user_id,
    )
    .execute(&app.pool)
    .await
    .expect("vehicle membership");

    let started_at = chrono::Utc::now() - chrono::Duration::days(60);
    let ended_at = started_at + chrono::Duration::minutes(24);
    let session_id = sqlx::query_scalar!(
        r#"INSERT INTO riviamigo.charge_sessions
           (vehicle_id, started_at, ended_at, charger_type, soc_start, soc_end, duration_minutes, kwh_added)
           VALUES ($1, $2, $3, 'dc', $4, $5, 24, 44.0)
           RETURNING id"#,
        vehicle_id,
        started_at,
        ended_at,
        18.0_f64,
        78.0_f64,
    )
    .fetch_one(&app.pool)
    .await
    .expect("charge session");

    let query_time = |value: chrono::DateTime<chrono::Utc>| value.to_rfc3339().replace('+', "%2B");

    sqlx::query!(
        r#"INSERT INTO riviamigo.rivian_charge_curve_points
           (vehicle_id, charge_session_id, ts, power_kw)
           VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)"#,
        vehicle_id,
        session_id,
        started_at + chrono::Duration::minutes(4),
        176.0_f64,
        started_at + chrono::Duration::minutes(14),
        118.0_f64,
    )
    .execute(&app.pool)
    .await
    .expect("insert fallback curve points");

    let thirty_day_res = app
        .request(
            Method::GET,
            &format!(
                "/v1/charging/curve-analysis?vehicle_id={vehicle_id}&from={}&to={}",
                query_time(chrono::Utc::now() - chrono::Duration::days(30)),
                query_time(chrono::Utc::now())
            ),
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(thirty_day_res.status, StatusCode::OK);
    assert!(thirty_day_res
        .body
        .as_array()
        .expect("30-day array")
        .is_empty());

    let ninety_day_res = app
        .request(
            Method::GET,
            &format!(
                "/v1/charging/curve-analysis?vehicle_id={vehicle_id}&from={}&to={}",
                query_time(chrono::Utc::now() - chrono::Duration::days(90)),
                query_time(chrono::Utc::now())
            ),
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(ninety_day_res.status, StatusCode::OK);
    let rows = ninety_day_res.body.as_array().expect("90-day array");
    assert!(!rows.is_empty(), "expected fallback-backed curve rows");
    assert!(rows
        .iter()
        .all(|row| row["session_id"] == json!(session_id)));
    assert!(rows
        .iter()
        .all(|row| row["sample_source"] == json!("rivian_charge_curve_points")));
    assert!(rows
        .iter()
        .all(|row| row["power_method"] == json!("recorded")));
}

#[tokio::test]
async fn charging_curve_analysis_uses_elapsed_time_and_strict_dc_sessions() {
    let app = TestApp::new().await;
    let token = register_and_login(&app, "charging-curve-interval@example.com").await;
    let user_id: uuid::Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "charging-curve-interval@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("user id");
    let vehicle_id = insert_vehicle(
        &app.pool,
        user_id,
        "charging-curve-interval-vehicle",
        "Interval Truck",
    )
    .await;

    let started_at = chrono::Utc::now() - chrono::Duration::days(2);
    let ended_at = started_at + chrono::Duration::minutes(20);
    let dc_session_id: uuid::Uuid = sqlx::query_scalar(
        r#"INSERT INTO riviamigo.charge_sessions
           (vehicle_id, started_at, ended_at, charger_type, is_home, soc_start, soc_end)
           VALUES ($1, $2, $3, 'dc', FALSE, 10.0, 30.0)
           RETURNING id"#,
    )
    .bind(vehicle_id)
    .bind(started_at)
    .bind(ended_at)
    .fetch_one(&app.pool)
    .await
    .expect("dc session");

    let home_session_id: uuid::Uuid = sqlx::query_scalar(
        r#"INSERT INTO riviamigo.charge_sessions
           (vehicle_id, started_at, ended_at, charger_type, is_home, soc_start, soc_end)
           VALUES ($1, $2, $3, 'dc', TRUE, 10.0, 30.0)
           RETURNING id"#,
    )
    .bind(vehicle_id)
    .bind(started_at + chrono::Duration::minutes(30))
    .bind(ended_at + chrono::Duration::minutes(30))
    .fetch_one(&app.pool)
    .await
    .expect("home session");

    let vendor_only_session_id: uuid::Uuid = sqlx::query_scalar(
        r#"INSERT INTO riviamigo.charge_sessions
           (vehicle_id, started_at, ended_at, charger_type, network_vendor, is_home, soc_start, soc_end)
           VALUES ($1, $2, $3, NULL, 'Tesla', FALSE, 10.0, 30.0)
           RETURNING id"#,
    )
    .bind(vehicle_id)
    .bind(started_at + chrono::Duration::minutes(60))
    .bind(ended_at + chrono::Duration::minutes(60))
    .fetch_one(&app.pool)
    .await
    .expect("vendor-only session");

    for (offset_seconds, battery_level, power_kw) in [
        (0_i64, 10.0_f64, None),
        (15, 10.5, None),
        (30, 10.5, Some(100.0_f64)),
        (45, 10.5, Some(120.0_f64)),
        (60, 11.0, None),
    ] {
        sqlx::query(
            r#"INSERT INTO timeseries.telemetry
               (ts, vehicle_id, charge_session_id, battery_level, battery_capacity_wh, power_kw)
               VALUES ($1, $2, $3, $4, $5, $6)"#,
        )
        .bind(started_at + chrono::Duration::seconds(offset_seconds))
        .bind(vehicle_id)
        .bind(dc_session_id)
        .bind(battery_level)
        .bind(110_000.0_f64)
        .bind(power_kw)
        .execute(&app.pool)
        .await
        .expect("curve telemetry");
    }

    let query_time = |value: chrono::DateTime<chrono::Utc>| value.to_rfc3339().replace('+', "%2B");
    let res = app
        .request(
            Method::GET,
            &format!(
                "/v1/charging/curve-analysis?vehicle_id={vehicle_id}&from={}&to={}",
                query_time(chrono::Utc::now() - chrono::Duration::days(7)),
                query_time(chrono::Utc::now())
            ),
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::OK);
    let rows = res.body.as_array().expect("curve rows");
    assert!(rows
        .iter()
        .all(|row| row["session_id"] == json!(dc_session_id)));
    assert_eq!(rows.len(), 2, "one point per session and exact SoC");
    let recorded = rows
        .iter()
        .find(|row| row["soc_pct"] == json!(10.5))
        .expect("recorded same-SoC point");
    assert_eq!(recorded["power_method"], json!("recorded"));
    assert!((recorded["charge_rate_kw"].as_f64().unwrap_or_default() - 110.0).abs() < 0.01);
    let derived = rows
        .iter()
        .find(|row| row["soc_pct"] == json!(11.0))
        .expect("15-second derived point");
    assert_eq!(derived["power_method"], json!("soc_delta"));
    assert!((derived["charge_rate_kw"].as_f64().unwrap_or_default() - 132.0).abs() < 0.01);
    assert!(!rows
        .iter()
        .any(|row| row["session_id"] == json!(home_session_id)));
    assert!(!rows
        .iter()
        .any(|row| row["session_id"] == json!(vendor_only_session_id)));
}

#[tokio::test]
async fn auth_public_limit_uses_forwarded_ip_and_sets_api_source_header() {
    let app = TestApp::new_with_rate_limit(deterministic_rate_limit_config()).await;

    let mut first_ip_limited = false;
    for i in 0..20 {
        let res = app
            .request_with_forwarded_ip(
                Method::POST,
                "/v1/auth/login",
                Some(json!({"email": "nobody@example.com", "password": "bad-password"})),
                None,
                None,
                Some("203.0.113.10"),
            )
            .await;

        if res.status == StatusCode::TOO_MANY_REQUESTS {
            first_ip_limited = true;
            let source = res
                .headers
                .get("x-riviamigo-ratelimit-source")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            assert_eq!(source, "api");
            break;
        }
        assert!(
            matches!(
                res.status,
                StatusCode::UNAUTHORIZED | StatusCode::TOO_MANY_REQUESTS
            ),
            "unexpected status on attempt {i}: {}",
            res.status
        );
    }
    assert!(
        first_ip_limited,
        "expected first forwarded IP to be rate limited"
    );

    let other_ip = app
        .request_with_forwarded_ip(
            Method::POST,
            "/v1/auth/login",
            Some(json!({"email": "nobody@example.com", "password": "bad-password"})),
            None,
            None,
            Some("203.0.113.11"),
        )
        .await;
    assert_eq!(
        other_ip.status,
        StatusCode::UNAUTHORIZED,
        "different forwarded IP should not share auth-public bucket"
    );
}

#[tokio::test]
async fn authenticated_limits_are_isolated_by_user_identity() {
    let app = TestApp::new_with_rate_limit(deterministic_rate_limit_config()).await;
    let token_one = register_and_login(&app, "rl-user-one@example.com").await;
    let token_two = insert_user_and_login(&app, "rl-user-two@example.com", "hunter2hunter2").await;

    let mut limited = false;
    for _ in 0..300 {
        let res = app
            .request(Method::GET, "/v1/auth/me", None, Some(&token_one), None)
            .await;
        if res.status == StatusCode::TOO_MANY_REQUESTS {
            limited = true;
            break;
        }
    }
    assert!(limited, "expected user one to eventually hit read limiter");

    let user_two = app
        .request(Method::GET, "/v1/auth/me", None, Some(&token_two), None)
        .await;
    assert_eq!(
        user_two.status,
        StatusCode::OK,
        "second user should not share the first user's limiter bucket"
    );
}

#[tokio::test]
async fn metadata_limits_do_not_block_regular_authenticated_reads() {
    let app = TestApp::new_with_rate_limit(deterministic_rate_limit_config()).await;
    let token = register_and_login(&app, "rl-metadata@example.com").await;

    let mut limited = false;
    for _ in 0..300 {
        let res = app
            .request(Method::GET, "/v1/auth/me", None, Some(&token), None)
            .await;
        if res.status == StatusCode::TOO_MANY_REQUESTS {
            limited = true;
            break;
        }
    }
    assert!(limited, "expected metadata limiter to activate");

    let regular_read = app
        .request(Method::GET, "/v1/vehicles", None, Some(&token), None)
        .await;
    assert_eq!(
        regular_read.status,
        StatusCode::OK,
        "exhausting metadata traffic should not block ordinary authenticated reads"
    );
}

#[tokio::test]
async fn heavy_read_exhaustion_does_not_block_regular_authenticated_reads() {
    let app = TestApp::new_with_rate_limit(deterministic_rate_limit_config()).await;
    let token = register_and_login(&app, "rl-heavy@example.com").await;

    let user_id: uuid::Uuid = sqlx::query_scalar!(
        "SELECT id FROM riviamigo.users WHERE email = $1",
        "rl-heavy@example.com"
    )
    .fetch_one(&app.pool)
    .await
    .expect("user id");
    let vehicle_id = insert_vehicle(&app.pool, user_id, "heavy-rate-vehicle", "Heavy Truck").await;

    let mut heavy_limited = false;
    for _ in 0..120 {
        let res = app
            .request(
                Method::GET,
                &format!("/v1/vehicles/{vehicle_id}/live-session"),
                None,
                Some(&token),
                None,
            )
            .await;
        if res.status == StatusCode::TOO_MANY_REQUESTS {
            heavy_limited = true;
            break;
        }
    }
    assert!(heavy_limited, "expected heavy read limiter to activate");

    let regular_read = app
        .request(Method::GET, "/v1/auth/me", None, Some(&token), None)
        .await;
    assert_eq!(
        regular_read.status,
        StatusCode::OK,
        "exhausting heavy-read traffic should not block normal auth reads"
    );
}

#[tokio::test]
async fn verified_enrollment_rejects_unlisted_ids_and_preserves_existing_authority() {
    use redis::AsyncCommands;
    use riviamigo_api::ingestion::session_store::{encrypt_tokens, RivianTokenBundle};
    let app = TestApp::new_with_rate_limit_and_pool_size(RateLimitConfig::default(), 4).await;
    let owner_token = register_and_login(&app, "proof-owner@example.com").await;
    let join_token =
        insert_user_and_login(&app, "proof-joiner@example.com", "hunter2hunter2").await;
    let owner: Uuid =
        sqlx::query_scalar("SELECT id FROM riviamigo.users WHERE email='proof-owner@example.com'")
            .fetch_one(&app.pool)
            .await
            .unwrap();
    let joiner: Uuid =
        sqlx::query_scalar("SELECT id FROM riviamigo.users WHERE email='proof-joiner@example.com'")
            .fetch_one(&app.pool)
            .await
            .unwrap();
    let vehicle = insert_vehicle(&app.pool, owner, "verified-existing", "Existing").await;
    let original_credentials = vec![4_u8, 2, 0, 7];
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_credentials(vehicle_id,encrypted_tokens,token_created_at) VALUES ($1,$2,now())",
    )
    .bind(vehicle)
    .bind(&original_credentials)
    .execute(&app.pool)
    .await
    .unwrap();
    let gateway = Router::new().route("/graphql", axum::routing::post(|| async {
        axum::Json(json!({"data":{"currentUser":{"vehicles":[{"id":"verified-existing","vin":"provider-vin","vehicle":{"model":"R1S"}},{"id":"verified-new","vin":"new-provider-vin","vehicle":{"model":"R1S"}}]}}}))
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, gateway).await.unwrap();
    });
    std::env::set_var(
        "RIVIAN_GRAPHQL_GATEWAY_URL",
        format!("http://{address}/graphql"),
    );
    let bundle = RivianTokenBundle {
        access_token: "proof-access".into(),
        refresh_token: "proof-refresh".into(),
        app_session_token: "proof-app".into(),
        user_session_token: "proof-user".into(),
        csrf_token: "proof-csrf".into(),
        created_at: chrono::Utc::now(),
    };
    let encrypted = encrypt_tokens(&bundle, &app.state.age_key.parse().unwrap()).unwrap();
    let mut redis = app
        .state
        .redis
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let _: () = redis
        .set_ex(format!("rivian:connect:{joiner}"), &encrypted, 60)
        .await
        .unwrap();
    let denied = app
        .request(
            Method::POST,
            "/v1/vehicles",
            Some(json!({"rivian_vehicle_id":"unlisted-id","model":"R1T","vin":"browser-vin"})),
            Some(&join_token),
            None,
        )
        .await;
    assert_eq!(
        denied.status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{}",
        denied.body
    );
    let (a, b) = tokio::join!(
        app.request(
            Method::POST,
            "/v1/vehicles",
            Some(json!({"rivian_vehicle_id":"verified-existing"})),
            Some(&join_token),
            None
        ),
        app.request(
            Method::POST,
            "/v1/vehicles",
            Some(json!({"rivian_vehicle_id":"verified-existing"})),
            Some(&join_token),
            None
        )
    );
    assert!(a.status == StatusCode::OK || b.status == StatusCode::OK);
    for response in [&a, &b] {
        assert!(
            matches!(response.status, StatusCode::OK | StatusCode::CONFLICT),
            "{}",
            response.body
        );
        if response.status == StatusCode::OK {
            assert_eq!(response.body["telemetry_status"], "unchanged");
        }
    }
    let role: String = sqlx::query_scalar(
        "SELECT role FROM riviamigo.vehicle_memberships WHERE vehicle_id=$1 AND user_id=$2",
    )
    .bind(vehicle)
    .bind(joiner)
    .fetch_one(&app.pool)
    .await
    .unwrap();
    assert_eq!(role, "viewer");
    let credentials: Vec<u8> = sqlx::query_scalar(
        "SELECT encrypted_tokens FROM riviamigo.vehicle_credentials WHERE vehicle_id=$1",
    )
    .bind(vehicle)
    .fetch_one(&app.pool)
    .await
    .unwrap();
    assert_eq!(credentials, original_credentials);
    let owner_role: String = sqlx::query_scalar(
        "SELECT role FROM riviamigo.vehicle_memberships WHERE vehicle_id=$1 AND user_id=$2",
    )
    .bind(vehicle)
    .bind(owner)
    .fetch_one(&app.pool)
    .await
    .unwrap();
    assert_eq!(owner_role, "owner");
    // Two independently verified accounts race to enroll one unseen vehicle.
    // Exactly the creator becomes owner; the second verified account is Viewer.
    for account in [owner, joiner] {
        let _: () = redis
            .set_ex(format!("rivian:connect:{account}"), &encrypted, 60)
            .await
            .unwrap();
    }
    let (first, second) = tokio::join!(
        app.request(
            Method::POST,
            "/v1/vehicles",
            Some(json!({"rivian_vehicle_id":"verified-new","vin":"forged-vin","model":"R1T"})),
            Some(&owner_token),
            None
        ),
        app.request(
            Method::POST,
            "/v1/vehicles",
            Some(json!({"rivian_vehicle_id":"verified-new"})),
            Some(&join_token),
            None
        )
    );
    assert_eq!(first.status, StatusCode::OK, "{}", first.body);
    assert_eq!(second.status, StatusCode::OK, "{}", second.body);
    let created: (Uuid, String, String) = sqlx::query_as(
        "SELECT id,model,vin FROM riviamigo.vehicles WHERE rivian_vehicle_id='verified-new'",
    )
    .fetch_one(&app.pool)
    .await
    .unwrap();
    assert_eq!(created.1, "R1S");
    assert_eq!(created.2, "new-provider-vin");
    let roles: Vec<String> = sqlx::query_scalar(
        "SELECT role FROM riviamigo.vehicle_memberships WHERE vehicle_id=$1 ORDER BY role",
    )
    .bind(created.0)
    .fetch_all(&app.pool)
    .await
    .unwrap();
    assert_eq!(roles, vec!["owner", "viewer"]);
    assert_eq!(
        app.request(Method::GET, "/v1/auth/me", None, Some(&owner_token), None)
            .await
            .status,
        StatusCode::OK
    );
    std::env::remove_var("RIVIAN_GRAPHQL_GATEWAY_URL");
    server.abort();
}

#[tokio::test]
async fn live_sockets_enforce_quota_expiry_and_membership_revocation() {
    use futures::{SinkExt, StreamExt};
    use riviamigo_api::middleware::auth::Claims;
    use tokio_tungstenite::{
        connect_async,
        tungstenite::{client::IntoClientRequest, Message},
    };
    let app = TestApp::new().await;
    let token = register_and_login(&app, "live-security@example.com").await;
    let user: Uuid = sqlx::query_scalar(
        "SELECT id FROM riviamigo.users WHERE email='live-security@example.com'",
    )
    .fetch_one(&app.pool)
    .await
    .unwrap();
    let vehicle = insert_vehicle(&app.pool, user, "live-fixture", "Live").await;
    let mut state = app.state.clone();
    state.config.security.ws_max_per_user = 1;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            routes::build_router(state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    let request = |jwt: &str| {
        let mut req = format!("ws://{address}/v1/vehicles/live?vehicle_id={vehicle}")
            .into_client_request()
            .unwrap();
        req.headers_mut().insert(
            "sec-websocket-protocol",
            format!("bearer, bearer.{jwt}").parse().unwrap(),
        );
        req
    };
    let (mut socket, _) = connect_async(request(&token)).await.unwrap();
    let denied = connect_async(request(&token)).await.unwrap_err();
    match denied {
        tokio_tungstenite::tungstenite::Error::Http(response) => {
            assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
            assert_eq!(response.headers()["retry-after"], "5");
        }
        other => panic!("unexpected error: {other}"),
    }
    // Let the initial authorization check complete, then remove membership.
    tokio::time::timeout(std::time::Duration::from_secs(5), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    sqlx::query("DELETE FROM riviamigo.vehicle_memberships WHERE vehicle_id=$1 AND user_id=$2")
        .bind(vehicle)
        .bind(user)
        .execute(&app.pool)
        .await
        .unwrap();
    let closed = tokio::time::timeout(std::time::Duration::from_secs(35), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Close(Some(frame)))) => break frame.code,
                Some(Ok(Message::Ping(bytes))) => {
                    let _ = socket.send(Message::Pong(bytes)).await;
                }
                Some(Ok(_)) => {}
                other => panic!("unexpected stream end: {other:?}"),
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(u16::from(closed), 4403);
    drop(socket);
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_memberships(vehicle_id,user_id,role) VALUES ($1,$2,'owner')",
    )
    .bind(vehicle)
    .bind(user)
    .execute(&app.pool)
    .await
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let now = chrono::Utc::now().timestamp();
    let short = jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
        &Claims {
            sub: user,
            iss: "riviamigo.app".into(),
            exp: now + 3,
            iat: now,
            default_vehicle_id: Some(vehicle),
            sid: None,
        },
        &app.state.jwt_keys.encoding,
    )
    .unwrap();
    let (mut socket, _) = connect_async(request(&short)).await.unwrap();
    let closed = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Close(Some(frame)))) => break frame.code,
                Some(Ok(Message::Ping(bytes))) => {
                    let _ = socket.send(Message::Pong(bytes)).await;
                }
                Some(Ok(_)) => {}
                other => panic!("unexpected expiry stream end: {other:?}"),
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(u16::from(closed), 4401);
    server.abort();
}

#[tokio::test]
async fn history_import_is_bounded_inert_and_target_catalog_wins_locator_conflicts() {
    use riviamigo_api::services::{
        restore_history,
        restore_jobs::{merge_catalog_snapshot, BackupArtifactSnapshot, BackupCatalogSnapshot},
    };
    let app = TestApp::new().await;
    let source_id = Uuid::new_v4();
    let target_id = Uuid::new_v4();
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("history.json");
    let source = BackupArtifactSnapshot {
        id: source_id,
        run_id: None,
        storage_type: "s3".into(),
        file_name: "fixture.rma.tar.gz".into(),
        storage_path: "s3://fixture/riviamigo/fixture.rma.tar.gz".into(),
        size_bytes: 1,
        checksum_sha256: "unverified".into(),
        manifest: json!({"restore_availability":"available"}),
        created_at: chrono::Utc::now(),
    };
    // Historical field order is deliberately different from FK dependency order.
    std::fs::write(
        &path,
        json!({"restore_requests":[],"artifacts":[source],"runs":[]}).to_string(),
    )
    .unwrap();
    assert!(restore_history::merge(&app.pool, &path, 8).await.is_err());
    restore_history::merge(&app.pool, &path, 4096)
        .await
        .unwrap();
    let available: String = sqlx::query_scalar(
        "SELECT manifest->>'restore_availability' FROM riviamigo.backup_artifacts WHERE id=$1",
    )
    .bind(source_id)
    .fetch_one(&app.pool)
    .await
    .unwrap();
    assert_eq!(available, "unavailable");
    let mut target = source.clone();
    target.id = target_id;
    target.checksum_sha256 = "target-verified".into();
    target.manifest = json!({"restore_availability":"available"});
    merge_catalog_snapshot(
        &app.pool,
        &BackupCatalogSnapshot {
            runs: vec![],
            artifacts: vec![target],
            restore_requests: vec![],
        },
    )
    .await
    .unwrap();
    let old:(String,String)=sqlx::query_as("SELECT storage_path,manifest->>'restore_availability' FROM riviamigo.backup_artifacts WHERE id=$1").bind(source_id).fetch_one(&app.pool).await.unwrap();
    assert!(old.0.starts_with("unavailable:"));
    assert_eq!(old.1, "unavailable");
    let checksum: String =
        sqlx::query_scalar("SELECT checksum_sha256 FROM riviamigo.backup_artifacts WHERE id=$1")
            .bind(target_id)
            .fetch_one(&app.pool)
            .await
            .unwrap();
    assert_eq!(checksum, "target-verified");
}
