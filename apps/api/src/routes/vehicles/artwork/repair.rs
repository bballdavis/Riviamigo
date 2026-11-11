//! Artwork repair scheduling: the single-flight claim, the background
//! repair pass, and the startup repair worker.

use tracing::warn;
use uuid::Uuid;

use std::time::Duration;

use crate::{db::vehicles::is_demo_vehicle_key, middleware::auth::AppState};

use super::cache_state::{refresh_vehicle_artwork_cache_state, ArtworkCacheStateUpdate};
use super::images::fetch_vehicle_image_rows;
use super::manifest::{ensure_vehicle_images_cached, ArtworkCachePass};
use super::mirror::artwork_asset_counts;

async fn vehicle_artwork_cache_complete(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
) -> bool {
    let rows = match fetch_vehicle_image_rows(pool, vehicle_id).await {
        Ok(rows) => rows,
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.cache_complete_rows_failed");
            return false;
        }
    };
    let (total, ready) = artwork_asset_counts(config, &rows);
    total > 0 && total == ready
}

/// Claims the single active artwork repair for a vehicle. An active repair is
/// only taken over once its lease is stale. A failed repair is not retried
/// before `next_attempt_at` unless `bypass_backoff` is set by an explicit
/// refresh.
async fn claim_vehicle_artwork_repair(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    bypass_backoff: bool,
) -> bool {
    match try_claim_vehicle_artwork_repair(pool, vehicle_id, bypass_backoff).await {
        Ok(claimed) => claimed,
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.repair_claim_failed");
            false
        }
    }
}

pub(in crate::routes::vehicles) async fn try_claim_vehicle_artwork_repair<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    vehicle_id: Uuid,
    bypass_backoff: bool,
) -> Result<bool, sqlx::Error> {
    // Claiming marks the repair active immediately so concurrent listings
    // cannot start a second repair before the first pass begins.
    let claimed = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO riviamigo.vehicle_artwork_cache_state AS s
              (vehicle_id, status, last_repair_attempt_at, updated_at)
           VALUES ($1, 'repairing', now(), now())
           ON CONFLICT (vehicle_id) DO UPDATE SET
             status = 'repairing', last_repair_attempt_at = now(), updated_at = now()
           WHERE CASE s.status
             WHEN 'repairing' THEN s.last_repair_attempt_at IS NULL
               OR s.last_repair_attempt_at < now() - interval '5 minutes'
             WHEN 'failed' THEN $2 OR s.next_attempt_at <= now()
             ELSE TRUE
           END
           RETURNING vehicle_id"#,
    )
    .bind(vehicle_id)
    .bind(bypass_backoff)
    .fetch_optional(executor)
    .await?;
    Ok(claimed.is_some())
}

pub(in crate::routes::vehicles) async fn queue_vehicle_artwork_repair(
    state: &AppState,
    vehicle_id: Uuid,
) {
    queue_vehicle_artwork_repair_with_mode(state, vehicle_id, false).await;
}

pub(super) async fn queue_vehicle_artwork_repair_with_mode(
    state: &AppState,
    vehicle_id: Uuid,
    force_manifest_refresh: bool,
) {
    let is_demo = sqlx::query_scalar::<_, String>(
        "SELECT rivian_vehicle_id FROM riviamigo.vehicles WHERE id=$1",
    )
    .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten()
    .is_some_and(|key| is_demo_vehicle_key(&key));
    if is_demo {
        return;
    }
    if !force_manifest_refresh
        && vehicle_artwork_cache_complete(&state.pool, &state.config, vehicle_id).await
    {
        return;
    }
    if !claim_vehicle_artwork_repair(&state.pool, vehicle_id, force_manifest_refresh).await {
        return;
    }
    let pool = state.pool.clone();
    let config = state.config.clone();
    let age_key = state.age_key.clone();
    tokio::spawn(async move {
        repair_vehicle_artwork(pool, config, age_key, vehicle_id, force_manifest_refresh).await;
    });
}

async fn repair_vehicle_artwork(
    pool: sqlx::PgPool,
    config: crate::config::Config,
    age_key: String,
    vehicle_id: Uuid,
    force_manifest_refresh: bool,
) {
    let mut failure = ArtworkCacheStateUpdate::RepairFailed;
    for attempt in 0..3 {
        let pass = ensure_vehicle_images_cached(
            &pool,
            &config,
            vehicle_id,
            &age_key,
            force_manifest_refresh,
        )
        .await;
        if vehicle_artwork_cache_complete(&pool, &config, vehicle_id).await {
            refresh_vehicle_artwork_cache_state(
                &pool,
                &config,
                vehicle_id,
                ArtworkCacheStateUpdate::Observe,
            )
            .await;
            return;
        }
        if pass == ArtworkCachePass::NoProviderArtwork {
            // An empty provider manifest will not change within seconds.
            failure = ArtworkCacheStateUpdate::NoProviderArtwork;
            break;
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_secs(5 * (attempt + 1))).await;
        }
    }
    refresh_vehicle_artwork_cache_state(&pool, &config, vehicle_id, failure).await;
}

/// Starts a bounded repair pass after the API has loaded its encrypted vehicle
/// credentials. Browser requests only read local files; they never trigger this.
pub fn start_vehicle_artwork_repair_worker(
    pool: sqlx::PgPool,
    config: crate::config::Config,
    age_key: String,
) {
    tokio::spawn(async move {
        let vehicle_ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT v.id FROM riviamigo.vehicles v
             JOIN riviamigo.vehicle_credentials c ON c.vehicle_id = v.id
             WHERE v.rivian_vehicle_id NOT LIKE 'demo-%'",
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        for vehicle_id in vehicle_ids {
            if vehicle_artwork_cache_complete(&pool, &config, vehicle_id).await {
                refresh_vehicle_artwork_cache_state(
                    &pool,
                    &config,
                    vehicle_id,
                    ArtworkCacheStateUpdate::Observe,
                )
                .await;
                continue;
            }
            if !claim_vehicle_artwork_repair(&pool, vehicle_id, false).await {
                continue;
            }

            repair_vehicle_artwork(
                pool.clone(),
                config.clone(),
                age_key.clone(),
                vehicle_id,
                false,
            )
            .await;
        }
    });
}
