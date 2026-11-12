//! Capture lifecycle: startup restore, start and stop, and the expiry and purge
//! tasks that bound each capture's life and storage.

use std::{future::Future, sync::atomic::Ordering, time::Duration};

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::{
    registry::{self, register, unregister},
    writer::run_writer,
    Kind, StopReason, CAPTURE_DURATION, CAPTURE_RETENTION,
};

/// Serializes capture starts and stops so the in-memory registry changes in
/// the same order as their database commits. The batch writer joins records
/// to the committed capture row, so an out-of-order registration would make
/// it drop every record silently. Captures are owner-started and rare, so one
/// process-wide lock is enough.
static LIFECYCLE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

const CHANNEL_CAPACITY: usize = 4096;
const EXPIRY_INTERVAL: Duration = Duration::from_secs(15);
const PURGE_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// Start the batch writer, expiry, and purge tasks, and restore any capture
/// that was running when the process stopped.
pub async fn init(pool: PgPool) -> anyhow::Result<()> {
    let (tx, rx) = mpsc::channel(CHANNEL_CAPACITY);
    if !registry::install(tx) {
        anyhow::bail!("ingestion capture service already initialised");
    }

    sqlx::query(
        "UPDATE riviamigo.vehicle_ingestion_diagnostics \
         SET stopped_at = enabled_until, stop_reason = 'expired', updated_at = now() \
         WHERE stopped_at IS NULL AND enabled_until <= now()",
    )
    .execute(&pool)
    .await?;
    let open = sqlx::query_as::<_, (Uuid, Uuid, DateTime<Utc>)>(
        "SELECT vehicle_id, capture_id, enabled_until FROM riviamigo.vehicle_ingestion_diagnostics \
         WHERE stopped_at IS NULL",
    )
    .fetch_all(&pool)
    .await?;
    for (vehicle_id, capture_id, ends_at) in open {
        register(vehicle_id, capture_id, ends_at);
    }

    tokio::spawn(run_writer(pool.clone(), rx));
    tokio::spawn(run_expiry(pool.clone()));
    tokio::spawn(run_purge(pool));
    Ok(())
}

/// Start a new capture, replacing the vehicle's previous one. The previous
/// capture keeps recording until the replacement has committed, and stays
/// registered (so expiry still closes it) when the replacement fails.
pub async fn start(pool: &PgPool, vehicle_id: Uuid, user_id: Uuid) -> anyhow::Result<()> {
    replace_capture(vehicle_id, || begin_capture(pool, vehicle_id, user_id)).await
}

/// Commit a replacement capture, then register it, under [`LIFECYCLE`].
pub(super) async fn replace_capture<F, Fut>(vehicle_id: Uuid, commit: F) -> anyhow::Result<()>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = anyhow::Result<(Uuid, DateTime<Utc>)>>,
{
    let _serialized = LIFECYCLE.lock().await;
    let (capture_id, ends_at) = commit().await?;
    register(vehicle_id, capture_id, ends_at);
    Ok(())
}

async fn begin_capture(
    pool: &PgPool,
    vehicle_id: Uuid,
    user_id: Uuid,
) -> anyhow::Result<(Uuid, DateTime<Utc>)> {
    let capture_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM riviamigo.vehicle_ingestion_capture_events WHERE vehicle_id = $1")
        .bind(vehicle_id)
        .execute(&mut *tx)
        .await?;
    let (started_at, ends_at) = sqlx::query_as::<_, (DateTime<Utc>, DateTime<Utc>)>(
        "INSERT INTO riviamigo.vehicle_ingestion_diagnostics \
             (vehicle_id, capture_id, started_at, enabled_until, enabled_by, stopped_at, stop_reason, dropped_events) \
         VALUES ($1, $2, now(), now() + $3::interval, $4, NULL, NULL, 0) \
         ON CONFLICT (vehicle_id) DO UPDATE SET \
             capture_id = EXCLUDED.capture_id, started_at = EXCLUDED.started_at, \
             enabled_until = EXCLUDED.enabled_until, enabled_by = EXCLUDED.enabled_by, \
             stopped_at = NULL, stop_reason = NULL, dropped_events = 0, updated_at = now() \
         RETURNING started_at, enabled_until",
    )
    .bind(vehicle_id)
    .bind(capture_id)
    .bind(CAPTURE_DURATION)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    insert_marker(
        &mut *tx,
        vehicle_id,
        capture_id,
        started_at,
        Kind::CaptureStarted,
        serde_json::json!({ "ends_at": ends_at }),
    )
    .await?;
    tx.commit().await?;
    Ok((capture_id, ends_at))
}

