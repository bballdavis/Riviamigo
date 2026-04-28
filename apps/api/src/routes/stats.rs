use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_owned,
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new().route("/stats/summary", get(get_summary))
}

#[derive(Deserialize)]
struct Params {
    vehicle_id: Option<Uuid>,
}

async fn get_summary(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Params>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let rate = crate::db::users::get_electricity_rate(&state.pool, auth.user_id).await?;

    let trips = sqlx::query!(
        "SELECT COALESCE(SUM(distance_miles),0) AS total_miles,
                COUNT(*) AS total_trips,
                CASE WHEN SUM(distance_miles) > 0
                     THEN SUM(distance_miles * efficiency_wh_per_mile) / SUM(distance_miles)
                     ELSE NULL END AS lifetime_efficiency
         FROM riviamigo.trips WHERE vehicle_id=$1",
        vid
    )
    .fetch_one(&state.pool)
    .await?;

    let charging = sqlx::query!(
        "SELECT COALESCE(SUM(kwh_added),0) AS total_kwh, COUNT(*) AS sessions
         FROM riviamigo.charge_sessions WHERE vehicle_id=$1",
        vid
    )
    .fetch_one(&state.pool)
    .await?;

    let total_kwh = charging.total_kwh.unwrap_or(0.0);
    Ok(Json(serde_json::json!({
        "total_miles":                trips.total_miles,
        "total_trips":                trips.total_trips,
        "total_kwh_charged":          total_kwh,
        "lifetime_efficiency_wh_mi":  trips.lifetime_efficiency,
        "total_charging_sessions":    charging.sessions,
        "estimated_total_cost_usd":   total_kwh * rate,
    })))
}
