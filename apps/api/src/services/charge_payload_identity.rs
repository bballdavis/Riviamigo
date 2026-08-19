//! Restart-safe backfill for semantic charge-payload identities.
//!
//! Migration 0007 only adds the identity schema. This worker fills historical
//! rows after the API is healthy, one bounded transaction at a time.

use anyhow::{Context, Result};
use sqlx::PgPool;
use std::time::Duration;

const JOB_KEY: &str = "charge_payload_identity";
const ADVISORY_LOCK_KEY: &str = "riviamigo-charge-payload-identity-backfill";
const PENDING_INDEX_NAME: &str = "rivian_charge_payloads_identity_pending_idx";
const DEFAULT_BATCH_SIZE: i64 = 1_000;
const DEFAULT_PAUSE_MS: u64 = 100;
const MIN_BATCH_SIZE: i64 = 100;
const MAX_BATCH_SIZE: i64 = 10_000;
const MAX_PAUSE_MS: u64 = 5_000;
const MAX_RETRY_DELAY: Duration = Duration::from_secs(60);
const DROP_PENDING_INDEX_SQL: &str =
    "DROP INDEX CONCURRENTLY IF EXISTS riviamigo.rivian_charge_payloads_identity_pending_idx";
const DROP_PENDING_INDEX_LOCKING_SQL: &str =
    "DROP INDEX IF EXISTS riviamigo.rivian_charge_payloads_identity_pending_idx";
const CREATE_PENDING_INDEX_SQL: &str =
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS rivian_charge_payloads_identity_pending_idx
     ON riviamigo.rivian_charge_payloads (captured_at, id)
     WHERE payload_fingerprint IS NULL";
const CREATE_PENDING_INDEX_LOCKING_SQL: &str =
    "CREATE INDEX IF NOT EXISTS rivian_charge_payloads_identity_pending_idx
     ON riviamigo.rivian_charge_payloads (captured_at, id)
     WHERE payload_fingerprint IS NULL";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackfillConfig {
    pub batch_size: i64,
    pub pause: Duration,
}

impl Default for BackfillConfig {
    fn default() -> Self {
        Self {
            batch_size: DEFAULT_BATCH_SIZE,
            pause: Duration::from_millis(DEFAULT_PAUSE_MS),
        }
    }
}

impl BackfillConfig {
    pub fn from_env() -> Result<Self> {
        let batch_size = parse_i64_env("CHARGE_IDENTITY_BACKFILL_BATCH_SIZE", DEFAULT_BATCH_SIZE)?;
        if !(MIN_BATCH_SIZE..=MAX_BATCH_SIZE).contains(&batch_size) {
            anyhow::bail!(
                "CHARGE_IDENTITY_BACKFILL_BATCH_SIZE must be between {MIN_BATCH_SIZE} and {MAX_BATCH_SIZE}"
            );
        }

        let pause_ms = parse_u64_env("CHARGE_IDENTITY_BACKFILL_PAUSE_MS", DEFAULT_PAUSE_MS)?;
        if pause_ms > MAX_PAUSE_MS {
            anyhow::bail!("CHARGE_IDENTITY_BACKFILL_PAUSE_MS must be between 0 and {MAX_PAUSE_MS}");
        }

        Ok(Self {
            batch_size,
            pause: Duration::from_millis(pause_ms),
        })
    }
}

fn parse_i64_env(name: &str, default: i64) -> Result<i64> {
    match std::env::var(name) {
        Ok(value) => value
            .parse::<i64>()
            .with_context(|| format!("{name} must be an integer")),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(error).with_context(|| format!("read {name}")),
    }
}

fn parse_u64_env(name: &str, default: u64) -> Result<u64> {
    match std::env::var(name) {
        Ok(value) => value
            .parse::<u64>()
            .with_context(|| format!("{name} must be an unsigned integer")),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(error).with_context(|| format!("read {name}")),
    }
}

pub fn start_worker(pool: PgPool, config: BackfillConfig) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut retry_delay = Duration::from_secs(1);
        loop {
            match run_until_complete(&pool, config).await {
                Ok(WorkerResult::Complete) => return,
                Ok(WorkerResult::Busy) => {
                    retry_delay = Duration::from_secs(1);
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
                Err(error) => {
                    let error_text = error.to_string();
                    tracing::error!(
                        error = %error,
                        retry_in_ms = retry_delay.as_millis() as u64,
                        "charge_payload_identity_backfill_failed"
                    );
                    if let Err(status_error) = mark_error(&pool, &error_text).await {
                        tracing::error!(error = %status_error, "charge_payload_identity_backfill_status_failed");
                    }
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = next_retry_delay(retry_delay);
                }
            }
        }
    })
}

