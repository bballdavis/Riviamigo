//! Read side of the artwork cache: resolving first-party image URLs and the
//! per-placement images JSON returned with a vehicle.

use uuid::Uuid;

use crate::errors::AppError;

use super::cache_state::vehicle_artwork_cache_state_json;
use super::manifest::overlay_entries_from_value;
use super::mirror::metadata_has_local_mirror;
use super::VehicleImageRow;

pub(in crate::routes::vehicles) fn resolved_image_url(
    _config: &crate::config::Config,
    vehicle_id: Uuid,
    _original_url: &str,
    metadata: &serde_json::Value,
) -> Option<String> {
    if let Some(key) = metadata.get("mirror_key").and_then(|value| value.as_str()) {
        return Some(format!("/v1/vehicle-image-cache/{vehicle_id}/{key}"));
    }
    None
}

fn resolved_overlays(
    config: &crate::config::Config,
    vehicle_id: Uuid,
    row_overlays: &serde_json::Value,
    metadata: &serde_json::Value,
) -> serde_json::Value {
    let overlays = overlay_entries_from_value(row_overlays);
    let Some(mirrors) = metadata
        .get("overlay_mirrors")
        .and_then(|value| value.as_array())
    else {
        return serde_json::json!([]);
    };

    let overlays: Vec<_> = overlays
        .into_iter()
        .filter_map(|mut overlay| {
            let mirror = mirrors.iter().find(|entry| {
                entry.get("source_url").and_then(|value| value.as_str())
                    == Some(overlay.url.as_str())
            })?;
            if let Some(key) = mirror.get("mirror_key").and_then(|value| value.as_str()) {
                if metadata_has_local_mirror(config, mirror) {
                    overlay.url = format!("/v1/vehicle-image-cache/{vehicle_id}/{key}");
                    return Some(overlay);
                }
            }
            None
        })
        .collect();

    serde_json::to_value(overlays).unwrap_or_else(|_| serde_json::json!([]))
}

pub(super) async fn find_mirrored_asset(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    image_key: &str,
) -> Result<Option<serde_json::Value>, AppError> {
    let rows = fetch_vehicle_image_rows(pool, vehicle_id).await?;

    for row in rows {
        let metadata = row.metadata;
        if metadata.get("mirror_key").and_then(|value| value.as_str()) == Some(image_key) {
            return Ok(Some(metadata));
        }

        if let Some(mirrors) = metadata
            .get("overlay_mirrors")
            .and_then(|value| value.as_array())
        {
            if let Some(found) = mirrors.iter().find(|mirror| {
                mirror.get("mirror_key").and_then(|value| value.as_str()) == Some(image_key)
            }) {
                return Ok(Some(found.clone()));
            }
        }
    }

    Ok(None)
}

pub(in crate::routes::vehicles) async fn fetch_vehicle_image_rows<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    vehicle_id: Uuid,
) -> Result<Vec<VehicleImageRow>, sqlx::Error> {
    // Older caches contain account-wide manifests. Enforce provider identity
    // on every read, including overlays, cache completeness, and repair.
    sqlx::query_as::<_, VehicleImageRow>(
        r#"
        SELECT i.placement, i.design, i.size, i.resolution, i.url, i.overlays, i.metadata
        FROM riviamigo.vehicle_images i
        JOIN riviamigo.vehicles v ON v.id = i.vehicle_id
        WHERE i.vehicle_id = $1
          AND i.metadata->>'rivian_vehicle_id' = v.rivian_vehicle_id
        ORDER BY
          CASE WHEN i.size = 'large' THEN 0 ELSE 1 END,
          i.placement,
          i.design NULLS LAST,
          i.created_at
        "#,
    )
    .bind(vehicle_id)
    .fetch_all(executor)
    .await
}

pub(in crate::routes::vehicles) async fn fetch_vehicle_images_json(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    vehicle_id: Uuid,
) -> Result<serde_json::Value, AppError> {
    let rows = fetch_vehicle_image_rows(pool, vehicle_id).await?;

    let all: Vec<_> = rows
        .iter()
        .filter_map(|row| {
            let resolved_url = resolved_image_url(config, vehicle_id, &row.url, &row.metadata)?;
            let resolved_overlays =
                resolved_overlays(config, vehicle_id, &row.overlays, &row.metadata);
            Some(serde_json::json!({
                "placement": row.placement,
                "design": row.design,
                "size": row.size,
                "resolution": row.resolution,
                "url": resolved_url,
                "overlays": resolved_overlays,
                "metadata": row.metadata,
            }))
        })
        .collect();

    let best = |placement: &str, design: &str| {
        rows.iter()
            .find(|row| {
                normalize_image_placement(&row.placement) == placement
                    && normalize_image_design(row.design.as_deref()) == design
            })
            .or_else(|| {
                rows.iter()
                    .find(|row| normalize_image_placement(&row.placement) == placement)
            })
            .and_then(|row| resolved_image_url(config, vehicle_id, &row.url, &row.metadata))
    };

    Ok(serde_json::json!({
        "all": all,
        "cache": vehicle_artwork_cache_state_json(pool, vehicle_id).await,
        "side": {
            "dark": best("side", "dark"),
            "light": best("side", "light")
        },
        "overhead": {
            "dark": best("overhead", "dark"),
            "light": best("overhead", "light")
        },
        "front": {
            "dark": best("front", "dark"),
            "light": best("front", "light")
        },
        "rear": {
            "dark": best("rear", "dark"),
            "light": best("rear", "light")
        }
    }))
}

fn normalize_image_placement(value: &str) -> &'static str {
    let normalized = value.to_lowercase();
    if normalized.contains("side") && !is_charging_side_value(value) {
        "side"
    } else if normalized.contains("overhead")
        || normalized.contains("top")
        || normalized.contains("bird")
    {
        "overhead"
    } else if normalized.contains("front") {
        "front"
    } else if normalized.contains("rear") || normalized.contains("back") {
        "rear"
    } else {
        "unknown"
    }
}

fn is_charging_side_value(value: &str) -> bool {
    let normalized = value.to_lowercase();
    normalized.contains("side")
        && (normalized.contains("charging") || normalized.contains("charge"))
}

fn normalize_image_design(value: Option<&str>) -> &'static str {
    let Some(value) = value else {
        return "unknown";
    };
    let normalized = value.to_lowercase();
    if normalized.contains("dark") {
        "dark"
    } else if normalized.contains("light") {
        "light"
    } else {
        "unknown"
    }
}
