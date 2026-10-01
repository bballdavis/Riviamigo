//! Owner-started ingestion captures.
//!
//! A capture records what the ingestion pipeline saw and decided for one
//! vehicle, so an owner can download one shareable file instead of reading
//! host logs. Each vehicle keeps only its most recent capture: starting a new
//! one replaces the previous capture's events.
//!
//! Recording is fire-and-forget. Hot paths check an in-memory registry and
//! hand records to one batch writer through a bounded channel, so ingestion
//! never waits on capture storage. Records never contain coordinates,
//! credentials, VINs, or the vehicle id.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, OnceLock, RwLock,
    },
    time::Duration,
};

use chrono::{DateTime, Utc};
use serde_json::{Map, Value};
use sqlx::PgPool;
use tokio::sync::mpsc;
use uuid::Uuid;

/// Captures stop on their own after this long.
pub const CAPTURE_DURATION: chrono::Duration = chrono::Duration::hours(1);
/// Finished captures are purged after this long.
pub const CAPTURE_RETENTION: chrono::Duration = chrono::Duration::hours(24);
/// Hard ceiling on stored events per capture.
pub const MAX_EVENTS_PER_CAPTURE: u64 = 50_000;
/// Version of the downloadable file format.
pub const FORMAT_VERSION: u32 = 1;

const CHANNEL_CAPACITY: usize = 4096;
const BATCH_ROWS: usize = 200;
const FLUSH_INTERVAL: Duration = Duration::from_secs(1);
const EXPIRY_INTERVAL: Duration = Duration::from_secs(15);
const PURGE_INTERVAL: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    ParallaxEnvelope,
    ParallaxConnection,
    LegacyFrame,
    LegacyConnection,
    Ingestion,
    Trip,
    Poll,
    CaptureStarted,
    CaptureStopped,
    Truncated,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ParallaxEnvelope => "parallax_envelope",
            Self::ParallaxConnection => "parallax_connection",
            Self::LegacyFrame => "legacy_frame",
            Self::LegacyConnection => "legacy_connection",
            Self::Ingestion => "ingestion",
            Self::Trip => "trip",
            Self::Poll => "poll",
            Self::CaptureStarted => "capture_started",
            Self::CaptureStopped => "capture_stopped",
            Self::Truncated => "truncated",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    User,
    Expired,
}

impl StopReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Expired => "expired",
        }
    }
}

#[derive(Debug)]
struct Record {
    vehicle_id: Uuid,
    capture_id: Uuid,
    recorded_at: DateTime<Utc>,
    kind: Kind,
    fields: Value,
}

#[derive(Debug, Clone)]
struct Window {
    capture_id: Uuid,
    ends_at: DateTime<Utc>,
    dropped: Arc<AtomicU64>,
}

struct Capture {
    windows: RwLock<HashMap<Uuid, Window>>,
    tx: mpsc::Sender<Record>,
}

static CAPTURE: OnceLock<Capture> = OnceLock::new();

fn active_window(vehicle_id: Uuid, now: DateTime<Utc>) -> Option<Window> {
    let capture = CAPTURE.get()?;
    let windows = capture.windows.read().ok()?;
    windows
        .get(&vehicle_id)
        .filter(|window| window.ends_at > now)
        .cloned()
}

/// Whether a capture is running for this vehicle. Cheap enough for hot paths;
/// callers use it to skip building records nobody will store.
pub fn is_capturing(vehicle_id: Uuid) -> bool {
    active_window(vehicle_id, Utc::now()).is_some()
}

/// Record one capture event. A no-op when no capture is running (or the
/// service was never started, as in tests and CLI binaries). Never blocks:
/// a full channel drops the record and counts it.
pub fn record(vehicle_id: Uuid, kind: Kind, fields: Value) {
    let now = Utc::now();
    let Some(window) = active_window(vehicle_id, now) else {
        return;
    };
    let Some(capture) = CAPTURE.get() else {
        return;
    };
    let record = Record {
        vehicle_id,
        capture_id: window.capture_id,
        recorded_at: now,
        kind,
        fields: sanitize(fields),
    };
    if capture.tx.try_send(record).is_err() {
        window.dropped.fetch_add(1, Ordering::Relaxed);
    }
}

