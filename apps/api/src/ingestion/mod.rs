pub mod charge_detector;
pub mod closure_motion;
pub mod location;
pub mod parser;
pub mod poller;
pub mod rivian_auth;
pub mod rivian_poll;
pub mod rivian_ws_backoff;
pub mod session_store;
pub mod supervisor;
pub mod trip_detector;
pub mod trip_signals;
pub mod worker;
pub mod ws_client;

use crate::config::Config;
use sqlx::PgPool;

/// Environment switch for the background Rivian connection. A development
/// copy of production data shares the production Rivian sign-in, so the
/// development launcher turns this off to keep two servers from polling the
/// same account. Unset means on.
pub const RIVIAN_WORKERS_ENABLED_ENV: &str = "RIVIAMIGO_RIVIAN_WORKERS_ENABLED";

pub fn rivian_workers_enabled() -> anyhow::Result<bool> {
    parse_workers_enabled(std::env::var(RIVIAN_WORKERS_ENABLED_ENV).ok().as_deref())
}

fn parse_workers_enabled(value: Option<&str>) -> anyhow::Result<bool> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(true),
        Some(value) => value
            .parse::<bool>()
            .map_err(|_| anyhow::anyhow!("{RIVIAN_WORKERS_ENABLED_ENV} must be true or false")),
    }
}

pub async fn start_workers(
    pool: PgPool,
    redis: redis::Client,
    age_key: String,
    config: Config,
) -> anyhow::Result<supervisor::SupervisorHandle> {
    let workers_enabled = rivian_workers_enabled()?;
    let handle = supervisor::WorkerSupervisor::start(
        pool.clone(),
        redis,
        age_key.clone(),
        config.clone(),
        workers_enabled,
    );
    if !workers_enabled {
        tracing::warn!(
            env = RIVIAN_WORKERS_ENABLED_ENV,
            "Rivian connection is off: live vehicle data, charge history sync, and artwork repair are paused"
        );
        return Ok(handle);
    }

    // Start every real vehicle, including restored vehicles whose provider
    // credentials were intentionally redacted. The worker records an
    // actionable needs_reauth state when credentials are absent; limiting
    // startup to credential-bearing rows leaves stale authorized/connected
    // runtime state behind indefinitely after a restore. A vehicle whose
    // collection a manager paused stays stopped until it is resumed.
    let enrolled: Vec<uuid::Uuid> = sqlx::query_scalar(
        "SELECT v.id FROM riviamigo.vehicles v \
         WHERE v.rivian_vehicle_id NOT LIKE 'demo-%' \
           AND NOT v.collection_paused",
    )
    .fetch_all(&pool)
    .await?;

    for vid in enrolled {
        if !handle
            .send(supervisor::SupervisorCommand::StartWorker { vehicle_id: vid })
            .await
        {
            return Err(anyhow::anyhow!(
                "worker supervisor stopped while starting vehicle {vid}"
            ));
        }
    }

    crate::routes::vehicles::start_vehicle_artwork_repair_worker(pool, config, age_key);

    Ok(handle)
}

#[cfg(test)]
mod tests {
    use super::parse_workers_enabled;

    #[test]
    fn rivian_workers_default_on_and_parse_explicit_values() {
        assert!(parse_workers_enabled(None).unwrap());
        assert!(parse_workers_enabled(Some("  ")).unwrap());
        assert!(parse_workers_enabled(Some("true")).unwrap());
        assert!(!parse_workers_enabled(Some("false")).unwrap());
        assert!(parse_workers_enabled(Some("off")).is_err());
    }
}
