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
    services::trip_enrichment::{
        backfill_trip_outside_temps_with_lookup, enrich_trip_history_for_vehicle_with_lookup,
        report_trip_enrichment_gaps,
    },
};
use serde_json::{json, Value};
use sqlx::{Executor, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

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
            .expect("migrate schema");

        seed_super_user(&pool).await.expect("seed super user");

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
                    .join("riviamigo-trip-enrichment-test-backups")
                    .to_string_lossy()
                    .into_owned(),
                backup_driver: "pg_dump".into(),
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
                    .join("riviamigo-trip-enrichment-test-images")
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

async fn insert_address(
    pool: &PgPool,
    display_name: &str,
    latitude: f64,
    longitude: f64,
    road: Option<&str>,
    city: Option<&str>,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO riviamigo.addresses
           (display_name, latitude, longitude, road, city)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id"#,
    )
    .bind(display_name)
    .bind(latitude)
    .bind(longitude)
    .bind(road)
    .bind(city)
    .fetch_one(pool)
    .await
    .expect("insert address")
}

async fn insert_geofence(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    latitude: f64,
    longitude: f64,
    radius_m: f64,
    address_id: Uuid,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO riviamigo.geofences
           (user_id, name, latitude, longitude, radius_m, address_id, is_home, is_work)
           VALUES ($1, $2, $3, $4, $5, $6, false, false)
           RETURNING id"#,
    )
    .bind(user_id)
    .bind(name)
    .bind(latitude)
    .bind(longitude)
    .bind(radius_m)
    .bind(address_id)
    .fetch_one(pool)
    .await
    .expect("insert geofence")
}

#[allow(clippy::too_many_arguments)]
async fn insert_trip(
    pool: &PgPool,
    vehicle_id: Uuid,
    started_at: &str,
    ended_at: &str,
    start_lat: f64,
    start_lng: f64,
    end_lat: f64,
    end_lng: f64,
    efficiency_wh_per_mile: f64,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO riviamigo.trips
           (vehicle_id, started_at, ended_at, start_lat, start_lng, end_lat, end_lng,
            distance_miles, duration_seconds, efficiency_wh_per_mile, soc_start, soc_end)
           VALUES ($1, $2::timestamptz, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id"#,
    )
    .bind(vehicle_id)
    .bind(started_at)
    .bind(ended_at)
    .bind(start_lat)
    .bind(start_lng)
    .bind(end_lat)
    .bind(end_lng)
    .bind(12.0_f64)
    .bind(1_200_i32)
    .bind(efficiency_wh_per_mile)
    .bind(80.0_f64)
    .bind(70.0_f64)
    .fetch_one(pool)
    .await
    .expect("insert trip")
}

#[tokio::test]
async fn trip_history_enrichment_helper_restores_labels_and_outside_temp() {
    let app = TestApp::new().await;
    let email = "trip-enrichment-helper@example.com";
    register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    let vehicle_id =
        insert_vehicle(&app.pool, user_id, "trip-helper-vehicle", "Helper Truck").await;

    let start_address_id = insert_address(
        &app.pool,
        "North Main Street, Houston, TX 77009",
        29.8182846_f64,
        -95.3881685_f64,
        Some("North Main Street"),
        Some("Houston"),
    )
    .await;
    insert_geofence(
        &app.pool,
        user_id,
        "Home - Test",
        29.8182846_f64,
        -95.3881685_f64,
        100.0_f64,
        start_address_id,
    )
    .await;

    insert_address(
        &app.pool,
        "Aurora Street, Houston, TX 77058",
        29.84793_f64,
        -95.50235_f64,
        Some("Aurora Street"),
        Some("Houston"),
    )
    .await;

    let trip_id = insert_trip(
        &app.pool,
        vehicle_id,
        "2026-06-16T22:45:00Z",
        "2026-06-16T23:05:00Z",
        29.81831_f64,
        -95.38817_f64,
        29.84793_f64,
        -95.50235_f64,
        320.0_f64,
    )
    .await;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .expect("reqwest client");

    let report = enrich_trip_history_for_vehicle_with_lookup(
        &app.pool,
        &client,
        vehicle_id,
        |_lat, _lng, _started_at| async move { Some(21.5_f64) },
    )
    .await
    .expect("trip enrichment helper");

    assert_eq!(report.geofence_matches.filled, 1);
    assert_eq!(report.address_matches.filled, 1);
    assert_eq!(report.outside_temps.filled, 1);

    let row = sqlx::query_as::<_, (Option<Uuid>, Option<Uuid>, Option<Uuid>, Option<Uuid>, Option<f64>)>(
        "SELECT start_geofence_id, end_geofence_id, start_address_id, end_address_id, outside_temp_c
         FROM riviamigo.trips
         WHERE id = $1",
    )
    .bind(trip_id)
    .fetch_one(&app.pool)
    .await
    .expect("enriched trip row");

    assert!(row.0.is_some(), "expected start geofence to be populated");
    assert!(
        row.1.is_none(),
        "did not expect an end geofence for this fixture"
    );
    assert!(row.2.is_some(), "expected start address to be populated");
    assert!(row.3.is_some(), "expected end address to be populated");
    assert_eq!(row.4, Some(21.5_f64));
}