fn next_retry_delay(current: Duration) -> Duration {
    current
        .checked_mul(2)
        .unwrap_or(MAX_RETRY_DELAY)
        .min(MAX_RETRY_DELAY)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkerResult {
    Complete,
    Busy,
}

async fn run_until_complete(pool: &PgPool, config: BackfillConfig) -> Result<WorkerResult> {
    let mut lock_connection = pool.acquire().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock(hashtextextended($1, 0))")
        .bind(ADVISORY_LOCK_KEY)
        .fetch_one(&mut *lock_connection)
        .await?;
    if !locked {
        return Ok(WorkerResult::Busy);
    }

    let result = run_locked(pool, config).await;
    let unlock_result =
        sqlx::query_scalar::<_, bool>("SELECT pg_advisory_unlock(hashtextextended($1, 0))")
            .bind(ADVISORY_LOCK_KEY)
            .fetch_one(&mut *lock_connection)
            .await;

    match (result, unlock_result) {
        (Ok(result), Ok(true)) => Ok(result),
        (Ok(_), Ok(false)) => anyhow::bail!("charge payload identity backfill lock was not held"),
        (Ok(_), Err(error)) => Err(error).context("release charge payload identity backfill lock"),
        (Err(error), Ok(_)) => Err(error),
        (Err(error), Err(unlock_error)) => Err(error.context(format!(
            "also failed to release backfill lock: {unlock_error}"
        ))),
    }
}

async fn run_locked(pool: &PgPool, config: BackfillConfig) -> Result<WorkerResult> {
    let initial_pending = pending_count(pool).await?;
    if initial_pending == 0 {
        mark_complete(pool).await?;
        return Ok(WorkerResult::Complete);
    }

    ensure_pending_index(pool).await?;
    mark_started(pool).await?;
    let mut remaining_estimate = initial_pending;
    tracing::info!(
        pending = initial_pending,
        "charge_payload_identity_backfill_started"
    );

    loop {
        let (rows_filled, identities_inserted) = process_batch(pool, config.batch_size).await?;
        if rows_filled == 0 {
            // Confirm completion exactly once at the boundary. A concurrent
            // writer may have claimed part of the original snapshot, so an
            // estimate alone must never mark the job complete.
            if pending_count(pool).await? == 0 {
                mark_complete(pool).await?;
                tracing::info!("charge_payload_identity_backfill_complete");
                return Ok(WorkerResult::Complete);
            }

            // Another writer may briefly hold the remaining rows. SKIP LOCKED
            // keeps the API responsive; the next pass will claim them.
            tokio::time::sleep(Duration::from_millis(250)).await;
            continue;
        }

        remaining_estimate = remaining_estimate.saturating_sub(rows_filled);
        tracing::info!(
            rows_filled,
            identities_inserted,
            remaining_estimate,
            "charge_payload_identity_backfill_progress"
        );
        tokio::time::sleep(config.pause).await;

        if rows_filled < config.batch_size {
            // A short batch is the other normal completion boundary. Confirm
            // it exactly once, while still retrying if SKIP LOCKED observed
            // rows held by another writer.
            if pending_count(pool).await? == 0 {
                mark_complete(pool).await?;
                tracing::info!("charge_payload_identity_backfill_complete");
                return Ok(WorkerResult::Complete);
            }
        }
    }
}

async fn ensure_pending_index(pool: &PgPool) -> Result<()> {
    let is_hypertable: bool = sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1
             FROM timescaledb_information.hypertables
             WHERE hypertable_schema = 'riviamigo'
               AND hypertable_name = 'rivian_charge_payloads'
         )",
    )
    .fetch_one(pool)
    .await?;
    let validity: Option<bool> = sqlx::query_scalar(
        "SELECT i.indisvalid
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'riviamigo' AND c.relname = $1",
    )
    .bind(PENDING_INDEX_NAME)
    .fetch_optional(pool)
    .await?;

    if validity == Some(false) {
        sqlx::query(if is_hypertable {
            DROP_PENDING_INDEX_LOCKING_SQL
        } else {
            DROP_PENDING_INDEX_SQL
        })
        .execute(pool)
        .await?;
    }

    // TimescaleDB does not support CREATE INDEX CONCURRENTLY on a hypertable.
    // This branch still runs only after the API is serving traffic; ordinary
    // PostgreSQL tables retain the non-blocking concurrent build.
    sqlx::query(if is_hypertable {
        CREATE_PENDING_INDEX_LOCKING_SQL
    } else {
        CREATE_PENDING_INDEX_SQL
    })
    .execute(pool)
    .await?;
    Ok(())
}

