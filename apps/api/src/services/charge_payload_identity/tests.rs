use super::*;

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL/TimescaleDB DATABASE_URL"]
async fn backfill_index_preserves_migrated_schema_contract_and_detects_real_drift() {
    let mut database_url = url::Url::parse(&std::env::var("DATABASE_URL").unwrap()).unwrap();
    database_url.set_path("/postgres");
    let admin = PgPool::connect(database_url.as_str()).await.unwrap();
    let database = format!(
        "riviamigo_index_contract_test_{}",
        uuid::Uuid::new_v4().simple()
    );
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "CREATE DATABASE \"{database}\""
    )))
    .execute(&admin)
    .await
    .unwrap();
    database_url.set_path(&format!("/{database}"));
    let pool = PgPool::connect(database_url.as_str()).await.unwrap();
    let fingerprints = async {
        crate::db::migrations::MIGRATOR.run(&pool).await?;
        let before = crate::services::restore_compatibility::schema_fingerprint(&pool).await?;
        ensure_pending_index(&pool).await?;
        let after = crate::services::restore_compatibility::schema_fingerprint(&pool).await?;
        sqlx::query("CREATE INDEX unexpected_contract_drift ON riviamigo.users(created_at)")
            .execute(&pool)
            .await?;
        let drift = crate::services::restore_compatibility::schema_fingerprint(&pool).await?;
        Ok::<_, anyhow::Error>((before, after, drift))
    }
    .await;
    pool.close().await;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "DROP DATABASE \"{database}\" WITH (FORCE)"
    )))
    .execute(&admin)
    .await
    .unwrap();
    admin.close().await;
    let (before, after, drift) = fingerprints.unwrap();
    assert_eq!(
        before, after,
        "backfill startup must preserve the migrated contract"
    );
    assert_ne!(
        before, drift,
        "unexpected schema changes must remain visible"
    );
}

#[test]
fn default_backfill_config_is_bounded() {
    let config = BackfillConfig::default();
    assert_eq!(config.batch_size, 1_000);
    assert_eq!(config.pause, Duration::from_millis(100));
}

#[test]
fn invalid_batch_size_is_rejected() {
    std::env::set_var("CHARGE_IDENTITY_BACKFILL_BATCH_SIZE", "99");
    let error = BackfillConfig::from_env().expect_err("invalid batch size must fail");
    std::env::remove_var("CHARGE_IDENTITY_BACKFILL_BATCH_SIZE");
    assert!(error.to_string().contains("between 100 and 10000"));
}

#[test]
fn retry_backoff_doubles_and_is_bounded() {
    assert_eq!(
        next_retry_delay(Duration::from_secs(1)),
        Duration::from_secs(2)
    );
    assert_eq!(
        next_retry_delay(Duration::from_secs(32)),
        Duration::from_secs(60)
    );
    assert_eq!(
        next_retry_delay(Duration::from_secs(60)),
        Duration::from_secs(60)
    );
}
