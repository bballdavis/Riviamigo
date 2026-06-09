//! One-off history rebuild for vehicle lifecycle facts.
//!
//! This script is intentionally not part of the normal ingestion loop.
//! It replays historical telemetry so the durable upstream facts that Phantom
//! Drain depends on can be rebuilt in one pass:
//!   1. `vehicle_state_periods`
//!   2. `charge_sessions`
//!   3. `trips`
//!   4. telemetry `trip_id` links
//!
//! Usage:
//!   cargo run --bin rebuild_vehicle_history -- [--vehicle <uuid>]

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use futures::TryStreamExt;
use riviamigo_api::{
    db::vehicles::get_vehicle_owner_id,
    ingestion::trip_detector::{
        compute_distance_odometer_or_gps, compute_trip_energy, CompletedTripData,
        TripDetectorState, TripEvent,
    },
    models::telemetry::{ChargerState, DriveMode, PowerState, TelemetryEvent},
    services::{cost::recompute_charge_session_cost, geofences::match_geofence},
};
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool};
use tracing::{info, warn};
use uuid::Uuid;

const MIN_TRIP_DISTANCE_MILES: f64 = 0.1;

#[derive(Debug, Clone)]
struct Args {
    vehicle_id: Option<Uuid>,
}

#[derive(Debug, FromRow)]
struct ReplayTelemetryRow {
    ts: DateTime<Utc>,
    vehicle_id: Uuid,
    latitude: Option<f64>,
    longitude: Option<f64>,
    altitude_m: Option<f64>,
    speed_mph: Option<f64>,
    battery_level: Option<f64>,
    battery_capacity_wh: Option<f64>,
    distance_to_empty_mi: Option<f64>,
    battery_limit: Option<f64>,
    power_state: Option<String>,
    charger_state: Option<String>,
    charger_status: Option<String>,
    time_to_end_of_charge_min: Option<i32>,
    drive_mode: Option<String>,
    gear_status: Option<String>,
    cabin_temp_c: Option<f64>,
    outside_temp_c: Option<f64>,
    power_kw: Option<f64>,
    regen_power_kw: Option<f64>,
    heading_deg: Option<f64>,
    odometer_miles: Option<f64>,
    is_online: Option<bool>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let args = parse_args()?;
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    rebuild_vehicle_history(&pool, args).await?;
    Ok(())
}

fn parse_args() -> Result<Args> {
    let mut vehicle_id = None;
    let mut iter = std::env::args().skip(1);

    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--vehicle" => {
                let raw = iter
                    .next()
                    .ok_or_else(|| anyhow!("--vehicle requires a UUID argument"))?;
                vehicle_id = Some(raw.parse().context("invalid --vehicle UUID")?);
            }
            "--help" | "-h" => {
                println!("Usage: cargo run --bin rebuild_vehicle_history -- [--vehicle <uuid>]");
                std::process::exit(0);
            }
            other => return Err(anyhow!("unknown argument: {other}")),
        }
    }

    Ok(Args { vehicle_id })
}

async fn rebuild_vehicle_history(pool: &PgPool, args: Args) -> Result<()> {
    let vehicles = load_vehicle_scope(pool, args.vehicle_id).await?;
    if vehicles.is_empty() {
        info!("No vehicles found for rebuild");
        return Ok(());
    }

    info!(
        vehicle_count = vehicles.len(),
        filtered = args.vehicle_id.is_some(),
        "starting historical rebuild"
    );

    for vehicle_id in vehicles {
        info!(vehicle_id = %vehicle_id, "rebuilding vehicle history");

        let state_periods = backfill_state_periods_for_vehicle(pool, vehicle_id).await?;
        let charge_sessions = repair_charge_sessions_for_vehicle(pool, vehicle_id).await?;
        let charge_locations =
            repair_charge_session_locations_for_vehicle(pool, vehicle_id).await?;
        let charge_costs = repair_charge_session_costs_for_vehicle(pool, vehicle_id).await?;
        let trips = replay_trips_for_vehicle(pool, vehicle_id).await?;
        let trip_ids = backfill_trip_ids_for_vehicle(pool, vehicle_id).await?;

        info!(
            vehicle_id = %vehicle_id,
            state_periods,
            charge_sessions,
            charge_locations,
            charge_costs,
            trips,
            trip_ids,
            "vehicle history rebuild complete"
        );
    }

    info!("historical rebuild finished");
    Ok(())
}

