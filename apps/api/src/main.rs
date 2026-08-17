use sqlx::postgres::PgPoolOptions;
use std::{net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;

use riviamigo_api::{
    config::Config,
    db::{self, pool::create_pool},
    ingestion, keys, logging,
    middleware::auth::{AppState, JwtKeys},
    routes, services,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    logging::init();

    let mut config = Config::from_env()?;
    if config.is_production() && config.allow_insecure_lan_http_auth {
        tracing::warn!(
            "ALLOW_INSECURE_LAN_HTTP_AUTH is enabled: browser credentials and telemetry may be intercepted on this LAN; use HTTPS behind an authenticated gateway whenever possible"
        );
    }
    let pool = create_pool(&config.database_url).await?;

    let migration_pool = PgPoolOptions::new()
        .max_connections(1)
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("SET search_path = public")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&config.database_url)
        .await?;
    let migration = db::migrations::run_current_migrations(&migration_pool).await?;
    migration_pool.close().await;
    tracing::info!(
        latest_version = migration.latest_version,
        ledger_action = ?migration.ledger_action,
        "database schema is current"
    );

    match services::restore_jobs::reconcile_completed_jobs(&pool, &config).await {
        Ok(()) => tracing::info!("restore job journal reconciled"),
        Err(error) => tracing::error!(error = ?error, "restore job journal reconciliation failed"),
    }
    match services::backups::reconcile_local_catalog(&pool, &config).await {
        Ok(inserted) if inserted > 0 => {
            tracing::info!(inserted, "local backup catalog reconciled from disk")
        }
        Ok(_) => {}
        Err(error) => tracing::error!(error = ?error, "local backup catalog reconciliation failed"),
    }

    routes::dashboards::seed_defaults(&pool).await?;
    tracing::info!("dashboard defaults seeded");

    services::external_connections::ensure_defaults(&pool).await?;
    tracing::info!("external connection defaults ensured");

    let active_keys = keys::bootstrap_keys(
        &pool,
        config.jwt_secret.clone(),
        config.jwt_public_key.clone(),
        config.age_encryption_key.clone(),
    )
    .await?;
    tracing::info!(
        cryptographic_key_source = config.cryptographic_key_source(),
        database_key_shared_fate = config.cryptographic_key_source() == "database",
        "application cryptographic keys ready"
    );

    let jwt_keys = Arc::new(JwtKeys::new(
        &active_keys.jwt_private_pem,
        &active_keys.jwt_public_pem,
    )?);

    let redis = redis::Client::open(config.redis_url.clone())?;
    services::redis_health::ping(&redis).await.map_err(|error| {
        tracing::error!(operation = "startup", error = %error, "secure_session_store.unavailable");
        anyhow::anyhow!("secure session storage is unavailable; Redis authentication failed or Redis is unreachable")
    })?;
    tracing::info!(operation = "startup", "secure_session_store.ready");

    let age_key = active_keys.age_key;
    config.age_encryption_key = Some(age_key.clone());

    let charge_identity_backfill_config =
        services::charge_payload_identity::BackfillConfig::from_env()?;

    let supervisor =
        ingestion::start_workers(pool.clone(), redis.clone(), age_key.clone(), config.clone())
            .await?;

    let state = AppState {
        pool: pool.clone(),
        redis: redis.clone(),
        jwt_keys,
        age_key: age_key.clone(),
        config: config.clone(),
        nominatim_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
        supervisor,
    };
    let _backup_scheduler = services::backups::start_backup_scheduler(pool.clone(), config.clone());
    let _restore_job_reconciler =
        services::restore_jobs::start_reconciler(pool.clone(), config.clone());
    let _weather_enrichment_worker =
        services::weather_enrichment::start_worker(pool.clone(), age_key.clone());
    let _trip_enrichment_reconciler =
        services::trip_enrichment::start_reconciliation_worker(pool.clone());
    let _security_audit_retention =
        services::security_audit::start_retention_worker(pool.clone());
    let _charge_identity_backfill = services::charge_payload_identity::start_worker(
        pool.clone(),
        charge_identity_backfill_config,
    );

    let app = routes::build_router(state);

    let addr: SocketAddr = format!(
        "{}:{}",
        config.origin_bind.riviamigo_bind_address, config.port
    )
    .parse()?;
    tracing::info!("listening on {addr}");
    let listener = TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
