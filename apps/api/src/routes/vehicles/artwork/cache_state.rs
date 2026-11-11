//! Artwork cache-state bookkeeping: repair attempts, failure backoff, and
//! the status reported with a vehicle's images.

use tracing::warn;
use uuid::Uuid;

use super::images::fetch_vehicle_image_rows;
use super::mirror::artwork_asset_counts;
use super::VehicleArtworkCacheStateRow;

pub(super) async fn mark_vehicle_artwork_repair_attempt(pool: &sqlx::PgPool, vehicle_id: Uuid) {
    // `attempts` counts consecutive failed repairs for backoff, so a pass
    // inside a repair only refreshes the active-repair lease.
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_artwork_cache_state
              (vehicle_id, status, last_repair_attempt_at, updated_at)
           VALUES ($1, 'repairing', now(), now())
           ON CONFLICT (vehicle_id) DO UPDATE SET
             status = 'repairing', last_repair_attempt_at = now(),
             last_error = NULL, updated_at = now()"#,
    )
    .bind(vehicle_id)
    .execute(pool)
    .await;
}

/// How a cache-state write affects repair scheduling.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::routes::vehicles) enum ArtworkCacheStateUpdate {
    /// Record asset counts. A ready cache clears the backoff; an incomplete
    /// one is pending, or stays repairing while a claimed repair runs.
    Observe,
    /// A repair ended without a complete cache after a provider, credential,
    /// or download error. Retries back off exponentially.
    RepairFailed,
    /// Rivian answered but has no artwork tagged with this vehicle yet.
    NoProviderArtwork,
}

const ARTWORK_REPAIR_BASE_BACKOFF_SECS: f64 = 5.0 * 60.0;
const ARTWORK_REPAIR_MAX_BACKOFF_SECS: f64 = 6.0 * 60.0 * 60.0;
const ARTWORK_NO_PROVIDER_ARTWORK_RETRY_SECS: f64 = 12.0 * 60.0 * 60.0;
pub(in crate::routes::vehicles) const ARTWORK_REPAIR_FAILED_ERROR: &str =
    "Rivian artwork repair failed; retry is scheduled.";
pub(in crate::routes::vehicles) const ARTWORK_NO_PROVIDER_ARTWORK_ERROR: &str =
    "Rivian has no artwork for this vehicle yet; using the standard model image.";

pub(super) async fn refresh_vehicle_artwork_cache_state(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
    update: ArtworkCacheStateUpdate,
) {
    let rows = match fetch_vehicle_image_rows(pool, vehicle_id).await {
        Ok(rows) => rows,
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.cache_state_rows_failed");
            return;
        }
    };
    let (asset_count, ready_asset_count) = artwork_asset_counts(config, &rows);
    if let Err(error) =
        write_vehicle_artwork_cache_state(pool, vehicle_id, asset_count, ready_asset_count, update)
            .await
    {
        warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.cache_state_write_failed");
    }
}

/// Single writer for terminal and observed artwork cache state. A complete
/// cache always wins over a failure report.
pub(in crate::routes::vehicles) async fn write_vehicle_artwork_cache_state<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    vehicle_id: Uuid,
    asset_count: i32,
    ready_asset_count: i32,
    update: ArtworkCacheStateUpdate,
) -> Result<(), sqlx::Error> {
    let ready = asset_count > 0 && asset_count == ready_asset_count;
    let (status, failure, last_error) = match (ready, update) {
        (true, _) => ("ready", None, None),
        (false, ArtworkCacheStateUpdate::Observe) => ("pending", None, None),
        (false, ArtworkCacheStateUpdate::RepairFailed) => (
            "failed",
            Some("repair_failed"),
            Some(ARTWORK_REPAIR_FAILED_ERROR),
        ),
        (false, ArtworkCacheStateUpdate::NoProviderArtwork) => (
            "failed",
            Some("no_provider_artwork"),
            Some(ARTWORK_NO_PROVIDER_ARTWORK_ERROR),
        ),
    };
    // `attempts` is the number of consecutive failed repairs. Real errors back
    // off as base * 2^attempts (before this failure), capped; an empty
    // provider manifest waits a fixed interval because it rarely changes soon.
    sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_artwork_cache_state AS s
              (vehicle_id, status, asset_count, ready_asset_count, attempts, next_attempt_at,
               last_repair_success_at, last_error, updated_at)
           VALUES ($1, $2, $3, $4,
                   CASE WHEN $6::text = 'repair_failed' THEN 1 ELSE 0 END,
                   now() + make_interval(secs => CASE $6::text
                     WHEN 'no_provider_artwork' THEN $8::double precision
                     WHEN 'repair_failed' THEN $7::double precision
                     ELSE 0 END),
                   CASE WHEN $2 = 'ready' THEN now() ELSE NULL END, $5, now())
           ON CONFLICT (vehicle_id) DO UPDATE SET
             status = CASE
               WHEN EXCLUDED.status = 'pending' AND s.status = 'repairing' THEN 'repairing'
               ELSE EXCLUDED.status
             END,
             asset_count = EXCLUDED.asset_count,
             ready_asset_count = EXCLUDED.ready_asset_count,
             attempts = CASE
               WHEN EXCLUDED.status = 'ready' THEN 0
               WHEN $6::text = 'repair_failed' THEN s.attempts + 1
               ELSE s.attempts
             END,
             next_attempt_at = CASE
               WHEN EXCLUDED.status = 'ready' THEN now()
               WHEN $6::text = 'no_provider_artwork'
                 THEN now() + make_interval(secs => $8::double precision)
               WHEN $6::text = 'repair_failed'
                 THEN now() + make_interval(secs => LEAST(
                   $7::double precision * power(2::double precision, LEAST(s.attempts, 16)),
                   $9::double precision))
               ELSE s.next_attempt_at
             END,
             last_repair_success_at = CASE WHEN EXCLUDED.status = 'ready' THEN now() ELSE s.last_repair_success_at END,
             last_error = EXCLUDED.last_error, updated_at = now()"#,
    )
    .bind(vehicle_id)
    .bind(status)
    .bind(asset_count)
    .bind(ready_asset_count)
    .bind(last_error)
    .bind(failure)
    .bind(ARTWORK_REPAIR_BASE_BACKOFF_SECS)
    .bind(ARTWORK_NO_PROVIDER_ARTWORK_RETRY_SECS)
    .bind(ARTWORK_REPAIR_MAX_BACKOFF_SECS)
    .execute(executor)
    .await?;
    Ok(())
}

pub(super) async fn vehicle_artwork_cache_state_json(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
) -> serde_json::Value {
    let state = sqlx::query_as::<_, VehicleArtworkCacheStateRow>(
        "SELECT status, asset_count, ready_asset_count, attempts, last_repair_attempt_at,
                last_repair_success_at, last_error
         FROM riviamigo.vehicle_artwork_cache_state WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    match state {
        Some(state) => serde_json::json!({
            "status": state.status,
            "asset_count": state.asset_count,
            "ready_asset_count": state.ready_asset_count,
            "attempts": state.attempts,
            "last_repair_attempt_at": state.last_repair_attempt_at,
            "last_repair_success_at": state.last_repair_success_at,
            "last_error": state.last_error,
        }),
        None => {
            serde_json::json!({ "status": "pending", "asset_count": 0, "ready_asset_count": 0 })
        }
    }
}