async fn load_vehicle_scope(pool: &PgPool, filter: Option<Uuid>) -> Result<Vec<Uuid>> {
    if let Some(vehicle_id) = filter {
        return Ok(vec![vehicle_id]);
    }

    let vehicle_ids =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM riviamigo.vehicles ORDER BY created_at, id")
            .fetch_all(pool)
            .await?;

    Ok(vehicle_ids)
}

async fn backfill_state_periods_for_vehicle(pool: &PgPool, vehicle_id: Uuid) -> Result<u64> {
    sqlx::query("DELETE FROM riviamigo.vehicle_state_periods WHERE vehicle_id = $1")
        .bind(vehicle_id)
        .execute(pool)
        .await?;

    let mut rows = sqlx::query_as::<_, StateRow>(
        r#"
        SELECT ts, power_state
        FROM timeseries.telemetry
        WHERE vehicle_id = $1
        ORDER BY ts
        "#,
    )
    .bind(vehicle_id)
    .fetch(pool);

    let Some(first) = rows.try_next().await? else {
        return Ok(0);
    };

    let mut inserted = 0u64;
    let mut current_state = normalize_state(first.power_state.as_deref());
    let mut period_start = first.ts;
    let mut prev_ts = first.ts;

    while let Some(row) = rows.try_next().await? {
        let state = normalize_state(row.power_state.as_deref());
        let gap_secs = (row.ts - prev_ts).num_seconds();
        let state_changed = state != current_state;
        let large_gap = gap_secs > 600;

        if state_changed || large_gap {
            inserted +=
                insert_state_period(pool, vehicle_id, &current_state, period_start, prev_ts)
                    .await?;
            period_start = row.ts;
            current_state = state;
        }
        prev_ts = row.ts;
    }

    inserted +=
        insert_state_period(pool, vehicle_id, &current_state, period_start, prev_ts).await?;
    Ok(inserted)
}

