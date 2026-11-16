//! Rivian artwork manifest: fetching it with stored credentials and storing
//! the entries tagged with this vehicle.

use sha2::{Digest, Sha256};
use tracing::{info, warn};
use uuid::Uuid;

use std::time::Duration;

use super::cache_state::{
    mark_vehicle_artwork_repair_attempt, refresh_vehicle_artwork_cache_state,
    ArtworkCacheStateUpdate,
};
use super::images::fetch_vehicle_image_rows;
use super::mirror::{mirror_vehicle_images, vehicle_image_needs_local_mirror};
use super::VehicleImageOverlay;

/// Result of one artwork cache pass. Completeness of the local cache decides
/// success; this only reports whether another pass could change the outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ArtworkCachePass {
    /// The pass ran, failed, or was skipped; a retry may help.
    Attempted,
    /// Rivian answered but tagged no artwork with this vehicle's provider ID,
    /// for example a new delivery with order-only images or a preorder.
    NoProviderArtwork,
}

async fn cache_vehicle_images(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
    tokens: &crate::ingestion::session_store::RivianTokenBundle,
    force_remirror: bool,
) -> ArtworkCachePass {
    mark_vehicle_artwork_repair_attempt(pool, vehicle_id).await;
    crate::services::external_connections::record_attempt(
        pool,
        crate::services::external_connections::RIVIAN_ACCOUNT,
    )
    .await;
    let result = async {
        let rivian_vehicle_id = sqlx::query_scalar::<_, String>(
            "SELECT rivian_vehicle_id FROM riviamigo.vehicles WHERE id = $1",
        )
        .bind(vehicle_id)
        .fetch_one(pool)
        .await?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;
        let images = crate::ingestion::rivian_auth::rivian_vehicle_images(
            &client,
            tokens,
            &rivian_vehicle_id,
        )
        .await?;
        let image_count = images.len();
        let mut tx = pool.begin().await?;
        store_vehicle_image_manifest(&mut tx, vehicle_id, &rivian_vehicle_id, images).await?;
        tx.commit().await?;
        Ok::<_, anyhow::Error>(image_count)
    }
    .await;
    match result {
        Ok(image_count) => {
            mirror_vehicle_images(pool, config, vehicle_id, force_remirror).await;
            refresh_vehicle_artwork_cache_state(
                pool,
                config,
                vehicle_id,
                ArtworkCacheStateUpdate::Observe,
            )
            .await;
            crate::services::external_connections::record_success(
                pool,
                crate::services::external_connections::RIVIAN_ACCOUNT,
            )
            .await;
            if image_count == 0 {
                info!(vehicle_id = %vehicle_id, "vehicle.images.no_provider_artwork");
                ArtworkCachePass::NoProviderArtwork
            } else {
                info!(vehicle_id = %vehicle_id, image_count, "vehicle.images.cached");
                ArtworkCachePass::Attempted
            }
        }
        Err(error) => {
            // The repair that owns this pass records the terminal cache state
            // and its retry backoff once all attempts are exhausted.
            crate::services::external_connections::record_failure(
                pool,
                crate::services::external_connections::RIVIAN_ACCOUNT,
                &error.to_string(),
            )
            .await;
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.add.image_cache_failed");
            ArtworkCachePass::Attempted
        }
    }
}

