//! Capture export: the header line, the per-capture file name, and paged rows
//! for the streamed NDJSON download.

use chrono::{DateTime, Utc};
use serde_json::{Map, Value};
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    sanitize::sanitize,
    status::{event_stats, load_row},
    FORMAT_VERSION,
};

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

pub(super) fn export_line(recorded_at: DateTime<Utc>, kind: &str, fields: Value) -> Value {
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
pub(super) fn build_header(
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
