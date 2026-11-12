//! Live charging-session data from the WebSocket `chargingSession`
//! subscription: the Redis live-session contract and its persistence into the
//! active canonical charge session.

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

/// Serialized to Redis and served by GET /v1/vehicles/:id/live-session.
/// Field names must match the frontend LiveSession TypeScript interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveSessionData {
    pub soc_pct: Option<f64>,
    pub power_kw: Option<f64>,
    pub energy_kwh: Option<f64>,
    pub range_added_km: Option<f64>,
    pub time_remaining_min: Option<f64>,
    pub charger_type: Option<String>,
    pub ts: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charge_rate_kph: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_elapsed_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_free_session: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_charger_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
}

pub(crate) const LIVE_SESSION_TTL_SECONDS: u64 = 120;

pub(crate) fn live_session_redis_key(vehicle_id: Uuid) -> String {
    format!("vehicle:{vehicle_id}:live_session")
}

/// Convert the documented `chargingSession` payload into the existing live
/// Redis contract. `timeRemaining` and `timeElapsed` are seconds in Rivian's
/// charging payload; the public live-session field remains minutes.
pub fn normalize_charging_session(
    event: &crate::ingestion::parser::ChargingSessionEvent,
    received_at: DateTime<Utc>,
) -> Option<LiveSessionData> {
    let live = event.live_data.as_ref()?;
    let has_live_value = live.power_kw.is_some()
        || live.kilometers_charged_per_hour.is_some()
        || live.range_added_this_session.is_some()
        || live.total_charged_energy.is_some()
        || live.time_elapsed_seconds.is_some()
        || live.time_remaining_seconds.is_some()
        || live.price.is_some()
        || live.currency.is_some()
        || live.is_free_session.is_some()
        || live.vehicle_charger_state.is_some()
        || live.start_time.is_some();
    let has_chart_value = event.chart_data.iter().any(|point| {
        point.soc.is_some()
            || point.power_kw.is_some()
            || point.start_time.is_some()
            || point.end_time.is_some()
            || point.time_estimation_validity_status.is_some()
            || point.vehicle_charger_state.is_some()
    });
    if !has_live_value && !has_chart_value {
        return None;
    }
    Some(LiveSessionData {
        soc_pct: event.chart_data.iter().rev().find_map(|point| point.soc),
        power_kw: live.power_kw,
        energy_kwh: live.total_charged_energy,
        range_added_km: live.range_added_this_session,
        time_remaining_min: live.time_remaining_seconds.map(|seconds| seconds / 60.0),
        charger_type: live.vehicle_charger_state.clone(),
        ts: received_at,
        charge_rate_kph: live.kilometers_charged_per_hour,
        time_elapsed_seconds: live.time_elapsed_seconds,
        price: live.price,
        currency: live.currency.clone(),
        is_free_session: live.is_free_session,
        vehicle_charger_state: live.vehicle_charger_state.clone(),
        started_at: live.start_time,
    })
}

