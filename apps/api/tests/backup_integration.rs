use std::io::Cursor;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use axum::{
    body::{to_bytes, Body},
    extract::ConnectInfo,
    http::{
        header::{AUTHORIZATION, CONTENT_TYPE, COOKIE},
        HeaderMap, Method, Request, StatusCode,
    },
    Router,
};
use flate2::{write::GzEncoder, Compression};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Executor, PgPool};
use tar::{Builder, Header};
use tower::ServiceExt;
use uuid::Uuid;

use riviamigo_api::{
    config::Config,
    ingestion::supervisor::SupervisorHandle,
    keys::bootstrap_keys,
    middleware::auth::{AppState, JwtKeys},
    routes,
    services::restore_compatibility,
};

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
        let db_name = format!("riviamigo_backup_test_{}", Uuid::new_v4().simple());

        let admin = PgPool::connect(&admin_db_url)
            .await
            .expect("admin db connect");
        admin
            .execute(sqlx::AssertSqlSafe(format!(
                "CREATE DATABASE \"{db_name}\""
            )))
            .await
            .expect("create test database");

        let db_url = replace_database_name(&base_db_url, &db_name);
        let pool = PgPool::connect(&db_url).await.expect("db connect");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrate");
        let backup_dir =
            std::env::temp_dir().join(format!("riviamigo-backups-{}", Uuid::new_v4().simple()));

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
                backup_artifact_dir: backup_dir.to_string_lossy().into_owned(),
                backup_driver: "pg_dump".into(),
                backup_poll_interval_seconds: 60,
                restore_agent_url: "http://127.0.0.1:3002".into(),
                restore_agent_key_file: "/backups/.restore-agent-key".into(),
                rivian_ws_reconnect_initial_seconds: 10,
                rivian_ws_reconnect_max_seconds: 900,
                rivian_raw_event_retention_days: 7,
                rivian_persist_raw_events: true,
                rivian_suppress_duplicate_telemetry: true,
                riviamigo_env: None,
                cookie_insecure: None,
                vehicle_image_cache_dir: std::env::temp_dir()
                    .join("riviamigo-backup-test-images")
                    .to_string_lossy()
                    .into_owned(),
                rate_limit: Default::default(),
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
            serde_json::from_slice(&bytes).expect("json body")
        };

        TestResponse {
            status,
            headers,
            body,
        }
    }

    async fn request_bytes(
        &self,
        method: Method,
        path: &str,
        bytes: Vec<u8>,
        bearer_token: &str,
        file_name: &str,
    ) -> TestResponse {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header(AUTHORIZATION, format!("Bearer {bearer_token}"))
            .header(CONTENT_TYPE, "application/gzip")
            .header("x-riviamigo-file-name", file_name)
            .body(Body::from(bytes))
            .expect("raw request");
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
            .expect("response bytes");
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

fn test_recovery_package() -> Vec<u8> {
    let mut database = b"PGDMP".to_vec();
    let mut state = 0x9e37_79b9_u32;
    for _ in 0..(96 * 1024) {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        database.push(state as u8);
    }
    let settings = br#"{"present":false}"#;
    let manifest = serde_json::to_vec(&json!({
        "format": "riviamigo-recovery-v1",
        "format_version": 1,
        "components": {
            "database": {
                "path": "database.dump",
                "sha256": hex::encode(Sha256::digest(&database)),
                "size_bytes": database.len()
            },
            "backup_settings": {
                "path": "backup-settings.json",
                "sha256": hex::encode(Sha256::digest(settings)),
                "size_bytes": settings.len()
            },
            "vehicle_image_cache": { "files": [] }
        }
    }))
    .expect("manifest JSON");

    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut archive = Builder::new(encoder);
    for (path, bytes) in [
        ("manifest.json", manifest.as_slice()),
        ("database.dump", database.as_slice()),
        ("backup-settings.json", settings.as_slice()),
    ] {
        let mut header = Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o600);
        header.set_cksum();
        archive
            .append_data(&mut header, path, Cursor::new(bytes))
            .expect("append recovery component");
    }
    let mut directory = Header::new_gnu();
    directory.set_entry_type(tar::EntryType::Directory);
    directory.set_size(0);
    directory.set_mode(0o700);
    directory.set_cksum();
    archive
        .append_data(
            &mut directory,
            "vehicle-image-cache",
            Cursor::new(Vec::<u8>::new()),
        )
        .expect("append artwork directory");
    archive
        .into_inner()
        .expect("finish tar")
        .finish()
        .expect("finish gzip")
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

async fn lookup_user_id(pool: &PgPool, email: &str) -> Uuid {
    sqlx::query_scalar("SELECT id FROM riviamigo.users WHERE email = $1")
        .bind(email)
        .fetch_one(pool)
        .await
        .expect("lookup user")
}

async fn promote_admin(pool: &PgPool, user_id: Uuid) {
    sqlx::query("UPDATE riviamigo.users SET role = 'admin' WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .expect("promote admin");
}

#[tokio::test]
async fn backup_overview_requires_admin_role() {
    let app = TestApp::new().await;
    let email = "backup-user@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    sqlx::query("UPDATE riviamigo.users SET role = 'user' WHERE id = $1")
        .bind(user_id)
        .execute(&app.pool)
        .await
        .expect("demote test user");

    let response = app
        .request(Method::GET, "/v1/admin/backups", None, Some(&token), None)
        .await;

    assert_eq!(response.status, StatusCode::FORBIDDEN);
    assert_eq!(response.body["error"]["code"], "FORBIDDEN");
}

#[tokio::test]
async fn admin_can_read_default_backup_settings() {
    let app = TestApp::new().await;
    let email = "backup-admin@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    promote_admin(&app.pool, user_id).await;

    let response = app
        .request(Method::GET, "/v1/admin/backups", None, Some(&token), None)
        .await;

    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.body["settings"]["enabled"], false);
    assert_eq!(response.body["settings"]["frequency"], "weekly");
    assert_eq!(response.body["settings"]["target_type"], "s3");
    assert_eq!(response.body["settings"]["has_secret_key"], false);
    assert!(response.body["next_run_at"].is_null());
    assert_eq!(response.body["runtime_readiness"]["run_now_allowed"], true);
    assert!(response.body["runtime_readiness"]["reason"].is_null());
    assert_eq!(
        response.body["recent_runs"].as_array().map(Vec::len),
        Some(0)
    );
}

#[tokio::test]
async fn admin_can_update_backup_settings_and_store_encrypted_secret() {
    let app = TestApp::new().await;
    let email = "backup-settings-admin@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    promote_admin(&app.pool, user_id).await;

    let update = app
        .request(
            Method::PUT,
            "/v1/admin/backups/settings",
            Some(json!({
                "enabled": true,
                "local_enabled": true,
                "s3_enabled": true,
                "frequency": "monthly",
                "run_at": "02:30",
                "timezone": "America/Chicago",
                "day_of_week": null,
                "day_of_month": 28,
                "retention_count": 12,
                "target_type": "s3",
                "endpoint": "https://s3.example.com",
                "region": "us-east-1",
                "bucket": "riviamigo-backups",
                "prefix": "prod/riviamigo",
                "access_key": "backup-user",
                "secret_key": "super-secret-value"
            })),
            Some(&token),
            None,
        )
        .await;

    assert_eq!(update.status, StatusCode::OK);
    assert_eq!(update.body["enabled"], true);
    assert_eq!(update.body["frequency"], "monthly");
    assert_eq!(update.body["day_of_month"], 28);
    assert_eq!(update.body["has_secret_key"], true);

    let overview = app
        .request(Method::GET, "/v1/admin/backups", None, Some(&token), None)
        .await;

    assert_eq!(overview.status, StatusCode::OK);
    assert_eq!(overview.body["settings"]["bucket"], "riviamigo-backups");
    assert_eq!(overview.body["settings"]["prefix"], "prod/riviamigo");
    assert_eq!(overview.body["settings"]["has_secret_key"], true);
    assert!(overview.body["next_run_at"].is_string());
    assert_eq!(overview.body["runtime_readiness"]["run_now_allowed"], true);

    let encrypted_secret: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT secret_key_encrypted FROM riviamigo.backup_settings WHERE id = TRUE",
    )
    .fetch_one(&app.pool)
    .await
    .expect("load encrypted secret");

    assert!(encrypted_secret.is_some());
    assert_ne!(encrypted_secret.unwrap(), b"super-secret-value");
}

