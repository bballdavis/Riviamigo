use std::borrow::Cow;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::Path;
use std::sync::Arc;

use axum::{
    body::{to_bytes, Body},
    extract::ConnectInfo,
    http::{
        header::{AUTHORIZATION, CONTENT_TYPE, COOKIE, SET_COOKIE},
        HeaderMap, Method, Request, StatusCode,
    },
    Router,
};
use serde_json::{json, Value};
use sqlx::{migrate::Migrator, Executor, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

use riviamigo_api::{
    config::Config,
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
        let migrator = Migrator::new(Path::new("./migrations"))
            .await
            .expect("load migrations");
        let (before_0047, after_0047): (Vec<_>, Vec<_>) = migrator
            .iter()
            .cloned()
            .partition(|migration| migration.version < 47);

        Migrator {
            migrations: Cow::Owned(before_0047),
            ignore_missing: false,
            locking: true,
        }
        .run(&pool)
        .await
        .expect("migrate pre-0047");

        seed_super_user(&pool).await.expect("seed super user");

        Migrator {
            migrations: Cow::Owned(after_0047),
            ignore_missing: false,
            locking: true,
        }
        .run(&pool)
        .await
        .expect("migrate post-0047");

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
                    .join("riviamigo-auth-test-backups")
                    .to_string_lossy()
                    .into_owned(),
                backup_driver: "json".into(),
                backup_poll_interval_seconds: 60,
                rivian_ws_reconnect_initial_seconds: 10,
                rivian_ws_reconnect_max_seconds: 900,
                rivian_raw_event_retention_days: 7,
                rivian_persist_raw_events: true,
                rivian_parallax_capture_enabled: true,
                rivian_suppress_duplicate_telemetry: true,
                riviamigo_env: None,
                cookie_insecure: None,
                rate_limit: Default::default(),
                vehicle_image_cache_dir: std::env::temp_dir()
                    .join("riviamigo-auth-test-images")
                    .to_string_lossy()
                    .into_owned(),
            },
            nominatim_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
            supervisor: SupervisorHandle::noop(),
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
}

async fn seed_super_user(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO riviamigo.users (email, password_hash, role)
         VALUES ($1, $2, 'super_user')
         ON CONFLICT (email) DO NOTHING",
    )
    .bind("seed-super-user@riviamigo.test")
    .bind("$argon2id$v=19$m=19456,t=2,p=1$cm9vdHJvb3Ryb290cm9v$6/Ds/Z5DKq/r+z5xFo0O3sDmN5RBUQ2A6yb7z1WB1Wg")
    .execute(pool)
    .await?;

    Ok(())
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
async fn charging_sessions_include_local_charging_window_day() {
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

    sqlx::query!(
        "UPDATE riviamigo.user_preferences SET home_timezone = $1 WHERE user_id = $2",
        "America/Chicago",
        user_id,
    )
    .execute(&app.pool)
    .await
    .expect("update timezone");

    // 2026-05-24 00:30 in America/Chicago => charging-window day key should be 2026-05-23
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
            &format!("/v1/vehicles/{vehicle_id}/charging-sessions"),
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(
        res.body["data"][0]["session_day_local"],
        json!("2026-05-23")
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
}

#[tokio::test]
async fn auth_public_limit_uses_forwarded_ip_and_sets_api_source_header() {
    let app = TestApp::new().await;

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
    let app = TestApp::new().await;
    let token_one = register_and_login(&app, "rl-user-one@example.com").await;
    let token_two = register_and_login(&app, "rl-user-two@example.com").await;

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
    let app = TestApp::new().await;
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
    let app = TestApp::new().await;
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
