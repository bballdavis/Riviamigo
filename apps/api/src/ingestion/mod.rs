pub mod charge_detector;
pub mod location;
pub mod parser;
pub mod poller;
pub mod rivian_auth;
pub mod rivian_poll;
pub mod session_store;
pub mod supervisor;
pub mod trip_detector;
pub mod worker;
pub mod ws_client;

use crate::config::Config;
use sqlx::PgPool;

pub async fn start_workers(
    pool: PgPool,
    redis: redis::Client,
    age_key: String,
    config: Config,
) -> anyhow::Result<supervisor::SupervisorHandle> {
    let handle =
        supervisor::WorkerSupervisor::start(pool.clone(), redis, age_key.clone(), config.clone());

    // Start every real vehicle, including restored vehicles whose provider
    // credentials were intentionally redacted. The worker records an
    // actionable needs_reauth state when credentials are absent; limiting
    // startup to credential-bearing rows leaves stale authorized/connected
    // runtime state behind indefinitely after a restore.
    let enrolled: Vec<uuid::Uuid> = sqlx::query_scalar(
        "SELECT v.id FROM riviamigo.vehicles v \
         WHERE v.rivian_vehicle_id NOT LIKE 'demo-%'",
    )
    .fetch_all(&pool)
    .await?;

    for vid in enrolled {
        handle
            .send(supervisor::SupervisorCommand::StartWorker { vehicle_id: vid })
            .await;
    }

    crate::routes::vehicles::start_vehicle_artwork_repair_worker(pool, config, age_key);

    Ok(handle)
}