#[tokio::test]
async fn admin_can_run_backup_and_get_catalog_entry() {
    let app = TestApp::new().await;
    let email = "backup-run-admin@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    promote_admin(&app.pool, user_id).await;

    let response = app
        .request(
            Method::POST,
            "/v1/admin/backups/run",
            None,
            Some(&token),
            None,
        )
        .await;

    assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
    assert_eq!(response.body["run"]["status"], "succeeded");
    assert_eq!(response.body["artifacts"][0]["storage_type"], "local");
    assert!(response.body["artifacts"][0]["storage_path"].is_string());

    let overview = app
        .request(Method::GET, "/v1/admin/backups", None, Some(&token), None)
        .await;

    assert_eq!(overview.status, StatusCode::OK);
    assert_eq!(
        overview.body["recent_runs"].as_array().map(Vec::len),
        Some(1)
    );
    assert_eq!(overview.body["artifacts"].as_array().map(Vec::len), Some(1));
}

#[tokio::test]
async fn admin_can_import_external_recovery_package() {
    let app = TestApp::new().await;
    let email = "backup-import-admin@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    promote_admin(&app.pool, user_id).await;

    let bytes = test_recovery_package();
    assert!(
        bytes.len() > 64 * 1024,
        "fixture must exercise large upload routing"
    );

    let imported = app
        .request_bytes(
            Method::POST,
            "/v1/admin/backups/imports",
            bytes,
            &token,
            "other-server.rma.tar.gz",
        )
        .await;

    assert_eq!(imported.status, StatusCode::CREATED);
    assert_eq!(imported.body["artifact"]["storage_type"], "uploaded");
    assert_eq!(
        imported.body["artifact"]["manifest"]["package"]["format"],
        "riviamigo-recovery-v1"
    );

    let plan = restore_compatibility::plan_restore(
        &json!({
            "format": "riviamigo-recovery-v1",
            "format_version": 1
        }),
        "legacy-package-checksum",
        &app.pool,
        None,
    )
    .await
    .expect("legacy package plan");
    assert!(!plan.compatible);
    assert!(plan.blocking_errors.iter().any(|error| {
        error.code == restore_compatibility::RestoreBlockingCode::UnsupportedMigrationChain
    }));
}

