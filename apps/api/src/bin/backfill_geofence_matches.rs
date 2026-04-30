use anyhow::Result;
use riviamigo_api::{
    db::vehicles::get_vehicle_owner_id,
    services::geofences::match_geofence,
};
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

    backfill_geofence_matches(&pool).await
}

async fn backfill_geofence_matches(pool: &PgPool) -> Result<()> {
    let trips = sqlx::query!(
        r#"SELECT id, vehicle_id, start_lat, start_lng, end_lat, end_lng
           FROM riviamigo.trips"#
    )
    .fetch_all(pool)
    .await?;

    for trip in trips {
        let owner_id = get_vehicle_owner_id(pool, trip.vehicle_id).await?;
        let start_match = match (owner_id, trip.start_lat, trip.start_lng) {
            (Some(user_id), Some(lat), Some(lon)) => match_geofence(pool, user_id, lat, lon).await?,
            _ => None,
        };
        let end_match = match (owner_id, trip.end_lat, trip.end_lng) {
            (Some(user_id), Some(lat), Some(lon)) => match_geofence(pool, user_id, lat, lon).await?,
            _ => None,
        };

        sqlx::query!(
            r#"UPDATE riviamigo.trips
               SET start_geofence_id = $2,
                   end_geofence_id = $3,
                   start_address_id = $4,
                   end_address_id = $5
               WHERE id = $1"#,
            trip.id,
            start_match.as_ref().map(|m| m.id),
            end_match.as_ref().map(|m| m.id),
            start_match.as_ref().and_then(|m| m.address_id),
            end_match.as_ref().and_then(|m| m.address_id),
        )
        .execute(pool)
        .await?;
    }

    let sessions = sqlx::query!(
        r#"SELECT id, vehicle_id, location_lat, location_lng
           FROM riviamigo.charge_sessions"#
    )
    .fetch_all(pool)
    .await?;

    for session in sessions {
        let owner_id = get_vehicle_owner_id(pool, session.vehicle_id).await?;
        let matched = match (owner_id, session.location_lat, session.location_lng) {
            (Some(user_id), Some(lat), Some(lon)) => match_geofence(pool, user_id, lat, lon).await?,
            _ => None,
        };

        sqlx::query!(
            r#"UPDATE riviamigo.charge_sessions
               SET geofence_id = $2,
                   address_id = $3,
                   is_home = COALESCE($4, is_home)
               WHERE id = $1"#,
            session.id,
            matched.as_ref().map(|m| m.id),
            matched.as_ref().and_then(|m| m.address_id),
            matched.as_ref().map(|m| m.is_home),
        )
        .execute(pool)
        .await?;
    }

    info!("geofence match backfill complete");
    Ok(())
}