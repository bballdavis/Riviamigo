//! Loads one session's curve inputs from the database.

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    build_charge_curve, CurveInputs, CurvePoint, EnergySample, GraphPoint, GraphSource,
    PowerSample, SocSample, ESTIMATE_MAX_HALF_SECONDS, MEASURED_HOLD_SECONDS,
};

/// Load one session's inputs and build its curve.
#[allow(clippy::too_many_arguments)]
pub async fn load_charge_curve(
    pool: &PgPool,
    vehicle_id: Uuid,
    session_id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    is_dc: bool,
    soc_bounds: Option<(f64, f64)>,
    bucket_seconds: i64,
) -> Result<Vec<CurvePoint>> {
    // Open sessions run to now; completed sessions keep their recorded end.
    let ended_at = ended_at.unwrap_or_else(Utc::now);

    let default_capacity_wh = sqlx::query_scalar::<_, Option<f64>>(
        r#"SELECT COALESCE(
               (SELECT battery_capacity_wh FROM riviamigo.vehicles
                WHERE id = $1 AND battery_capacity_wh IS NOT NULL LIMIT 1),
               (SELECT max(battery_capacity_wh) FROM timeseries.telemetry
                WHERE vehicle_id = $1 AND battery_capacity_wh IS NOT NULL))"#,
    )
    .bind(vehicle_id)
    .fetch_one(pool)
    .await?;

    // Telemetry linked to the session, or the vehicle's telemetry in the
    // session window when the link is missing.
    let mut telemetry =
        load_telemetry(pool, vehicle_id, Some(session_id), started_at, ended_at).await?;
    if telemetry.len() < 2 {
        telemetry = load_telemetry(pool, vehicle_id, None, started_at, ended_at).await?;
    }
    let telemetry_soc: Vec<SocSample> = telemetry
        .iter()
        .filter_map(|row| {
            row.soc.map(|soc| SocSample {
                ts: row.ts,
                soc,
                capacity_kwh: row.capacity_wh.map(|wh| wh / 1000.0),
            })
        })
        .collect();
    let telemetry_power: Vec<PowerSample> = telemetry
        .iter()
        .filter_map(|row| {
            row.power_kw.map(|kw| PowerSample {
                ts: row.ts,
                power_kw: kw.abs(),
            })
        })
        .collect();

    // Measured power is read by window, a minute either side so a reading
    // just before a bucket can be held into it.
    let session_power = sqlx::query_as::<_, (DateTime<Utc>, f64)>(
        r#"SELECT source_at, power_kw
           FROM timeseries.parallax_charge_power_samples
           WHERE vehicle_id = $1 AND source_at >= $2 AND source_at <= $3
           ORDER BY source_at"#,
    )
    .bind(vehicle_id)
    .bind(started_at - Duration::seconds(MEASURED_HOLD_SECONDS))
    .bind(ended_at)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(ts, power_kw)| PowerSample { ts, power_kw })
    .collect::<Vec<_>>();

    let breakdown = sqlx::query_as::<_, (DateTime<Utc>, Option<f64>, Option<f64>)>(
        r#"SELECT source_at, total_kwh, power_kw
           FROM timeseries.parallax_charge_breakdown_samples
           WHERE vehicle_id = $1 AND source_at >= $2 AND source_at <= $3
           ORDER BY source_at"#,
    )
    .bind(vehicle_id)
    .bind(started_at - Duration::seconds(ESTIMATE_MAX_HALF_SECONDS))
    .bind(ended_at + Duration::seconds(ESTIMATE_MAX_HALF_SECONDS))
    .fetch_all(pool)
    .await?;
    let breakdown_power: Vec<PowerSample> = breakdown
        .iter()
        .filter(|(ts, _, _)| {
            *ts >= started_at - Duration::seconds(MEASURED_HOLD_SECONDS) && *ts <= ended_at
        })
        .filter_map(|(ts, _, kw)| kw.map(|power_kw| PowerSample { ts: *ts, power_kw }))
        .collect();
    let breakdown_energy: Vec<EnergySample> = breakdown
        .iter()
        .filter_map(|(ts, total, _)| total.map(|total_kwh| EnergySample { ts: *ts, total_kwh }))
        .collect();

    // The two curve stores explicitly associated with the session. A Parallax
    // point wins an exact timestamp collision because it carries battery level;
    // among Parallax segments sharing a timestamp, the one with power wins.
    let graph_points = sqlx::query_as::<_, (DateTime<Utc>, Option<f64>, Option<f64>, bool)>(
        r#"WITH candidates AS (
               SELECT ts, power_kw, NULL::float8 AS soc, false AS parallax, 1 AS precedence
               FROM riviamigo.rivian_charge_curve_points
               WHERE vehicle_id = $1 AND charge_session_id = $2
                 AND power_kw IS NOT NULL
               UNION ALL
               SELECT source_at AS ts, power_kw, soc, true AS parallax, 2 AS precedence
               FROM timeseries.parallax_charge_curve_points
               WHERE vehicle_id = $1 AND charge_session_id = $2
                 AND (power_kw IS NOT NULL OR soc IS NOT NULL)
           )
           SELECT DISTINCT ON (ts) ts, power_kw, soc, parallax
           FROM candidates
           ORDER BY ts, precedence DESC, (power_kw IS NULL), power_kw DESC"#,
    )
    .bind(vehicle_id)
    .bind(session_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(ts, power_kw, soc, parallax)| GraphPoint {
        ts,
        // A point without power is kept: after the last powered point it marks
        // that charging stopped.
        power_kw,
        soc,
        source: if parallax {
            GraphSource::Parallax
        } else {
            GraphSource::RivianApi
        },
    })
    .collect::<Vec<_>>();

    Ok(build_charge_curve(&CurveInputs {
        started_at: Some(started_at),
        ended_at: Some(ended_at),
        is_dc,
        bucket_seconds,
        default_capacity_kwh: default_capacity_wh.map(|wh| wh / 1000.0),
        soc_bounds,
        telemetry_soc: &telemetry_soc,
        telemetry_power: &telemetry_power,
        session_power: &session_power,
        breakdown_power: &breakdown_power,
        breakdown_energy: &breakdown_energy,
        graph_points: &graph_points,
    }))
}

#[derive(Debug, sqlx::FromRow)]
struct TelemetryRow {
    ts: DateTime<Utc>,
    soc: Option<f64>,
    capacity_wh: Option<f64>,
    power_kw: Option<f64>,
}

async fn load_telemetry(
    pool: &PgPool,
    vehicle_id: Uuid,
    session_id: Option<Uuid>,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
) -> Result<Vec<TelemetryRow>> {
    Ok(sqlx::query_as::<_, TelemetryRow>(
        r#"SELECT ts,
                  battery_level AS soc,
                  battery_capacity_wh AS capacity_wh,
                  power_kw
           FROM timeseries.telemetry
           WHERE vehicle_id = $1
             AND ($2::uuid IS NULL OR charge_session_id = $2)
             AND ts >= $3
             AND ts <= $4
             AND (battery_level IS NOT NULL OR power_kw IS NOT NULL)
           ORDER BY ts"#,
    )
    .bind(vehicle_id)
    .bind(session_id)
    .bind(started_at)
    .bind(ended_at)
    .fetch_all(pool)
    .await?)
}