async fn process_batch(pool: &PgPool, batch_size: i64) -> Result<(i64, i64)> {
    let mut transaction = pool.begin().await?;
    let (rows_filled, identities_inserted): (i64, i64) = sqlx::query_as(
        r#"WITH pending AS MATERIALIZED (
               SELECT id, vehicle_id, operation, rivian_transaction_id,
                      rivian_vehicle_id, payload
               FROM riviamigo.rivian_charge_payloads
               WHERE payload_fingerprint IS NULL
               ORDER BY captured_at ASC, id ASC
               FOR UPDATE SKIP LOCKED
               LIMIT $1
           ), hashed AS MATERIALIZED (
               SELECT pending.*,
                      riviamigo.charge_payload_fingerprint(pending.payload) AS fingerprint
               FROM pending
           ), updated AS (
               UPDATE riviamigo.rivian_charge_payloads payload
               SET payload_fingerprint = hashed.fingerprint
               FROM hashed
               WHERE payload.id = hashed.id
                 AND payload.payload_fingerprint IS NULL
               RETURNING payload.id, payload.vehicle_id, payload.operation,
                         payload.rivian_transaction_id, payload.rivian_vehicle_id,
                         payload.payload_fingerprint
           ), inserted AS (
               INSERT INTO riviamigo.rivian_charge_payload_identities (
                   identity_key,
                   vehicle_id,
                   operation,
                   payload_fingerprint,
                   canonical_payload_id
               )
               SELECT riviamigo.charge_payload_identity_key(
                          updated.vehicle_id,
                          updated.operation,
                          updated.rivian_transaction_id,
                          updated.rivian_vehicle_id,
                          updated.payload_fingerprint
                      ),
                      updated.vehicle_id,
                      updated.operation,
                      updated.payload_fingerprint,
                      updated.id
               FROM updated
               ON CONFLICT (identity_key) DO NOTHING
               RETURNING 1
           )
           SELECT
               (SELECT COUNT(*) FROM updated)::bigint,
               (SELECT COUNT(*) FROM inserted)::bigint"#,
    )
    .bind(batch_size)
    .fetch_one(&mut *transaction)
    .await?;

    sqlx::query(
        "UPDATE riviamigo.charge_payload_identity_backfill_status
         SET status = 'running',
             rows_scanned = rows_scanned + $1,
             fingerprints_filled = fingerprints_filled + $1,
             identities_inserted = identities_inserted + $2,
             last_error = NULL,
             heartbeat_at = now(),
             updated_at = now()
         WHERE job_key = $3",
    )
    .bind(rows_filled)
    .bind(identities_inserted)
    .bind(JOB_KEY)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    Ok((rows_filled, identities_inserted))
}

async fn pending_count(pool: &PgPool) -> Result<i64> {
    Ok(sqlx::query_scalar(
        "SELECT COUNT(*)::bigint
         FROM riviamigo.rivian_charge_payloads
         WHERE payload_fingerprint IS NULL",
    )
    .fetch_one(pool)
    .await?)
}

async fn mark_started(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "UPDATE riviamigo.charge_payload_identity_backfill_status
         SET status = 'running',
             last_error = NULL,
             started_at = now(),
             completed_at = NULL,
             heartbeat_at = now(),
             updated_at = now()
         WHERE job_key = $1",
    )
    .bind(JOB_KEY)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_complete(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "UPDATE riviamigo.charge_payload_identity_backfill_status
         SET status = 'complete',
             last_error = NULL,
             completed_at = COALESCE(completed_at, now()),
             heartbeat_at = now(),
             updated_at = now()
         WHERE job_key = $1",
    )
    .bind(JOB_KEY)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_error(pool: &PgPool, error: &str) -> Result<()> {
    sqlx::query(
        "UPDATE riviamigo.charge_payload_identity_backfill_status
         SET status = 'error',
             last_error = $1,
             heartbeat_at = now(),
             updated_at = now()
         WHERE job_key = $2",
    )
    .bind(error)
    .bind(JOB_KEY)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