/// Keys that must never appear in a capture, at any depth.
const FORBIDDEN_KEYS: &[&str] = &[
    "vehicle_id",
    "vin",
    "latitude",
    "longitude",
    "lat",
    "lng",
    "lon",
    "altitude_m",
    "gnssLocation",
    "location",
    "name",
    "email",
    "token",
    "u-sess",
    "a-sess",
    "csrf",
    "password",
    "authorization",
];

fn is_forbidden_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    FORBIDDEN_KEYS
        .iter()
        .any(|forbidden| lower == forbidden.to_ascii_lowercase())
        || ["token", "secret", "password", "csrf"]
            .iter()
            .any(|needle| lower.contains(needle))
}

/// Remove identifying and location keys at any depth. Call sites already
/// avoid them; this is the backstop that keeps the file shareable.
pub fn sanitize(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter(|(key, _)| !is_forbidden_key(key))
                .map(|(key, value)| (key, sanitize(value)))
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(sanitize).collect()),
        other => other,
    }
}

/// Non-null fields of a serialized value, without identity or location.
pub fn present_fields<T: serde::Serialize>(value: &T) -> Value {
    match serde_json::to_value(value) {
        Ok(Value::Object(map)) => sanitize(Value::Object(
            map.into_iter()
                .filter(|(_, value)| !value.is_null())
                .collect::<Map<_, _>>(),
        )),
        _ => Value::Null,
    }
}

/// Start the batch writer, expiry, and purge tasks, and restore any capture
/// that was running when the process stopped.
pub async fn init(pool: PgPool) -> anyhow::Result<()> {
    let (tx, rx) = mpsc::channel(CHANNEL_CAPACITY);
    let capture = Capture {
        windows: RwLock::new(HashMap::new()),
        tx,
    };
    if CAPTURE.set(capture).is_err() {
        anyhow::bail!("ingestion capture service already initialised");
    }

    sqlx::query(
        "UPDATE riviamigo.vehicle_ingestion_diagnostics \
         SET stopped_at = enabled_until, stop_reason = 'expired', updated_at = now() \
         WHERE stopped_at IS NULL AND enabled_until <= now()",
    )
    .execute(&pool)
    .await?;
    let open = sqlx::query_as::<_, (Uuid, Uuid, DateTime<Utc>)>(
        "SELECT vehicle_id, capture_id, enabled_until FROM riviamigo.vehicle_ingestion_diagnostics \
         WHERE stopped_at IS NULL",
    )
    .fetch_all(&pool)
    .await?;
    for (vehicle_id, capture_id, ends_at) in open {
        register(vehicle_id, capture_id, ends_at);
    }

    tokio::spawn(run_writer(pool.clone(), rx));
    tokio::spawn(run_expiry(pool.clone()));
    tokio::spawn(run_purge(pool));
    Ok(())
}

fn register(vehicle_id: Uuid, capture_id: Uuid, ends_at: DateTime<Utc>) {
    if let Some(capture) = CAPTURE.get() {
        if let Ok(mut windows) = capture.windows.write() {
            windows.insert(
                vehicle_id,
                Window {
                    capture_id,
                    ends_at,
                    dropped: Arc::new(AtomicU64::new(0)),
                },
            );
        }
    }
}

fn unregister(vehicle_id: Uuid) -> Option<Window> {
    CAPTURE
        .get()
        .and_then(|capture| capture.windows.write().ok()?.remove(&vehicle_id))
}

/// Start a new capture, replacing the vehicle's previous one.
pub async fn start(pool: &PgPool, vehicle_id: Uuid, user_id: Uuid) -> anyhow::Result<()> {
    unregister(vehicle_id);
    let capture_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM riviamigo.vehicle_ingestion_capture_events WHERE vehicle_id = $1")
        .bind(vehicle_id)
        .execute(&mut *tx)
        .await?;
    let (started_at, ends_at) = sqlx::query_as::<_, (DateTime<Utc>, DateTime<Utc>)>(
        "INSERT INTO riviamigo.vehicle_ingestion_diagnostics \
             (vehicle_id, capture_id, started_at, enabled_until, enabled_by, stopped_at, stop_reason, dropped_events) \
         VALUES ($1, $2, now(), now() + $3::interval, $4, NULL, NULL, 0) \
         ON CONFLICT (vehicle_id) DO UPDATE SET \
             capture_id = EXCLUDED.capture_id, started_at = EXCLUDED.started_at, \
             enabled_until = EXCLUDED.enabled_until, enabled_by = EXCLUDED.enabled_by, \
             stopped_at = NULL, stop_reason = NULL, dropped_events = 0, updated_at = now() \
         RETURNING started_at, enabled_until",
    )
    .bind(vehicle_id)
    .bind(capture_id)
    .bind(CAPTURE_DURATION)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    insert_marker(
        &mut *tx,
        vehicle_id,
        capture_id,
        started_at,
        Kind::CaptureStarted,
        serde_json::json!({ "ends_at": ends_at }),
    )
    .await?;
    tx.commit().await?;
    register(vehicle_id, capture_id, ends_at);
    Ok(())
}

