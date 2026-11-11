//! Vehicle artwork: the cached Rivian image manifest, its local mirror, the
//! cache-state bookkeeping, and the background repair that keeps it complete.

mod cache_state;
mod images;
mod manifest;
mod mirror;
mod repair;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderName, HeaderValue},
    response::Response,
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    db::users::require_admin_or_super_user,
    db::vehicles::require_vehicle_read_access,
    errors::AppError,
    middleware::auth::{require_vehicle_access, AppState, AuthUser},
};

use super::require_remote_backed_vehicle;

use cache_state::refresh_vehicle_artwork_cache_state;
pub(super) use cache_state::ArtworkCacheStateUpdate;
pub(super) use images::fetch_vehicle_images_json;
use images::find_mirrored_asset;
pub(super) use mirror::mirror_file_path;
use mirror::{image_cache_root, sanitize_image_key};
pub(super) use repair::queue_vehicle_artwork_repair;
use repair::queue_vehicle_artwork_repair_with_mode;
pub use repair::start_vehicle_artwork_repair_worker;
#[cfg(test)]
pub(super) use {
    cache_state::{
        write_vehicle_artwork_cache_state, ARTWORK_NO_PROVIDER_ARTWORK_ERROR,
        ARTWORK_REPAIR_FAILED_ERROR,
    },
    images::{fetch_vehicle_image_rows, resolved_image_url},
    manifest::store_vehicle_image_manifest,
    repair::try_claim_vehicle_artwork_repair,
};

#[derive(Debug, sqlx::FromRow)]
pub(super) struct VehicleImageRow {
    pub(super) placement: String,
    pub(super) design: Option<String>,
    pub(super) size: Option<String>,
    pub(super) resolution: Option<String>,
    pub(super) url: String,
    pub(super) overlays: serde_json::Value,
    pub(super) metadata: serde_json::Value,
}

#[derive(Debug, sqlx::FromRow)]
struct VehicleArtworkCacheStateRow {
    status: String,
    asset_count: i32,
    ready_asset_count: i32,
    attempts: i32,
    last_repair_attempt_at: Option<chrono::DateTime<chrono::Utc>>,
    last_repair_success_at: Option<chrono::DateTime<chrono::Utc>>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct VehicleImageOverlay {
    url: String,
    overlay: Option<String>,
    #[serde(rename = "zIndex")]
    z_index: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct MirroredOverlayAsset {
    source_url: String,
    mirror_key: String,
    mirror_relpath: String,
    mime_type: String,
    sha256: String,
    overlay: Option<String>,
    #[serde(rename = "zIndex")]
    z_index: Option<i32>,
}

#[derive(Debug, Clone)]
struct MirroredFileAsset {
    mirror_key: String,
    mirror_relpath: String,
    mime_type: String,
    sha256: String,
}

pub(super) async fn vehicle_images(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(vid): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_access(&auth, vid)?;
    require_vehicle_read_access(&state.pool, &auth, vid).await?;
    Ok(Json(
        fetch_vehicle_images_json(&state.pool, &state.config, vid).await?,
    ))
}

pub(super) async fn vehicle_image_cache_asset(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vehicle_id, image_key)): Path<(Uuid, String)>,
) -> Result<Response, AppError> {
    if !sanitize_image_key(&image_key) {
        return Err(AppError::NotFound);
    }
    require_vehicle_read_access(&state.pool, &auth, vehicle_id).await?;
    let metadata = find_mirrored_asset(&state.pool, vehicle_id, &image_key)
        .await?
        .ok_or(AppError::NotFound)?;

    let Some(relpath) = metadata
        .get("mirror_relpath")
        .and_then(|value| value.as_str())
    else {
        queue_vehicle_artwork_repair(&state, vehicle_id).await;
        return Ok(vehicle_artwork_restoring_response());
    };
    let mime_type = metadata
        .get("mime_type")
        .and_then(|value| value.as_str())
        .unwrap_or("application/octet-stream");
    let path = mirror_file_path(&state.config, relpath);
    let Ok(bytes) = tokio::fs::read(path).await else {
        queue_vehicle_artwork_repair(&state, vehicle_id).await;
        return Ok(vehicle_artwork_restoring_response());
    };
    let Some(expected_sha256) = metadata.get("sha256").and_then(|value| value.as_str()) else {
        return Ok(vehicle_artwork_placeholder_response());
    };
    if hex::encode(Sha256::digest(&bytes)) != expected_sha256 {
        queue_vehicle_artwork_repair(&state, vehicle_id).await;
        return Ok(vehicle_artwork_restoring_response());
    }

    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=31536000, immutable"),
    );
    Ok(response)
}

fn vehicle_artwork_placeholder_response() -> Response {
    // A compact, first-party neutral fallback for stale browser URLs while the
    // background worker repairs the persistent artwork cache.
    const PLACEHOLDER: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img" aria-label="Vehicle artwork unavailable"><rect width="320" height="180" fill="#1d2430"/><path d="M54 121h212l-16-39c-4-10-13-16-24-16H94c-11 0-20 6-24 16l-16 39Z" fill="#64748b"/><circle cx="94" cy="122" r="18" fill="#0f172a"/><circle cx="226" cy="122" r="18" fill="#0f172a"/></svg>"##;
    let mut response = Response::new(Body::from(PLACEHOLDER));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("image/svg+xml; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response
}

fn vehicle_artwork_restoring_response() -> Response {
    let mut response = vehicle_artwork_placeholder_response();
    *response.status_mut() = axum::http::StatusCode::ACCEPTED;
    response.headers_mut().insert(
        HeaderName::from_static("x-riviamigo-artwork-state"),
        HeaderValue::from_static("restoring"),
    );
    response
}

pub(super) async fn admin_remirror_vehicle_images(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    require_remote_backed_vehicle(&state.pool, vehicle_id).await?;
    queue_vehicle_artwork_repair_with_mode(&state, vehicle_id, true).await;
    Ok(Json(
        serde_json::json!({ "ok": true, "queued": true, "vehicle_id": vehicle_id }),
    ))
}

pub(super) async fn admin_purge_vehicle_artwork_cache(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    require_remote_backed_vehicle(&state.pool, vehicle_id).await?;
    let _ = tokio::fs::remove_dir_all(image_cache_root(&state.config).join(vehicle_id.to_string()))
        .await;
    sqlx::query(
        "UPDATE riviamigo.vehicle_images
         SET metadata = jsonb_set(metadata, '{mirror_status}', '\"pending\"'::jsonb, true), updated_at = now()
         WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .execute(&state.pool)
    .await?;
    refresh_vehicle_artwork_cache_state(
        &state.pool,
        &state.config,
        vehicle_id,
        ArtworkCacheStateUpdate::Observe,
    )
    .await;
    Ok(Json(
        serde_json::json!({ "ok": true, "vehicle_id": vehicle_id }),
    ))
}
