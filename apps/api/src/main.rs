use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use std::{net::SocketAddr, process::ExitCode, sync::Arc};
use tokio::net::TcpListener;

use riviamigo_api::{
    config::Config,
    db::{self, pool::create_pool},
    ingestion, keys, logging,
    middleware::auth::{AppState, JwtKeys},
    routes, services,
};

#[tokio::main]
async fn main() -> ExitCode {
    logging::run(run()).await
}

async fn run() -> anyhow::Result<()> {
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "api starting");
    let mut config = Config::from_env().context("loading configuration from the environment")?;
    if config.is_production() && config.allow_insecure_lan_http_auth {
        tracing::warn!(
            setting = "ALLOW_INSECURE_LAN_HTTP_AUTH",
            "insecure LAN HTTP auth enabled; browser credentials and telemetry may be intercepted on this LAN; use HTTPS behind an authenticated gateway whenever possible"
        );
    }
    let pool = create_pool(&config.database_url)
        .await
        .context("connecting to the database")?;
    tracing::info!("database connected");

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
        .await
        .context("connecting the migration connection")?;
    let migration = db::migrations::run_current_migrations(&migration_pool)
        .await
        .context("applying database migrations")?;
    migration_pool.close().await;
    tracing::info!(
        latest_version = migration.latest_version,
        "database schema is current"
    );

    match services::backups::reconcile_running_runs(&pool).await {
        Ok(count) if count > 0 => {
            tracing::warn!(count, "backup running jobs reconciled after API startup")
        }
        Ok(_) => {}
        Err(error) => tracing::error!(error = %error, "backup running job reconciliation failed"),
    }
    match services::restore_jobs::reconcile_completed_jobs(&pool, &config).await {
        Ok(()) => tracing::debug!("restore job journal reconciled"),
        Err(error) => tracing::error!(error = %error, "restore job journal reconciliation failed"),
    }
    match services::backups::reconcile_local_catalog(&pool, &config).await {
        Ok(count) if count > 0 => {
            tracing::info!(count, "local backup catalog reconciled from disk")
        }
        Ok(_) => {}
        Err(error) => tracing::error!(error = %error, "local backup catalog reconciliation failed"),
    }

    routes::dashboards::seed_defaults(&pool)
        .await
        .context("seeding dashboard defaults")?;
    tracing::debug!("dashboard defaults seeded");
    services::chart_registry::seed_defaults(&pool)
        .await
        .context("seeding chart defaults")?;
    tracing::debug!("chart defaults seeded");

    services::external_connections::ensure_defaults(&pool)
        .await
        .context("ensuring external connection defaults")?;
    tracing::debug!("external connection defaults ensured");

    let active_keys = keys::bootstrap_keys(
        &pool,
        config.jwt_secret.clone(),
        config.jwt_public_key.clone(),
        config.age_encryption_key.clone(),
    )
    .await
    .context("bootstrapping application keys")?;
    tracing::debug!(
        key_source = config.cryptographic_key_source(),
        database_key_shared_fate = config.cryptographic_key_source() == "database",
        "application cryptographic keys ready"
    );

    let jwt_keys = Arc::new(
        JwtKeys::new(&active_keys.jwt_private_pem, &active_keys.jwt_public_pem)
            .context("loading the JWT signing keys")?,
    );

    let redis = redis::Client::open(config.redis_url.clone()).context("parsing the Redis URL")?;
    services::redis_health::ping(&redis).await.map_err(|error| {
        anyhow::anyhow!(
            "secure session store unavailable; Redis authentication failed or Redis is unreachable: {error}"
        )
    })?;
    tracing::info!("secure session store ready");

    let age_key = active_keys.age_key;
    config.age_encryption_key = Some(age_key.clone());

    let charge_identity_backfill_config =
        services::charge_payload_identity::BackfillConfig::from_env()
            .context("loading charge payload identity backfill settings")?;

    // Before the workers start, so a capture that was running across a
    // restart keeps recording from the first frame.
    services::ingestion_capture::init(pool.clone())
        .await
        .context("initialising ingestion capture")?;

    let supervisor =
        ingestion::start_workers(pool.clone(), redis.clone(), age_key.clone(), config.clone())
            .await
            .context("starting ingestion workers")?;
    // start_workers has already read this flag and rejected an invalid value,
    // so this read cannot newly fail.
    let rivian_workers_enabled =
        ingestion::rivian_workers_enabled().context("reading the Rivian workers setting")?;
    tracing::info!(
        environment = config.riviamigo_env.as_deref().unwrap_or("unset"),
        port = config.port,
        rivian_workers_enabled,
        log_filter = std::env::var("RUST_LOG")
            .as_deref()
            .unwrap_or(logging::DEFAULT_FILTER),
        "effective configuration"
    );

    let state = AppState {
        pool: pool.clone(),
        redis: redis.clone(),
        jwt_keys,
        age_key: age_key.clone(),
        config: config.clone(),
        nominatim_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
        supervisor,
        resources: Default::default(),
    };
    let _backup_scheduler = services::backups::start_backup_scheduler(pool.clone(), config.clone());
    let _basemap_cache_maintenance = services::basemap_cache::start_maintenance(redis.clone());
    let _restore_job_reconciler =
        services::restore_jobs::start_reconciler(pool.clone(), config.clone());
    let _weather_enrichment_worker =
        services::weather_enrichment::start_worker(pool.clone(), age_key.clone());
    let _trip_enrichment_reconciler =
        services::trip_enrichment::start_reconciliation_worker(pool.clone());
    let _security_audit_retention = services::security_audit::start_retention_worker(pool.clone());
    let _charge_identity_backfill = services::charge_payload_identity::start_worker(
        pool.clone(),
        charge_identity_backfill_config,
    );
    tracing::info!("background tasks started");

    let app = routes::build_router(state);

    let addr: SocketAddr = format!(
        "{}:{}",
        config.origin_bind.riviamigo_bind_address, config.port
    )
    .parse()
    .context("parsing the API listen address")?;
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("binding {addr}"))?;
    tracing::info!(listen_addr = %addr, "api listening");
    let serve = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    );
    // Stop promptly on a signal, as the default signal handling did, instead of
    // waiting for long-lived websocket connections to drain.
    tokio::select! {
        result = serve => result.context("serving HTTP")?,
        signal = logging::shutdown_signal() => tracing::info!(signal, "shutdown signal received; stopping"),
    }
    Ok(())
}
