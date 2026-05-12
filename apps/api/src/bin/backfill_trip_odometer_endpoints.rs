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

    backfill_trip_odometer_endpoints(&pool).await
}

async fn backfill_trip_odometer_endpoints(pool: &PgPool) -> Result<()> {
    let trips = sqlx::query!(
        r#"SELECT id, vehicle_id
           FROM riviamigo.trips
           ORDER BY started_at"#
    )
    .fetch_all(pool)
    .await?;

    info!(count = trips.len(), "backfilling trip endpoints");

    for trip in trips {
        let start = sqlx::query!(
            r#"SELECT ts, odometer_miles, distance_to_empty_mi
               FROM timeseries.telemetry
               WHERE trip_id = $1 AND vehicle_id = $2
               ORDER BY ts ASC
               LIMIT 1"#,
            trip.id,
            trip.vehicle_id
        )
        .fetch_optional(pool)
        .await?;

        let end = sqlx::query!(
            r#"SELECT ts, odometer_miles, distance_to_empty_mi
               FROM timeseries.telemetry
               WHERE trip_id = $1 AND vehicle_id = $2
               ORDER BY ts DESC
               LIMIT 1"#,
            trip.id,
            trip.vehicle_id
        )
        .fetch_optional(pool)
        .await?;

        sqlx::query!(
            r#"UPDATE riviamigo.trips
               SET start_odometer_mi = COALESCE($2, start_odometer_mi),
                   end_odometer_mi = COALESCE($3, end_odometer_mi),
                   start_position_ts = COALESCE($4, start_position_ts),
                   end_position_ts = COALESCE($5, end_position_ts),
                   range_start_mi = COALESCE($6, range_start_mi),
                   range_end_mi = COALESCE($7, range_end_mi)
               WHERE id = $1"#,
            trip.id,
            start.as_ref().and_then(|row| row.odometer_miles),
            end.as_ref().and_then(|row| row.odometer_miles),
            start.as_ref().map(|row| row.ts),
            end.as_ref().map(|row| row.ts),
            start.as_ref().and_then(|row| row.distance_to_empty_mi),
            end.as_ref().and_then(|row| row.distance_to_empty_mi),
        )
        .execute(pool)
        .await?;
    }

    Ok(())
}