/// Persist the fields that belong to the active canonical charge session.
/// The WebSocket worker owns when this is called; this helper owns the SQL
/// shape so HTTP history and live-stream enrichment share one seam.
pub async fn persist_live_session_data(
    pool: &PgPool,
    active_session_id: Option<Uuid>,
    live: &LiveSessionData,
) -> Result<()> {
    let Some(session_id) = active_session_id else {
        return Ok(());
    };

    sqlx::query(
        "UPDATE riviamigo.charge_sessions SET
             live_current_price       = COALESCE($2, live_current_price),
             live_current_currency    = COALESCE($3, live_current_currency),
             live_total_charged_kwh   = COALESCE($4, live_total_charged_kwh),
             live_range_added_km      = COALESCE($5, live_range_added_km),
             live_power_kw            = COALESCE($6, live_power_kw),
             live_charge_rate_kph     = COALESCE($7, live_charge_rate_kph),
             live_time_elapsed_seconds = COALESCE($8, live_time_elapsed_seconds),
             live_session_started_at  = COALESCE($9, live_session_started_at),
             live_time_remaining_minutes = COALESCE($11, live_time_remaining_minutes),
             is_free_session          = COALESCE($10, is_free_session),
             kwh_added                = COALESCE($4, kwh_added),
             range_added_km           = COALESCE($5, range_added_km),
             max_charge_rate_kw      = CASE WHEN $6 IS NOT NULL
                                            THEN GREATEST(COALESCE(max_charge_rate_kw, 0), $6)
                                            ELSE max_charge_rate_kw END,
             duration_minutes        = COALESCE($12, duration_minutes),
             source = CASE WHEN source = 'rivian_api'
                           THEN 'telemetry+rivian_api'
                           ELSE COALESCE(source, 'telemetry') END,
             data_confidence = CASE WHEN source = 'rivian_api'
                                    THEN 'telemetry_enriched'
                                    ELSE COALESCE(data_confidence, 'telemetry') END
         WHERE id = $1 AND ended_at IS NULL",
    )
    .bind(session_id)
    .bind(live.price)
    .bind(&live.currency)
    .bind(live.energy_kwh)
    .bind(live.range_added_km)
    .bind(live.power_kw)
    .bind(live.charge_rate_kph)
    .bind(
        live.time_elapsed_seconds
            .map(|seconds| seconds.round() as i32),
    )
    .bind(live.started_at)
    .bind(live.is_free_session)
    .bind(
        live.time_remaining_min
            .map(|minutes| minutes.round() as i32),
    )
    .bind(
        live.time_elapsed_seconds
            .map(|seconds| (seconds / 60.0).round() as i32),
    )
    .execute(pool)
    .await?;

    // Do not compute a final billing amount while the session is open.  The
    // live price is retained above for an estimate; final cost is recomputed
    // by the canonical session-finalization path once ended_at is known.
    Ok(())
}

/// Persist chart power points emitted by `chargingSession`. The existing
/// curve table deliberately stores only observed power; absent or malformed
/// timestamps are ignored instead of inventing samples.
pub async fn persist_charging_session_chart(
    pool: &PgPool,
    vehicle_id: Uuid,
    active_session_id: Option<Uuid>,
    points: &[crate::ingestion::parser::ChargingSessionChartPoint],
) -> Result<usize> {
    let selected = points
        .iter()
        .filter_map(|point| point.start_time.map(|ts| (ts, point.power_kw)))
        .collect::<Vec<_>>();
    if selected.is_empty() {
        return Ok(0);
    }

    let timestamps = selected.iter().map(|(ts, _)| *ts).collect::<Vec<_>>();
    let power = selected.iter().map(|(_, power)| *power).collect::<Vec<_>>();
    let actions = sqlx::query_scalar::<_, bool>(
        r#"INSERT INTO riviamigo.rivian_charge_curve_points
               (vehicle_id, charge_session_id, ts, power_kw)
           SELECT $1, $2, incoming.ts, incoming.power_kw
           FROM unnest($3::timestamptz[], $4::double precision[])
               AS incoming(ts, power_kw)
           ON CONFLICT (vehicle_id, ts)
           DO UPDATE SET
               charge_session_id = COALESCE(
                   rivian_charge_curve_points.charge_session_id,
                   EXCLUDED.charge_session_id
               ),
               power_kw = COALESCE(
                   EXCLUDED.power_kw,
                   rivian_charge_curve_points.power_kw
               )
           WHERE rivian_charge_curve_points.charge_session_id IS DISTINCT FROM
                     COALESCE(
                         rivian_charge_curve_points.charge_session_id,
                         EXCLUDED.charge_session_id
                     )
              OR rivian_charge_curve_points.power_kw IS DISTINCT FROM
                     COALESCE(
                         EXCLUDED.power_kw,
                         rivian_charge_curve_points.power_kw
                     )
           RETURNING xmax = 0"#,
    )
    .bind(vehicle_id)
    .bind(active_session_id)
    .bind(&timestamps)
    .bind(&power)
    .fetch_all(pool)
    .await?;
    Ok(actions.len())
}
