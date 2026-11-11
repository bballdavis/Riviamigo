//! Local artwork mirror: downloading manifest assets into the image cache
//! and checking which cached files are still valid.

use sha2::{Digest, Sha256};
use tracing::warn;
use uuid::Uuid;

use std::{
    path::{Path as StdPath, PathBuf},
    time::Duration,
};

use super::images::fetch_vehicle_image_rows;
use super::manifest::{merge_metadata, overlay_entries_from_value};
use super::{MirroredFileAsset, MirroredOverlayAsset, VehicleImageOverlay, VehicleImageRow};

pub(super) fn image_cache_root(config: &crate::config::Config) -> PathBuf {
    PathBuf::from(&config.vehicle_image_cache_dir)
}

pub(in crate::routes::vehicles) fn mirror_file_path(
    config: &crate::config::Config,
    relpath: &str,
) -> PathBuf {
    image_cache_root(config).join(relpath.replace('/', std::path::MAIN_SEPARATOR_STR))
}

pub(super) fn sanitize_image_key(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
}

fn infer_extension(source_url: &str, content_type: Option<&str>) -> &'static str {
    let lowered = source_url.to_ascii_lowercase();
    for ext in ["webp", "png", "jpg", "jpeg", "gif"] {
        if lowered.contains(&format!(".{ext}")) {
            return ext;
        }
    }
    match content_type.unwrap_or_default() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        _ => "webp",
    }
}

fn guess_mime_type(path: &StdPath) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        _ => "image/webp",
    }
}

async fn download_and_store_asset(
    client: &reqwest::Client,
    config: &crate::config::Config,
    vehicle_id: Uuid,
    source_url: &str,
) -> Result<MirroredFileAsset, anyhow::Error> {
    let response = client.get(source_url).send().await?.error_for_status()?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let bytes = response.bytes().await?;
    let sha256 = hex::encode(Sha256::digest(&bytes));
    let extension = infer_extension(source_url, content_type.as_deref());
    let key_hash = hex::encode(Sha256::digest(source_url.as_bytes()));
    // Include the content revision so a deliberate administrator refresh gets a
    // new immutable first-party URL rather than serving an old browser cache.
    let mirror_key = format!("{key_hash}-{}.{extension}", &sha256[..16]);
    let mirror_relpath = format!("{vehicle_id}/{mirror_key}");
    let path = mirror_file_path(config, &mirror_relpath);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, &bytes).await?;
    Ok(MirroredFileAsset {
        mirror_key,
        mirror_relpath,
        mime_type: content_type.unwrap_or_else(|| guess_mime_type(&path).to_string()),
        sha256,
    })
}

async fn mirror_vehicle_image_assets(
    client: &reqwest::Client,
    config: &crate::config::Config,
    vehicle_id: Uuid,
    source_url: &str,
    overlays: &[VehicleImageOverlay],
) -> Result<serde_json::Value, anyhow::Error> {
    let mirrored = download_and_store_asset(client, config, vehicle_id, source_url).await?;
    let mut overlay_assets = Vec::with_capacity(overlays.len());
    for overlay in overlays {
        let mirrored_overlay =
            download_and_store_asset(client, config, vehicle_id, &overlay.url).await?;
        overlay_assets.push(MirroredOverlayAsset {
            source_url: overlay.url.clone(),
            mirror_key: mirrored_overlay.mirror_key,
            mirror_relpath: mirrored_overlay.mirror_relpath,
            mime_type: mirrored_overlay.mime_type,
            sha256: mirrored_overlay.sha256,
            overlay: overlay.overlay.clone(),
            z_index: overlay.z_index,
        });
    }

    Ok(serde_json::json!({
        "source_url": source_url,
        "mirror_status": "ready",
        "mirror_key": mirrored.mirror_key,
        "mirror_relpath": mirrored.mirror_relpath,
        "mime_type": mirrored.mime_type,
        "sha256": mirrored.sha256,
        "overlay_mirrors": overlay_assets
    }))
}

fn mirrored_asset_is_valid(config: &crate::config::Config, metadata: &serde_json::Value) -> bool {
    let Some(relpath) = metadata
        .get("mirror_relpath")
        .and_then(|value| value.as_str())
    else {
        return false;
    };
    let Some(expected_sha256) = metadata.get("sha256").and_then(|value| value.as_str()) else {
        return false;
    };
    let Ok(bytes) = std::fs::read(mirror_file_path(config, relpath)) else {
        return false;
    };
    hex::encode(Sha256::digest(&bytes)) == expected_sha256
}

