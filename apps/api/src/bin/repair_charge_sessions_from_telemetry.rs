//! Reconstruct missing charge_sessions from telemetry evidence.
//!
//! This repairs sessions that were not closed by the live detector, usually
//! because the API restarted while a charge was in progress or Rivian sent
//! sparse partial patches without charger_state on every row.
//!
//!   cargo run --bin repair_charge_sessions_from_telemetry

use anyhow::Result;
use riviamigo_api::{
    db::vehicles::get_vehicle_owner_id, models::cost_profile::compute_cost,
    services::cost::resolve_profile, services::geofences::match_geofence,
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
    let merged = merge_rivian_api_live_sessions(&pool).await?;
    let repaired_api_metadata = repair_api_summary_metadata(&pool).await?;
    let estimated_soc = estimate_api_session_soc_from_energy(&pool).await?;
    let retagged = repair_charge_session_locations(&pool).await?;
    let recosted = repair_charge_session_costs(&pool).await?;
    info!(
        repaired,
        merged,
        repaired_api_metadata,
        estimated_soc,
        retagged,
        recosted,
        "charge session telemetry repair complete"
    );
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
        merged_duplicates AS (
            DELETE FROM riviamigo.charge_sessions duplicate
            USING repaired
            WHERE duplicate.vehicle_id = repaired.vehicle_id
              AND duplicate.id <> repaired.id
              AND duplicate.started_at <= repaired.ended_at
              AND COALESCE(duplicate.ended_at, duplicate.started_at) >= repaired.started_at
              AND COALESCE(duplicate.source, '') <> 'rivian_api'
            RETURNING duplicate.id
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

async fn merge_rivian_api_live_sessions(pool: &sqlx::PgPool) -> Result<u64> {
    let merged: i64 = sqlx::query_scalar(
        r#"
        WITH pairs AS (
            SELECT DISTINCT ON (live.id)
                api.id AS api_id,
                live.id AS live_id
            FROM riviamigo.charge_sessions api
            JOIN riviamigo.charge_sessions live
              ON live.vehicle_id = api.vehicle_id
             AND live.id <> api.id
             AND COALESCE(live.source, '') <> 'rivian_api'
             AND live.started_at <= COALESCE(api.ended_at, api.started_at)
             AND COALESCE(live.ended_at, live.started_at) >= api.started_at
            WHERE api.source = 'rivian_api'
            ORDER BY live.id,
                     ABS(EXTRACT(EPOCH FROM (live.started_at - api.started_at)))
        ),
        merged_values AS (
            SELECT
                pairs.api_id,
                pairs.live_id,
                api.kwh_added AS api_kwh_added,
                api.energy_added_wh AS api_energy_added_wh,
                live.location_lat,
                live.location_lng,
                live.soc_start,
                live.soc_end,
                live.charge_limit,
                live.max_charge_rate_kw,
                live.avg_charge_rate_kw,
                live.charger_type,
                live.geofence_id,
                live.address_id,
                live.is_home
            FROM pairs
            JOIN riviamigo.charge_sessions api ON api.id = pairs.api_id
            JOIN riviamigo.charge_sessions live ON live.id = pairs.live_id
        ),
        updated AS (
            UPDATE riviamigo.charge_sessions api
            SET
                location_lat = COALESCE(api.location_lat, merged_values.location_lat),
                location_lng = COALESCE(api.location_lng, merged_values.location_lng),
                soc_start = COALESCE(api.soc_start, merged_values.soc_start),
                soc_end = COALESCE(api.soc_end, merged_values.soc_end),
                charge_limit = COALESCE(api.charge_limit, merged_values.charge_limit),
                duration_minutes = COALESCE(
                    api.duration_minutes,
                    CASE
                        WHEN api.ended_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (api.ended_at - api.started_at))::int / 60
                    END
                ),
                energy_added_wh = COALESCE(
                    api.energy_added_wh,
                    api.kwh_added * 1000.0,
                    merged_values.api_energy_added_wh
                ),
                max_charge_rate_kw = COALESCE(api.max_charge_rate_kw, merged_values.max_charge_rate_kw),
                avg_charge_rate_kw = COALESCE(api.avg_charge_rate_kw, merged_values.avg_charge_rate_kw),
                charger_type = COALESCE(api.charger_type, merged_values.charger_type),
                geofence_id = COALESCE(api.geofence_id, merged_values.geofence_id),
                address_id = COALESCE(api.address_id, merged_values.address_id),
                is_home = COALESCE(api.is_home, merged_values.is_home)
            FROM merged_values
            WHERE api.id = merged_values.api_id
            RETURNING api.id, merged_values.live_id
        ),
        restamped AS (
            UPDATE timeseries.telemetry t
            SET charge_session_id = updated.id
            FROM updated
            WHERE t.charge_session_id = updated.live_id
            RETURNING updated.live_id
        ),
        deleted AS (
            DELETE FROM riviamigo.charge_sessions live
            USING updated
            WHERE live.id = updated.live_id
            RETURNING live.id
        )
        SELECT COUNT(*)::int8 FROM deleted
        "#
    )
    .fetch_one(pool)
    .await?;

    Ok(merged as u64)
}

async fn estimate_api_session_soc_from_energy(pool: &sqlx::PgPool) -> Result<u64> {
    let repaired = sqlx::query!(
        r#"
        UPDATE riviamigo.charge_sessions cs
        SET soc_start = GREATEST(
                0.0,
                cs.soc_end - (cs.kwh_added / (v.battery_capacity_wh / 1000.0) * 100.0)
            )
        FROM riviamigo.vehicles v
        WHERE cs.vehicle_id = v.id
          AND cs.source = 'rivian_api'
          AND cs.kwh_added IS NOT NULL
          AND cs.soc_end IS NOT NULL
          AND v.battery_capacity_wh IS NOT NULL
          AND v.battery_capacity_wh > 0
          AND (
              cs.soc_start IS NULL
              OR ((cs.soc_end - cs.soc_start) / 100.0 * (v.battery_capacity_wh / 1000.0)) < cs.kwh_added * 0.6
          )
        "#
    )
    .execute(pool)
    .await?
    .rows_affected();

    Ok(repaired)
}

async fn repair_api_summary_metadata(pool: &sqlx::PgPool) -> Result<u64> {
    let repaired = sqlx::query!(
        r#"
        UPDATE riviamigo.charge_sessions
        SET duration_minutes = COALESCE(
                duration_minutes,
                CASE
                    WHEN ended_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (ended_at - started_at))::int / 60
                END
            ),
            charger_type = COALESCE(
                charger_type,
                CASE
                    WHEN lower(COALESCE(network_vendor, '')) = ANY(ARRAY['tesla','rivian','electrify america','evgo']) THEN 'dc'
                    WHEN is_home THEN 'ac'
                END
            )
        WHERE source = 'rivian_api'
          AND (
              duration_minutes IS NULL
              OR charger_type IS NULL
          )
        "#
    )
    .execute(pool)
    .await?
    .rows_affected();

    Ok(repaired)
}