#[tokio::test]
async fn admin_can_create_restore_request_for_artifact() {
    let app = TestApp::new().await;
    let email = "restore-request-admin@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    promote_admin(&app.pool, user_id).await;

    let run = app
        .request(
            Method::POST,
            "/v1/admin/backups/run",
            None,
            Some(&token),
            None,
        )
        .await;
    let artifact_id = run.body["artifacts"][0]["id"]
        .as_str()
        .expect("artifact id");

    let restore = app
        .request(
            Method::POST,
            "/v1/admin/backups/restore-requests",
            Some(json!({
                "artifact_id": artifact_id,
                "confirmation_phrase": "RESTORE",
                "notes": "Operator requested maintenance restore"
            })),
            Some(&token),
            None,
        )
        .await;

    assert_eq!(restore.status, StatusCode::CREATED);
    assert_eq!(restore.body["status"], "pending");
    assert_eq!(restore.body["artifact_id"], artifact_id);

    let overview = app
        .request(Method::GET, "/v1/admin/backups", None, Some(&token), None)
        .await;

    assert_eq!(
        overview.body["restore_requests"].as_array().map(Vec::len),
        Some(1)
    );
}

#[tokio::test]
async fn admin_can_preflight_a_versioned_recovery_package() {
    let app = TestApp::new().await;
    let email = "restore-preflight-admin@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    promote_admin(&app.pool, user_id).await;

    let run = app
        .request(
            Method::POST,
            "/v1/admin/backups/run",
            None,
            Some(&token),
            None,
        )
        .await;
    assert_eq!(run.status, StatusCode::CREATED, "{}", run.body);
    assert_eq!(run.body["run"]["status"], "succeeded", "{}", run.body);
    let artifact_id = run.body["artifacts"][0]["id"]
        .as_str()
        .expect("artifact id");

    let preflight = app
        .request(
            Method::POST,
            "/v1/admin/backups/restores/preflight",
            Some(json!({ "artifact_id": artifact_id })),
            Some(&token),
            None,
        )
        .await;

    assert_eq!(preflight.status, StatusCode::OK, "{}", preflight.body);
    assert_eq!(preflight.body["plan"]["compatible"], true);
    assert_eq!(
        preflight.body["plan"]["package_format"],
        "riviamigo-recovery-v3"
    );
    assert_eq!(preflight.body["plan"]["source"]["migration_version"], 1);
    assert_eq!(preflight.body["plan"]["target"]["migration_version"], 1);
    assert!(preflight.body["plan"]["plan_id"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
}

#[tokio::test]
async fn backup_creation_refuses_a_drifted_live_migration_ledger() {
    let app = TestApp::new().await;
    let email = "backup-ledger-drift-admin@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    promote_admin(&app.pool, user_id).await;

    sqlx::query(
        "UPDATE public._sqlx_migrations
         SET checksum = decode(repeat('00', 48), 'hex')
         WHERE version = 1",
    )
    .execute(&app.pool)
    .await
    .expect("introduce migration checksum drift");

    let response = app
        .request(
            Method::POST,
            "/v1/admin/backups/run",
            None,
            Some(&token),
            None,
        )
        .await;
    assert_eq!(
        response.status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{}",
        response.body
    );
    assert!(response.body.to_string().contains("migration ledger"));
}
