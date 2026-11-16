use super::*;

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn list_vehicles_requires_auth() {
    let app = make_app().await;
    assert_eq!(
        get_status(app, "/v1/vehicles").await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn verified_vin_refresh_keeps_known_vin_when_rivian_omits_it() {
    let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL"))
        .await
        .expect("test database");
    crate::db::migrations::run_current_migrations(&pool)
        .await
        .expect("migrate test database");
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO riviamigo.users (id, email, password_hash) VALUES ($1, $2, 'unused')")
        .bind(user_id)
        .bind(format!("vin-refresh-{user_id}@example.test"))
        .execute(&pool)
        .await
        .unwrap();
    let vehicle_id: Uuid = sqlx::query_scalar(
        "INSERT INTO riviamigo.vehicles (user_id, rivian_vehicle_id, model)
         VALUES ($1, $2, 'R1S') RETURNING id",
    )
    .bind(user_id)
    .bind(format!("vin-refresh-{user_id}"))
    .fetch_one(&pool)
    .await
    .unwrap();

    for (reported, expected) in [
        (Some(" 7FCTGAAL0SN000001 "), Some("7FCTGAAL0SN000001")),
        (None, Some("7FCTGAAL0SN000001")),
        (Some("   "), Some("7FCTGAAL0SN000001")),
        (Some("7FCTGAAL0TN000001"), Some("7FCTGAAL0TN000001")),
    ] {
        let mut tx = pool.begin().await.unwrap();
        refresh_vehicle_vin(&mut tx, vehicle_id, reported)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let saved: Option<String> =
            sqlx::query_scalar("SELECT vin FROM riviamigo.vehicles WHERE id = $1")
                .bind(vehicle_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(saved.as_deref(), expected);
    }

    // A vehicle removed concurrently is not an error.
    let mut tx = pool.begin().await.unwrap();
    refresh_vehicle_vin(&mut tx, Uuid::new_v4(), Some("7FCTGAAL0SN000001"))
        .await
        .unwrap();
    tx.rollback().await.unwrap();

    sqlx::query("DELETE FROM riviamigo.users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn vehicle_list_derives_year_from_stored_vin() {
    let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL"))
        .await
        .expect("test database");
    crate::db::migrations::run_current_migrations(&pool)
        .await
        .expect("migrate test database");
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO riviamigo.users (id, email, password_hash) VALUES ($1, $2, 'unused')")
        .bind(user_id)
        .bind(format!("model-year-{user_id}@example.test"))
        .execute(&pool)
        .await
        .unwrap();

    let cases = [
        (Some("7FCTGAAL0RN000001"), serde_json::json!(2024)),
        (Some("7FCTGAAL0SN000001"), serde_json::json!(2025)),
        (Some("7FCTGAAL0TN000001"), serde_json::json!(2026)),
        (Some("NOT-A-VALID-VIN"), serde_json::Value::Null),
        (None, serde_json::Value::Null),
    ];
    for (vin, _) in &cases {
        let vehicle_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO riviamigo.vehicles
             (id, user_id, rivian_vehicle_id, model, vin)
             VALUES ($1, $2, $3, 'R1S', $4)",
        )
        .bind(vehicle_id)
        .bind(user_id)
        .bind(format!("demo-model-year-{vehicle_id}"))
        .bind(vin)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role)
             VALUES ($1, $2, 'owner')",
        )
        .bind(vehicle_id)
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    }

    let mut state = make_helper_state("redis://127.0.0.1/".into());
    state.pool = pool.clone();
    let Json(body) = list_vehicles(
        State(state),
        crate::middleware::auth::AuthUser {
            user_id,
            default_vehicle_id: None,
            api_access_level: None,
            api_vehicle_id: None,
        },
    )
    .await
    .unwrap();
    let vehicles = body["vehicles"].as_array().expect("vehicle list");
    assert_eq!(vehicles.len(), cases.len());
    for (vin, year) in &cases {
        let vin = vin.map_or(serde_json::Value::Null, serde_json::Value::from);
        let vehicle = vehicles
            .iter()
            .find(|vehicle| vehicle["vin"] == vin)
            .expect("listed vehicle");
        assert_eq!(&vehicle["year"], year, "year for VIN {vin}");
    }

    sqlx::query("DELETE FROM riviamigo.users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn add_vehicle_requires_auth() {
    let app = make_app().await;
    let status = post_status(
        app,
        "/v1/vehicles",
        serde_json::json!({"rivian_vehicle_id": "test"}),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn demo_vehicle_requires_auth() {
    let app = make_app().await;
    let status = post_status(app, "/v1/vehicles/demo", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn refresh_demo_vehicle_requires_auth() {
    let app = make_app().await;
    let status = post_status(
        app,
        &format!("/v1/vehicles/{}/demo/refresh", Uuid::new_v4()),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[test]
fn demo_vehicle_keys_are_detected_explicitly() {
    assert!(is_demo_vehicle_key("demo-r1t-local"));
    assert!(is_demo_vehicle_key("demo-r2-local"));
    assert!(is_demo_vehicle_key("demo-r2s-local"));
    assert!(!is_demo_vehicle_key("rivian-1234"));
}

#[test]
fn r2_model_aliases_canonicalize_before_storage_and_response() {
    assert_eq!(canonical_vehicle_model("R2"), "R2");
    assert_eq!(canonical_vehicle_model(" r2s "), "R2");
    assert_eq!(canonical_vehicle_model("R2-S"), "R2");
    assert_eq!(canonical_vehicle_model("R1S"), "R1S");
    assert_eq!(canonical_battery_config("R2S"), "r2");
    assert_eq!(canonical_vehicle_name("R2S"), "R2");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn vehicle_status_requires_auth() {
    let app = make_app().await;
    let status = get_status(
        app,
        &format!("/v1/vehicles/{}/status", uuid::Uuid::new_v4()),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
