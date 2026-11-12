//! Job routes for Settings > Jobs.
//!
//! Site-wide jobs cover the whole installation, so only admins can see or
//! start them. Vehicle jobs follow vehicle access: members can see each job's
//! latest run, and only the vehicle's managers can start one. The work itself
//! lives in `services::maintenance_jobs`.

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
    services::maintenance_jobs::{self, MaintenanceJobError, MaintenanceJobStatus},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/maintenance-jobs", get(list_site_jobs))
        .route("/maintenance-jobs/{kind}", post(start_site_job))
        .route("/vehicles/{id}/maintenance-jobs", get(list_vehicle_jobs))
        .route(
            "/vehicles/{id}/maintenance-jobs/{kind}",
            post(start_vehicle_job),
        )
}

async fn list_site_jobs(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<MaintenanceJobStatus>>, AppError> {
    require_admin(&state, auth.user_id).await?;
    Ok(Json(
        maintenance_jobs::list_site(&state.pool)
            .await
            .map_err(map_error)?,
    ))
}

async fn start_site_job(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(kind): Path<String>,
) -> Result<Json<MaintenanceJobStatus>, AppError> {
    require_admin(&state, auth.user_id).await?;
    Ok(Json(
        maintenance_jobs::spawn_site(state.pool.clone(), &kind, auth.user_id)
            .await
            .map_err(map_error)?,
    ))
}

async fn list_vehicle_jobs(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<Vec<MaintenanceJobStatus>>, AppError> {
    require_vehicle_read_access(&state.pool, &auth, vehicle_id).await?;
    Ok(Json(
        maintenance_jobs::list_vehicle(&state.pool, vehicle_id)
            .await
            .map_err(map_error)?,
    ))
}

async fn start_vehicle_job(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vehicle_id, kind)): Path<(Uuid, String)>,
) -> Result<Json<MaintenanceJobStatus>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    Ok(Json(
        maintenance_jobs::spawn_vehicle(state.pool.clone(), vehicle_id, &kind, auth.user_id)
            .await
            .map_err(map_error)?,
    ))
}

async fn require_admin(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    let role = sqlx::query_scalar::<_, String>("SELECT role FROM riviamigo.users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?;
    if role_can_manage_installation(role.as_deref()) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

fn role_can_manage_installation(role: Option<&str>) -> bool {
    matches!(role, Some("admin" | "super_user"))
}

fn map_error(error: MaintenanceJobError) -> AppError {
    match error {
        MaintenanceJobError::AlreadyRunning => {
            AppError::Conflict("this job is already running".into())
        }
        MaintenanceJobError::NotFound => AppError::NotFound,
        MaintenanceJobError::Database(error) => AppError::Database(error),
    }
}

#[cfg(test)]
mod tests {
    use super::role_can_manage_installation;

    #[test]
    fn only_installation_managers_see_site_jobs() {
        assert!(role_can_manage_installation(Some("admin")));
        assert!(role_can_manage_installation(Some("super_user")));
        assert!(!role_can_manage_installation(Some("user")));
        assert!(!role_can_manage_installation(None));
    }
}
