//! Manual maintenance jobs a vehicle manager starts from Settings > Jobs.
//!
//! Each job is a safe, repeatable repair that would otherwise need a shell and
//! a maintenance binary. A press records one row in
//! `riviamigo.maintenance_job_runs`; the work runs in the background and the
//! row carries the outcome. At most one run per vehicle and job kind can be
//! running (enforced by a partial unique index), and a run left `running` by a
//! restart is marked as interrupted once it passes the stale window.

use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::services::{charge_session_recovery, cost, trip_energy, trip_enrichment};

/// A run still marked `running` after this long was interrupted (for
/// example by an API restart) and no longer blocks a new run.
const STALE_AFTER_MINUTES: i32 = 120;
const INTERRUPTED_MESSAGE: &str = "Interrupted before finishing. Run it again.";
const MAX_ERROR_CHARS: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaintenanceJobKind {
    RecomputeChargingCosts,
    RecoverMissedChargeSessions,
    RecomputeTripEnergy,
    FillOutsideTemperatures,
    FillAddresses,
}

impl MaintenanceJobKind {
    /// Every job, in the order the Jobs page lists them.
    pub const ALL: &'static [Self] = &[
        Self::RecomputeChargingCosts,
        Self::RecoverMissedChargeSessions,
        Self::RecomputeTripEnergy,
        Self::FillOutsideTemperatures,
        Self::FillAddresses,
    ];

    pub fn slug(self) -> &'static str {
        match self {
            Self::RecomputeChargingCosts => "recompute_charging_costs",
            Self::RecoverMissedChargeSessions => "recover_missed_charge_sessions",
            Self::RecomputeTripEnergy => "recompute_trip_energy",
            Self::FillOutsideTemperatures => "fill_outside_temperatures",
            Self::FillAddresses => "fill_addresses",
        }
    }

    pub fn parse(slug: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|kind| kind.slug() == slug)
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::RecomputeChargingCosts => "Recalculate charging costs",
            Self::RecoverMissedChargeSessions => "Recover missed charging sessions",
            Self::RecomputeTripEnergy => "Recalculate trip energy",
            Self::FillOutsideTemperatures => "Fill missing outside temperatures",
            Self::FillAddresses => "Fill missing addresses",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::RecomputeChargingCosts => {
                "Prices every charging session again with its current cost profile, \
                 network settings, and corrections. Run it after changing a rate or \
                 schedule, or after an update that fixes how costs are calculated."
            }
            Self::RecoverMissedChargeSessions => {
                "Adds charging sessions that telemetry shows but Riviamigo never recorded, \
                 and closes sessions left open by a restart. Recorded sessions and your \
                 corrections are never changed or removed."
            }
            Self::RecomputeTripEnergy => {
                "Works out each trip's energy use and efficiency again from its battery \
                 levels. Run it after an update that changes how efficiency is calculated."
            }
            Self::FillOutsideTemperatures => {
                "Queues a weather lookup for trips without an outside temperature, \
                 including earlier lookups that failed. Temperatures fill in over the next \
                 few minutes; trips that already have one are left alone."
            }
            Self::FillAddresses => {
                "Looks up street addresses for trip ends and charging spots that have none, \
                 up to 100 of each per run. Uses the address lookup service when it is \
                 turned on in External Connections."
            }
        }
    }

    /// Unit for `processed_count` / `changed_count` in the UI.
    pub fn subject(self) -> &'static str {
        match self {
            Self::RecomputeChargingCosts => "sessions",
            Self::RecoverMissedChargeSessions => "charging windows",
            Self::RecomputeTripEnergy => "trips",
            Self::FillOutsideTemperatures => "trips",
            Self::FillAddresses => "places",
        }
    }

    /// What `changed_count` means for this job in the UI.
    pub fn changed_label(self) -> &'static str {
        match self {
            Self::RecomputeChargingCosts | Self::RecomputeTripEnergy => "changed",
            Self::RecoverMissedChargeSessions => "recovered",
            Self::FillOutsideTemperatures => "queued",
            Self::FillAddresses => "filled",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MaintenanceJobStatus {
    pub kind: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub subject: &'static str,
    pub changed_label: &'static str,
    /// Latest run's status (`running`, `done`, `error`); `None` if never run.
    pub status: Option<String>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub finished_at: Option<chrono::DateTime<chrono::Utc>>,
    pub processed_count: Option<i32>,
    pub changed_count: Option<i32>,
    pub failed_count: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MaintenanceJobError {
    #[error("job already running")]
    AlreadyRunning,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

#[derive(Debug, sqlx::FromRow)]
struct LatestRunRow {
    job_kind: String,
    status: String,
    started_at: chrono::DateTime<chrono::Utc>,
    finished_at: Option<chrono::DateTime<chrono::Utc>>,
    processed_count: Option<i32>,
    changed_count: Option<i32>,
    failed_count: Option<i32>,
    error: Option<String>,
}

/// The latest run of every job for one vehicle, including jobs never run.
pub async fn list(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Result<Vec<MaintenanceJobStatus>, MaintenanceJobError> {
    expire_stale_runs(pool, vehicle_id).await?;
    let rows = sqlx::query_as::<_, LatestRunRow>(
        r#"SELECT DISTINCT ON (job_kind)
                  job_kind, status, started_at, finished_at,
                  processed_count, changed_count, failed_count, error
           FROM riviamigo.maintenance_job_runs
           WHERE vehicle_id = $1
           ORDER BY job_kind, started_at DESC"#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    Ok(MaintenanceJobKind::ALL
        .iter()
        .map(|&kind| {
            let latest = rows.iter().find(|row| row.job_kind == kind.slug());
            status_for(kind, latest)
        })
        .collect())
}

/// Record a new run and start it in the background.
pub async fn spawn(
    pool: PgPool,
    vehicle_id: Uuid,
    kind: MaintenanceJobKind,
    requested_by: Uuid,
) -> Result<MaintenanceJobStatus, MaintenanceJobError> {
    expire_stale_runs(&pool, vehicle_id).await?;
    let run_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO riviamigo.maintenance_job_runs
               (vehicle_id, job_kind, status, requested_by)
           VALUES ($1, $2, 'running', $3)
           RETURNING id"#,
    )
    .bind(vehicle_id)
    .bind(kind.slug())
    .bind(requested_by)
    .fetch_one(&pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => {
            MaintenanceJobError::AlreadyRunning
        }
        _ => MaintenanceJobError::Database(error),
    })?;

    let task_pool = pool.clone();
    tokio::spawn(async move {
        let outcome = run(&task_pool, vehicle_id, kind).await;
        if let Err(error) = finish(&task_pool, run_id, &outcome).await {
            tracing::warn!(%vehicle_id, job = kind.slug(), %error, "failed to record maintenance job outcome");
        }
        match outcome {
            Ok(counts) => tracing::info!(
                %vehicle_id,
                job = kind.slug(),
                processed = counts.processed,
                changed = counts.changed,
                failed = counts.failed,
                "maintenance job complete"
            ),
            Err(error) => tracing::warn!(
                %vehicle_id,
                job = kind.slug(),
                error = %error,
                "maintenance job failed"
            ),
        }
    });

    Ok(MaintenanceJobStatus {
        status: Some("running".into()),
        started_at: Some(chrono::Utc::now()),
        ..status_for(kind, None)
    })
}

#[derive(Debug, Clone, Copy, Default)]
struct JobCounts {
    processed: usize,
    changed: usize,
    failed: usize,
}

async fn run(
    pool: &PgPool,
    vehicle_id: Uuid,
    kind: MaintenanceJobKind,
) -> anyhow::Result<JobCounts> {
    match kind {
        MaintenanceJobKind::RecomputeChargingCosts => {
            let summary = cost::recompute_charging_costs(pool, Some(vehicle_id)).await?;
            Ok(JobCounts {
                processed: summary.processed,
                changed: summary.changed,
                failed: 0,
            })
        }
        MaintenanceJobKind::RecoverMissedChargeSessions => {
            let summary =
                charge_session_recovery::recover_missed_charge_sessions(pool, vehicle_id).await?;
            Ok(JobCounts {
                processed: summary.windows,
                changed: summary.inserted + summary.closed,
                failed: 0,
            })
        }
        MaintenanceJobKind::RecomputeTripEnergy => {
            let summary = trip_energy::recompute_trip_energy(pool, Some(vehicle_id)).await?;
            Ok(JobCounts {
                processed: summary.processed,
                changed: summary.changed,
                failed: 0,
            })
        }
        MaintenanceJobKind::FillOutsideTemperatures => {
            let stats =
                trip_enrichment::enqueue_trip_weather_enrichment(pool, Some(vehicle_id)).await?;
            Ok(JobCounts {
                processed: stats.scanned,
                changed: stats.filled,
                failed: stats.failed,
            })
        }
        MaintenanceJobKind::FillAddresses => {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()?;
            let vehicle = Some(vehicle_id);
            trip_enrichment::backfill_trip_coordinates(pool, vehicle).await?;
            trip_enrichment::backfill_charge_session_coordinates(pool, vehicle).await?;
            let trips = trip_enrichment::backfill_trip_addresses(pool, &client, vehicle).await?;
            let sessions =
                trip_enrichment::backfill_charge_session_locations(pool, &client, vehicle).await?;
            Ok(JobCounts {
                processed: trips.scanned + sessions.scanned,
                changed: trips.filled + sessions.filled,
                failed: trips.failed + sessions.failed,
            })
        }
    }
}

async fn finish(
    pool: &PgPool,
    run_id: Uuid,
    outcome: &anyhow::Result<JobCounts>,
) -> Result<(), sqlx::Error> {
    let (status, processed, changed, failed, error) = match outcome {
        Ok(counts) => (
            "done",
            Some(clamp_count(counts.processed)),
            Some(clamp_count(counts.changed)),
            Some(clamp_count(counts.failed)),
            None,
        ),
        Err(error) => (
            "error",
            None,
            None,
            None,
            Some(truncate_error(&format!("{error:#}"))),
        ),
    };
    sqlx::query(
        r#"UPDATE riviamigo.maintenance_job_runs
           SET status = $2,
               finished_at = now(),
               processed_count = $3,
               changed_count = $4,
               failed_count = $5,
               error = $6
           WHERE id = $1"#,
    )
    .bind(run_id)
    .bind(status)
    .bind(processed)
    .bind(changed)
    .bind(failed)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

async fn expire_stale_runs(pool: &PgPool, vehicle_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE riviamigo.maintenance_job_runs
           SET status = 'error',
               finished_at = now(),
               error = $3
           WHERE vehicle_id = $1
             AND status = 'running'
             AND started_at < now() - make_interval(mins => $2)"#,
    )
    .bind(vehicle_id)
    .bind(STALE_AFTER_MINUTES)
    .bind(INTERRUPTED_MESSAGE)
    .execute(pool)
    .await?;
    Ok(())
}

fn status_for(kind: MaintenanceJobKind, latest: Option<&LatestRunRow>) -> MaintenanceJobStatus {
    MaintenanceJobStatus {
        kind: kind.slug(),
        title: kind.title(),
        description: kind.description(),
        subject: kind.subject(),
        changed_label: kind.changed_label(),
        status: latest.map(|row| row.status.clone()),
        started_at: latest.map(|row| row.started_at),
        finished_at: latest.and_then(|row| row.finished_at),
        processed_count: latest.and_then(|row| row.processed_count),
        changed_count: latest.and_then(|row| row.changed_count),
        failed_count: latest.and_then(|row| row.failed_count),
        error: latest.and_then(|row| row.error.clone()),
    }
}

fn clamp_count(value: usize) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

fn truncate_error(message: &str) -> String {
    if message.chars().count() <= MAX_ERROR_CHARS {
        return message.to_owned();
    }
    let mut truncated: String = message.chars().take(MAX_ERROR_CHARS - 1).collect();
    truncated.push('…');
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_round_trips_through_its_slug() {
        for &kind in MaintenanceJobKind::ALL {
            assert_eq!(MaintenanceJobKind::parse(kind.slug()), Some(kind));
        }
        assert_eq!(MaintenanceJobKind::parse("drop_everything"), None);
    }

    #[test]
    fn never_run_jobs_still_list_with_their_metadata() {
        let status = status_for(MaintenanceJobKind::RecomputeChargingCosts, None);
        assert_eq!(status.kind, "recompute_charging_costs");
        assert_eq!(status.title, "Recalculate charging costs");
        assert_eq!(status.status, None);
        assert_eq!(status.started_at, None);
    }

    #[test]
    fn long_errors_are_truncated_for_storage() {
        let long = "x".repeat(MAX_ERROR_CHARS + 50);
        let stored = truncate_error(&long);
        assert_eq!(stored.chars().count(), MAX_ERROR_CHARS);
        assert!(stored.ends_with('…'));
        assert_eq!(truncate_error("short"), "short");
    }
}
