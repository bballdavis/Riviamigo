//! Backfill outside_temp_c on trips that have no value yet by fetching the
//! ambient temperature from Open-Meteo at the trip's start location and time.
//!
//! Safe to re-run: only touches rows where outside_temp_c IS NULL.
//! Skips trips with no start lat/lng (can't do a location-based lookup).
//!
//! Usage:
//!   DATABASE_URL=... cargo run --bin backfill_outside_temp

use anyhow::Result;
use reqwest::Client;
use riviamigo_api::services::weather::fetch_ambient_temp_c;
use sqlx::postgres::PgPoolOptions;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    let http_client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    let trips = sqlx::query!(
        r#"SELECT id, started_at, start_lat, start_lng
           FROM riviamigo.trips
           WHERE outside_temp_c IS NULL
             AND start_lat IS NOT NULL
             AND start_lng IS NOT NULL
           ORDER BY started_at DESC"#
    )
    .fetch_all(&pool)
    .await?;

    info!(count = trips.len(), "trips needing outside_temp_c backfill");

    let mut filled = 0usize;
    let mut failed = 0usize;

    for trip in &trips {
        let (Some(lat), Some(lng)) = (trip.start_lat, trip.start_lng) else {
            continue;
        };

        match fetch_ambient_temp_c(&http_client, lat, lng, trip.started_at).await {
            Some(temp_c) => {
                if let Err(e) = sqlx::query!(
                    "UPDATE riviamigo.trips SET outside_temp_c = $2 WHERE id = $1",
                    trip.id,
                    temp_c,
                )
                .execute(&pool)
                .await
                {
                    tracing::warn!(trip_id = %trip.id, error = %e, "backfill.update_failed");
                    failed += 1;
                } else {
                    filled += 1;
                    tracing::debug!(trip_id = %trip.id, temp_c, "backfill.updated");
                }
            }
            None => {
                tracing::warn!(
                    trip_id = %trip.id,
                    lat, lng,
                    started_at = %trip.started_at,
                    "backfill.weather_lookup_failed"
                );
                failed += 1;
            }
        }

        // Open-Meteo's free tier is generous but let's be polite
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    info!(filled, failed, "outside_temp_c backfill complete");
    Ok(())
}