pub(super) fn vehicle_image_needs_local_mirror(
    config: &crate::config::Config,
    row: &VehicleImageRow,
) -> bool {
    if !row.url.starts_with("http://") && !row.url.starts_with("https://") {
        return false;
    }
    if row
        .metadata
        .get("mirror_status")
        .and_then(|value| value.as_str())
        != Some("ready")
    {
        return true;
    }
    if !mirrored_asset_is_valid(config, &row.metadata) {
        return true;
    }
    row.metadata
        .get("overlay_mirrors")
        .and_then(|value| value.as_array())
        .map(|overlays| {
            overlays
                .iter()
                .any(|overlay| !mirrored_asset_is_valid(config, overlay))
        })
        .unwrap_or_else(|| !overlay_entries_from_value(&row.overlays).is_empty())
}

pub(super) async fn mirror_vehicle_images(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
    force_remirror: bool,
) {
    let rows = match fetch_vehicle_image_rows(pool, vehicle_id).await {
        Ok(rows) => rows,
        Err(error) => {
            warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.mirror_rows_failed");
            return;
        }
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    for row in rows {
        let needs_mirror = vehicle_image_needs_local_mirror(config, &row);
        let is_remote = row.url.starts_with("http://") || row.url.starts_with("https://");
        if !needs_mirror && !(force_remirror && is_remote) {
            continue;
        }
        // Each download can take up to the client timeout, so keep an active
        // repair's lease fresh; otherwise a long mirror pass could be taken
        // over as stale and run twice.
        let _ = sqlx::query(
            "UPDATE riviamigo.vehicle_artwork_cache_state
             SET last_repair_attempt_at = now()
             WHERE vehicle_id = $1 AND status = 'repairing'",
        )
        .bind(vehicle_id)
        .execute(pool)
        .await;
        let overlays = overlay_entries_from_value(&row.overlays);
        match mirror_vehicle_image_assets(&client, config, vehicle_id, &row.url, &overlays).await {
            Ok(mirror_metadata) => {
                let merged = merge_metadata(row.metadata.clone(), mirror_metadata);
                let _ = sqlx::query(
                    "UPDATE riviamigo.vehicle_images
                     SET metadata = $3,
                         updated_at = now()
                     WHERE vehicle_id = $1 AND url = $2",
                )
                .bind(vehicle_id)
                .bind(&row.url)
                .bind(merged)
                .execute(pool)
                .await;
            }
            Err(error) if !needs_mirror => {
                // An explicit refresh could not download a replacement. The
                // existing mirror is still complete and valid, so keep serving
                // it rather than downgrading the vehicle to packaged fallbacks.
                warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.remirror_failed_kept_existing");
            }
            Err(error) => {
                warn!(vehicle_id = %vehicle_id, error = %error, "vehicle.images.mirror_failed");
                let merged = merge_metadata(
                    row.metadata.clone(),
                    serde_json::json!({
                        "source_url": row.url,
                        "mirror_status": "failed",
                        "mirror_error": error.to_string()
                    }),
                );
                let _ = sqlx::query(
                    "UPDATE riviamigo.vehicle_images
                     SET metadata = $3,
                         updated_at = now()
                     WHERE vehicle_id = $1 AND url = $2",
                )
                .bind(vehicle_id)
                .bind(&row.url)
                .bind(merged)
                .execute(pool)
                .await;
            }
        }
    }
}

pub(super) fn metadata_has_local_mirror(
    config: &crate::config::Config,
    metadata: &serde_json::Value,
) -> bool {
    metadata
        .get("mirror_status")
        .and_then(|value| value.as_str())
        == Some("ready")
        && mirrored_asset_is_valid(config, metadata)
}

pub(super) fn artwork_asset_counts(
    config: &crate::config::Config,
    rows: &[VehicleImageRow],
) -> (i32, i32) {
    let mut total = 0;
    let mut ready = 0;
    for row in rows {
        if !row.url.starts_with("http://") && !row.url.starts_with("https://") {
            continue;
        }
        total += 1;
        if metadata_has_local_mirror(config, &row.metadata) {
            ready += 1;
        }
        for overlay in row
            .metadata
            .get("overlay_mirrors")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            total += 1;
            if mirrored_asset_is_valid(config, overlay) {
                ready += 1;
            }
        }
    }
    (total, ready)
}
