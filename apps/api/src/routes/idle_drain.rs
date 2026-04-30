//! Idle (phantom) drain endpoint — queries the `phantom_drain_periods` view
//! to surface resting energy loss events (e.g. Sentry Mode, camp mode, cold
//! weather conditioning).

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
    Router::new().route("/vehicles/:vehicle_id/idle-drain", get(idle_drain))
}

#[derive(Deserialize)]
struct IdleDrainParams {
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    100
}

#[derive(Serialize, sqlx::FromRow)]
struct PhantomPeriod {
    period_start: Option<DateTime<Utc>>,
    period_end: Option<DateTime<Utc>>,
    duration_hours: Option<f64>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
    soc_lost_pct: Option<f64>,
    drain_pct_per_hour: Option<f64>,
}

#[derive(Serialize)]
struct IdleDrainResponse {
    vehicle_id: Uuid,
    periods: Vec<PhantomPeriod>,
}

async fn idle_drain(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
    Query(params): Query<IdleDrainParams>,
) -> Result<Json<IdleDrainResponse>, AppError> {
    ensure_owned(&state.pool, vehicle_id, auth.user_id).await?;

    let from = params.from.unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
    let to = params.to.unwrap_or_else(Utc::now);
    let limit = params.limit.min(500);

    let periods = sqlx::query_as!(
        PhantomPeriod,
        r#"SELECT
                             period_start,
                             period_end,
                             duration_hours AS "duration_hours?: f64",
               soc_start,
               soc_end,
                             soc_lost_pct,
                             drain_pct_per_hour
           FROM timeseries.phantom_drain_periods
           WHERE vehicle_id = $1
                         AND period_start >= $2
                         AND period_start <= $3
                     ORDER BY period_start DESC
           LIMIT $4"#,
        vehicle_id,
        from,
        to,
        limit
    )
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(IdleDrainResponse { vehicle_id, periods }))
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

    if !owned { Err(AppError::NotFound) } else { Ok(()) }
}
