//! Reverse-geocode trip start/end points that have no address row yet.
//!
//! Run after `backfill_geofence_matches` so geofence-linked addresses are
//! already in place.  This binary only touches trips where start_address_id
//! or end_address_id is NULL and the corresponding lat/lng is known.
//!
//! Usage:
//!   DATABASE_URL=... cargo run --bin backfill_trip_addresses

use anyhow::Result;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(3)
        .connect(&database_url)
        .await?;

    backfill_trip_addresses(&pool).await
}

async fn backfill_trip_addresses(pool: &PgPool) -> Result<()> {
    // Fetch trips missing at least one address, where coords are available.
    let trips = sqlx::query!(
        r#"SELECT id,
                  start_lat, start_lng, start_address_id,
                  end_lat,   end_lng,   end_address_id
           FROM riviamigo.trips
           WHERE (start_address_id IS NULL AND start_lat IS NOT NULL AND start_lng IS NOT NULL)
              OR (end_address_id   IS NULL AND end_lat   IS NOT NULL AND end_lng   IS NOT NULL)
           ORDER BY started_at DESC"#
    )
    .fetch_all(pool)
    .await?;

    info!(count = trips.len(), "trips needing address backfill");

    for trip in trips {
        let start_addr = if trip.start_address_id.is_none() {
            if let (Some(lat), Some(lon)) = (trip.start_lat, trip.start_lng) {
                reverse_geocode_and_store(pool, lat, lon).await
            } else {
                None
            }
        } else {
            trip.start_address_id
        };

        let end_addr = if trip.end_address_id.is_none() {
            if let (Some(lat), Some(lon)) = (trip.end_lat, trip.end_lng) {
                reverse_geocode_and_store(pool, lat, lon).await
            } else {
                None
            }
        } else {
            trip.end_address_id
        };

        if start_addr.is_some() || end_addr.is_some() {
            sqlx::query!(
                r#"UPDATE riviamigo.trips
                   SET start_address_id = COALESCE($2, start_address_id),
                       end_address_id   = COALESCE($3, end_address_id)
                   WHERE id = $1"#,
                trip.id,
                start_addr,
                end_addr,
            )
            .execute(pool)
            .await?;
        }
    }

    info!("trip address backfill complete");
    Ok(())
}

/// Call Nominatim reverse geocoding, upsert into `riviamigo.addresses`,
/// and return the UUID.  Applies ≥ 1100 ms pacing between calls.
async fn reverse_geocode_and_store(pool: &PgPool, lat: f64, lon: f64) -> Option<Uuid> {
    // Nominatim policy: max 1 req/s.
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;

    let lat_s = lat.to_string();
    let lon_s = lon.to_string();
    let resp = client
        .get("https://nominatim.openstreetmap.org/reverse")
        .header(
            reqwest::header::USER_AGENT,
            "riviamigo-api/0.1 (contact: support@riviamigo.com)",
        )
        .query(&[
            ("format", "jsonv2"),
            ("addressdetails", "1"),
            ("lat", lat_s.as_str()),
            ("lon", lon_s.as_str()),
        ])
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        tracing::warn!(status=%resp.status(), lat=%lat, lon=%lon, "backfill.reverse_geocode_http_error");
        return None;
    }

    let raw: serde_json::Value = resp.json().await.ok()?;

    let display_name = raw.get("display_name")?.as_str()?.to_string();
    let osm_id = raw.get("osm_id").and_then(|v| v.as_i64());
    let addr = raw.get("address").and_then(|v| v.as_object());

    let road: Option<String> = addr
        .and_then(|a| {
            a.get("road")
                .or_else(|| a.get("pedestrian"))
                .or_else(|| a.get("footway"))
        })
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let city: Option<String> = addr
        .and_then(|a| {
            a.get("city")
                .or_else(|| a.get("town"))
                .or_else(|| a.get("village"))
        })
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let state: Option<String> = addr
        .and_then(|a| a.get("state"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let postcode: Option<String> = addr
        .and_then(|a| a.get("postcode"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let country: Option<String> = addr
        .and_then(|a| a.get("country"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let result: Result<Uuid, sqlx::Error> = if let Some(oid) = osm_id {
        sqlx::query_scalar!(
            r#"INSERT INTO riviamigo.addresses
               (display_name, osm_id, latitude, longitude, road, city, state, postcode, country, raw)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (osm_id) DO UPDATE SET
                 display_name = EXCLUDED.display_name,
                 road = EXCLUDED.road,
                 city = EXCLUDED.city,
                 state = EXCLUDED.state,
                 postcode = EXCLUDED.postcode,
                 country = EXCLUDED.country,
                 raw = EXCLUDED.raw
               RETURNING id"#,
            display_name,
            oid,
            lat,
            lon,
            road,
            city,
            state,
            postcode,
            country,
            raw,
        )
        .fetch_one(pool)
        .await
    } else {
        sqlx::query_scalar!(
            r#"INSERT INTO riviamigo.addresses
               (display_name, latitude, longitude, road, city, state, postcode, country, raw)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING id"#,
            display_name,
            lat,
            lon,
            road,
            city,
            state,
            postcode,
            country,
            raw,
        )
        .fetch_one(pool)
        .await
    };

    match result {
        Ok(id) => {
            tracing::info!(lat=%lat, lon=%lon, address_id=%id, "backfill.address_stored");
            Some(id)
        }
        Err(e) => {
            tracing::warn!(error=%e, "backfill.reverse_geocode_db_insert_failed");
            None
        }
    }
}
