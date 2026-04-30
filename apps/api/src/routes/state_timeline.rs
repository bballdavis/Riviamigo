//! Vehicle state timeline endpoint — returns `vehicle_state_periods` rows for
//! a time range, suitable for rendering a Gantt-style state chart.

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{errors::AppError, middleware::auth::{AppState, AuthUser}};

pub fn router() -> Router<AppState> {
    Router::new().route("/vehicles/:vehicle_id/state-timeline", get(state_timeline))
}

#[derive(Deserialize)]
struct TimelineParams {
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    500
}

#[derive(Serialize, sqlx::FromRow)]
struct StatePeriod {
    id: i64,
    state: String,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    duration_seconds: Option<i32>,
}

#[derive(Serialize)]
struct TimelineResponse {
    vehicle_id: Uuid,
    periods: Vec<StatePeriod>,
}

async fn state_timeline(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
    Query(params): Query<TimelineParams>,
) -> Result<Json<TimelineResponse>, AppError> {
    ensure_owned(&state.pool, vehicle_id, auth.user_id).await?;

    let from = params.from.unwrap_or_else(|| {
        Utc::now() - chrono::Duration::days(7)
    });
    let to = params.to.unwrap_or_else(Utc::now);
    let limit = params.limit.min(2000);

    let rows = sqlx::query_as!(
        StatePeriod,
        r#"SELECT id, state, started_at, ended_at, duration_seconds
           FROM riviamigo.vehicle_state_periods
           WHERE vehicle_id = $1
             AND started_at >= $2
             AND started_at <= $3
           ORDER BY started_at DESC
           LIMIT $4"#,
        vehicle_id,
        from,
        to,
        limit
    )
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(TimelineResponse { vehicle_id, periods: rows }))
}

async fn ensure_owned(pool: &sqlx::PgPool, vehicle_id: Uuid, user_id: Uuid) -> Result<(), AppError> {
    let owned: bool = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM riviamigo.vehicles WHERE id=$1 AND user_id=$2)",
        vehicle_id,
        user_id
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::from)?
    .unwrap_or(false);

    if !owned {
        Err(AppError::NotFound)
    } else {
        Ok(())
    }
}
