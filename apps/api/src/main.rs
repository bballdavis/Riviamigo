use std::{net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod config;
mod db;
mod errors;
mod ingestion;
mod middleware;
mod models;
mod routes;

use config::Config;
use db::pool::create_pool;
use middleware::auth::{AppState, JwtKeys};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "riviamigo_api=debug,tower_http=info".into()))
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let config = Config::from_env()?;
    let pool   = create_pool(&config.database_url).await?;

    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("migrations applied");

    let jwt_keys = Arc::new(JwtKeys::new(&config.jwt_secret, &config.jwt_public_key)?);

    let redis = redis::Client::open(config.redis_url.clone())?;

    let state = AppState {
        pool:     pool.clone(),
        redis:    redis.clone(),
        jwt_keys,
        age_key:  config.age_key.clone(),
        config:   config.clone(),
    };

    // Start ingestion workers
    let _supervisor = ingestion::start_workers(pool.clone(), redis, config.clone()).await?;

    // Phantom-drain MV refresh (hourly)
    let pool_ref = pool.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(tokio::time::Duration::from_secs(3600));
        loop {
            tick.tick().await;
            let _ = sqlx::query(
                "REFRESH MATERIALIZED VIEW CONCURRENTLY timeseries.phantom_drain_periods"
            ).execute(&pool_ref).await;
            let _ = sqlx::query(
                "REFRESH MATERIALIZED VIEW CONCURRENTLY timeseries.phantom_drain_daily"
            ).execute(&pool_ref).await;
            tracing::info!("phantom drain views refreshed");
        }
    });

    let app = routes::build_router(state);

    let addr: SocketAddr = format!("0.0.0.0:{}", config.port).parse()?;
    tracing::info!("listening on {addr}");
    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