#[derive(Debug, FromRow)]
struct StateRow {
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

async fn insert_state_period(
    pool: &PgPool,
    vehicle_id: Uuid,
    state: &str,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
) -> Result<u64> {
    if ended_at < started_at {
        return Ok(0);
    }

    let result = sqlx::query(
        r#"
        INSERT INTO riviamigo.vehicle_state_periods
            (vehicle_id, state, started_at, ended_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(vehicle_id)
    .bind(state)
    .bind(started_at)
    .bind(ended_at)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

async fn repair_charge_sessions_for_vehicle(pool: &PgPool, vehicle_id: Uuid) -> Result<u64> {
    let repaired: i64 = sqlx::query_scalar(
        r#"
        WITH evidence AS (
            SELECT
                t.*,
                LAG(t.ts) OVER (ORDER BY t.ts) AS prev_ts
            FROM timeseries.telemetry t
            WHERE t.vehicle_id = $1
              AND (
                  t.charger_state = 'charging'
                  OR t.charger_status = 'chrgr_sts_connected_charging'
                  OR COALESCE(t.time_to_end_of_charge_min, 0) > 0
              )
        ),
        marked AS (
            SELECT
                *,
                CASE
                    WHEN prev_ts IS NULL OR ts - prev_ts > interval '2 hours' THEN 1
                    ELSE 0
                END AS new_segment
            FROM evidence
        ),
        segmented AS (
            SELECT
                *,
                SUM(new_segment) OVER (ORDER BY ts) AS segment_id
            FROM marked
        ),
        windows AS (
            SELECT
                gen_random_uuid() AS id,
                vehicle_id,
                MIN(ts) AS started_at,
                MAX(ts) AS ended_at,
                (ARRAY_AGG(latitude ORDER BY ts) FILTER (WHERE latitude IS NOT NULL))[1] AS location_lat,
                (ARRAY_AGG(longitude ORDER BY ts) FILTER (WHERE longitude IS NOT NULL))[1] AS location_lng,
                (ARRAY_AGG(battery_level ORDER BY ts) FILTER (WHERE battery_level IS NOT NULL))[1] AS soc_start,
                (ARRAY_AGG(battery_level ORDER BY ts DESC) FILTER (WHERE battery_level IS NOT NULL))[1] AS soc_end,
                MAX(battery_limit) AS charge_limit,
                AVG(battery_capacity_wh) FILTER (WHERE battery_capacity_wh IS NOT NULL) AS battery_capacity_wh,
                MAX(ABS(power_kw)) FILTER (WHERE power_kw IS NOT NULL) AS max_charge_rate_kw,
                EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts)))::int / 60 AS duration_minutes
            FROM segmented
            GROUP BY vehicle_id, segment_id
        ),
        candidates AS (
            SELECT
                *,
                CASE
                    WHEN soc_end > soc_start AND battery_capacity_wh > 0
                    THEN (soc_end - soc_start) / 100.0 * battery_capacity_wh
                END AS energy_added_wh
            FROM windows
            WHERE ended_at > started_at
              AND duration_minutes >= 5
              AND soc_end IS NOT NULL
              AND soc_start IS NOT NULL
              AND soc_end - soc_start >= 1.0
        ),
        matched_existing AS (
            SELECT DISTINCT ON (c.id)
                c.*,
                cs.id AS existing_id
            FROM candidates c
            JOIN riviamigo.charge_sessions cs
              ON cs.vehicle_id = c.vehicle_id
             AND cs.started_at <= c.ended_at
             AND COALESCE(cs.ended_at, cs.started_at) >= c.started_at
            ORDER BY c.id,
                     (cs.source = 'rivian_api') DESC,
                     (cs.kwh_added IS NOT NULL) DESC,
                     cs.started_at
        ),
        updated AS (
            UPDATE riviamigo.charge_sessions cs
            SET
                started_at = CASE
                    WHEN cs.source = 'rivian_api' THEN cs.started_at
                    ELSE matched_existing.started_at
                END,
                ended_at = CASE
                    WHEN cs.source = 'rivian_api' THEN COALESCE(cs.ended_at, matched_existing.ended_at)
                    ELSE matched_existing.ended_at
                END,
                location_lat = COALESCE(cs.location_lat, matched_existing.location_lat),
                location_lng = COALESCE(cs.location_lng, matched_existing.location_lng),
                soc_start = CASE
                    WHEN cs.source = 'rivian_api' THEN COALESCE(cs.soc_start, matched_existing.soc_start)
                    ELSE matched_existing.soc_start
                END,
                soc_end = CASE
                    WHEN cs.source = 'rivian_api' THEN COALESCE(cs.soc_end, matched_existing.soc_end)
                    ELSE matched_existing.soc_end
                END,
                charge_limit = COALESCE(cs.charge_limit, matched_existing.charge_limit),
                duration_minutes = CASE
                    WHEN cs.source = 'rivian_api' THEN COALESCE(
                        cs.duration_minutes,
                        EXTRACT(EPOCH FROM (COALESCE(cs.ended_at, matched_existing.ended_at) - cs.started_at))::int / 60,
                        matched_existing.duration_minutes
                    )
                    ELSE matched_existing.duration_minutes
                END,
                kwh_added = CASE
                    WHEN cs.source = 'rivian_api' AND cs.kwh_added IS NOT NULL THEN cs.kwh_added
                    ELSE matched_existing.energy_added_wh / 1000.0
                END,
                energy_added_wh = CASE
                    WHEN cs.source = 'rivian_api' AND COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) IS NOT NULL
                    THEN COALESCE(cs.energy_added_wh, cs.kwh_added * 1000.0)
                    ELSE matched_existing.energy_added_wh
                END,
                max_charge_rate_kw = COALESCE(cs.max_charge_rate_kw, matched_existing.max_charge_rate_kw),
                avg_charge_rate_kw = CASE
                    WHEN cs.source = 'rivian_api' AND cs.avg_charge_rate_kw IS NOT NULL THEN cs.avg_charge_rate_kw
                    WHEN matched_existing.duration_minutes > 0
                    THEN (
                        CASE
                            WHEN cs.source = 'rivian_api' AND cs.kwh_added IS NOT NULL THEN cs.kwh_added
                            ELSE matched_existing.energy_added_wh / 1000.0
                        END
                    ) / (matched_existing.duration_minutes::float8 / 60.0)
                END,
                cost_method = COALESCE(cs.cost_method, 'telemetry_repair'),
                charger_type = COALESCE(
                    cs.charger_type,
                    CASE
                        WHEN matched_existing.max_charge_rate_kw < 12 THEN 'ac'
                        WHEN matched_existing.max_charge_rate_kw < 50 THEN 'ac_l2'
                        WHEN matched_existing.max_charge_rate_kw IS NOT NULL THEN 'dc'
                        WHEN matched_existing.duration_minutes > 0
                             AND matched_existing.energy_added_wh / 1000.0 / (matched_existing.duration_minutes::float8 / 60.0) < 12 THEN 'ac'
                        WHEN matched_existing.duration_minutes > 0
                             AND matched_existing.energy_added_wh / 1000.0 / (matched_existing.duration_minutes::float8 / 60.0) < 50 THEN 'ac_l2'
                        WHEN matched_existing.duration_minutes > 0 THEN 'dc'
                    END
                )
            FROM matched_existing
            WHERE cs.id = matched_existing.existing_id
              AND (
                  matched_existing.started_at <> cs.started_at
                  OR matched_existing.ended_at <> COALESCE(cs.ended_at, cs.started_at)
                  OR (COALESCE(cs.source, '') <> 'rivian_api' AND cs.soc_start IS DISTINCT FROM matched_existing.soc_start)
                  OR (COALESCE(cs.source, '') <> 'rivian_api' AND cs.soc_end IS DISTINCT FROM matched_existing.soc_end)
                  OR (COALESCE(cs.source, '') <> 'rivian_api' AND cs.duration_minutes IS DISTINCT FROM matched_existing.duration_minutes)
                  OR cs.soc_start IS NULL
                  OR cs.soc_end IS NULL
                  OR cs.kwh_added IS NULL
                  OR cs.energy_added_wh IS NULL
                  OR cs.duration_minutes IS NULL
            )
            RETURNING cs.id, cs.vehicle_id, cs.started_at, cs.ended_at
        ),
        inserted AS (
            INSERT INTO riviamigo.charge_sessions (
                id, vehicle_id, started_at, ended_at,
                location_lat, location_lng,
                soc_start, soc_end, charge_limit, duration_minutes,
                kwh_added, max_charge_rate_kw, cost_usd,
                energy_added_wh, energy_used_wh,
                avg_charge_rate_kw, peak_voltage,
                cost_method, charger_type
            )
            SELECT
                id, vehicle_id, started_at, ended_at,
                location_lat, location_lng,
                soc_start, soc_end, charge_limit, duration_minutes,
                energy_added_wh / 1000.0, max_charge_rate_kw, NULL,
                energy_added_wh, NULL,
                CASE
                    WHEN duration_minutes > 0 THEN energy_added_wh / 1000.0 / (duration_minutes::float8 / 60.0)
                END,
                NULL,
                'telemetry_repair',
                CASE
                    WHEN max_charge_rate_kw < 12 THEN 'ac'
                    WHEN max_charge_rate_kw < 50 THEN 'ac_l2'
                    WHEN max_charge_rate_kw IS NOT NULL THEN 'dc'
                    WHEN duration_minutes > 0 AND energy_added_wh / 1000.0 / (duration_minutes::float8 / 60.0) < 12 THEN 'ac'
                    WHEN duration_minutes > 0 AND energy_added_wh / 1000.0 / (duration_minutes::float8 / 60.0) < 50 THEN 'ac_l2'
                    WHEN duration_minutes > 0 THEN 'dc'
                END
            FROM candidates
            WHERE NOT EXISTS (
                  SELECT 1
                  FROM matched_existing
                  WHERE matched_existing.id = candidates.id
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM riviamigo.charge_sessions cs
                  WHERE cs.vehicle_id = candidates.vehicle_id
                    AND cs.started_at <= candidates.ended_at
                    AND COALESCE(cs.ended_at, cs.started_at) >= candidates.started_at
              )
            RETURNING id, vehicle_id, started_at, ended_at
        ),
        repaired AS (
            SELECT * FROM inserted
            UNION ALL
            SELECT * FROM updated
        ),
        stamped AS (
            UPDATE timeseries.telemetry t
            SET charge_session_id = repaired.id
            FROM repaired
            WHERE t.vehicle_id = repaired.vehicle_id
              AND t.ts >= repaired.started_at
              AND t.ts <= repaired.ended_at
              AND (
                  t.charge_session_id IS NULL
                  OR NOT EXISTS (
                      SELECT 1
                      FROM riviamigo.charge_sessions existing
                      WHERE existing.id = t.charge_session_id
                  )
              )
            RETURNING repaired.id
        )
        SELECT COUNT(DISTINCT id)::int8 AS repaired
        FROM stamped
        "#,
    )
    .bind(vehicle_id)
    .fetch_one(pool)
    .await?;