/// Stop the running capture, keeping its events for download. Returns false
/// when no capture was running.
pub async fn stop(pool: &PgPool, vehicle_id: Uuid, reason: StopReason) -> anyhow::Result<bool> {
    close_capture(vehicle_id, |dropped| {
        end_capture(pool, vehicle_id, reason, dropped)
    })
    .await
}

/// Unregister the capture and close it in the database, under [`LIFECYCLE`].
/// When the close fails nothing was committed, so the window is restored and
/// expiry (or the owner) can retry instead of leaving an open, unregistered
/// capture that nothing would ever close.
pub(super) async fn close_capture<F, Fut>(vehicle_id: Uuid, close: F) -> anyhow::Result<bool>
where
    F: FnOnce(u64) -> Fut,
    Fut: Future<Output = anyhow::Result<bool>>,
{
    let _serialized = LIFECYCLE.lock().await;
    let window = unregister(vehicle_id);
    let dropped = window
        .as_ref()
        .map_or(0, |window| window.dropped.load(Ordering::Relaxed));
    match close(dropped).await {
        Ok(stopped) => Ok(stopped),
        Err(error) => {
            if let Some(window) = window {
                registry::restore(vehicle_id, window);
            }
            Err(error)
        }
    }
}

async fn end_capture(
    pool: &PgPool,
    vehicle_id: Uuid,
    reason: StopReason,
    dropped: u64,
) -> anyhow::Result<bool> {
    let mut tx = pool.begin().await?;
    let stopped = sqlx::query_as::<_, (Uuid, DateTime<Utc>)>(
        "UPDATE riviamigo.vehicle_ingestion_diagnostics \
         SET stopped_at = LEAST(now(), enabled_until), stop_reason = $2, \
             dropped_events = dropped_events + $3, updated_at = now() \
         WHERE vehicle_id = $1 AND stopped_at IS NULL \
         RETURNING capture_id, stopped_at",
    )
    .bind(vehicle_id)
    .bind(reason.as_str())
    .bind(i64::try_from(dropped).unwrap_or(i64::MAX))
    .fetch_optional(&mut *tx)
    .await?;
    let Some((capture_id, stopped_at)) = stopped else {
        return Ok(false);
    };
    insert_marker(
        &mut *tx,
        vehicle_id,
        capture_id,
        stopped_at,
        Kind::CaptureStopped,
        serde_json::json!({ "reason": reason.as_str(), "dropped_events": dropped }),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

async fn insert_marker<'e, E>(
    executor: E,
    vehicle_id: Uuid,
    capture_id: Uuid,
    recorded_at: DateTime<Utc>,
    kind: Kind,
    fields: Value,
) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_ingestion_capture_events \
             (vehicle_id, capture_id, recorded_at, kind, fields) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(vehicle_id)
    .bind(capture_id)
    .bind(recorded_at)
    .bind(kind.as_str())
    .bind(fields)
    .execute(executor)
    .await?;
    Ok(())
}

async fn run_expiry(pool: PgPool) {
    let mut interval = tokio::time::interval(EXPIRY_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let now = Utc::now();
        for vehicle_id in registry::expired(now) {
            if let Err(error) = stop(&pool, vehicle_id, StopReason::Expired).await {
                tracing::warn!(vehicle_id = %vehicle_id, err = %error, "ingestion capture expiry failed");
            }
        }
    }
}

async fn run_purge(pool: PgPool) {
    let mut interval = tokio::time::interval(PURGE_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let result = sqlx::query(
            "WITH purged AS ( \
                 DELETE FROM riviamigo.vehicle_ingestion_diagnostics \
                 WHERE stopped_at IS NOT NULL AND stopped_at < now() - $1::interval \
                 RETURNING vehicle_id) \
             DELETE FROM riviamigo.vehicle_ingestion_capture_events e \
             USING purged WHERE e.vehicle_id = purged.vehicle_id",
        )
        .bind(CAPTURE_RETENTION)
        .execute(&pool)
        .await;
        match result {
            Ok(done) if done.rows_affected() > 0 => {
                tracing::info!(
                    removed = done.rows_affected(),
                    "expired ingestion capture events purged"
                )
            }
            Ok(_) => {}
            Err(error) => tracing::warn!(err = %error, "ingestion capture purge failed"),
        }
    }
}
