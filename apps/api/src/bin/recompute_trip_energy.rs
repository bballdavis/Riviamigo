use anyhow::Result;
use riviamigo_api::ingestion::trip_detector::compute_trip_energy;
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

    recompute_trip_energy(&pool).await
}

async fn recompute_trip_energy(pool: &PgPool) -> Result<()> {
    let trips = sqlx::query!(
        r#"SELECT t.id, t.distance_miles, t.soc_start, t.soc_end, t.range_start_mi, t.range_end_mi,
                  t.efficiency_wh_per_mile,
                  v.battery_capacity_wh
           FROM riviamigo.trips t
           JOIN riviamigo.vehicles v ON v.id = t.vehicle_id"#
    )
    .fetch_all(pool)
    .await?;

    for trip in trips {
        let distance = trip.distance_miles.unwrap_or(0.0);
        let (energy_wh, strategy, efficiency_wh_per_mile) = match compute_trip_energy(
            trip.soc_start,
            trip.soc_end,
            trip.battery_capacity_wh,
            trip.range_start_mi,
            trip.range_end_mi,
            distance,
            trip.efficiency_wh_per_mile,
        ) {
            Some((wh, strategy)) => {
                let efficiency = if distance > 0.0 { Some(wh / distance) } else { None };
                (Some(wh), Some(strategy.to_string()), efficiency)
            }
            None => {
                let efficiency = match (trip.soc_start, trip.soc_end, trip.battery_capacity_wh) {
                    (Some(s0), Some(s1), Some(cap)) if distance > 0.0 && s0 > s1 => {
                        Some(((s0 - s1) / 100.0) * cap / distance)
                    }
                    _ => None,
                };
                (None, None, efficiency)
            }
        };

        sqlx::query!(
            r#"UPDATE riviamigo.trips
               SET energy_wh = $2,
                   energy_strategy = $3,
                   efficiency_wh_per_mile = COALESCE($4, efficiency_wh_per_mile)
               WHERE id = $1"#,
            trip.id,
            energy_wh,
            strategy,
            efficiency_wh_per_mile,
        )
        .execute(pool)
        .await?;
    }

    info!("trip energy recompute complete");
    Ok(())
}