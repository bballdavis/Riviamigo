use super::*;

#[test]
fn resolved_image_url_keeps_a_first_party_path_when_local_file_is_missing() {
    let config = crate::config::Config {
        database_url: "postgres://localhost/test".into(),
        redis_url: "redis://localhost".into(),
        jwt_secret: None,
        jwt_public_key: None,
        age_encryption_key: None,
        port: 3001,
        allowed_origins: vec![],
        s3_endpoint: None,
        s3_access_key: None,
        s3_secret_key: None,
        backup_artifact_dir: std::env::temp_dir()
            .join("riviamigo-test-backups")
            .to_string_lossy()
            .into_owned(),
        vehicle_image_cache_dir: std::env::temp_dir()
            .join("riviamigo-test-missing-mirror")
            .to_string_lossy()
            .into_owned(),
        backup_driver: "pg_dump".into(),
        backup_poll_interval_seconds: 60,
        restore_agent_url: "http://127.0.0.1:3002".into(),
        restore_agent_key_file: "/backups/.restore-agent-key".into(),
        recovery: crate::config::RecoveryConfig::default(),
        origin_bind: crate::config::OriginBindConfig::default(),
        security: Default::default(),
        rivian_ws_reconnect_initial_seconds: 10,
        rivian_ws_reconnect_max_seconds: 900,
        rivian_raw_event_retention_days: 7,
        rivian_persist_raw_events: true,
        rivian_suppress_duplicate_telemetry: true,
        riviamigo_env: None,
        cookie_insecure: None,
        allow_insecure_lan_http_auth: false,
        rate_limit: crate::config::RateLimitConfig::default(),
    };
    let metadata = serde_json::json!({
        "mirror_status": "ready",
        "mirror_key": "abc.webp",
        "mirror_relpath": "vehicle/abc.webp"
    });

    let url = resolved_image_url(
        &config,
        uuid::Uuid::nil(),
        "https://rivian.com/mobile/static/img/example.webp",
        &metadata,
    );

    assert_eq!(
        url,
        Some("/v1/vehicle-image-cache/00000000-0000-0000-0000-000000000000/abc.webp".into())
    );
}

#[tokio::test]
async fn resolved_image_url_keeps_a_first_party_path_for_a_corrupt_local_file() {
    use sha2::{Digest, Sha256};

    let vehicle_id = Uuid::new_v4();
    let mut config = make_helper_state("redis://127.0.0.1/".into()).config;
    config.vehicle_image_cache_dir = std::env::temp_dir()
        .join(format!("riviamigo-artwork-checksum-{vehicle_id}"))
        .to_string_lossy()
        .into_owned();
    let relpath = format!("{vehicle_id}/artwork.webp");
    let path = mirror_file_path(&config, &relpath);
    std::fs::create_dir_all(path.parent().expect("cache parent")).expect("cache directory");
    std::fs::write(&path, b"valid-artwork").expect("cache asset");
    let metadata = serde_json::json!({
        "mirror_status": "ready",
        "mirror_key": "artwork.webp",
        "mirror_relpath": relpath,
        "sha256": hex::encode(Sha256::digest(b"valid-artwork"))
    });

    assert_eq!(
        resolved_image_url(
            &config,
            vehicle_id,
            "https://rivian.com/artwork.webp",
            &metadata
        ),
        Some(format!("/v1/vehicle-image-cache/{vehicle_id}/artwork.webp"))
    );

    std::fs::write(&path, b"corrupt-artwork").expect("corrupt cache asset");
    assert_eq!(
        resolved_image_url(
            &config,
            vehicle_id,
            "https://rivian.com/artwork.webp",
            &metadata
        ),
        Some(format!("/v1/vehicle-image-cache/{vehicle_id}/artwork.webp"))
    );
    let _ = std::fs::remove_dir_all(&config.vehicle_image_cache_dir);
}