#[tokio::test]
async fn trips_route_surfaces_human_readable_start_and_destination_labels() {
    let app = TestApp::new().await;
    let email = "trip-route-labels@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    let vehicle_id = insert_vehicle(&app.pool, user_id, "trip-route-vehicle", "Route Truck").await;

    let start_address_id = insert_address(
        &app.pool,
        "North Main Street, Houston, TX 77009",
        29.8182846_f64,
        -95.3881685_f64,
        Some("North Main Street"),
        Some("Houston"),
    )
    .await;
    let geofence_id = insert_geofence(
        &app.pool,
        user_id,
        "Home - Test",
        29.8182846_f64,
        -95.3881685_f64,
        100.0_f64,
        start_address_id,
    )
    .await;
    let end_address_id = insert_address(
        &app.pool,
        "Aurora Street, Houston, TX 77058",
        29.84793_f64,
        -95.50235_f64,
        Some("Aurora Street"),
        Some("Houston"),
    )
    .await;

    sqlx::query(
        r#"INSERT INTO riviamigo.trips
           (vehicle_id, started_at, ended_at, start_lat, start_lng, end_lat, end_lng,
            distance_miles, duration_seconds, efficiency_wh_per_mile, soc_start, soc_end,
            start_geofence_id, start_address_id, end_address_id)
           VALUES ($1, $2::timestamptz, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)"#,
    )
    .bind(vehicle_id)
    .bind("2026-06-17T13:25:00Z")
    .bind("2026-06-17T13:45:00Z")
    .bind(29.81831_f64)
    .bind(-95.38817_f64)
    .bind(29.84793_f64)
    .bind(-95.50235_f64)
    .bind(10.0_f64)
    .bind(1_200_i32)
    .bind(280.0_f64)
    .bind(90.0_f64)
    .bind(84.0_f64)
    .bind(geofence_id)
    .bind(start_address_id)
    .bind(end_address_id)
    .execute(&app.pool)
    .await
    .expect("insert labeled trip");

    let response = app
        .request(
            Method::GET,
            &format!(
                "/v1/trips?vehicle_id={vehicle_id}&from=2026-06-01T00:00:00Z&to=2026-06-30T23:59:59Z"
            ),
            None,
            Some(&token),
        )
        .await;

    assert_eq!(response.status, StatusCode::OK);
    assert!(response.headers.contains_key("content-type"));
    assert_eq!(
        response.body["items"][0]["start_place"],
        json!("Home - Test")
    );
    assert_eq!(
        response.body["items"][0]["start_address"],
        json!("North Main Street, Houston, TX 77009")
    );
    assert_eq!(
        response.body["items"][0]["end_place"],
        json!("Aurora Street, Houston")
    );
    assert_eq!(
        response.body["items"][0]["end_address"],
        json!("Aurora Street, Houston, TX 77058")
    );
}