/// Replaces a vehicle's cached manifest with Rivian entries already filtered to
/// its provider ID. An empty manifest is still authoritative: foreign and
/// unidentified legacy rows are removed so they cannot be served or block
/// repair, while rows tagged with this vehicle keep their local mirrors.
pub(in crate::routes::vehicles) async fn store_vehicle_image_manifest(
    conn: &mut sqlx::PgConnection,
    vehicle_id: Uuid,
    rivian_vehicle_id: &str,
    images: Vec<crate::ingestion::rivian_auth::RivianVehicleImage>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM riviamigo.vehicle_images
         WHERE vehicle_id = $1
           AND metadata->>'rivian_vehicle_id' IS DISTINCT FROM $2",
    )
    .bind(vehicle_id)
    .bind(rivian_vehicle_id)
    .execute(&mut *conn)
    .await?;
    for image in images {
        sqlx::query(
            r#"
                INSERT INTO riviamigo.vehicle_images
                  (vehicle_id, placement, design, size, resolution, url, overlays, metadata)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (vehicle_id, url) DO UPDATE
                SET placement = EXCLUDED.placement,
                    design = EXCLUDED.design,
                    size = EXCLUDED.size,
                    resolution = EXCLUDED.resolution,
                    overlays = EXCLUDED.overlays,
                    -- A manifest refresh must never discard a working local
                    -- mirror. Keep the ready mirror identity and only take
                    -- the descriptive manifest fields; the later mirror pass
                    -- replaces the asset only after a successful download.
                    metadata = CASE
                      WHEN riviamigo.vehicle_images.metadata->>'mirror_status' = 'ready'
                        THEN riviamigo.vehicle_images.metadata
                          || (EXCLUDED.metadata - 'mirror_key' - 'mirror_status')
                      ELSE EXCLUDED.metadata
                    END,
                    updated_at = now()
                "#,
        )
        .bind(vehicle_id)
        .bind(image.placement.as_deref().unwrap_or("unknown"))
        .bind(image.design)
        .bind(image.size)
        .bind(image.resolution)
        .bind(&image.url)
        .bind(image.overlays)
        .bind(build_cached_vehicle_image_metadata(
            &image.url,
            serde_json::json!({
            "source": image.source,
            "vehicle_version": image.vehicle_version,
            "rivian_vehicle_id": image.vehicle_id,
            "rivian_order_id": image.order_id,
            "extension": image.extension
            }),
        ))
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

pub(super) async fn ensure_vehicle_images_cached(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
    age_key: &str,
    force_manifest_refresh: bool,
) -> ArtworkCachePass {
    let rows = match fetch_vehicle_image_rows(pool, vehicle_id).await {
        Ok(rows) => rows,
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.backfill_rows_failed");
            return ArtworkCachePass::Attempted;
        }
    };

    if !rows.is_empty() && !force_manifest_refresh {
        if rows
            .iter()
            .any(|row| vehicle_image_needs_local_mirror(config, row))
        {
            mark_vehicle_artwork_repair_attempt(pool, vehicle_id).await;
            mirror_vehicle_images(pool, config, vehicle_id, false).await;
            refresh_vehicle_artwork_cache_state(
                pool,
                config,
                vehicle_id,
                ArtworkCacheStateUpdate::Observe,
            )
            .await;
        }
        return ArtworkCachePass::Attempted;
    }

    let identity = match age_key.parse::<age::x25519::Identity>() {
        Ok(identity) => identity,
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.backfill_bad_age_key");
            return ArtworkCachePass::Attempted;
        }
    };

    let encrypted_tokens = match sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT encrypted_tokens FROM riviamigo.vehicle_credentials WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await
    {
        Ok(Some(tokens)) => tokens,
        Ok(None) => return ArtworkCachePass::Attempted,
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.backfill_credentials_failed");
            return ArtworkCachePass::Attempted;
        }
    };

    match crate::ingestion::session_store::decrypt_tokens(&encrypted_tokens, &identity) {
        Ok(tokens) => {
            cache_vehicle_images(pool, config, vehicle_id, &tokens, force_manifest_refresh).await
        }
        Err(error) => {
            // The owning repair records the sanitized failure and backoff.
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.backfill_decrypt_failed");
            ArtworkCachePass::Attempted
        }
    }
}

fn build_cached_vehicle_image_metadata(
    source_url: &str,
    base: serde_json::Value,
) -> serde_json::Value {
    // A stable first-party key lets the UI render a local restoring placeholder
    // even before an initial mirror has completed. Successful mirrors replace
    // it with a checksum-revisioned immutable key.
    let pending_key = format!(
        "{}.webp",
        hex::encode(Sha256::digest(source_url.as_bytes()))
    );
    merge_metadata(
        base,
        serde_json::json!({
            "source_url": source_url,
            "mirror_key": pending_key,
            "mirror_status": "pending"
        }),
    )
}

pub(super) fn merge_metadata(
    mut left: serde_json::Value,
    right: serde_json::Value,
) -> serde_json::Value {
    if let (Some(left_obj), Some(right_obj)) = (left.as_object_mut(), right.as_object()) {
        for (key, value) in right_obj {
            left_obj.insert(key.clone(), value.clone());
        }
        left
    } else {
        right
    }
}

pub(super) fn overlay_entries_from_value(value: &serde_json::Value) -> Vec<VehicleImageOverlay> {
    serde_json::from_value::<Vec<VehicleImageOverlay>>(value.clone()).unwrap_or_default()
}
