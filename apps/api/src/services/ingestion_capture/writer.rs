//! Batch writer: drains accepted records, enforces the per-capture event cap,
//! and inserts each batch in one statement.

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use sqlx::PgPool;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::{registry::Record, Kind, CAPTURE_DURATION, MAX_EVENTS_PER_CAPTURE};

const BATCH_ROWS: usize = 200;
const FLUSH_INTERVAL: Duration = Duration::from_secs(1);
/// A capture whose records stopped arriving this long ago is forgotten. A
/// capture runs for at most [`CAPTURE_DURATION`], so this only drops finished
/// ones; a late record re-seeds its count from the database.
const LEDGER_IDLE: Duration =
    Duration::from_secs(CAPTURE_DURATION.num_seconds().unsigned_abs() + 15 * 60);

#[derive(Debug)]
struct CapEntry {
    stored: u64,
    truncated: bool,
    touched: Instant,
}

/// Per-capture stored-row accounting for the writer.
#[derive(Debug, Default)]
pub(super) struct CapLedger {
    counts: HashMap<Uuid, CapEntry>,
}

pub(super) enum Admit {
    Store,
    /// Store a single truncation marker instead of this record.
    Truncate,
    Drop,
}

impl CapLedger {
    fn is_known(&self, capture_id: Uuid) -> bool {
        self.counts.contains_key(&capture_id)
    }

    pub(super) fn seed(&mut self, capture_id: Uuid, stored: u64) {
        self.counts.entry(capture_id).or_insert(CapEntry {
            stored,
            truncated: false,
            touched: Instant::now(),
        });
    }

    pub(super) fn admit(&mut self, capture_id: Uuid, cap: u64) -> Admit {
        let entry = self.counts.entry(capture_id).or_insert(CapEntry {
            stored: 0,
            truncated: false,
            touched: Instant::now(),
        });
        entry.touched = Instant::now();
        if entry.stored < cap {
            entry.stored += 1;
            Admit::Store
        } else if !entry.truncated {
            entry.truncated = true;
            Admit::Truncate
        } else {
            Admit::Drop
        }
    }

    /// Forget captures that have received no records for `idle` by `now`.
    pub(super) fn prune(&mut self, now: Instant, idle: Duration) {
        self.counts
            .retain(|_, entry| now.saturating_duration_since(entry.touched) < idle);
    }

    #[cfg(test)]
    pub(super) fn len(&self) -> usize {
        self.counts.len()
    }
}

pub(super) async fn run_writer(pool: PgPool, mut rx: mpsc::Receiver<Record>) {
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
                    ledger.prune(Instant::now(), LEDGER_IDLE);
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