/// Stop the running capture, keeping its events for download. Returns false
/// when no capture was running.
pub async fn stop(pool: &PgPool, vehicle_id: Uuid, reason: StopReason) -> anyhow::Result<bool> {
    let window = unregister(vehicle_id);
    let dropped = window
        .as_ref()
        .map_or(0, |window| window.dropped.load(Ordering::Relaxed));
    let stopped = sqlx::query_as::<_, (Uuid, DateTime<Utc>)>(
        "UPDATE riviamigo.vehicle_ingestion_diagnostics \
         SET stopped_at = LEAST(now(), enabled_until), stop_reason = $2, \
             dropped_events = dropped_events + $3, updated_at = now() \
         WHERE vehicle_id = $1 AND stopped_at IS NULL \
         RETURNING capture_id, stopped_at",
    )
    .bind(vehicle_id)
    .bind(reason.as_str())
    .bind(i64::try_from(dropped).unwrap_or(i64::MAX))
    .fetch_optional(pool)
    .await?;
    let Some((capture_id, stopped_at)) = stopped else {
        return Ok(false);
    };
    insert_marker(
        pool,
        vehicle_id,
        capture_id,
        stopped_at,
        Kind::CaptureStopped,
        serde_json::json!({ "reason": reason.as_str(), "dropped_events": dropped }),
    )
    .await?;
    Ok(true)
}

async fn insert_marker<'e, E>(
    executor: E,
    vehicle_id: Uuid,
    capture_id: Uuid,
    recorded_at: DateTime<Utc>,
    kind: Kind,
    fields: Value,
) -> sqlx::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_ingestion_capture_events \
             (vehicle_id, capture_id, recorded_at, kind, fields) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(vehicle_id)
    .bind(capture_id)
    .bind(recorded_at)
    .bind(kind.as_str())
    .bind(fields)
    .execute(executor)
    .await?;
    Ok(())
}

/// Per-capture stored-row accounting for the writer.
#[derive(Debug, Default)]
struct CapLedger {
    counts: HashMap<Uuid, (u64, bool)>,
}

enum Admit {
    Store,
    /// Store a single truncation marker instead of this record.
    Truncate,
    Drop,
}

impl CapLedger {
    fn is_known(&self, capture_id: Uuid) -> bool {
        self.counts.contains_key(&capture_id)
    }

    fn seed(&mut self, capture_id: Uuid, stored: u64) {
        self.counts.entry(capture_id).or_insert((stored, false));
    }

    fn admit(&mut self, capture_id: Uuid, cap: u64) -> Admit {
        let (count, truncated) = self.counts.entry(capture_id).or_insert((0, false));
        if *count < cap {
            *count += 1;
            Admit::Store
        } else if !*truncated {
            *truncated = true;
            Admit::Truncate
        } else {
            Admit::Drop
        }
    }
}

async fn run_writer(pool: PgPool, mut rx: mpsc::Receiver<Record>) {
    let mut ledger = CapLedger::default();
    let mut batch = Vec::with_capacity(BATCH_ROWS);
    let mut flush = tokio::time::interval(FLUSH_INTERVAL);
    flush.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            record = rx.recv() => {
                let Some(record) = record else { break };
                batch.push(record);
                if batch.len() < BATCH_ROWS {
                    continue;
                }
            }
            _ = flush.tick() => {
                if batch.is_empty() {
                    continue;
                }
            }
        }
        let records = std::mem::take(&mut batch);
        if let Err(error) = write_batch(&pool, &mut ledger, records).await {
            tracing::warn!(err = %error, "ingestion capture batch write failed");
        }
    }
}

