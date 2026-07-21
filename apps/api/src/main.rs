use sqlx::postgres::PgPoolOptions;
use std::{net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use riviamigo_api::{
    config::Config,
    db::pool::create_pool,
    ingestion, keys,
    middleware::auth::{AppState, JwtKeys},
    routes, services,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "riviamigo_api=debug,tower_http=info".into()),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .json()
                .with_writer(std::io::stdout),
        )
        .init();

    let config = Config::from_env()?;
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
    sqlx::migrate!("./migrations").run(&migration_pool).await?;
    migration_pool.close().await;
    tracing::info!("database schema is current");

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
    let _weather_enrichment_worker =
        services::weather_enrichment::start_worker(pool.clone(), age_key.clone());
    let _trip_enrichment_reconciler =
        services::trip_enrichment::start_reconciliation_worker(pool.clone());

    let app = routes::build_router(state);

    let addr: SocketAddr = format!("0.0.0.0:{}", config.port).parse()?;
    tracing::info!("listening on {addr}");
    let listener = TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
