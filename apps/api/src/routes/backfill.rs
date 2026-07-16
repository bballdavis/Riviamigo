//! Charging history backfill routes.
//!
//! This module owns the public API for charging history backfill. Both the
//! current settings endpoint and the older charging-specific endpoint route
//! through the same service so status, locking, and error handling stay aligned.

use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use uuid::Uuid;

use crate::{
    db::vehicles::{require_vehicle_manager_access, require_vehicle_read_access},
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
    services::charge_backfill::{self, ChargeBackfillError},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/vehicles/:id/backfill-status", get(get_backfill_status))
        .route("/vehicles/:id/backfill", post(trigger_backfill))
        .route("/vehicles/:id/charging-backfill", post(trigger_backfill))
}

async fn get_backfill_status(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<charge_backfill::ChargeBackfillStatus>, AppError> {
    require_vehicle_read_access(&state.pool, &auth, vehicle_id).await?;
    Ok(Json(
        charge_backfill::get_status(&state.pool, vehicle_id)
            .await
            .map_err(map_backfill_error)?,
    ))
}

async fn trigger_backfill(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<charge_backfill::ChargeBackfillStart>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    Ok(Json(
        charge_backfill::spawn(state.pool.clone(), state.age_key.clone(), vehicle_id)
            .await
            .map_err(map_backfill_error)?,
    ))
}

fn map_backfill_error(error: ChargeBackfillError) -> AppError {
    match error {
        ChargeBackfillError::AlreadyRunning => {
            AppError::Conflict("backfill already running".into())
        }
        ChargeBackfillError::CredentialsNotFound => AppError::NotFound,
        ChargeBackfillError::Database(error) => AppError::Database(error),
        ChargeBackfillError::Other(error) => AppError::Internal(error),
    }
}