async fn write_batch(
    pool: &PgPool,
    ledger: &mut CapLedger,
    records: Vec<Record>,
) -> anyhow::Result<()> {
    for record in &records {
        if !ledger.is_known(record.capture_id) {
            let stored = sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM riviamigo.vehicle_ingestion_capture_events WHERE capture_id = $1",
            )
            .bind(record.capture_id)
            .fetch_one(pool)
            .await?;
            ledger.seed(record.capture_id, u64::try_from(stored).unwrap_or(0));
        }
    }

    let mut vehicle_ids = Vec::with_capacity(records.len());
    let mut capture_ids = Vec::with_capacity(records.len());
    let mut recorded_ats = Vec::with_capacity(records.len());
    let mut kinds = Vec::with_capacity(records.len());
    let mut fields = Vec::with_capacity(records.len());
    for record in records {
        let (kind, value) = match ledger.admit(record.capture_id, MAX_EVENTS_PER_CAPTURE) {
            Admit::Store => (record.kind, record.fields),
            Admit::Truncate => (
                Kind::Truncated,
                serde_json::json!({ "max_events": MAX_EVENTS_PER_CAPTURE }),
            ),
            Admit::Drop => continue,
        };
        vehicle_ids.push(record.vehicle_id);
        capture_ids.push(record.capture_id);
        recorded_ats.push(record.recorded_at);
        kinds.push(kind.as_str().to_owned());
        fields.push(value);
    }
    if vehicle_ids.is_empty() {
        return Ok(());
    }
    // Joining the current capture row drops records that were queued for a
    // capture that has since been replaced.
    sqlx::query(
        "INSERT INTO riviamigo.vehicle_ingestion_capture_events \
             (vehicle_id, capture_id, recorded_at, kind, fields) \
         SELECT r.vehicle_id, r.capture_id, r.recorded_at, r.kind, r.fields \
         FROM unnest($1::uuid[], $2::uuid[], $3::timestamptz[], $4::text[], $5::jsonb[]) \
              AS r(vehicle_id, capture_id, recorded_at, kind, fields) \
         JOIN riviamigo.vehicle_ingestion_diagnostics d \
           ON d.vehicle_id = r.vehicle_id AND d.capture_id = r.capture_id",
    )
    .bind(vehicle_ids)
    .bind(capture_ids)
    .bind(recorded_ats)
    .bind(kinds)
    .bind(fields)
    .execute(pool)
    .await?;
    Ok(())
}

async fn run_expiry(pool: PgPool) {
    let mut interval = tokio::time::interval(EXPIRY_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let now = Utc::now();
        let expired: Vec<Uuid> = CAPTURE
            .get()
            .and_then(|capture| capture.windows.read().ok())
            .map(|windows| {
                windows
                    .iter()
                    .filter(|(_, window)| window.ends_at <= now)
                    .map(|(vehicle_id, _)| *vehicle_id)
                    .collect()
            })
            .unwrap_or_default();
        for vehicle_id in expired {
            if let Err(error) = stop(&pool, vehicle_id, StopReason::Expired).await {
                tracing::warn!(vehicle_id = %vehicle_id, err = %error, "ingestion capture expiry failed");
            }
        }
    }
}

async fn run_purge(pool: PgPool) {
    let mut interval = tokio::time::interval(PURGE_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let result = sqlx::query(
            "WITH purged AS ( \
                 DELETE FROM riviamigo.vehicle_ingestion_diagnostics \
                 WHERE stopped_at IS NOT NULL AND stopped_at < now() - $1::interval \
                 RETURNING vehicle_id) \
             DELETE FROM riviamigo.vehicle_ingestion_capture_events e \
             USING purged WHERE e.vehicle_id = purged.vehicle_id",
        )
        .bind(CAPTURE_RETENTION)
        .execute(&pool)
        .await;
        match result {
            Ok(done) if done.rows_affected() > 0 => {
                tracing::info!(
                    removed = done.rows_affected(),
                    "expired ingestion capture events purged"
                )
            }
            Ok(_) => {}
            Err(error) => tracing::warn!(err = %error, "ingestion capture purge failed"),
        }
    }
}

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
struct CaptureRow {
    capture_id: Uuid,
    started_at: DateTime<Utc>,
    enabled_until: DateTime<Utc>,
    stopped_at: Option<DateTime<Utc>>,
    stop_reason: Option<String>,
    dropped_events: i64,
}

