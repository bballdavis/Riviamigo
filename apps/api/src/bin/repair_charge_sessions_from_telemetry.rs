//! Reconstruct missing charge_sessions from telemetry evidence.
//!
//! This repairs sessions that were not closed by the live detector, usually
//! because the API restarted while a charge was in progress or Rivian sent
//! sparse partial patches without charger_state on every row.
//!
//!   cargo run --bin repair_charge_sessions_from_telemetry

use anyhow::Result;
use riviamigo_api::{
    db::vehicles::get_vehicle_owner_id,
    services::geofences::match_geofence,
};
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

    let repaired = repair_charge_sessions_from_telemetry(&pool).await?;
    let retagged = repair_charge_session_locations(&pool).await?;
    info!(repaired, retagged, "charge session telemetry repair complete");
    Ok(())
}

async fn repair_charge_sessions_from_telemetry(pool: &sqlx::PgPool) -> Result<u64> {
    let repaired: i64 = sqlx::query_scalar(
        r#"
        WITH evidence AS (
            SELECT
                t.*,
                LAG(t.ts) OVER (PARTITION BY t.vehicle_id ORDER BY t.ts) AS prev_ts
            FROM timeseries.telemetry t
            WHERE t.charger_state = 'charging'
               OR t.charger_status = 'chrgr_sts_connected_charging'
               OR COALESCE(t.time_to_end_of_charge_min, 0) > 0
               OR (
                    t.charge_session_id IS NOT NULL
                    AND NOT EXISTS (
                        SELECT 1
                        FROM riviamigo.charge_sessions existing
                        WHERE existing.id = t.charge_session_id
                    )
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
                SUM(new_segment) OVER (PARTITION BY vehicle_id ORDER BY ts) AS segment_id
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
            ORDER BY c.id, cs.started_at
        ),
        updated AS (
            UPDATE riviamigo.charge_sessions cs
            SET
                started_at = LEAST(cs.started_at, matched_existing.started_at),
                ended_at = GREATEST(
                    COALESCE(cs.ended_at, matched_existing.ended_at),
                    matched_existing.ended_at
                ),
                location_lat = COALESCE(cs.location_lat, matched_existing.location_lat),
                location_lng = COALESCE(cs.location_lng, matched_existing.location_lng),
                soc_start = CASE
                    WHEN matched_existing.started_at < cs.started_at
                    THEN matched_existing.soc_start
                    ELSE COALESCE(cs.soc_start, matched_existing.soc_start)
                END,
                soc_end = CASE
                    WHEN matched_existing.ended_at > COALESCE(cs.ended_at, cs.started_at)
                    THEN matched_existing.soc_end
                    ELSE COALESCE(cs.soc_end, matched_existing.soc_end)
                END,
                charge_limit = COALESCE(cs.charge_limit, matched_existing.charge_limit),
                duration_minutes = EXTRACT(
                    EPOCH FROM (
                        GREATEST(
                            COALESCE(cs.ended_at, matched_existing.ended_at),
                            matched_existing.ended_at
                        )
                        - LEAST(cs.started_at, matched_existing.started_at)
                    )
                )::int / 60,
                kwh_added = matched_existing.energy_added_wh / 1000.0,
                energy_added_wh = matched_existing.energy_added_wh,
                max_charge_rate_kw = COALESCE(cs.max_charge_rate_kw, matched_existing.max_charge_rate_kw),
                avg_charge_rate_kw = CASE
                    WHEN matched_existing.duration_minutes > 0
                    THEN matched_existing.energy_added_wh / 1000.0 / (matched_existing.duration_minutes::float8 / 60.0)
                END,
                cost_method = COALESCE(cs.cost_method, 'telemetry_repair')
            FROM matched_existing
            WHERE cs.id = matched_existing.existing_id
              AND (
                  matched_existing.started_at < cs.started_at
                  OR matched_existing.ended_at > COALESCE(cs.ended_at, cs.started_at)
                  OR cs.soc_start IS NULL
                  OR cs.soc_end IS NULL
                  OR cs.kwh_added IS NULL
                  OR cs.energy_added_wh IS NULL
                  OR cs.duration_minutes IS NULL
              )
            RETURNING cs.id, cs.vehicle_id, cs.started_at, COALESCE(cs.ended_at, matched_existing.ended_at) AS ended_at
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
        "#
    )
    .fetch_one(pool)
    .await?;

    Ok(repaired as u64)
}

async fn repair_charge_session_locations(pool: &sqlx::PgPool) -> Result<u64> {
    let sessions = sqlx::query!(
        r#"SELECT id, vehicle_id, location_lat, location_lng
           FROM riviamigo.charge_sessions
           WHERE geofence_id IS NULL
             AND location_lat IS NOT NULL
             AND location_lng IS NOT NULL"#
    )
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

        let result = sqlx::query!(
            r#"UPDATE riviamigo.charge_sessions
               SET geofence_id = COALESCE(geofence_id, $2),
                   address_id  = COALESCE(address_id,  $3),
                   is_home     = COALESCE(is_home,     $4)
               WHERE id = $1"#,
            session.id,
            matched.id,
            matched.address_id,
            matched.is_home,
        )
        .execute(pool)
        .await?;

        repaired += result.rows_affected();
    }

    Ok(repaired)
}