async fn repair_charge_session_costs(pool: &sqlx::PgPool) -> Result<u64> {
    let sessions = sqlx::query!(
        r#"SELECT id, vehicle_id, geofence_id, cost_profile_id, started_at, ended_at,
                  duration_minutes, kwh_added, energy_added_wh, energy_used_wh,
                  rivian_paid_total, is_public, is_rivian_network
           FROM riviamigo.charge_sessions"#
    )
    .fetch_all(pool)
    .await?;

    let mut repaired = 0u64;

    for session in sessions {
        let profile = resolve_profile(
            pool,
            session.cost_profile_id,
            session.geofence_id,
            session.vehicle_id,
        )
        .await?;
        let authoritative_paid_total = (session.is_public == Some(true)
            || session.is_rivian_network == Some(true))
        .then_some(session.rivian_paid_total)
        .flatten();
        let cost_usd = authoritative_paid_total.or_else(|| {
            profile.as_ref().and_then(|p| {
                compute_cost(
                    p,
                    session
                        .energy_added_wh
                        .map(|wh| wh / 1000.0)
                        .or(session.kwh_added),
                    session.energy_used_wh.map(|wh| wh / 1000.0),
                    session.duration_minutes.unwrap_or(0),
                    session.started_at,
                    session.ended_at,
                )
            })
        });
        let resolved_profile_id = profile.as_ref().map(|p| p.id);
        let cost_method = if authoritative_paid_total.is_some() {
            Some("rivian_paid_total")
        } else if resolved_profile_id.is_some() {
            Some("profile")
        } else {
            Some("unknown")
        };

        let result = sqlx::query!(
            r#"UPDATE riviamigo.charge_sessions
               SET cost_profile_id = $2,
                   cost_method = $3,
                   cost_usd = $4
               WHERE id = $1"#,
            session.id,
            resolved_profile_id,
            cost_method,
            cost_usd,
        )
        .execute(pool)
        .await?;
        repaired += result.rows_affected();
    }

    Ok(repaired)
}
