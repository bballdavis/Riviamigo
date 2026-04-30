//! Backfill vehicle_state_periods from historical telemetry.
//!
//! Performs a run-length encode over `power_state` (ordered by ts) for each
//! vehicle and inserts the resulting contiguous periods.
//!
//! Run once after deploying migration 0009:
//!   cargo run --bin backfill_state_periods

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    backfill_state_periods(&pool).await?;
    Ok(())
}

async fn backfill_state_periods(pool: &PgPool) -> Result<()> {
    let vehicles = sqlx::query_scalar!("SELECT id FROM riviamigo.vehicles")
        .fetch_all(pool)
        .await?;

    sqlx::query!("DELETE FROM riviamigo.vehicle_state_periods")
        .execute(pool)
        .await?;

    info!("Backfilling state periods for {} vehicles", vehicles.len());

    for vehicle_id in vehicles {
        process_vehicle(pool, vehicle_id).await?;
    }

    info!("State period backfill complete");
    Ok(())
}

struct TelemetryRow {
    ts: DateTime<Utc>,
    power_state: Option<String>,
}

fn normalize_state(power_state: Option<&str>) -> String {
    match power_state.map(|state| state.trim().to_ascii_lowercase()) {
        Some(state) if state == "drive" || state == "go" => "drive".to_string(),
        Some(state) if state == "charging" => "charging".to_string(),
        Some(state) if state == "ready" => "ready".to_string(),
        Some(state) if state == "sleep" => "sleep".to_string(),
        Some(state) if state == "offline" => "offline".to_string(),
        Some(state) if state == "updating" => "updating".to_string(),
        _ => "unknown".to_string(),
    }
}

async fn process_vehicle(pool: &PgPool, vehicle_id: Uuid) -> Result<()> {
    let rows = sqlx::query_as!(
        TelemetryRow,
        r#"SELECT ts, power_state
           FROM timeseries.telemetry
           WHERE vehicle_id = $1
           ORDER BY ts"#,
        vehicle_id
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(());
    }

    // Run-length encode the power_state column.
    // A period closes when state changes or the gap between samples > 10 min.
    let mut periods: Vec<(String, DateTime<Utc>, DateTime<Utc>)> = Vec::new();
    let mut current_state = normalize_state(rows[0].power_state.as_deref());
    let mut period_start = rows[0].ts;
    let mut prev_ts = rows[0].ts;

    for row in rows.iter().skip(1) {
        let state = normalize_state(row.power_state.as_deref());
        let gap_secs = (row.ts - prev_ts).num_seconds();
        let state_changed = state != current_state;
        let large_gap = gap_secs > 600; // 10-minute gap = implicit state break

        if state_changed || large_gap {
            periods.push((current_state.clone(), period_start, prev_ts));
            period_start = row.ts;
            current_state = state;
        }
        prev_ts = row.ts;
    }
    // Close final period
    periods.push((current_state, period_start, prev_ts));

    info!(vehicle_id = %vehicle_id, periods = periods.len(), "Inserting state periods");

    for (state, started_at, ended_at) in periods {
        sqlx::query!(
            r#"INSERT INTO riviamigo.vehicle_state_periods
               (vehicle_id, state, started_at, ended_at)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT DO NOTHING"#,
            vehicle_id,
            state,
            started_at,
            ended_at
        )
        .execute(pool)
        .await?;
    }

    Ok(())
}