    Ok(repaired as u64)
}

async fn repair_charge_session_locations_for_vehicle(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Result<u64> {
    let sessions = sqlx::query_as::<_, ChargeLocationRow>(
        r#"
        SELECT id, vehicle_id, location_lat, location_lng
        FROM riviamigo.charge_sessions
        WHERE vehicle_id = $1
          AND geofence_id IS NULL
          AND location_lat IS NOT NULL
          AND location_lng IS NOT NULL
        "#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut repaired = 0u64;

    for session in sessions {
        let owner_id = get_vehicle_owner_id(pool, session.vehicle_id).await?;
        let matched = match (owner_id, session.location_lat, session.location_lng) {
            (Some(user_id), Some(lat), Some(lon)) => {
                match_geofence(pool, user_id, lat, lon).await?
            }
            _ => None,
        };

        let Some(matched) = matched else {
            continue;
        };

        let result = sqlx::query(
            r#"
            UPDATE riviamigo.charge_sessions
            SET geofence_id = COALESCE(geofence_id, $2),
                address_id  = COALESCE(address_id,  $3),
                is_home     = COALESCE(is_home,     $4)
            WHERE id = $1
            "#,
        )
        .bind(session.id)
        .bind(matched.id)
        .bind(matched.address_id)
        .bind(matched.is_home)
        .execute(pool)
        .await?;

        repaired += result.rows_affected();
    }

    Ok(repaired)
}

async fn repair_charge_session_costs_for_vehicle(pool: &PgPool, vehicle_id: Uuid) -> Result<u64> {
    let session_ids = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id
        FROM riviamigo.charge_sessions
        WHERE vehicle_id = $1
        "#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut repaired = 0u64;
    for session_id in session_ids {
        if recompute_charge_session_cost(pool, session_id)
            .await
            .is_ok()
        {
            repaired += 1;
        }
    }

    Ok(repaired)
}

#[derive(Debug, FromRow)]
struct ChargeLocationRow {
    id: Uuid,
    vehicle_id: Uuid,
    location_lat: Option<f64>,
    location_lng: Option<f64>,
}

async fn replay_trips_for_vehicle(pool: &PgPool, vehicle_id: Uuid) -> Result<u64> {
    let owner_id = get_vehicle_owner_id(pool, vehicle_id).await?;
    let mut trip_det = TripDetectorState::new(vehicle_id);
    let mut rows = sqlx::query_as::<_, ReplayTelemetryRow>(
        r#"
        SELECT
            ts, vehicle_id,
            latitude, longitude, altitude_m, speed_mph,
            battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit,
            power_state, charger_state, charger_status, time_to_end_of_charge_min,
            drive_mode, gear_status, cabin_temp_c, outside_temp_c,
            power_kw, regen_power_kw, heading_deg, odometer_miles, is_online
        FROM timeseries.telemetry
        WHERE vehicle_id = $1
        ORDER BY ts
        "#,
    )
    .bind(vehicle_id)
    .fetch(pool);

    let mut inserted = 0u64;
    while let Some(row) = rows.try_next().await? {
        let event = row_to_event(row);

        if let TripEvent::TripEnded { trip } = trip_det.process(&event) {
            let distance = compute_distance_odometer_or_gps(
                trip.start_odometer_mi,
                trip.end_odometer_mi,
                &trip.points,
            );
            if distance < MIN_TRIP_DISTANCE_MILES {
                continue;
            }

            let was_inserted = persist_replayed_trip(pool, owner_id, &trip, distance).await?;
            if was_inserted {
                inserted += 1;
            }
        }
    }

    Ok(inserted)
}

fn row_to_event(row: ReplayTelemetryRow) -> TelemetryEvent {
    let mut event = TelemetryEvent::empty(row.vehicle_id, row.ts);
    event.latitude = row.latitude;
    event.longitude = row.longitude;
    event.altitude_m = row.altitude_m;
    event.speed_mph = row.speed_mph;
    event.battery_level = row.battery_level;
    event.battery_capacity_wh = row.battery_capacity_wh;
    event.distance_to_empty_mi = row.distance_to_empty_mi;
    event.battery_limit = row.battery_limit;
    event.power_state = row.power_state.as_deref().and_then(parse_power_state);
    event.charger_state = row.charger_state.as_deref().and_then(parse_charger_state);
    event.charger_status = row.charger_status;
    event.time_to_end_of_charge_min = row.time_to_end_of_charge_min;
    event.drive_mode = row.drive_mode.as_deref().and_then(parse_drive_mode);
    event.gear_status = row.gear_status;
    event.cabin_temp_c = row.cabin_temp_c;
    event.outside_temp_c = row.outside_temp_c;
    event.power_kw = row.power_kw;
    event.regen_power_kw = row.regen_power_kw;
    event.heading_deg = row.heading_deg;
    event.odometer_miles = row.odometer_miles;
    event.is_online = row.is_online;
    event
}

fn parse_power_state(value: &str) -> Option<PowerState> {
    value.parse().ok()
}

fn parse_charger_state(value: &str) -> Option<ChargerState> {
    value.parse().ok()
}

fn parse_drive_mode(value: &str) -> Option<DriveMode> {
    value.parse().ok()
}

async fn persist_replayed_trip(
    pool: &PgPool,
    owner_id: Option<Uuid>,
    trip: &CompletedTripData,
    distance: f64,
) -> Result<bool> {
    let overlap: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT id
        FROM riviamigo.trips
        WHERE vehicle_id = $1
          AND started_at <= $3
          AND ended_at >= $2
        LIMIT 1
        "#,
    )
    .bind(trip.vehicle_id)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .fetch_optional(pool)
    .await?;

    if let Some(existing) = overlap {
        warn!(
            vehicle_id = %trip.vehicle_id,
            trip_id = %trip.trip_id,
            existing_trip_id = %existing,
            started_at = %trip.started_at,
            ended_at = %trip.ended_at,
            "skipping overlapping existing trip during replay"
        );
        return Ok(false);
    }

    let duration = (trip.ended_at - trip.started_at).num_seconds() as i32;
    let max_speed = trip
        .points
        .iter()
        .map(|p| p.speed_mph)
        .fold(0.0_f64, f64::max);
    let avg_speed = if duration > 0 {
        Some(distance / (duration as f64 / 3600.0))
    } else {
        None
    };

    let (energy_wh, energy_strategy, efficiency_wh_per_mi) = match compute_trip_energy(
        trip.soc_start,
        trip.soc_end,
        trip.battery_capacity_wh,
        trip.range_start_mi,
        trip.range_end_mi,
        distance,
        None,
    ) {
        Some((wh, strat)) => {
            let eff = if distance > 0.0 {
                Some(wh / distance)
            } else {
                None
            };
            (Some(wh), Some(strat.to_string()), eff)
        }
        None => {
            let eff = match (trip.soc_start, trip.soc_end, trip.battery_capacity_wh) {
                (Some(s0), Some(s1), Some(cap)) if distance > 0.0 && s0 > s1 => {
                    Some(((s0 - s1) / 100.0) * cap / distance)
                }
                _ => None,
            };
            (None, None, eff)
        }
    };

    let start = trip.points.first();
    let end = trip.points.last();
    let outside_temp_c = trip.outside_temp_avg_c;

    let start_match = match (owner_id, start) {
        (Some(user_id), Some(point)) => match_point(pool, user_id, point.lat, point.lng).await?,
        _ => MatchedLocation::none(),
    };
    let end_match = match (owner_id, end) {
        (Some(user_id), Some(point)) => match_point(pool, user_id, point.lat, point.lng).await?,
        _ => MatchedLocation::none(),
    };

    sqlx::query(
        r#"
        INSERT INTO riviamigo.trips
           (id, vehicle_id, started_at, ended_at,
            start_lat, start_lng, end_lat, end_lng,
            distance_miles, duration_seconds,
            soc_start, soc_end,
            efficiency_wh_per_mile, max_speed_mph, avg_speed_mph, drive_mode,
            start_odometer_mi, end_odometer_mi,
            start_position_ts, end_position_ts,
            start_geofence_id, end_geofence_id,
            start_address_id, end_address_id,
            range_start_mi, range_end_mi,
            power_max_kw, power_min_kw,
            elevation_gain_m, elevation_loss_m,
            inside_temp_avg_c, outside_temp_c, regen_wh, energy_wh, energy_strategy)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
        "#,
    )
    .bind(trip.trip_id)
    .bind(trip.vehicle_id)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .bind(start.map(|p| p.lat))
    .bind(start.map(|p| p.lng))
    .bind(end.map(|p| p.lat))
    .bind(end.map(|p| p.lng))
    .bind(distance)
    .bind(duration)
    .bind(trip.soc_start)
    .bind(trip.soc_end)
    .bind(efficiency_wh_per_mi)
    .bind(max_speed)
    .bind(avg_speed)
    .bind(trip.dominant_drive_mode.as_deref())
    .bind(trip.start_odometer_mi)
    .bind(trip.end_odometer_mi)
    .bind(start.map(|p| p.ts))
    .bind(end.map(|p| p.ts))
    .bind(start_match.geofence_id)
    .bind(end_match.geofence_id)
    .bind(start_match.address_id)
    .bind(end_match.address_id)
    .bind(trip.range_start_mi)
    .bind(trip.range_end_mi)
    .bind(trip.power_max_kw)
    .bind(trip.power_min_kw)
    .bind(trip.elevation_gain_m)
    .bind(trip.elevation_loss_m)
    .bind(trip.inside_temp_avg_c)
    .bind(outside_temp_c)
    .bind(trip.regen_wh)
    .bind(energy_wh)
    .bind(energy_strategy.as_deref())
    .execute(pool)
    .await?;

    if let Some(user_id) = owner_id {
        sqlx::query(
            r#"
            INSERT INTO riviamigo.trip_user_annotations
               (trip_id, user_id, start_geofence_id, end_geofence_id, start_address_id, end_address_id, matched_at)
               VALUES ($1, $2, $3, $4, $5, $6, now())
               ON CONFLICT (trip_id, user_id) DO UPDATE
               SET start_geofence_id = EXCLUDED.start_geofence_id,
                   end_geofence_id = EXCLUDED.end_geofence_id,
                   start_address_id = EXCLUDED.start_address_id,
                   end_address_id = EXCLUDED.end_address_id,
                   matched_at = now(),
                   updated_at = now()
            "#,
        )
        .bind(trip.trip_id)
        .bind(user_id)
        .bind(start_match.geofence_id)
        .bind(end_match.geofence_id)
        .bind(start_match.address_id)
        .bind(end_match.address_id)
        .execute(pool)
        .await?;
    }

    Ok(true)
}

async fn backfill_trip_ids_for_vehicle(pool: &PgPool, vehicle_id: Uuid) -> Result<u64> {
    let trips = sqlx::query_as::<_, TripRangeRow>(
        r#"
        SELECT id, started_at, ended_at
        FROM riviamigo.trips
        WHERE vehicle_id = $1
          AND ended_at IS NOT NULL
        ORDER BY started_at
        "#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut stamped = 0u64;
    for trip in trips {
        let result = sqlx::query(
            r#"
            UPDATE timeseries.telemetry
            SET trip_id = $1
            WHERE vehicle_id = $2
              AND ts >= $3
              AND ts <= $4
              AND trip_id IS NULL
            "#,
        )
        .bind(trip.id)
        .bind(vehicle_id)
        .bind(trip.started_at)
        .bind(trip.ended_at)
        .execute(pool)
        .await?;

        stamped += result.rows_affected();
    }

    Ok(stamped)
}

#[derive(Debug, FromRow)]
struct TripRangeRow {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
}

struct MatchedLocation {
    geofence_id: Option<Uuid>,
    address_id: Option<Uuid>,
}

impl MatchedLocation {
    fn none() -> Self {
        Self {
            geofence_id: None,
            address_id: None,
        }
    }
}

async fn match_point(pool: &PgPool, user_id: Uuid, lat: f64, lon: f64) -> Result<MatchedLocation> {
    let matched = match_geofence(pool, user_id, lat, lon).await?;

    Ok(match matched {
        Some(geofence) => MatchedLocation {
            geofence_id: Some(geofence.id),
            address_id: geofence.address_id,
        },
        None => MatchedLocation::none(),
    })
}
