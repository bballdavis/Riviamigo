//! Recover charging sessions the live detector missed, from telemetry.
//!
//! Used by Settings > Jobs ("Recover missed charging sessions"). Charging
//! telemetry is grouped into windows (a gap of more than two hours starts a
//! new one), and each finished window is handled conservatively:
//!
//! - no recorded session overlaps it: a session is created from telemetry;
//! - one open telemetry session started in it (the API restarted mid-charge,
//!   so the session never closed): that session is closed, filling only
//!   values it is missing;
//! - anything else: left alone.
//!
//! It never deletes or merges sessions and never rewrites a finished one, so
//! corrections are safe. Windows that ended less than two hours ago are
//! skipped because the charge may still be going. The broader operator tool,
//! `repair_charge_sessions_from_telemetry`, also rewrites and merges sessions
//! and stays a command-line repair.

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::vehicles::get_vehicle_owner_id,
    services::{cost::recompute_charge_session_cost, geofences::match_geofence},
};

/// Charging evidence further apart than this starts a new window, and a
/// window must have ended at least this long ago to be considered finished.
const WINDOW_GAP_HOURS: i64 = 2;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ChargeSessionRecoverySummary {
    /// Finished charging windows found in telemetry.
    pub windows: usize,
    /// Sessions created for windows with no recorded session.
    pub inserted: usize,
    /// Open sessions closed from their window.
    pub closed: usize,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct ChargeWindow {
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    location_lat: Option<f64>,
    location_lng: Option<f64>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
    charge_limit: Option<f64>,
    max_charge_rate_kw: Option<f64>,
    energy_added_wh: Option<f64>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct OverlappingSession {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    source: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowAction {
    Insert,
    Close(Uuid),
    Skip,
}

fn classify(window: &ChargeWindow, overlapping: &[OverlappingSession]) -> WindowAction {
    match overlapping {
        [] => WindowAction::Insert,
        [only]
            if only.ended_at.is_none()
                && only.source.as_deref() != Some("rivian_api")
                && only.started_at >= window.started_at - Duration::hours(WINDOW_GAP_HOURS)
                && only.started_at <= window.ended_at =>
        {
            WindowAction::Close(only.id)
        }
        _ => WindowAction::Skip,
    }
}

/// Recover missed charging sessions for one vehicle.
pub async fn recover_missed_charge_sessions(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Result<ChargeSessionRecoverySummary> {
    let windows = fetch_finished_windows(pool, vehicle_id).await?;
    let mut summary = ChargeSessionRecoverySummary {
        windows: windows.len(),
        ..Default::default()
    };

    let mut touched = Vec::new();
    for window in &windows {
        let overlapping = sqlx::query_as::<_, OverlappingSession>(
            r#"SELECT id, started_at, ended_at, source
               FROM riviamigo.charge_sessions
               WHERE vehicle_id = $1
                 AND started_at <= $3
                 AND (ended_at IS NULL OR ended_at >= $2)"#,
        )
        .bind(vehicle_id)
        .bind(window.started_at)
        .bind(window.ended_at)
        .fetch_all(pool)
        .await?;

        match classify(window, &overlapping) {
            WindowAction::Insert => {
                touched.push(insert_session(pool, vehicle_id, window).await?);
                summary.inserted += 1;
            }
            WindowAction::Close(session_id) => {
                if close_session(pool, session_id, window).await? {
                    touched.push(session_id);
                    summary.closed += 1;
                }
            }
            WindowAction::Skip => {}
        }
    }

    let owner_id = get_vehicle_owner_id(pool, vehicle_id).await?;
    for session_id in touched {
        stamp_telemetry(pool, vehicle_id, session_id).await?;
        if let Some(owner_id) = owner_id {
            link_place(pool, owner_id, session_id).await?;
        }
        recompute_charge_session_cost(pool, session_id).await?;
    }
    Ok(summary)
}

async fn fetch_finished_windows(pool: &PgPool, vehicle_id: Uuid) -> Result<Vec<ChargeWindow>> {
    Ok(sqlx::query_as::<_, ChargeWindow>(
        r#"WITH evidence AS (
               SELECT t.ts, t.latitude, t.longitude, t.battery_level, t.battery_limit,
                      t.battery_capacity_wh, t.power_kw,
                      LAG(t.ts) OVER (ORDER BY t.ts) AS prev_ts
               FROM timeseries.telemetry t
               WHERE t.vehicle_id = $1
                 AND (t.charger_state = 'charging'
                      OR t.charger_status = 'chrgr_sts_connected_charging'
                      OR COALESCE(t.time_to_end_of_charge_min, 0) > 0)
           ),
           segmented AS (
               SELECT *,
                      SUM(CASE WHEN prev_ts IS NULL OR ts - prev_ts > make_interval(hours => $2)
                               THEN 1 ELSE 0 END) OVER (ORDER BY ts) AS segment_id
               FROM evidence
           ),
           windows AS (
               SELECT MIN(ts) AS started_at,
                      MAX(ts) AS ended_at,
                      (ARRAY_AGG(latitude ORDER BY ts) FILTER (WHERE latitude IS NOT NULL))[1] AS location_lat,
                      (ARRAY_AGG(longitude ORDER BY ts) FILTER (WHERE longitude IS NOT NULL))[1] AS location_lng,
                      (ARRAY_AGG(battery_level ORDER BY ts) FILTER (WHERE battery_level IS NOT NULL))[1] AS soc_start,
                      (ARRAY_AGG(battery_level ORDER BY ts DESC) FILTER (WHERE battery_level IS NOT NULL))[1] AS soc_end,
                      MAX(battery_limit) AS charge_limit,
                      AVG(battery_capacity_wh) FILTER (WHERE battery_capacity_wh IS NOT NULL) AS battery_capacity_wh,
                      MAX(ABS(power_kw)) FILTER (WHERE power_kw IS NOT NULL) AS max_charge_rate_kw
               FROM segmented
               GROUP BY segment_id
           )
           SELECT started_at, ended_at, location_lat, location_lng, soc_start, soc_end,
                  charge_limit, max_charge_rate_kw,
                  CASE WHEN battery_capacity_wh > 0
                       THEN (soc_end - soc_start) / 100.0 * battery_capacity_wh
                  END AS energy_added_wh
           FROM windows
           WHERE ended_at - started_at >= interval '5 minutes'
             AND ended_at < now() - make_interval(hours => $2)
             AND soc_start IS NOT NULL
             AND soc_end IS NOT NULL
             AND soc_end - soc_start >= 1.0
           ORDER BY started_at"#,
    )
    .bind(vehicle_id)
    .bind(WINDOW_GAP_HOURS as i32)
    .fetch_all(pool)
    .await?)
}

fn charger_type(
    max_charge_rate_kw: Option<f64>,
    avg_charge_rate_kw: Option<f64>,
) -> Option<&'static str> {
    let rate = max_charge_rate_kw.or(avg_charge_rate_kw)?;
    Some(if rate < 12.0 {
        "ac"
    } else if rate < 50.0 {
        "ac_l2"
    } else {
        "dc"
    })
}

fn duration_minutes(started_at: DateTime<Utc>, ended_at: DateTime<Utc>) -> i32 {
    ((ended_at - started_at).num_seconds() / 60).clamp(0, i64::from(i32::MAX)) as i32
}

async fn insert_session(pool: &PgPool, vehicle_id: Uuid, window: &ChargeWindow) -> Result<Uuid> {
    let duration = duration_minutes(window.started_at, window.ended_at);
    let avg_rate = window
        .energy_added_wh
        .filter(|_| duration > 0)
        .map(|wh| wh / 1000.0 / (f64::from(duration) / 60.0));
    let id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO riviamigo.charge_sessions (
               vehicle_id, started_at, ended_at,
               location_lat, location_lng, source_location_lat, source_location_lng,
               soc_start, soc_end, charge_limit, duration_minutes,
               kwh_added, energy_added_wh, max_charge_rate_kw, avg_charge_rate_kw,
               cost_method, charger_type, source, data_confidence
           )
           VALUES ($1, $2, $3, $4, $5, $4, $5, $6, $7, $8, $9,
                   $10 / 1000.0, $10, $11, $12,
                   'telemetry_repair', $13, 'telemetry', 'telemetry')
           RETURNING id"#,
    )
    .bind(vehicle_id)
    .bind(window.started_at)
    .bind(window.ended_at)
    .bind(window.location_lat)
    .bind(window.location_lng)
    .bind(window.soc_start)
    .bind(window.soc_end)
    .bind(window.charge_limit)
    .bind(duration)
    .bind(window.energy_added_wh)
    .bind(window.max_charge_rate_kw)
    .bind(avg_rate)
    .bind(charger_type(window.max_charge_rate_kw, avg_rate))
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Close an open session from its window. Values the session already has are
/// kept, except that energy only grows; user location overrides are kept.
async fn close_session(pool: &PgPool, session_id: Uuid, window: &ChargeWindow) -> Result<bool> {
    let closed = sqlx::query(
        r#"UPDATE riviamigo.charge_sessions
           SET ended_at = $2,
               duration_minutes = EXTRACT(EPOCH FROM ($2 - started_at))::int / 60,
               soc_start = COALESCE(soc_start, $3),
               soc_end = COALESCE($4, soc_end),
               charge_limit = COALESCE(charge_limit, $5),
               max_charge_rate_kw = GREATEST(max_charge_rate_kw, $6),
               energy_added_wh = GREATEST(energy_added_wh, $7),
               kwh_added = GREATEST(kwh_added, $7 / 1000.0),
               source_location_lat = COALESCE(source_location_lat, $8),
               source_location_lng = COALESCE(source_location_lng, $9),
               location_lat = CASE WHEN location_override_mode = 'automatic'
                                   THEN COALESCE(location_lat, $8) ELSE location_lat END,
               location_lng = CASE WHEN location_override_mode = 'automatic'
                                   THEN COALESCE(location_lng, $9) ELSE location_lng END,
               data_confidence = COALESCE(data_confidence, 'telemetry')
           WHERE id = $1
             AND ended_at IS NULL"#,
    )
    .bind(session_id)
    .bind(window.ended_at)
    .bind(window.soc_start)
    .bind(window.soc_end)
    .bind(window.charge_limit)
    .bind(window.max_charge_rate_kw)
    .bind(window.energy_added_wh)
    .bind(window.location_lat)
    .bind(window.location_lng)
    .execute(pool)
    .await?;
    Ok(closed.rows_affected() > 0)
}

async fn stamp_telemetry(pool: &PgPool, vehicle_id: Uuid, session_id: Uuid) -> Result<()> {
    sqlx::query(
        r#"UPDATE timeseries.telemetry t
           SET charge_session_id = cs.id
           FROM riviamigo.charge_sessions cs
           WHERE cs.id = $2
             AND t.vehicle_id = $1
             AND t.ts >= cs.started_at
             AND t.ts <= cs.ended_at
             AND (t.charge_session_id IS NULL
                  OR NOT EXISTS (SELECT 1 FROM riviamigo.charge_sessions existing
                                 WHERE existing.id = t.charge_session_id))"#,
    )
    .bind(vehicle_id)
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn link_place(pool: &PgPool, owner_id: Uuid, session_id: Uuid) -> Result<()> {
    let location = sqlx::query_as::<_, (Option<f64>, Option<f64>)>(
        r#"SELECT location_lat, location_lng
           FROM riviamigo.charge_sessions
           WHERE id = $1 AND geofence_id IS NULL AND location_override_mode = 'automatic'"#,
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?;
    let Some((Some(lat), Some(lng))) = location else {
        return Ok(());
    };
    let Some(place) = match_geofence(pool, owner_id, lat, lng).await? else {
        return Ok(());
    };
    sqlx::query(
        r#"UPDATE riviamigo.charge_sessions
           SET geofence_id = COALESCE(geofence_id, $2),
               address_id = COALESCE(address_id, $3),
               is_home = COALESCE(is_home, $4)
           WHERE id = $1"#,
    )
    .bind(session_id)
    .bind(place.id)
    .bind(place.address_id)
    .bind(place.is_home)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(hour: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 12, hour, 0, 0)
            .single()
            .unwrap()
    }

    fn window() -> ChargeWindow {
        ChargeWindow {
            started_at: at(3),
            ended_at: at(11),
            location_lat: None,
            location_lng: None,
            soc_start: Some(16.0),
            soc_end: Some(100.0),
            charge_limit: None,
            max_charge_rate_kw: Some(11.0),
            energy_added_wh: Some(93_000.0),
        }
    }

    fn session(started_hour: u32, ended_hour: Option<u32>, source: &str) -> OverlappingSession {
        OverlappingSession {
            id: Uuid::new_v4(),
            started_at: at(started_hour),
            ended_at: ended_hour.map(at),
            source: Some(source.into()),
        }
    }

    #[test]
    fn an_unrecorded_window_becomes_a_session() {
        assert_eq!(classify(&window(), &[]), WindowAction::Insert);
    }

    #[test]
    fn an_open_session_that_started_in_the_window_is_closed() {
        let open = session(4, None, "telemetry");
        assert_eq!(
            classify(&window(), std::slice::from_ref(&open)),
            WindowAction::Close(open.id)
        );
    }

    #[test]
    fn finished_sessions_are_never_rewritten() {
        assert_eq!(
            classify(&window(), &[session(3, Some(11), "telemetry")]),
            WindowAction::Skip
        );
        assert_eq!(
            classify(&window(), &[session(3, Some(5), "rivian_api")]),
            WindowAction::Skip
        );
    }

    #[test]
    fn ambiguous_or_foreign_overlaps_are_skipped() {
        // Two sessions: closing or merging either could lose data.
        let both = [
            session(4, None, "telemetry"),
            session(8, Some(10), "telemetry"),
        ];
        assert_eq!(classify(&window(), &both), WindowAction::Skip);
        // Open Rivian API sessions are owned by the API backfill.
        assert_eq!(
            classify(&window(), &[session(4, None, "rivian_api")]),
            WindowAction::Skip
        );
        // A session stuck open since long before this window is not this charge.
        let stale = OverlappingSession {
            started_at: at(3) - Duration::days(2),
            ..session(3, None, "telemetry")
        };
        assert_eq!(classify(&window(), &[stale]), WindowAction::Skip);
    }

    #[test]
    fn charger_type_follows_the_rate() {
        assert_eq!(charger_type(Some(11.0), None), Some("ac"));
        assert_eq!(charger_type(Some(19.2), None), Some("ac_l2"));
        assert_eq!(charger_type(None, Some(150.0)), Some("dc"));
        assert_eq!(charger_type(None, None), None);
    }
}
