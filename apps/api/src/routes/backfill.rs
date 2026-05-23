//! Charging history backfill endpoint.
//!
//! Allows a user to manually trigger (or re-trigger) a full charge history
//! backfill for one of their vehicles.  The API reads the vehicle's stored
//! Rivian credentials, spawns `fetch_charge_history_full` in the background,
//! and returns immediately with `{"status":"running"}`.
//!
//! Status tracking is written back to `riviamigo.vehicles`:
//!   history_backfill_status  — 'running' | 'done' | 'error'
//!   history_backfilled_at    — set to now() on success
//!   history_session_count    — number of sessions processed on success
//!
//! These fields are included in `GET /v1/vehicles` so the UI can poll for
//! completion without a dedicated SSE/WebSocket stream.

use axum::{
    extract::{Path, State},
    routing::post,
    Json, Router,
};
use tracing::{info, warn};
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_owned,
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new().route("/vehicles/:id/charging-backfill", post(trigger_backfill))
}

async fn trigger_backfill(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vid): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    // Reject concurrent runs.
    let current_status: Option<String> = sqlx::query_scalar(
        "SELECT history_backfill_status FROM riviamigo.vehicles WHERE id = $1",
    )
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .flatten();

    if current_status.as_deref() == Some("running") {
        return Err(AppError::Conflict("backfill already running".into()));
    }

    // Fetch Rivian vehicle ID and decrypt stored credentials.
    let row: Option<(String, Vec<u8>)> = sqlx::query_as(
        "SELECT v.rivian_vehicle_id, vc.encrypted_tokens \
         FROM riviamigo.vehicles v \
         JOIN riviamigo.vehicle_credentials vc ON vc.vehicle_id = v.id \
         WHERE v.id = $1",
    )
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?;

    let (rivian_vehicle_id, encrypted_tokens) = row.ok_or(AppError::NotFound)?;

    let identity = state
        .age_key
        .parse::<age::x25519::Identity>()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("age key parse failed: {e}")))?;

    let tokens =
        crate::ingestion::session_store::decrypt_tokens(&encrypted_tokens, &identity)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("token decrypt failed: {e}")))?;

    // Mark as running before spawning so the UI can reflect it immediately.
    sqlx::query(
        "UPDATE riviamigo.vehicles \
         SET history_backfill_status = 'running', \
             history_backfilled_at   = NULL, \
             history_session_count   = NULL \
         WHERE id = $1",
    )
    .bind(vid)
    .execute(&state.pool)
    .await?;

    let pool = state.pool.clone();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    tokio::spawn(async move {
        match crate::ingestion::rivian_poll::fetch_charge_history_full(
            &rivian_vehicle_id,
            vid,
            &pool,
            &client,
            &tokens,
        )
        .await
        {
            Ok(count) => {
                let _ = sqlx::query(
                    "UPDATE riviamigo.vehicles \
                     SET history_backfill_status = 'done', \
                         history_backfilled_at   = now(), \
                         history_session_count   = $2 \
                     WHERE id = $1",
                )
                .bind(vid)
                .bind(count as i32)
                .execute(&pool)
                .await;
                info!(vehicle_id=%vid, count, "manual charging backfill complete");
            }
            Err(e) => {
                let _ = sqlx::query(
                    "UPDATE riviamigo.vehicles \
                     SET history_backfill_status = 'error' \
                     WHERE id = $1",
                )
                .bind(vid)
                .execute(&pool)
                .await;
                warn!(vehicle_id=%vid, err=%e, "manual charging backfill failed");
            }
        }
    });

    Ok(Json(serde_json::json!({ "status": "running" })))
}
