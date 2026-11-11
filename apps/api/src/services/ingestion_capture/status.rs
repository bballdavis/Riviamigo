//! Capture status as the Settings page shows it, read from the diagnostics row
//! and the stored event counts.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use super::StopReason;

/// The capture's state as the Settings page shows it.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CaptureStatus {
    pub state: &'static str,
    pub started_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub stopped_at: Option<DateTime<Utc>>,
    pub stop_reason: Option<String>,
    pub event_count: i64,
    pub last_event_at: Option<DateTime<Utc>>,
    pub truncated: bool,
}

#[derive(sqlx::FromRow)]
pub(super) struct CaptureRow {
    pub(super) capture_id: Uuid,
    pub(super) started_at: DateTime<Utc>,
    pub(super) enabled_until: DateTime<Utc>,
    pub(super) stopped_at: Option<DateTime<Utc>>,
    pub(super) stop_reason: Option<String>,
    pub(super) dropped_events: i64,
}

pub(super) async fn load_row(pool: &PgPool, vehicle_id: Uuid) -> sqlx::Result<Option<CaptureRow>> {
    sqlx::query_as::<_, CaptureRow>(
        "SELECT capture_id, started_at, enabled_until, stopped_at, stop_reason, dropped_events \
         FROM riviamigo.vehicle_ingestion_diagnostics WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await
}

pub(super) struct EventStats {
    pub(super) count: i64,
    pub(super) last_event_at: Option<DateTime<Utc>>,
    pub(super) truncated: bool,
}

pub(super) async fn event_stats(pool: &PgPool, capture_id: Uuid) -> sqlx::Result<EventStats> {
    let (count, last_event_at, truncated) =
        sqlx::query_as::<_, (i64, Option<DateTime<Utc>>, bool)>(
            "SELECT count(*) FILTER (WHERE kind NOT IN ('capture_started', 'capture_stopped', 'truncated')), \
                    max(recorded_at), bool_or(kind = 'truncated') IS TRUE \
             FROM riviamigo.vehicle_ingestion_capture_events WHERE capture_id = $1",
        )
        .bind(capture_id)
        .fetch_one(pool)
        .await?;
    Ok(EventStats {
        count,
        last_event_at,
        truncated,
    })
}

pub async fn status(pool: &PgPool, vehicle_id: Uuid) -> sqlx::Result<CaptureStatus> {
    let Some(row) = load_row(pool, vehicle_id).await? else {
        return Ok(CaptureStatus {
            state: "idle",
            started_at: None,
            ends_at: None,
            stopped_at: None,
            stop_reason: None,
            event_count: 0,
            last_event_at: None,
            truncated: false,
        });
    };
    let stats = event_stats(pool, row.capture_id).await?;
    let running = row.stopped_at.is_none() && row.enabled_until > Utc::now();
    Ok(CaptureStatus {
        state: if running { "capturing" } else { "stopped" },
        started_at: Some(row.started_at),
        ends_at: Some(row.enabled_until),
        stopped_at: row.stopped_at.or((!running).then_some(row.enabled_until)),
        stop_reason: row
            .stop_reason
            .or((!running).then(|| StopReason::Expired.as_str().to_owned())),
        event_count: stats.count,
        last_event_at: stats.last_event_at,
        truncated: stats.truncated,
    })
}
