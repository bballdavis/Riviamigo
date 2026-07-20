use std::{future::Future, time::Duration};

use anyhow::Result;
use chrono::{DateTime, NaiveDate, Utc};
use reqwest::Client;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::{
    db::vehicles::get_vehicle_owner_id,
    services::{geofences::match_geofence, nominatim},
};

const ADDRESS_CACHE_RADIUS_METERS: f64 = 100.0;
const RECONCILIATION_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const RECONCILIATION_ADDRESS_BATCH_SIZE: i64 = 100;

/// Recover enrichment skipped while a sanitized restore or provider outage left
/// completed trips without weather or address data. The existing provider
/// lanes still own outbound rate limiting.
pub fn start_reconciliation_worker(pool: PgPool) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let client = match Client::builder().timeout(Duration::from_secs(20)).build() {
            Ok(client) => client,
            Err(error) => {
                warn!(error = %error, "trip_enrichment.reconciler_client_build_failed");
                return;
            }
        };
        loop {
            let addresses = backfill_trip_addresses(&pool, &client, None).await;
            let weather = enqueue_trip_weather_enrichment(&pool, None).await;
            match (addresses, weather) {
                (Ok(addresses), Ok(weather)) => info!(
                    address_scanned = addresses.scanned,
                    address_filled = addresses.filled,
                    weather_scanned = weather.scanned,
                    weather_queued = weather.filled,
                    "trip_enrichment.reconciler_complete"
                ),
                (addresses, weather) => warn!(
                    address_error = ?addresses.err(),
                    weather_error = ?weather.err(),
                    "trip_enrichment.reconciler_failed"
                ),
            }
            tokio::time::sleep(RECONCILIATION_INTERVAL).await;
        }
    })
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BackfillStats {
    pub scanned: usize,
    pub filled: usize,
    pub failed: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TripEnrichmentReport {
    pub geofence_matches: BackfillStats,
    pub address_matches: BackfillStats,
    pub outside_temps: BackfillStats,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MatchedLocation {
    pub geofence_id: Option<Uuid>,
    pub address_id: Option<Uuid>,
    pub is_home: Option<bool>,
}

impl MatchedLocation {
    pub const fn none() -> Self {
        Self {
            geofence_id: None,
            address_id: None,
            is_home: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, FromRow, PartialEq, Eq)]
pub struct TripEnrichmentDiagnosticsRow {
    pub vehicle_id: Uuid,
    pub trip_day: NaiveDate,
    pub total_trips: i64,
    pub missing_start_address_id: i64,
    pub missing_end_address_id: i64,
    pub missing_start_geofence_id: i64,
    pub missing_end_geofence_id: i64,
    pub missing_outside_temp_c: i64,
    pub missing_start_address_with_coordinates: i64,
    pub missing_end_address_with_coordinates: i64,
    pub start_address_cached_matches: i64,
    pub end_address_cached_matches: i64,
    pub missing_outside_temp_with_coordinates: i64,
    pub missing_outside_temp_unrecoverable_no_start_coordinates: i64,
}

#[derive(Debug, FromRow)]
struct TripLocationRow {
    id: Uuid,
    vehicle_id: Uuid,
    start_lat: Option<f64>,
    start_lng: Option<f64>,
    end_lat: Option<f64>,
    end_lng: Option<f64>,
}

#[derive(Debug, FromRow)]
struct TripAddressRow {
    id: Uuid,
    vehicle_id: Uuid,
    started_at: DateTime<Utc>,
    start_lat: Option<f64>,
    start_lng: Option<f64>,
    start_address_id: Option<Uuid>,
    end_lat: Option<f64>,
    end_lng: Option<f64>,
    end_address_id: Option<Uuid>,
}

#[derive(Debug, FromRow)]
struct ChargeSessionLocationRow {
    id: Uuid,
    vehicle_id: Uuid,
    location_lat: Option<f64>,
    location_lng: Option<f64>,
}

pub async fn enrich_trip_history_for_vehicle(
    pool: &PgPool,
    client: &Client,
    vehicle_id: Uuid,
) -> Result<TripEnrichmentReport> {
    let geofence_matches = backfill_trip_geofence_matches(pool, Some(vehicle_id)).await?;
    let address_matches = backfill_trip_addresses(pool, client, Some(vehicle_id)).await?;
    let outside_temps = enqueue_trip_weather_enrichment(pool, Some(vehicle_id)).await?;

    Ok(TripEnrichmentReport {
        geofence_matches,
        address_matches,
        outside_temps,
    })
}

pub async fn enrich_trip_history_for_vehicle_with_lookup<F, Fut>(
    pool: &PgPool,
    client: &Client,
    vehicle_id: Uuid,
    lookup: F,
) -> Result<TripEnrichmentReport>
where
    F: FnMut(f64, f64, DateTime<Utc>) -> Fut,
    Fut: Future<Output = Option<f64>>,
{
    let geofence_matches = backfill_trip_geofence_matches(pool, Some(vehicle_id)).await?;
    let address_matches = backfill_trip_addresses(pool, client, Some(vehicle_id)).await?;
    let outside_temps =
        backfill_trip_outside_temps_with_lookup(pool, Some(vehicle_id), lookup, None).await?;

    Ok(TripEnrichmentReport {
        geofence_matches,
        address_matches,
        outside_temps,
    })
}

pub async fn report_trip_enrichment_gaps(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
) -> Result<Vec<TripEnrichmentDiagnosticsRow>> {
    let rows = sqlx::query_as::<_, TripEnrichmentDiagnosticsRow>(
        r#"SELECT
               t.vehicle_id,
               (t.started_at AT TIME ZONE 'UTC')::date AS trip_day,
               COUNT(*)::int8 AS total_trips,
               COUNT(*) FILTER (WHERE t.start_address_id IS NULL)::int8 AS missing_start_address_id,
               COUNT(*) FILTER (WHERE t.end_address_id IS NULL)::int8 AS missing_end_address_id,
               COUNT(*) FILTER (WHERE t.start_geofence_id IS NULL)::int8 AS missing_start_geofence_id,
               COUNT(*) FILTER (WHERE t.end_geofence_id IS NULL)::int8 AS missing_end_geofence_id,
               COUNT(*) FILTER (WHERE t.outside_temp_c IS NULL)::int8 AS missing_outside_temp_c,
               COUNT(*) FILTER (
                   WHERE t.start_address_id IS NULL
                     AND t.start_lat IS NOT NULL
                     AND t.start_lng IS NOT NULL
                     AND NOT (t.start_lat = 0 AND t.start_lng = 0)
               )::int8 AS missing_start_address_with_coordinates,
               COUNT(*) FILTER (
                   WHERE t.end_address_id IS NULL
                     AND t.end_lat IS NOT NULL
                     AND t.end_lng IS NOT NULL
                     AND NOT (t.end_lat = 0 AND t.end_lng = 0)
               )::int8 AS missing_end_address_with_coordinates,
               COUNT(*) FILTER (
                   WHERE t.start_address_id IS NULL
                     AND t.start_lat IS NOT NULL
                     AND t.start_lng IS NOT NULL
                     AND NOT (t.start_lat = 0 AND t.start_lng = 0)
                     AND EXISTS (
                         SELECT 1
                         FROM riviamigo.addresses a
                         WHERE earth_distance(
                                   ll_to_earth(a.latitude, a.longitude),
                                   ll_to_earth(t.start_lat, t.start_lng)
                               ) < $2
                     )
               )::int8 AS start_address_cached_matches,
               COUNT(*) FILTER (
                   WHERE t.end_address_id IS NULL
                     AND t.end_lat IS NOT NULL
                     AND t.end_lng IS NOT NULL
                     AND NOT (t.end_lat = 0 AND t.end_lng = 0)
                     AND EXISTS (
                         SELECT 1
                         FROM riviamigo.addresses a
                         WHERE earth_distance(
                                   ll_to_earth(a.latitude, a.longitude),
                                   ll_to_earth(t.end_lat, t.end_lng)
                               ) < $2
                     )
               )::int8 AS end_address_cached_matches,
               COUNT(*) FILTER (
                   WHERE t.outside_temp_c IS NULL
                     AND t.start_lat IS NOT NULL
                     AND t.start_lng IS NOT NULL
                     AND NOT (t.start_lat = 0 AND t.start_lng = 0)
               )::int8 AS missing_outside_temp_with_coordinates,
               COUNT(*) FILTER (
                   WHERE t.outside_temp_c IS NULL
                     AND (
                         t.start_lat IS NULL
                         OR t.start_lng IS NULL
                         OR (t.start_lat = 0 AND t.start_lng = 0)
                     )
               )::int8 AS missing_outside_temp_unrecoverable_no_start_coordinates
           FROM riviamigo.trips t
           WHERE ($1::uuid IS NULL OR t.vehicle_id = $1)
           GROUP BY t.vehicle_id, trip_day
           ORDER BY trip_day DESC, t.vehicle_id"#,
    )
    .bind(vehicle_id)
    .bind(ADDRESS_CACHE_RADIUS_METERS)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn match_geofence_location(
    pool: &PgPool,
    user_id: Uuid,
    lat: f64,
    lon: f64,
) -> Result<MatchedLocation> {
    let matched = match_geofence(pool, user_id, lat, lon).await?;

    Ok(match matched {
        Some(geofence) => MatchedLocation {
            geofence_id: Some(geofence.id),
            address_id: geofence.address_id,
            is_home: Some(geofence.is_home),
        },
        None => MatchedLocation::none(),
    })
}

pub async fn resolve_trip_location(
    pool: &PgPool,
    client: &Client,
    user_id: Uuid,
    lat: f64,
    lon: f64,
) -> Result<MatchedLocation> {
    let geofence_match = match_geofence_location(pool, user_id, lat, lon).await?;
    if geofence_match.geofence_id.is_some() || geofence_match.address_id.is_some() {
        return Ok(geofence_match);
    }

    Ok(MatchedLocation {
        address_id: resolve_address_id(pool, client, lat, lon).await,
        ..MatchedLocation::none()
    })
}

pub async fn resolve_address_id(
    pool: &PgPool,
    client: &Client,
    lat: f64,
    lon: f64,
) -> Option<Uuid> {
    if !has_usable_coordinate_pair(Some(lat), Some(lon)) {
        return None;
    }

    if let Some(id) = find_cached_address_id(pool, lat, lon).await {
        debug!(lat, lon, address_id = %id, "trip_enrichment.address.cache_hit");
        return Some(id);
    }

    reverse_geocode_and_store(pool, client, lat, lon).await
}

pub async fn backfill_trip_geofence_matches(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
) -> Result<BackfillStats> {
    let trips = sqlx::query_as::<_, TripLocationRow>(
        r#"SELECT id, vehicle_id, start_lat, start_lng, end_lat, end_lng
           FROM riviamigo.trips
           WHERE ($1::uuid IS NULL OR vehicle_id = $1)
             AND (
               (start_geofence_id IS NULL AND start_lat IS NOT NULL AND start_lng IS NOT NULL AND NOT (start_lat = 0 AND start_lng = 0))
               OR
               (end_geofence_id IS NULL AND end_lat IS NOT NULL AND end_lng IS NOT NULL AND NOT (end_lat = 0 AND end_lng = 0))
             )"#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut stats = BackfillStats {
        scanned: trips.len(),
        ..BackfillStats::default()
    };

    for trip in &trips {
        let owner_id = match get_vehicle_owner_id(pool, trip.vehicle_id).await {
            Ok(Some(user_id)) => user_id,
            Ok(None) => {
                warn!(trip_id = %trip.id, "trip_enrichment.geofence.owner_missing");
                stats.failed += 1;
                continue;
            }
            Err(err) => {
                warn!(trip_id = %trip.id, error = %err, "trip_enrichment.geofence.owner_lookup_failed");
                stats.failed += 1;
                continue;
            }
        };

        let start_match = if has_usable_coordinate_pair(trip.start_lat, trip.start_lng) {
            match_geofence_location(
                pool,
                owner_id,
                trip.start_lat.expect("checked"),
                trip.start_lng.expect("checked"),
            )
            .await?
        } else {
            MatchedLocation::none()
        };

        let end_match = if has_usable_coordinate_pair(trip.end_lat, trip.end_lng) {
            match_geofence_location(
                pool,
                owner_id,
                trip.end_lat.expect("checked"),
                trip.end_lng.expect("checked"),
            )
            .await?
        } else {
            MatchedLocation::none()
        };

        if start_match.geofence_id.is_none() && end_match.geofence_id.is_none() {
            stats.skipped += 1;
            continue;
        }

        if let Err(err) = sqlx::query(
            r#"UPDATE riviamigo.trips
               SET start_geofence_id = COALESCE(start_geofence_id, $2),
                   end_geofence_id   = COALESCE(end_geofence_id,   $3),
                   start_address_id  = COALESCE(start_address_id,  $4),
                   end_address_id    = COALESCE(end_address_id,    $5)
               WHERE id = $1"#,
        )
        .bind(trip.id)
        .bind(start_match.geofence_id)
        .bind(end_match.geofence_id)
        .bind(start_match.address_id)
        .bind(end_match.address_id)
        .execute(pool)
        .await
        {
            warn!(trip_id = %trip.id, error = %err, "trip_enrichment.geofence.trip_update_failed");
            stats.failed += 1;
            continue;
        }

        upsert_trip_user_annotation(
            pool,
            trip.id,
            owner_id,
            start_match.geofence_id,
            end_match.geofence_id,
            start_match.address_id,
            end_match.address_id,
        )
        .await?;

        stats.filled += 1;
    }

    info!(
        vehicle_id = ?vehicle_id,
        scanned = stats.scanned,
        filled = stats.filled,
        failed = stats.failed,
        skipped = stats.skipped,
        "trip_enrichment.geofence.complete"
    );
    Ok(stats)
}

pub async fn backfill_charge_session_geofence_matches(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
) -> Result<BackfillStats> {
    let sessions = sqlx::query_as::<_, ChargeSessionLocationRow>(
        r#"SELECT id, vehicle_id, location_lat, location_lng
           FROM riviamigo.charge_sessions
           WHERE ($1::uuid IS NULL OR vehicle_id = $1)
             AND geofence_id IS NULL
             AND location_lat IS NOT NULL
             AND location_lng IS NOT NULL
             AND NOT (location_lat = 0 AND location_lng = 0)"#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut stats = BackfillStats {
        scanned: sessions.len(),
        ..BackfillStats::default()
    };

    for session in &sessions {
        let owner_id = match get_vehicle_owner_id(pool, session.vehicle_id).await {
            Ok(Some(user_id)) => user_id,
            Ok(None) => {
                warn!(session_id = %session.id, "trip_enrichment.charge_geofence.owner_missing");
                stats.failed += 1;
                continue;
            }
            Err(err) => {
                warn!(session_id = %session.id, error = %err, "trip_enrichment.charge_geofence.owner_lookup_failed");
                stats.failed += 1;
                continue;
            }
        };

        let matched = match_geofence_location(
            pool,
            owner_id,
            session.location_lat.expect("checked"),
            session.location_lng.expect("checked"),
        )
        .await?;

        let Some(geofence_id) = matched.geofence_id else {
            stats.skipped += 1;
            continue;
        };

        if let Err(err) = sqlx::query(
            r#"UPDATE riviamigo.charge_sessions
               SET geofence_id = COALESCE(geofence_id, $2),
                   address_id  = COALESCE(address_id,  $3),
                   is_home     = COALESCE(is_home,     $4)
               WHERE id = $1"#,
        )
        .bind(session.id)
        .bind(geofence_id)
        .bind(matched.address_id)
        .bind(matched.is_home)
        .execute(pool)
        .await
        {
            warn!(session_id = %session.id, error = %err, "trip_enrichment.charge_geofence.session_update_failed");
            stats.failed += 1;
            continue;
        }

        upsert_charge_session_user_annotation(
            pool,
            session.id,
            owner_id,
            Some(geofence_id),
            matched.address_id,
            matched.is_home,
        )
        .await?;

        stats.filled += 1;
    }

    info!(
        vehicle_id = ?vehicle_id,
        scanned = stats.scanned,
        filled = stats.filled,
        failed = stats.failed,
        skipped = stats.skipped,
        "trip_enrichment.charge_geofence.complete"
    );
    Ok(stats)
}

pub async fn backfill_trip_addresses(
    pool: &PgPool,
    client: &Client,
    vehicle_id: Option<Uuid>,
) -> Result<BackfillStats> {
    let trips = sqlx::query_as::<_, TripAddressRow>(
        r#"SELECT id, vehicle_id, started_at, start_lat, start_lng, start_address_id, end_lat, end_lng, end_address_id
           FROM riviamigo.trips
           WHERE ($1::uuid IS NULL OR vehicle_id = $1)
             AND (
               (start_address_id IS NULL AND start_lat IS NOT NULL AND start_lng IS NOT NULL AND NOT (start_lat = 0 AND start_lng = 0))
               OR
               (end_address_id IS NULL AND end_lat IS NOT NULL AND end_lng IS NOT NULL AND NOT (end_lat = 0 AND end_lng = 0))
             )
           ORDER BY started_at DESC
           LIMIT $2"#,
    )
    .bind(vehicle_id)
    .bind(RECONCILIATION_ADDRESS_BATCH_SIZE)
    .fetch_all(pool)
    .await?;

    let mut stats = BackfillStats {
        scanned: trips.len(),
        ..BackfillStats::default()
    };

    for trip in &trips {
        let owner_id = get_vehicle_owner_id(pool, trip.vehicle_id).await?;
        let mut start_addr = trip.start_address_id;
        let mut end_addr = trip.end_address_id;
        let mut filled_any = false;
        let mut failed_any = false;

        if trip.start_address_id.is_none()
            && has_usable_coordinate_pair(trip.start_lat, trip.start_lng)
        {
            start_addr = resolve_address_id(
                pool,
                client,
                trip.start_lat.expect("checked"),
                trip.start_lng.expect("checked"),
            )
            .await;
            if start_addr.is_some() {
                filled_any = true;
            } else {
                warn!(
                    trip_id = %trip.id,
                    lat = trip.start_lat,
                    lng = trip.start_lng,
                    started_at = %trip.started_at,
                    "trip_enrichment.address.start_lookup_failed"
                );
                failed_any = true;
            }
        }

        if trip.end_address_id.is_none() && has_usable_coordinate_pair(trip.end_lat, trip.end_lng) {
            end_addr = resolve_address_id(
                pool,
                client,
                trip.end_lat.expect("checked"),
                trip.end_lng.expect("checked"),
            )
            .await;
            if end_addr.is_some() {
                filled_any = true;
            } else {
                warn!(
                    trip_id = %trip.id,
                    lat = trip.end_lat,
                    lng = trip.end_lng,
                    started_at = %trip.started_at,
                    "trip_enrichment.address.end_lookup_failed"
                );
                failed_any = true;
            }
        }

        if !filled_any {
            if failed_any {
                stats.failed += 1;
            } else {
                stats.skipped += 1;
            }
            continue;
        }

        if let Err(err) = sqlx::query(
            r#"UPDATE riviamigo.trips
               SET start_address_id = COALESCE($2, start_address_id),
                   end_address_id   = COALESCE($3, end_address_id)
               WHERE id = $1"#,
        )
        .bind(trip.id)
        .bind(start_addr)
        .bind(end_addr)
        .execute(pool)
        .await
        {
            warn!(trip_id = %trip.id, error = %err, "trip_enrichment.address.trip_update_failed");
            stats.failed += 1;
            continue;
        }

        if let Some(user_id) = owner_id {
            upsert_trip_user_annotation(pool, trip.id, user_id, None, None, start_addr, end_addr)
                .await?;
        }

        stats.filled += 1;
        if failed_any {
            stats.failed += 1;
        }
    }

    info!(
        vehicle_id = ?vehicle_id,
        scanned = stats.scanned,
        filled = stats.filled,
        failed = stats.failed,
        skipped = stats.skipped,
        "trip_enrichment.address.complete"
    );
    Ok(stats)
}

pub async fn backfill_charge_session_addresses(
    pool: &PgPool,
    client: &Client,
    vehicle_id: Option<Uuid>,
) -> Result<BackfillStats> {
    let sessions = sqlx::query_as::<_, ChargeSessionLocationRow>(
        r#"SELECT id, vehicle_id, location_lat, location_lng
           FROM riviamigo.charge_sessions
           WHERE ($1::uuid IS NULL OR vehicle_id = $1)
             AND address_id IS NULL
             AND location_lat IS NOT NULL
             AND location_lng IS NOT NULL
             AND NOT (location_lat = 0 AND location_lng = 0)
           ORDER BY started_at DESC"#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut stats = BackfillStats {
        scanned: sessions.len(),
        ..BackfillStats::default()
    };

    for session in &sessions {
        let owner_id = get_vehicle_owner_id(pool, session.vehicle_id).await?;
        let Some(address_id) = resolve_address_id(
            pool,
            client,
            session.location_lat.expect("checked"),
            session.location_lng.expect("checked"),
        )
        .await
        else {
            warn!(
                session_id = %session.id,
                lat = session.location_lat,
                lng = session.location_lng,
                "trip_enrichment.address.session_lookup_failed"
            );
            stats.failed += 1;
            continue;
        };

        if let Err(err) = sqlx::query(
            r#"UPDATE riviamigo.charge_sessions
               SET address_id = COALESCE($2, address_id)
               WHERE id = $1"#,
        )
        .bind(session.id)
        .bind(address_id)
        .execute(pool)
        .await
        {
            warn!(session_id = %session.id, error = %err, "trip_enrichment.address.session_update_failed");
            stats.failed += 1;
            continue;
        }

        if let Some(user_id) = owner_id {
            upsert_charge_session_user_annotation(
                pool,
                session.id,
                user_id,
                None,
                Some(address_id),
                None,
            )
            .await?;
        }

        stats.filled += 1;
    }

    info!(
        vehicle_id = ?vehicle_id,
        scanned = stats.scanned,
        filled = stats.filled,
        failed = stats.failed,
        skipped = stats.skipped,
        "trip_enrichment.charge_address.complete"
    );
    Ok(stats)
}

pub async fn backfill_trip_outside_temps(
    pool: &PgPool,
    _client: &Client,
    vehicle_id: Option<Uuid>,
) -> Result<BackfillStats> {
    enqueue_trip_weather_enrichment(pool, vehicle_id).await
}

pub async fn enqueue_trip_weather_enrichment(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
) -> Result<BackfillStats> {
    let trip_ids = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id
           FROM riviamigo.trips
           WHERE ($1::uuid IS NULL OR vehicle_id = $1)
             AND started_at IS NOT NULL
             AND ended_at IS NOT NULL
           ORDER BY started_at DESC"#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut stats = BackfillStats {
        scanned: trip_ids.len(),
        ..BackfillStats::default()
    };
    for trip_id in trip_ids {
        let result = sqlx::query(
            r#"INSERT INTO riviamigo.weather_enrichment_jobs
                 (trip_id, status, attempts, next_attempt_at, last_error, updated_at, completed_at)
               VALUES ($1, 'pending', 0, now(), NULL, now(), NULL)
               ON CONFLICT (trip_id) DO UPDATE SET
                 status = 'pending', attempts = 0, next_attempt_at = now(),
                 last_error = NULL, updated_at = now(), completed_at = NULL
               WHERE riviamigo.weather_enrichment_jobs.status IN ('failed', 'unavailable')"#,
        )
        .bind(trip_id)
        .execute(pool)
        .await?;
        if result.rows_affected() > 0 {
            stats.filled += 1;
        } else {
            stats.skipped += 1;
        }
    }

    info!(
        vehicle_id = ?vehicle_id,
        scanned = stats.scanned,
        queued = stats.filled,
        skipped = stats.skipped,
        "trip_enrichment.weather_jobs.queued"
    );
    Ok(stats)
}

pub async fn backfill_trip_outside_temps_with_lookup<F, Fut>(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
    mut lookup: F,
    polite_delay: Option<Duration>,
) -> Result<BackfillStats>
where
    F: FnMut(f64, f64, DateTime<Utc>) -> Fut,
    Fut: Future<Output = Option<f64>>,
{
    let trips = sqlx::query_as::<_, TripAddressRow>(
        r#"SELECT id, vehicle_id, started_at, start_lat, start_lng, start_address_id, end_lat, end_lng, end_address_id
           FROM riviamigo.trips
           WHERE ($1::uuid IS NULL OR vehicle_id = $1)
             AND outside_temp_c IS NULL
             AND start_lat IS NOT NULL
             AND start_lng IS NOT NULL
             AND NOT (start_lat = 0 AND start_lng = 0)
           ORDER BY started_at DESC"#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut stats = BackfillStats {
        scanned: trips.len(),
        ..BackfillStats::default()
    };

    for trip in &trips {
        let temp_c = lookup(
            trip.start_lat.expect("checked"),
            trip.start_lng.expect("checked"),
            trip.started_at,
        )
        .await;

        match temp_c {
            Some(value) => {
                if let Err(err) =
                    sqlx::query("UPDATE riviamigo.trips SET outside_temp_c = $2 WHERE id = $1")
                        .bind(trip.id)
                        .bind(value)
                        .execute(pool)
                        .await
                {
                    warn!(trip_id = %trip.id, error = %err, "trip_enrichment.outside_temp.update_failed");
                    stats.failed += 1;
                } else {
                    stats.filled += 1;
                    debug!(trip_id = %trip.id, outside_temp_c = value, "trip_enrichment.outside_temp.updated");
                }
            }
            None => {
                warn!(
                    trip_id = %trip.id,
                    lat = trip.start_lat,
                    lng = trip.start_lng,
                    started_at = %trip.started_at,
                    "trip_enrichment.outside_temp.lookup_failed"
                );
                stats.failed += 1;
            }
        }

        if let Some(delay) = polite_delay {
            tokio::time::sleep(delay).await;
        }
    }

    info!(
        vehicle_id = ?vehicle_id,
        scanned = stats.scanned,
        filled = stats.filled,
        failed = stats.failed,
        skipped = stats.skipped,
        "trip_enrichment.outside_temp.complete"
    );
    Ok(stats)
}

async fn find_cached_address_id(pool: &PgPool, lat: f64, lon: f64) -> Option<Uuid> {
    sqlx::query_scalar(
        r#"SELECT id
           FROM riviamigo.addresses
           WHERE earth_distance(
                     ll_to_earth(latitude, longitude),
                     ll_to_earth($1, $2)
                 ) < $3
           ORDER BY earth_distance(
                     ll_to_earth(latitude, longitude),
                     ll_to_earth($1, $2)
                 )
           LIMIT 1"#,
    )
    .bind(lat)
    .bind(lon)
    .bind(ADDRESS_CACHE_RADIUS_METERS)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

async fn reverse_geocode_and_store(
    pool: &PgPool,
    client: &Client,
    lat: f64,
    lon: f64,
) -> Option<Uuid> {
    let raw = match nominatim::reverse(pool, client, lat, lon).await {
        Ok(Some(raw)) => raw,
        Ok(None) => return None,
        Err(crate::errors::AppError::ExternalConnectionDisabled(_)) => return None,
        Err(err) => {
            warn!(error = %err, "trip_enrichment.address.request_failed");
            return None;
        }
    };

    let display_name = raw.get("display_name")?.as_str()?.to_string();
    let osm_id = raw.get("osm_id").and_then(|value| value.as_i64());
    let address = raw.get("address").and_then(|value| value.as_object());

    let road = address
        .and_then(|row| {
            row.get("road")
                .or_else(|| row.get("pedestrian"))
                .or_else(|| row.get("footway"))
        })
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let city = address
        .and_then(|row| {
            row.get("city")
                .or_else(|| row.get("town"))
                .or_else(|| row.get("village"))
        })
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let state = address
        .and_then(|row| row.get("state"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let postcode = address
        .and_then(|row| row.get("postcode"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let country = address
        .and_then(|row| row.get("country"))
        .and_then(|value| value.as_str())
        .map(str::to_string);

    let result: Result<Uuid, sqlx::Error> = if let Some(osm_id) = osm_id {
        sqlx::query_scalar(
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
        )
        .bind(display_name)
        .bind(osm_id)
        .bind(lat)
        .bind(lon)
        .bind(road)
        .bind(city)
        .bind(state)
        .bind(postcode)
        .bind(country)
        .bind(raw)
        .fetch_one(pool)
        .await
    } else {
        sqlx::query_scalar(
            r#"INSERT INTO riviamigo.addresses
               (display_name, latitude, longitude, road, city, state, postcode, country, raw)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING id"#,
        )
        .bind(display_name)
        .bind(lat)
        .bind(lon)
        .bind(road)
        .bind(city)
        .bind(state)
        .bind(postcode)
        .bind(country)
        .bind(raw)
        .fetch_one(pool)
        .await
    };

    match result {
        Ok(id) => {
            info!(lat, lon, address_id = %id, "trip_enrichment.address.stored");
            Some(id)
        }
        Err(err) => {
            warn!(error = %err, lat, lon, "trip_enrichment.address.insert_failed");
            None
        }
    }
}

async fn upsert_trip_user_annotation(
    pool: &PgPool,
    trip_id: Uuid,
    user_id: Uuid,
    start_geofence_id: Option<Uuid>,
    end_geofence_id: Option<Uuid>,
    start_address_id: Option<Uuid>,
    end_address_id: Option<Uuid>,
) -> Result<()> {
    sqlx::query(
        r#"INSERT INTO riviamigo.trip_user_annotations
           (trip_id, user_id, start_geofence_id, end_geofence_id, start_address_id, end_address_id, matched_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (trip_id, user_id) DO UPDATE
           SET start_geofence_id = COALESCE(EXCLUDED.start_geofence_id, riviamigo.trip_user_annotations.start_geofence_id),
               end_geofence_id = COALESCE(EXCLUDED.end_geofence_id, riviamigo.trip_user_annotations.end_geofence_id),
               start_address_id = COALESCE(EXCLUDED.start_address_id, riviamigo.trip_user_annotations.start_address_id),
               end_address_id = COALESCE(EXCLUDED.end_address_id, riviamigo.trip_user_annotations.end_address_id),
               matched_at = now(),
               updated_at = now()"#,
    )
    .bind(trip_id)
    .bind(user_id)
    .bind(start_geofence_id)
    .bind(end_geofence_id)
    .bind(start_address_id)
    .bind(end_address_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn upsert_charge_session_user_annotation(
    pool: &PgPool,
    charge_session_id: Uuid,
    user_id: Uuid,
    geofence_id: Option<Uuid>,
    address_id: Option<Uuid>,
    is_home: Option<bool>,
) -> Result<()> {
    sqlx::query(
        r#"INSERT INTO riviamigo.charge_session_user_annotations
           (charge_session_id, user_id, geofence_id, address_id, is_home, computed_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (charge_session_id, user_id) DO UPDATE
           SET geofence_id = COALESCE(EXCLUDED.geofence_id, riviamigo.charge_session_user_annotations.geofence_id),
               address_id = COALESCE(EXCLUDED.address_id, riviamigo.charge_session_user_annotations.address_id),
               is_home = COALESCE(EXCLUDED.is_home, riviamigo.charge_session_user_annotations.is_home),
               computed_at = now(),
               updated_at = now()"#,
    )
    .bind(charge_session_id)
    .bind(user_id)
    .bind(geofence_id)
    .bind(address_id)
    .bind(is_home)
    .execute(pool)
    .await?;

    Ok(())
}

fn has_usable_coordinate_pair(lat: Option<f64>, lng: Option<f64>) -> bool {
    matches!((lat, lng), (Some(lat), Some(lng)) if !(lat == 0.0 && lng == 0.0))
}