async fn load_row(pool: &PgPool, vehicle_id: Uuid) -> sqlx::Result<Option<CaptureRow>> {
    sqlx::query_as::<_, CaptureRow>(
        "SELECT capture_id, started_at, enabled_until, stopped_at, stop_reason, dropped_events \
         FROM riviamigo.vehicle_ingestion_diagnostics WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await
}

struct EventStats {
    count: i64,
    last_event_at: Option<DateTime<Utc>>,
    truncated: bool,
}

async fn event_stats(pool: &PgPool, capture_id: Uuid) -> sqlx::Result<EventStats> {
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

/// A finished or running capture, ready to stream as NDJSON.
pub struct Export {
    pub header: Value,
    pub filename: String,
    pub capture_id: Uuid,
}

/// Build the export header for the vehicle's latest capture, or `None` when
/// there is nothing to download.
pub async fn export(pool: &PgPool, vehicle_id: Uuid) -> sqlx::Result<Option<Export>> {
    let Some(row) = load_row(pool, vehicle_id).await? else {
        return Ok(None);
    };
    let stats = event_stats(pool, row.capture_id).await?;
    let counts = sqlx::query_as::<_, (String, i64)>(
        "SELECT kind, count(*) FROM riviamigo.vehicle_ingestion_capture_events \
         WHERE capture_id = $1 GROUP BY kind ORDER BY kind",
    )
    .bind(row.capture_id)
    .fetch_all(pool)
    .await?;
    let model = sqlx::query_scalar::<_, Option<String>>(
        "SELECT model FROM riviamigo.vehicles WHERE id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?
    .flatten();
    let running = row.stopped_at.is_none() && row.enabled_until > Utc::now();
    let header = build_header(
        model.as_deref(),
        row.started_at,
        (!running).then(|| row.stopped_at.unwrap_or(row.enabled_until)),
        row.stop_reason.as_deref(),
        &counts,
        stats.count,
        row.dropped_events,
        stats.truncated,
    );
    Ok(Some(Export {
        filename: export_filename(model.as_deref(), row.started_at),
        header,
        capture_id: row.capture_id,
    }))
}

/// One page of exported rows, in capture order, without the vehicle id.
pub async fn export_rows(
    pool: &PgPool,
    capture_id: Uuid,
    after_id: i64,
    limit: i64,
) -> sqlx::Result<Vec<(i64, Value)>> {
    let rows = sqlx::query_as::<_, (i64, DateTime<Utc>, String, Value)>(
        "SELECT id, recorded_at, kind, fields FROM riviamigo.vehicle_ingestion_capture_events \
         WHERE capture_id = $1 AND id > $2 ORDER BY id LIMIT $3",
    )
    .bind(capture_id)
    .bind(after_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, recorded_at, kind, fields)| (id, export_line(recorded_at, &kind, fields)))
        .collect())
}

fn export_line(recorded_at: DateTime<Utc>, kind: &str, fields: Value) -> Value {
    serde_json::json!({
        "recorded_at": recorded_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "kind": kind,
        "fields": sanitize(fields),
    })
}

pub fn export_filename(model: Option<&str>, started_at: DateTime<Utc>) -> String {
    let model: String = model
        .unwrap_or("vehicle")
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_lowercase();
    let model = if model.is_empty() {
        "vehicle".to_owned()
    } else {
        model
    };
    format!(
        "riviamigo-capture-{model}-{}.jsonl",
        started_at.format("%Y%m%dT%H%MZ")
    )
}

#[allow(clippy::too_many_arguments)] // Header fields are independent capture facts.
fn build_header(
    model: Option<&str>,
    started_at: DateTime<Utc>,
    stopped_at: Option<DateTime<Utc>>,
    stop_reason: Option<&str>,
    counts_by_kind: &[(String, i64)],
    event_count: i64,
    dropped_events: i64,
    truncated: bool,
) -> Value {
    let counts: Map<String, Value> = counts_by_kind
        .iter()
        .map(|(kind, count)| (kind.clone(), Value::from(*count)))
        .collect();
    serde_json::json!({
        "kind": "header",
        "format_version": FORMAT_VERSION,
        "app_version": std::env::var("RIVIAMIGO_BUILD_VERSION")
            .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").into()),
        "model": model,
        "started_at": started_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "stopped_at": stopped_at.map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        "stop_reason": stop_reason,
        "event_count": event_count,
        "counts_by_kind": counts,
        "dropped_events": dropped_events,
        "truncated": truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn record_is_a_noop_without_a_running_capture() {
        // The service is never initialised in unit tests.
        let vehicle_id = Uuid::new_v4();
        assert!(!is_capturing(vehicle_id));
        record(vehicle_id, Kind::Ingestion, json!({ "source": "legacy" }));
        assert!(!is_capturing(vehicle_id));
    }

    #[test]
    fn cap_admits_up_to_the_limit_then_one_truncation_marker() {
        let mut ledger = CapLedger::default();
        let capture = Uuid::new_v4();
        ledger.seed(capture, 1);
        assert!(matches!(ledger.admit(capture, 3), Admit::Store));
        assert!(matches!(ledger.admit(capture, 3), Admit::Store));
        assert!(matches!(ledger.admit(capture, 3), Admit::Truncate));
        assert!(matches!(ledger.admit(capture, 3), Admit::Drop));
        assert!(matches!(ledger.admit(capture, 3), Admit::Drop));
        // Another capture has its own budget.
        assert!(matches!(ledger.admit(Uuid::new_v4(), 3), Admit::Store));
    }

    #[test]
    fn sanitize_strips_identity_location_and_credentials_at_any_depth() {
        let cleaned = sanitize(json!({
            "vehicle_id": "x",
            "topic": "body.closures.states",
            "decoded": {
                "latitude": 1.0,
                "longitude": 2.0,
                "speed_mph": 3.0,
                "door_front_left_closed": false,
            },
            "fields": { "gnssLocation": { "latitude": 1.0 }, "doorFrontLeftClosed": { "value": "open" } },
            "headers": { "U-Sess": "secret", "csrfToken": "t", "appSessionToken": "t" },
            "entries": [{ "vin": "7PD", "position": 1 }],
        }));
        assert_eq!(
            cleaned,
            json!({
                "topic": "body.closures.states",
                "decoded": { "speed_mph": 3.0, "door_front_left_closed": false },
                "fields": { "doorFrontLeftClosed": { "value": "open" } },
                "headers": {},
                "entries": [{ "position": 1 }],
            })
        );
    }

    #[test]
    fn export_lines_omit_vehicle_id_and_coordinates() {
        let line = export_line(
            "2026-09-30T21:10:47.988Z".parse().unwrap(),
            "parallax_envelope",
            json!({ "vehicle_id": "x", "decoded": { "latitude": 1.0, "speed_mph": 0.0 } }),
        );
        assert_eq!(
            line,
            json!({
                "recorded_at": "2026-09-30T21:10:47.988Z",
                "kind": "parallax_envelope",
                "fields": { "decoded": { "speed_mph": 0.0 } },
            })
        );
    }

    #[test]
    fn present_fields_drops_nulls_and_identity() {
        #[derive(serde::Serialize)]
        struct Sample {
            vehicle_id: Uuid,
            latitude: Option<f64>,
            speed_mph: Option<f64>,
            power_state: Option<&'static str>,
        }
        let value = present_fields(&Sample {
            vehicle_id: Uuid::nil(),
            latitude: Some(1.0),
            speed_mph: None,
            power_state: Some("ready"),
        });
        assert_eq!(value, json!({ "power_state": "ready" }));
    }

    #[test]
    fn header_is_shareable_and_complete() {
        let header = build_header(
            Some("R1S"),
            "2026-09-30T21:10:00Z".parse().unwrap(),
            Some("2026-09-30T21:25:00Z".parse().unwrap()),
            Some("user"),
            &[
                ("legacy_frame".into(), 12),
                ("parallax_envelope".into(), 30),
            ],
            42,
            0,
            false,
        );
        assert_eq!(header["kind"], "header");
        assert_eq!(header["format_version"], FORMAT_VERSION);
        assert_eq!(header["model"], "R1S");
        assert_eq!(header["stopped_at"], "2026-09-30T21:25:00.000Z");
        assert_eq!(header["counts_by_kind"]["parallax_envelope"], 30);
        assert_eq!(header["event_count"], 42);
        let keys: Vec<&str> = header
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert!(!keys
            .iter()
            .any(|key| key.contains("vehicle") || *key == "vin" || *key == "name"));
    }

    #[test]
    fn filename_uses_model_and_start_time() {
        assert_eq!(
            export_filename(Some("R1S"), "2026-09-30T21:10:12Z".parse().unwrap()),
            "riviamigo-capture-r1s-20260930T2110Z.jsonl"
        );
        assert_eq!(
            export_filename(None, "2026-09-30T21:10:12Z".parse().unwrap()),
            "riviamigo-capture-vehicle-20260930T2110Z.jsonl"
        );
    }
}
