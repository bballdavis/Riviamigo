//! Dashboard overview endpoint — a single aggregated tile payload for the
//! main dashboard screen.

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::{errors::AppError, middleware::auth::{AppState, AuthUser}};

pub fn router() -> Router<AppState> {
    Router::new().route("/dashboard/overview/:vehicle_id", get(overview))
}

#[derive(Serialize)]
struct OverviewResponse {
    vehicle_id: Uuid,
    generated_at: DateTime<Utc>,
    live: Option<LiveTile>,
    last_trip: Option<TripTile>,
    last_charge: Option<ChargeTile>,
    today: TodayTile,
}

#[derive(Serialize, sqlx::FromRow)]
struct LiveTile {
    battery_level: Option<f64>,
    distance_to_empty_mi: Option<f64>,
    power_state: Option<String>,
    odometer_miles: Option<f64>,
    outside_temp_c: Option<f64>,
    ts: Option<DateTime<Utc>>,
}

#[derive(Serialize, sqlx::FromRow)]
struct TripTile {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    distance_miles: Option<f64>,
    efficiency_wh_per_mile: Option<f64>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
}

#[derive(Serialize, sqlx::FromRow)]
struct ChargeTile {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
    energy_added_wh: Option<f64>,
    charger_type: Option<String>,
}

#[derive(Serialize)]
struct TodayTile {
    date: NaiveDate,
    miles_driven: Option<f64>,
}

async fn overview(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<OverviewResponse>, AppError> {
    // Verify ownership
    let owned: bool = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM riviamigo.vehicles WHERE id=$1 AND user_id=$2)",
        vehicle_id,
        auth.user_id
    )
    .fetch_one(&state.pool)
    .await
    .map_err(AppError::from)?
    .unwrap_or(false);

    if !owned {
        return Err(AppError::NotFound);
    }

    let (live, last_trip, last_charge, today_miles) = tokio::try_join!(
        fetch_live(&state.pool, vehicle_id),
        fetch_last_trip(&state.pool, vehicle_id),
        fetch_last_charge(&state.pool, vehicle_id),
        fetch_today_miles(&state.pool, vehicle_id),
    )?;

    Ok(Json(OverviewResponse {
        vehicle_id,
        generated_at: Utc::now(),
        live,
        last_trip,
        last_charge,
        today: TodayTile {
            date: Utc::now().date_naive(),
            miles_driven: today_miles,
        },
    }))
}

async fn fetch_live(pool: &sqlx::PgPool, vid: Uuid) -> Result<Option<LiveTile>, AppError> {
    let row = sqlx::query_as!(
        LiveTile,
        r#"SELECT battery_level, distance_to_empty_mi, power_state, odometer_miles,
                  outside_temp_c, ts
           FROM timeseries.telemetry
           WHERE vehicle_id = $1
           ORDER BY ts DESC LIMIT 1"#,
        vid
    )
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;
    Ok(row)
}

async fn fetch_last_trip(pool: &sqlx::PgPool, vid: Uuid) -> Result<Option<TripTile>, AppError> {
    let row = sqlx::query_as!(
        TripTile,
        r#"SELECT id, started_at, ended_at, distance_miles,
                  efficiency_wh_per_mile, soc_start, soc_end
           FROM riviamigo.trips
           WHERE vehicle_id = $1
           ORDER BY ended_at DESC LIMIT 1"#,
        vid
    )
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;
    Ok(row)
}

async fn fetch_last_charge(pool: &sqlx::PgPool, vid: Uuid) -> Result<Option<ChargeTile>, AppError> {
    let row = sqlx::query_as!(
        ChargeTile,
        r#"SELECT id, started_at, ended_at, soc_start, soc_end,
                  energy_added_wh, charger_type
           FROM riviamigo.charge_sessions
           WHERE vehicle_id = $1
           ORDER BY started_at DESC LIMIT 1"#,
        vid
    )
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;
    Ok(row)
}

async fn fetch_today_miles(pool: &sqlx::PgPool, vid: Uuid) -> Result<Option<f64>, AppError> {
    // odometer_daily CAGG stores max odometer per day; diff today's max from yesterday's max
    let miles: Option<f64> = sqlx::query_scalar!(
        r#"SELECT miles_driven
           FROM timeseries.odometer_daily
           WHERE vehicle_id = $1
                         AND day = date_trunc('day', now())::timestamptz
           LIMIT 1"#,
        vid
    )
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?
    .flatten();
    Ok(miles)
}
