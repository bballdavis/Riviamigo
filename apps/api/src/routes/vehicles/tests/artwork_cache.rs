use super::*;

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn vehicle_images_ignore_foreign_and_unidentified_legacy_cache_entries() {
    let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL"))
        .await
        .expect("test database");
    let mut tx = pool.begin().await.expect("test transaction");
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO riviamigo.users (id, email, password_hash) VALUES ($1, $2, 'unused')")
        .bind(user_id)
        .bind(format!("artwork-{user_id}@example.com"))
        .execute(&mut *tx)
        .await
        .expect("test user");

    for (model, paint) in [
        ("R1T", "compass-yellow"),
        ("R1T", "rivian-blue"),
        ("R1S", "forest-green"),
        ("R2", "glacier-white"),
        ("R1S", "missing-artwork"),
    ] {
        let vehicle_id = Uuid::new_v4();
        let provider_id = format!("provider-{vehicle_id}");
        sqlx::query(
            "INSERT INTO riviamigo.vehicles (id, user_id, rivian_vehicle_id, model, color)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(vehicle_id)
        .bind(user_id)
        .bind(&provider_id)
        .bind(model)
        .bind(paint)
        .execute(&mut *tx)
        .await
        .expect("test vehicle");

        for placement in ["side", "overhead", "three-quarter"] {
            let mut entries = vec![
                (
                    "foreign",
                    serde_json::json!({ "rivian_vehicle_id": "another-vehicle" }),
                ),
                (
                    "order",
                    serde_json::json!({ "rivian_order_id": "unassigned-order" }),
                ),
                ("null", serde_json::json!({ "rivian_vehicle_id": null })),
            ];
            if paint != "missing-artwork" {
                entries.push((
                    paint,
                    serde_json::json!({ "rivian_vehicle_id": provider_id }),
                ));
            }
            for (image_paint, metadata) in entries {
                sqlx::query(
                    "INSERT INTO riviamigo.vehicle_images
                     (vehicle_id, placement, design, size, url, metadata, overlays)
                     VALUES ($1, $2, 'light', 'large', $3, $4, $5)",
                )
                .bind(vehicle_id)
                .bind(placement)
                .bind(format!("https://rivian.com/{image_paint}/{placement}.webp"))
                .bind(metadata)
                .bind(serde_json::json!([{ "url": format!("https://rivian.com/{image_paint}/overlay.webp") }]))
                .execute(&mut *tx)
                .await
                .expect("legacy cache entry");
            }
        }

        let rows = fetch_vehicle_image_rows(&mut *tx, vehicle_id)
            .await
            .expect("scoped cache rows");
        if paint == "missing-artwork" {
            assert!(rows.is_empty(), "foreign artwork must not prevent repair");
        } else {
            assert_eq!(rows.len(), 3);
            for row in rows {
                assert!(row.url.contains(paint));
                assert_eq!(row.metadata["rivian_vehicle_id"], provider_id);
                assert!(row.overlays[0]["url"].as_str().unwrap().contains(paint));
            }
        }
    }
    tx.rollback().await.expect("rollback test fixtures");
}

async fn insert_artwork_test_vehicle(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    provider_id: &str,
) -> Uuid {
    let vehicle_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO riviamigo.vehicles (id, user_id, rivian_vehicle_id, model, color)
         VALUES ($1, $2, $3, 'R1S', 'forest-green')",
    )
    .bind(vehicle_id)
    .bind(user_id)
    .bind(provider_id)
    .execute(&mut *conn)
    .await
    .expect("test vehicle");
    vehicle_id
}

async fn insert_artwork_test_user(conn: &mut sqlx::PgConnection) -> Uuid {
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO riviamigo.users (id, email, password_hash) VALUES ($1, $2, 'unused')")
        .bind(user_id)
        .bind(format!("artwork-{user_id}@example.com"))
        .execute(&mut *conn)
        .await
        .expect("test user");
    user_id
}

