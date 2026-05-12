//! Reverse-geocode trip start/end points and charge session locations that
//! have no address row yet.
//!
//! Run after `backfill_geofence_matches` so geofence-linked addresses are
//! already in place.  This binary only touches rows where address_id is NULL
//! and the corresponding lat/lng is known.
//!
//! Usage:
//!   DATABASE_URL=... cargo run --bin backfill_trip_addresses

use anyhow::Result;
use reqwest::Client;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;
use uuid::Uuid;

const MAX_RETRIES: u32 = 4;
// Base delay in ms; doubles each retry: 1100 → 2200 → 4400 → 8800
const BASE_DELAY_MS: u64 = 1100;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(3)
        .connect(&database_url)
        .await?;

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    backfill_trip_addresses(&pool, &client).await?;
    backfill_charge_session_addresses(&pool, &client).await?;
    Ok(())
}

async fn backfill_trip_addresses(pool: &PgPool, client: &Client) -> Result<()> {
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

    let mut filled = 0usize;
    let mut failed = 0usize;

    for trip in &trips {
        let start_addr = if trip.start_address_id.is_none() {
            if let (Some(lat), Some(lon)) = (trip.start_lat, trip.start_lng) {
                match reverse_geocode_with_retry(pool, client, lat, lon).await {
                    Some(id) => Some(id),
                    None => {
                        failed += 1;
                        None
                    }
                }
            } else {
                None
            }
        } else {
            trip.start_address_id
        };

        let end_addr = if trip.end_address_id.is_none() {
            if let (Some(lat), Some(lon)) = (trip.end_lat, trip.end_lng) {
                match reverse_geocode_with_retry(pool, client, lat, lon).await {
                    Some(id) => Some(id),
                    None => {
                        failed += 1;
                        None
                    }
                }
            } else {
                None
            }
        } else {
            trip.end_address_id
        };

        if start_addr.is_some() || end_addr.is_some() {
            if let Err(e) = sqlx::query!(
                r#"UPDATE riviamigo.trips
                   SET start_address_id = COALESCE($2, start_address_id),
                       end_address_id   = COALESCE($3, end_address_id)
                   WHERE id = $1"#,
                trip.id,
                start_addr,
                end_addr,
            )
            .execute(pool)
            .await
            {
                tracing::warn!(trip_id=%trip.id, error=%e, "backfill.trip_update_failed");
                failed += 1;
                continue;
            }
            filled += 1;
        }
    }

    info!(filled, failed, "trip address backfill complete");
    Ok(())
}

async fn backfill_charge_session_addresses(pool: &PgPool, client: &Client) -> Result<()> {
    let sessions = sqlx::query!(
        r#"SELECT id, location_lat, location_lng
           FROM riviamigo.charge_sessions
           WHERE address_id IS NULL
             AND location_lat IS NOT NULL
             AND location_lng IS NOT NULL
           ORDER BY started_at DESC"#
    )
    .fetch_all(pool)
    .await?;

    info!(
        count = sessions.len(),
        "charge sessions needing address backfill"
    );

    let mut filled = 0usize;
    let mut failed = 0usize;

    for session in &sessions {
        if let (Some(lat), Some(lon)) = (session.location_lat, session.location_lng) {
            match reverse_geocode_with_retry(pool, client, lat, lon).await {
                Some(addr_id) => {
                    if let Err(e) = sqlx::query!(
                        r#"UPDATE riviamigo.charge_sessions
                           SET address_id = COALESCE($2, address_id)
                           WHERE id = $1"#,
                        session.id,
                        addr_id,
                    )
                    .execute(pool)
                    .await
                    {
                        tracing::warn!(session_id=%session.id, error=%e, "backfill.session_update_failed");
                        failed += 1;
                    } else {
                        filled += 1;
                    }
                }
                None => {
                    failed += 1;
                }
            }
        }
    }

    info!(filled, failed, "charge session address backfill complete");
    Ok(())
}

/// Attempt reverse geocoding up to MAX_RETRIES times with exponential backoff.
/// Checks the local address cache first to avoid redundant API calls for the
/// same coordinates (within ~100m).
async fn reverse_geocode_with_retry(
    pool: &PgPool,
    client: &Client,
    lat: f64,
    lon: f64,
) -> Option<Uuid> {
    // Check if we already have a nearby address cached (~100m radius).
    let cached: Option<Uuid> = sqlx::query_scalar!(
        r#"SELECT id FROM riviamigo.addresses
           WHERE earth_distance(
               ll_to_earth(latitude, longitude),
               ll_to_earth($1, $2)
           ) < 100
           LIMIT 1"#,
        lat,
        lon,
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some(id) = cached {
        tracing::debug!(lat=%lat, lon=%lon, address_id=%id, "backfill.address_cache_hit");
        return Some(id);
    }

    for attempt in 0..MAX_RETRIES {
        let delay = BASE_DELAY_MS * (1u64 << attempt);
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;

        match reverse_geocode_once(pool, client, lat, lon).await {
            Some(id) => return Some(id),
            None => {
                if attempt + 1 < MAX_RETRIES {
                    tracing::warn!(
                        lat=%lat, lon=%lon, attempt=attempt+1,
                        next_delay_ms=BASE_DELAY_MS * (1u64 << (attempt + 1)),
                        "backfill.geocode_failed_retrying"
                    );
                } else {
                    tracing::error!(
                        lat=%lat, lon=%lon,
                        "backfill.geocode_exhausted_retries"
                    );
                }
            }
        }
    }

    None
}

/// Single Nominatim call — returns `None` on any error without panicking.
async fn reverse_geocode_once(pool: &PgPool, client: &Client, lat: f64, lon: f64) -> Option<Uuid> {
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

    let status = resp.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        tracing::warn!(lat=%lat, lon=%lon, "backfill.geocode_rate_limited");
        return None;
    }
    if !status.is_success() {
        tracing::warn!(status=%status, lat=%lat, lon=%lon, "backfill.geocode_http_error");
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
                 road         = EXCLUDED.road,
                 city         = EXCLUDED.city,
                 state        = EXCLUDED.state,
                 postcode     = EXCLUDED.postcode,
                 country      = EXCLUDED.country,
                 raw          = EXCLUDED.raw
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
            tracing::warn!(error=%e, "backfill.db_insert_failed");
            None
        }
    }
}
