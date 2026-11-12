//! Manual maintenance job routes for Settings > Jobs.
//!
//! Members can see each job's latest run; only vehicle managers can start one.
//! The work itself lives in `services::maintenance_jobs`.

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
    services::maintenance_jobs::{
        self, MaintenanceJobError, MaintenanceJobKind, MaintenanceJobStatus,
    },
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/vehicles/{id}/maintenance-jobs", get(list_jobs))
        .route("/vehicles/{id}/maintenance-jobs/{kind}", post(start_job))
}

async fn list_jobs(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<Vec<MaintenanceJobStatus>>, AppError> {
    require_vehicle_read_access(&state.pool, &auth, vehicle_id).await?;
    Ok(Json(
        maintenance_jobs::list(&state.pool, vehicle_id)
            .await
            .map_err(map_error)?,
    ))
}

async fn start_job(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vehicle_id, kind)): Path<(Uuid, String)>,
) -> Result<Json<MaintenanceJobStatus>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    let kind = MaintenanceJobKind::parse(&kind).ok_or(AppError::NotFound)?;
    Ok(Json(
        maintenance_jobs::spawn(state.pool.clone(), vehicle_id, kind, auth.user_id)
            .await
            .map_err(map_error)?,
    ))
}

fn map_error(error: MaintenanceJobError) -> AppError {
    match error {
        MaintenanceJobError::AlreadyRunning => {
            AppError::Conflict("this job is already running".into())
        }
        MaintenanceJobError::Database(error) => AppError::Database(error),
    }
}