async fn set_artwork_cache_state(
    conn: &mut sqlx::PgConnection,
    vehicle_id: Uuid,
    status: &str,
    next_attempt_offset_secs: f64,
    last_attempt_offset_secs: Option<f64>,
) {
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_artwork_cache_state
           (vehicle_id, status, next_attempt_at, last_repair_attempt_at)
         VALUES ($1, $2, now() + make_interval(secs => $3),
                 now() + make_interval(secs => $4))
         ON CONFLICT (vehicle_id) DO UPDATE SET
           status = EXCLUDED.status,
           next_attempt_at = EXCLUDED.next_attempt_at,
           last_repair_attempt_at = EXCLUDED.last_repair_attempt_at",
    )
    .bind(vehicle_id)
    .bind(status)
    .bind(next_attempt_offset_secs)
    .bind(last_attempt_offset_secs)
    .execute(&mut *conn)
    .await
    .expect("cache state fixture");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn artwork_repair_claim_respects_failure_backoff_unless_forced() {
    let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL"))
        .await
        .expect("test database");
    let mut tx = pool.begin().await.expect("test transaction");
    let user_id = insert_artwork_test_user(&mut tx).await;
    let vehicle_id = insert_artwork_test_vehicle(&mut tx, user_id, "provider-claim").await;
    // No state row yet: the first claim creates an active repair.
    assert!(
        try_claim_vehicle_artwork_repair(&mut *tx, vehicle_id, false)
            .await
            .unwrap()
    );
    let status: String = sqlx::query_scalar(
        "SELECT status FROM riviamigo.vehicle_artwork_cache_state WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    assert_eq!(status, "repairing");

    // A fresh active repair blocks both automatic and forced claims.
    for bypass in [false, true] {
        assert!(
            !try_claim_vehicle_artwork_repair(&mut *tx, vehicle_id, bypass)
                .await
                .unwrap()
        );
    }

    // A stale active repair is taken over.
    set_artwork_cache_state(&mut tx, vehicle_id, "repairing", 0.0, Some(-600.0)).await;
    assert!(
        try_claim_vehicle_artwork_repair(&mut *tx, vehicle_id, false)
            .await
            .unwrap()
    );

    // A failed repair waits for next_attempt_at unless forced.
    set_artwork_cache_state(&mut tx, vehicle_id, "failed", 3600.0, Some(-600.0)).await;
    assert!(
        !try_claim_vehicle_artwork_repair(&mut *tx, vehicle_id, false)
            .await
            .unwrap()
    );
    assert!(try_claim_vehicle_artwork_repair(&mut *tx, vehicle_id, true)
        .await
        .unwrap());

    set_artwork_cache_state(&mut tx, vehicle_id, "failed", -1.0, Some(-600.0)).await;
    assert!(
        try_claim_vehicle_artwork_repair(&mut *tx, vehicle_id, false)
            .await
            .unwrap()
    );

    for status in ["pending", "ready"] {
        set_artwork_cache_state(&mut tx, vehicle_id, status, 3600.0, Some(-1.0)).await;
        assert!(
            try_claim_vehicle_artwork_repair(&mut *tx, vehicle_id, false)
                .await
                .unwrap(),
            "{status} caches are claimable"
        );
    }
    tx.rollback().await.expect("rollback test fixtures");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn artwork_cache_state_schedules_backoff_by_failure_kind() {
    use ArtworkCacheStateUpdate::{NoProviderArtwork, Observe, RepairFailed};

    let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL"))
        .await
        .expect("test database");
    let mut tx = pool.begin().await.expect("test transaction");
    let user_id = insert_artwork_test_user(&mut tx).await;
    let vehicle_id = insert_artwork_test_vehicle(&mut tx, user_id, "provider-backoff").await;

    async fn state(
        conn: &mut sqlx::PgConnection,
        vehicle_id: Uuid,
    ) -> (String, i32, i64, Option<String>) {
        sqlx::query_as(
            "SELECT status, attempts,
                    EXTRACT(EPOCH FROM next_attempt_at - now())::bigint,
                    last_error
             FROM riviamigo.vehicle_artwork_cache_state WHERE vehicle_id = $1",
        )
        .bind(vehicle_id)
        .fetch_one(&mut *conn)
        .await
        .expect("cache state")
    }

    assert!(
        try_claim_vehicle_artwork_repair(&mut *tx, vehicle_id, false)
            .await
            .unwrap()
    );
    // Observing an incomplete cache mid-repair keeps the repair active.
    write_vehicle_artwork_cache_state(&mut *tx, vehicle_id, 2, 1, Observe)
        .await
        .unwrap();
    assert_eq!(state(&mut tx, vehicle_id).await.0, "repairing");

    // Real errors back off 5 min * 2^attempts, capped at 6 h.
    for (expected_attempts, expected_delay) in [
        (1, 300),
        (2, 600),
        (3, 1200),
        (4, 2400),
        (5, 4800),
        (6, 9600),
        (7, 19200),
        (8, 21600),
        (9, 21600),
    ] {
        write_vehicle_artwork_cache_state(&mut *tx, vehicle_id, 0, 0, RepairFailed)
            .await
            .unwrap();
        let (status, attempts, delay, last_error) = state(&mut tx, vehicle_id).await;
        assert_eq!(status, "failed");
        assert_eq!(attempts, expected_attempts);
        assert_eq!(delay, expected_delay);
        assert_eq!(last_error.as_deref(), Some(ARTWORK_REPAIR_FAILED_ERROR));
    }

    // A complete cache wins over a failure report and resets the backoff.
    write_vehicle_artwork_cache_state(&mut *tx, vehicle_id, 2, 2, RepairFailed)
        .await
        .unwrap();
    let (status, attempts, delay, last_error) = state(&mut tx, vehicle_id).await;
    assert_eq!((status.as_str(), attempts, delay), ("ready", 0, 0));
    assert_eq!(last_error, None);

    // No provider artwork waits a fixed 12 h with a user-facing reason.
    write_vehicle_artwork_cache_state(&mut *tx, vehicle_id, 0, 0, NoProviderArtwork)
        .await
        .unwrap();
    let (status, attempts, delay, last_error) = state(&mut tx, vehicle_id).await;
    assert_eq!((status.as_str(), attempts, delay), ("failed", 0, 43_200));
    assert_eq!(
        last_error.as_deref(),
        Some(ARTWORK_NO_PROVIDER_ARTWORK_ERROR)
    );
    assert!(
        !try_claim_vehicle_artwork_repair(&mut *tx, vehicle_id, false)
            .await
            .unwrap()
    );
    tx.rollback().await.expect("rollback test fixtures");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn empty_provider_manifest_cleans_only_the_target_vehicle() {
    let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL"))
        .await
        .expect("test database");
    let mut tx = pool.begin().await.expect("test transaction");
    let user_id = insert_artwork_test_user(&mut tx).await;
    let target = insert_artwork_test_vehicle(&mut tx, user_id, "provider-target").await;
    let sibling = insert_artwork_test_vehicle(&mut tx, user_id, "provider-sibling").await;

    // Both vehicles cached the same account-wide manifest URLs.
    let urls = [
        ("https://rivian.com/target/side.webp", "provider-target"),
        ("https://rivian.com/sibling/side.webp", "provider-sibling"),
        ("https://rivian.com/preorder/side.webp", ""),
    ];
    for vehicle_id in [target, sibling] {
        for (url, provider_id) in urls {
            let metadata = if provider_id.is_empty() {
                serde_json::json!({ "rivian_order_id": "unassigned-order" })
            } else {
                serde_json::json!({ "rivian_vehicle_id": provider_id })
            };
            sqlx::query(
                "INSERT INTO riviamigo.vehicle_images
                 (vehicle_id, placement, design, size, url, metadata, overlays)
                 VALUES ($1, 'side', 'light', 'large', $2, $3, '[]'::jsonb)",
            )
            .bind(vehicle_id)
            .bind(url)
            .bind(metadata)
            .execute(&mut *tx)
            .await
            .expect("legacy cache entry");
        }
    }

    store_vehicle_image_manifest(&mut tx, target, "provider-target", Vec::new())
        .await
        .expect("store empty manifest");

    let urls_for = |vehicle_id| {
        sqlx::query_scalar::<_, String>(
            "SELECT url FROM riviamigo.vehicle_images WHERE vehicle_id = $1 ORDER BY url",
        )
        .bind(vehicle_id)
    };
    let target_urls = urls_for(target).fetch_all(&mut *tx).await.unwrap();
    assert_eq!(target_urls, vec!["https://rivian.com/target/side.webp"]);
    let sibling_urls = urls_for(sibling).fetch_all(&mut *tx).await.unwrap();
    assert_eq!(
        sibling_urls,
        vec![
            "https://rivian.com/preorder/side.webp",
            "https://rivian.com/sibling/side.webp",
            "https://rivian.com/target/side.webp",
        ]
    );
    tx.rollback().await.expect("rollback test fixtures");
}
