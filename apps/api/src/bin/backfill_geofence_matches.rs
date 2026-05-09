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
    // Only process trips that are missing at least one geofence/address link.
    let trips = sqlx::query!(
        r#"SELECT id, vehicle_id, start_lat, start_lng, end_lat, end_lng
           FROM riviamigo.trips
           WHERE (start_geofence_id IS NULL AND start_lat IS NOT NULL AND start_lng IS NOT NULL)
              OR (end_geofence_id   IS NULL AND end_lat   IS NOT NULL AND end_lng   IS NOT NULL)"#
    )
    .fetch_all(pool)
    .await?;

    info!(count = trips.len(), "trips needing geofence backfill");

    let mut trip_filled = 0usize;
    let mut trip_failed = 0usize;

    for trip in &trips {
        let owner_id = match get_vehicle_owner_id(pool, trip.vehicle_id).await {
            Ok(id) => id,
            Err(e) => {
                tracing::warn!(trip_id=%trip.id, error=%e, "backfill.geofence.owner_lookup_failed");
                trip_failed += 1;
                continue;
            }
        };

        let start_match = match (owner_id, trip.start_lat, trip.start_lng) {
            (Some(user_id), Some(lat), Some(lon)) => {
                match match_geofence(pool, user_id, lat, lon).await {
                    Ok(m) => m,
                    Err(e) => {
                        tracing::warn!(trip_id=%trip.id, error=%e, "backfill.geofence.start_match_failed");
                        None
                    }
                }
            }
            _ => None,
        };

        let end_match = match (owner_id, trip.end_lat, trip.end_lng) {
            (Some(user_id), Some(lat), Some(lon)) => {
                match match_geofence(pool, user_id, lat, lon).await {
                    Ok(m) => m,
                    Err(e) => {
                        tracing::warn!(trip_id=%trip.id, error=%e, "backfill.geofence.end_match_failed");
                        None
                    }
                }
            }
            _ => None,
        };

        // COALESCE preserves any existing IDs — only fills NULLs.
        if let Err(e) = sqlx::query!(
            r#"UPDATE riviamigo.trips
               SET start_geofence_id = COALESCE(start_geofence_id, $2),
                   end_geofence_id   = COALESCE(end_geofence_id,   $3),
                   start_address_id  = COALESCE(start_address_id,  $4),
                   end_address_id    = COALESCE(end_address_id,    $5)
               WHERE id = $1"#,
            trip.id,
            start_match.as_ref().map(|m| m.id),
            end_match.as_ref().map(|m| m.id),
            start_match.as_ref().and_then(|m| m.address_id),
            end_match.as_ref().and_then(|m| m.address_id),
        )
        .execute(pool)
        .await
        {
            tracing::warn!(trip_id=%trip.id, error=%e, "backfill.geofence.trip_update_failed");
            trip_failed += 1;
        } else {
            trip_filled += 1;
        }
    }

    info!(trip_filled, trip_failed, "trip geofence backfill complete");

    // Only process charge sessions missing a geofence/address link.
    let sessions = sqlx::query!(
        r#"SELECT id, vehicle_id, location_lat, location_lng
           FROM riviamigo.charge_sessions
           WHERE geofence_id IS NULL
             AND location_lat IS NOT NULL
             AND location_lng IS NOT NULL"#
    )
    .fetch_all(pool)
    .await?;

    info!(count = sessions.len(), "charge sessions needing geofence backfill");

    let mut session_filled = 0usize;
    let mut session_failed = 0usize;

    for session in &sessions {
        let owner_id = match get_vehicle_owner_id(pool, session.vehicle_id).await {
            Ok(id) => id,
            Err(e) => {
                tracing::warn!(session_id=%session.id, error=%e, "backfill.geofence.owner_lookup_failed");
                session_failed += 1;
                continue;
            }
        };

        let matched = match (owner_id, session.location_lat, session.location_lng) {
            (Some(user_id), Some(lat), Some(lon)) => {
                match match_geofence(pool, user_id, lat, lon).await {
                    Ok(m) => m,
                    Err(e) => {
                        tracing::warn!(session_id=%session.id, error=%e, "backfill.geofence.session_match_failed");
                        None
                    }
                }
            }
            _ => None,
        };

        if let Err(e) = sqlx::query!(
            r#"UPDATE riviamigo.charge_sessions
               SET geofence_id = COALESCE(geofence_id, $2),
                   address_id  = COALESCE(address_id,  $3),
                   is_home     = COALESCE(is_home,     $4)
               WHERE id = $1"#,
            session.id,
            matched.as_ref().map(|m| m.id),
            matched.as_ref().and_then(|m| m.address_id),
            matched.as_ref().map(|m| m.is_home),
        )
        .execute(pool)
        .await
        {
            tracing::warn!(session_id=%session.id, error=%e, "backfill.geofence.session_update_failed");
            session_failed += 1;
        } else {
            session_filled += 1;
        }
    }

    info!(session_filled, session_failed, "charge session geofence backfill complete");
    Ok(())
}
