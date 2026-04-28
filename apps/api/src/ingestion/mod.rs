pub mod charge_detector;
pub mod parser;
pub mod poller;
pub mod rivian_auth;
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
    let handle = supervisor::WorkerSupervisor::start(pool.clone(), redis, age_key, config);

    let enrolled: Vec<uuid::Uuid> = sqlx::query_scalar!(
        "SELECT v.id FROM riviamigo.vehicles v \
         JOIN riviamigo.vehicle_credentials c ON c.vehicle_id = v.id"
    )
    .fetch_all(&pool)
    .await?;

    for vid in enrolled {
        handle
            .send(supervisor::SupervisorCommand::StartWorker { vehicle_id: vid })
            .await;
    }

    Ok(handle)
}
