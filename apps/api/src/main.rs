use std::{net::SocketAddr, sync::Arc, time::Instant};
use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use riviamigo_api::{
    config::Config,
    db::pool::create_pool,
    ingestion, keys,
    middleware::auth::{AppState, JwtKeys},
    routes,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "riviamigo_api=debug,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let config = Config::from_env()?;
    let pool = create_pool(&config.database_url).await?;

    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("migrations applied");

    routes::dashboards::seed_defaults(&pool).await?;
    tracing::info!("dashboard defaults seeded");

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

    let age_key = active_keys.age_key;

    let state = AppState {
        pool: pool.clone(),
        redis: redis.clone(),
        jwt_keys,
        age_key: age_key.clone(),
        config: config.clone(),
        nominatim_next_call: Arc::new(tokio::sync::Mutex::new(Instant::now())),
        nominatim_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
    };

    let _supervisor =
        ingestion::start_workers(pool.clone(), redis, age_key, config.clone()).await?;

    let app = routes::build_router(state);

    let addr: SocketAddr = format!("0.0.0.0:{}", config.port).parse()?;
    tracing::info!("listening on {addr}");
    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