#[tokio::test]
async fn efficiency_vs_temp_includes_trips_after_outside_temp_backfill() {
    let app = TestApp::new().await;
    let email = "efficiency-vs-temp@example.com";
    let token = register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    let vehicle_id = insert_vehicle(
        &app.pool,
        user_id,
        "trip-efficiency-vehicle",
        "Efficiency Truck",
    )
    .await;

    insert_trip(
        &app.pool,
        vehicle_id,
        "2026-06-12T14:00:00Z",
        "2026-06-12T14:20:00Z",
        29.81831_f64,
        -95.38817_f64,
        29.84793_f64,
        -95.50235_f64,
        320.0_f64,
    )
    .await;

    let path = format!(
        "/v1/efficiency/vs-temp?vehicle_id={vehicle_id}&from=2026-06-01T00:00:00Z&to=2026-06-30T23:59:59Z"
    );

    let before = app.request(Method::GET, &path, None, Some(&token)).await;
    assert_eq!(before.status, StatusCode::OK);
    assert_eq!(before.body, json!([]));

    let stats = backfill_trip_outside_temps_with_lookup(
        &app.pool,
        Some(vehicle_id),
        |_lat, _lng, _started_at| async move { Some(21.0_f64) },
        None,
    )
    .await
    .expect("outside temp backfill");

    assert_eq!(stats.filled, 1);

    let after = app.request(Method::GET, &path, None, Some(&token)).await;
    assert_eq!(after.status, StatusCode::OK);
    assert_eq!(after.body.as_array().map(|rows| rows.len()), Some(1));
    assert_eq!(after.body[0]["trip_count"], json!(1));
    assert_eq!(after.body[0]["avg_efficiency_wh_mi"], json!(320.0));
}

#[tokio::test]
async fn trip_enrichment_diagnostics_distinguish_recoverable_and_unrecoverable_gaps() {
    let app = TestApp::new().await;
    let email = "trip-enrichment-diagnostics@example.com";
    register_and_login(&app, email).await;
    let user_id = lookup_user_id(&app.pool, email).await;
    let vehicle_id = insert_vehicle(
        &app.pool,
        user_id,
        "trip-diagnostics-vehicle",
        "Diagnostics Truck",
    )
    .await;

    insert_address(
        &app.pool,
        "North Main Street, Houston, TX 77009",
        29.8182846_f64,
        -95.3881685_f64,
        Some("North Main Street"),
        Some("Houston"),
    )
    .await;

    insert_trip(
        &app.pool,
        vehicle_id,
        "2026-06-09T14:00:00Z",
        "2026-06-09T14:10:00Z",
        29.81831_f64,
        -95.38817_f64,
        29.84793_f64,
        -95.50235_f64,
        315.0_f64,
    )
    .await;

    sqlx::query(
        r#"INSERT INTO riviamigo.trips
           (vehicle_id, started_at, ended_at, distance_miles, duration_seconds, efficiency_wh_per_mile, soc_start, soc_end)
           VALUES ($1, $2::timestamptz, $3::timestamptz, $4, $5, $6, $7, $8)"#,
    )
    .bind(vehicle_id)
    .bind("2026-06-09T18:00:00Z")
    .bind("2026-06-09T18:20:00Z")
    .bind(5.0_f64)
    .bind(1_200_i32)
    .bind(360.0_f64)
    .bind(80.0_f64)
    .bind(74.0_f64)
    .execute(&app.pool)
    .await
    .expect("insert unrecoverable trip");

    let rows = report_trip_enrichment_gaps(&app.pool, Some(vehicle_id))
        .await
        .expect("trip enrichment diagnostics");

    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.total_trips, 2);
    assert_eq!(row.missing_start_address_id, 2);
    assert_eq!(row.missing_end_address_id, 2);
    assert_eq!(row.missing_outside_temp_c, 2);
    assert_eq!(row.missing_start_address_with_coordinates, 1);
    assert_eq!(row.start_address_cached_matches, 1);
    assert_eq!(row.missing_outside_temp_with_coordinates, 1);
    assert_eq!(
        row.missing_outside_temp_unrecoverable_no_start_coordinates,
        1
    );
}
