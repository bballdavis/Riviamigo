//! Backfill trip_id on historical telemetry rows.
//!
//! For each completed trip, stamps all telemetry rows that fall within
//! [started_at, ended_at] and belong to the same vehicle with that trip's UUID.
//!
//! Run once after deploying migration 0011:
//!   cargo run --bin backfill_trip_ids

use anyhow::Result;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    backfill_trip_ids(&pool).await?;
    Ok(())
}

async fn backfill_trip_ids(pool: &PgPool) -> Result<()> {
    let trips = sqlx::query!(
        r#"SELECT id, vehicle_id, started_at, ended_at
           FROM riviamigo.trips
           WHERE ended_at IS NOT NULL
           ORDER BY started_at"#
    )
    .fetch_all(pool)
    .await?;

    info!("Found {} completed trips to backfill", trips.len());

    for trip in &trips {
        let result = sqlx::query!(
            r#"UPDATE timeseries.telemetry
               SET trip_id = $1
               WHERE vehicle_id = $2
                 AND ts >= $3
                 AND ts <= $4
                 AND trip_id IS NULL"#,
            trip.id,
            trip.vehicle_id,
            trip.started_at,
            trip.ended_at
        )
        .execute(pool)
        .await?;

        if result.rows_affected() > 0 {
            info!(
                trip_id = %trip.id,
                rows = result.rows_affected(),
                "Stamped telemetry rows"
            );
        }
    }

    info!("Backfill complete");
    Ok(())
}
