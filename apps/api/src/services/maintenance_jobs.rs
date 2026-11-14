//! Jobs shown on Settings > Jobs.
//!
//! The page has two sections:
//!
//! - **Site-wide jobs** cover the whole installation and are for admins. Some
//!   run on their own schedule (the location and weather catch-up, security
//!   log cleanup) and record each pass; others are manual repairs run after an
//!   update (recalculating every charging cost or trip energy figure). Two
//!   more rows, weather lookups and scheduled backups, are read from their own
//!   tables instead of from recorded runs.
//! - **Vehicle jobs** act on one vehicle and are for that vehicle's managers.
//!
//! Every recorded run is one row in `riviamigo.maintenance_job_runs`
//! (`vehicle_id` is NULL for site-wide jobs). Partial unique indexes allow at
//! most one running run per job and vehicle, or per site-wide job, so a second
//! press is refused instead of doubling the work. A run left `running` by a
//! restart is marked interrupted once it passes the stale window.

use std::future::Future;

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::services::{
    charge_session_recovery, cost, external_connections as connections, security_audit,
    trip_energy, trip_enrichment, weather_enrichment,
};

/// A run still marked `running` after this long was interrupted (for
/// example by an API restart) and no longer blocks a new run.
const STALE_AFTER_MINUTES: i32 = 120;
const INTERRUPTED_MESSAGE: &str = "Interrupted before finishing. Run it again.";
const MAX_ERROR_CHARS: usize = 500;
/// Finished runs older than this are pruned; the page only shows the latest.
const KEEP_FINISHED_RUNS_DAYS: i32 = 90;

const WEATHER_LOOKUPS_SLUG: &str = "weather_lookups";
const SCHEDULED_BACKUPS_SLUG: &str = "scheduled_backups";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobScope {
    Site,
    Vehicle,
}

/// Jobs whose runs are recorded in `maintenance_job_runs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaintenanceJobKind {
    LocationWeatherCatchUp,
    SecurityLogCleanup,
    RecomputeChargingCosts,
    RecomputeTripEnergy,
    RecoverMissedChargeSessions,
}

impl MaintenanceJobKind {
    pub const ALL: &'static [Self] = &[
        Self::LocationWeatherCatchUp,
        Self::SecurityLogCleanup,
        Self::RecomputeChargingCosts,
        Self::RecomputeTripEnergy,
        Self::RecoverMissedChargeSessions,
    ];

    pub fn slug(self) -> &'static str {
        match self {
            Self::LocationWeatherCatchUp => "location_weather_catch_up",
            Self::SecurityLogCleanup => "security_log_cleanup",
            Self::RecomputeChargingCosts => "recompute_charging_costs",
            Self::RecomputeTripEnergy => "recompute_trip_energy",
            Self::RecoverMissedChargeSessions => "recover_missed_charge_sessions",
        }
    }

    pub fn parse(slug: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|kind| kind.slug() == slug)
    }

    pub fn scope(self) -> JobScope {
        match self {
            Self::RecoverMissedChargeSessions => JobScope::Vehicle,
            _ => JobScope::Site,
        }
    }

    /// The API runs this job on its own schedule.
    pub fn automatic(self) -> bool {
        matches!(
            self,
            Self::LocationWeatherCatchUp | Self::SecurityLogCleanup
        )
    }

    /// Someone can start a run from the Jobs page.
    pub fn runnable(self) -> bool {
        !matches!(self, Self::SecurityLogCleanup)
    }

    pub fn schedule(self) -> Option<&'static str> {
        match self {
            Self::LocationWeatherCatchUp => Some("Every 6 hours"),
            Self::SecurityLogCleanup => Some("Daily"),
            _ => None,
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::LocationWeatherCatchUp => "Location and weather catch-up",
            Self::SecurityLogCleanup => "Security log cleanup",
            Self::RecomputeChargingCosts => "Recalculate charging costs",
            Self::RecomputeTripEnergy => "Recalculate trip energy",
            Self::RecoverMissedChargeSessions => "Recover missed charging sessions",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::LocationWeatherCatchUp => {
                "Fills in missing coordinates, saved places, and street addresses for trips \
                 and charging sessions, up to 100 addresses per pass, then queues weather \
                 lookups for trips without an outside temperature. Uses the address and \
                 weather services turned on in External Connections."
            }
            Self::SecurityLogCleanup => "Removes security log events older than a year.",
            Self::RecomputeChargingCosts => {
                "Prices every vehicle's charging sessions again with their current cost \
                 profiles, network settings, and corrections. Run it after an update that \
                 fixes how costs are calculated; editing a cost profile already reprices \
                 its own sessions."
            }
            Self::RecomputeTripEnergy => {
                "Works out every trip's energy use and efficiency again from its battery \
                 levels. Run it after an update that changes how efficiency is calculated."
            }
            Self::RecoverMissedChargeSessions => {
                "Adds charging sessions that telemetry shows but Riviamigo never recorded, \
                 and closes sessions left open by a restart. Recorded sessions and your \
                 corrections are never changed or removed."
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MaintenanceJobStatus {
    pub kind: &'static str,
    pub title: &'static str,
    pub description: String,
    /// Runs on its own schedule (shown under "Automatic").
    pub automatic: bool,
    /// When it runs, for example "Every 6 hours"; `None` for manual jobs.
    pub schedule: Option<String>,
    /// The Jobs page may offer a Run button for it.
    pub can_run: bool,
    /// `running`, `done`, `error`, or `paused`; `None` if it never ran.
    pub status: Option<String>,
    /// What started the latest run: `manual` or `automatic`.
    pub trigger: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    /// The latest run's result, for example "412 sessions checked · 3 changed".
    pub summary: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MaintenanceJobError {
    #[error("job already running")]
    AlreadyRunning,
    #[error("job not found")]
    NotFound,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// What a finished run reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobOutcome {
    pub processed: usize,
    pub changed: usize,
    pub failed: usize,
    pub summary: String,
}

impl JobOutcome {
    fn from_counts(
        kind: MaintenanceJobKind,
        processed: usize,
        changed: usize,
        failed: usize,
    ) -> Self {
        Self {
            processed,
            changed,
            failed,
            summary: count_summary(kind, processed, changed, failed),
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
struct LatestRunRow {
    job_kind: String,
    status: String,
    trigger: String,
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
    processed_count: Option<i32>,
    changed_count: Option<i32>,
    failed_count: Option<i32>,
    summary: Option<String>,
    error: Option<String>,
}

/// Site-wide jobs in page order: automatic ones first, then manual ones.
pub async fn list_site(pool: &PgPool) -> Result<Vec<MaintenanceJobStatus>, MaintenanceJobError> {
    expire_stale_runs(pool).await?;
    let rows = sqlx::query_as::<_, LatestRunRow>(
        r#"SELECT DISTINCT ON (job_kind)
                  job_kind, status, trigger, started_at, finished_at,
                  processed_count, changed_count, failed_count, summary, error
           FROM riviamigo.maintenance_job_runs
           WHERE vehicle_id IS NULL
           ORDER BY job_kind, started_at DESC"#,
    )
    .fetch_all(pool)
    .await?;
    let latest = |kind: MaintenanceJobKind| {
        status_for(kind, rows.iter().find(|row| row.job_kind == kind.slug()))
    };

    Ok(vec![
        latest(MaintenanceJobKind::LocationWeatherCatchUp),
        weather_lookups_status(pool).await?,
        scheduled_backups_status(pool).await?,
        latest(MaintenanceJobKind::SecurityLogCleanup),
        latest(MaintenanceJobKind::RecomputeChargingCosts),
        latest(MaintenanceJobKind::RecomputeTripEnergy),
    ])
}

/// One vehicle's recorded jobs, including jobs never run.
pub async fn list_vehicle(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Result<Vec<MaintenanceJobStatus>, MaintenanceJobError> {
    expire_stale_runs(pool).await?;
    let rows = sqlx::query_as::<_, LatestRunRow>(
        r#"SELECT DISTINCT ON (job_kind)
                  job_kind, status, trigger, started_at, finished_at,
                  processed_count, changed_count, failed_count, summary, error
           FROM riviamigo.maintenance_job_runs
           WHERE vehicle_id = $1
           ORDER BY job_kind, started_at DESC"#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    Ok(MaintenanceJobKind::ALL
        .iter()
        .copied()
        .filter(|kind| kind.scope() == JobScope::Vehicle)
        .map(|kind| status_for(kind, rows.iter().find(|row| row.job_kind == kind.slug())))
        .collect())
}

/// Start a site-wide job from the Jobs page.
pub async fn spawn_site(
    pool: PgPool,
    slug: &str,
    requested_by: Uuid,
) -> Result<MaintenanceJobStatus, MaintenanceJobError> {
    let kind = MaintenanceJobKind::parse(slug)
        .filter(|kind| kind.scope() == JobScope::Site && kind.runnable())
        .ok_or(MaintenanceJobError::NotFound)?;
    spawn(pool, None, kind, requested_by).await
}

/// Start one of a vehicle's jobs from the Jobs page.
pub async fn spawn_vehicle(
    pool: PgPool,
    vehicle_id: Uuid,
    slug: &str,
    requested_by: Uuid,
) -> Result<MaintenanceJobStatus, MaintenanceJobError> {
    let kind = MaintenanceJobKind::parse(slug)
        .filter(|kind| kind.scope() == JobScope::Vehicle && kind.runnable())
        .ok_or(MaintenanceJobError::NotFound)?;
    spawn(pool, Some(vehicle_id), kind, requested_by).await
}

/// Record and run one automatic pass of a scheduled job. If a run of the same
/// job is already in progress (someone pressed Run now), this pass is skipped
/// and `None` is returned; the running one does the same work.
pub async fn run_automatic<F, Fut>(
    pool: &PgPool,
    kind: MaintenanceJobKind,
    work: F,
) -> Option<anyhow::Result<JobOutcome>>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = anyhow::Result<JobOutcome>>,
{
    debug_assert!(kind.automatic() && kind.scope() == JobScope::Site);
    if let Err(error) = expire_stale_runs(pool).await {
        tracing::warn!(job = kind.slug(), %error, "failed to expire stale job runs");
    }
    if let Err(error) = prune_old_runs(pool).await {
        tracing::warn!(job = kind.slug(), %error, "failed to prune old job runs");
    }
    let run_id = match insert_run(pool, None, kind, None, "automatic").await {
        Ok(run_id) => Some(run_id),
        Err(MaintenanceJobError::AlreadyRunning) => {
            tracing::info!(
                job = kind.slug(),
                "skipping automatic pass; a run is already active"
            );
            return None;
        }
        // Still do the work: it matters more than the record of it.
        Err(error) => {
            tracing::warn!(job = kind.slug(), %error, "failed to record automatic job run");
            None
        }
    };
    let outcome = work().await;
    if let Some(run_id) = run_id {
        if let Err(error) = finish(pool, run_id, &outcome).await {
            tracing::warn!(job = kind.slug(), %error, "failed to record automatic job outcome");
        }
    }
    Some(outcome)
}

async fn spawn(
    pool: PgPool,
    vehicle_id: Option<Uuid>,
    kind: MaintenanceJobKind,
    requested_by: Uuid,
) -> Result<MaintenanceJobStatus, MaintenanceJobError> {
    expire_stale_runs(&pool).await?;
    let run_id = insert_run(&pool, vehicle_id, kind, Some(requested_by), "manual").await?;

    let task_pool = pool.clone();
    tokio::spawn(async move {
        let outcome = run(&task_pool, vehicle_id, kind).await;
        if let Err(error) = finish(&task_pool, run_id, &outcome).await {
            tracing::warn!(?vehicle_id, job = kind.slug(), %error, "failed to record maintenance job outcome");
        }
        match outcome {
            Ok(outcome) => tracing::info!(
                ?vehicle_id,
                job = kind.slug(),
                processed = outcome.processed,
                changed = outcome.changed,
                failed = outcome.failed,
                "maintenance job complete"
            ),
            Err(error) => tracing::warn!(
                ?vehicle_id,
                job = kind.slug(),
                error = %error,
                "maintenance job failed"
            ),
        }
    });

    Ok(MaintenanceJobStatus {
        status: Some("running".into()),
        trigger: Some("manual".into()),
        started_at: Some(Utc::now()),
        ..status_for(kind, None)
    })
}

async fn insert_run(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
    kind: MaintenanceJobKind,
    requested_by: Option<Uuid>,
    trigger: &str,
) -> Result<Uuid, MaintenanceJobError> {
    sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO riviamigo.maintenance_job_runs
               (vehicle_id, job_kind, status, requested_by, trigger)
           VALUES ($1, $2, 'running', $3, $4)
           RETURNING id"#,
    )
    .bind(vehicle_id)
    .bind(kind.slug())
    .bind(requested_by)
    .bind(trigger)
    .fetch_one(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => {
            MaintenanceJobError::AlreadyRunning
        }
        _ => MaintenanceJobError::Database(error),
    })
}

async fn run(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
    kind: MaintenanceJobKind,
) -> anyhow::Result<JobOutcome> {
    match kind {
        MaintenanceJobKind::LocationWeatherCatchUp => {
            trip_enrichment::run_catch_up_pass(pool).await
        }
        MaintenanceJobKind::SecurityLogCleanup => security_log_cleanup(pool).await,
        MaintenanceJobKind::RecomputeChargingCosts => {
            let summary = cost::recompute_charging_costs(pool, vehicle_id).await?;
            Ok(JobOutcome::from_counts(
                kind,
                summary.processed,
                summary.changed,
                0,
            ))
        }
        MaintenanceJobKind::RecomputeTripEnergy => {
            let summary = trip_energy::recompute_trip_energy(pool, vehicle_id).await?;
            Ok(JobOutcome::from_counts(
                kind,
                summary.processed,
                summary.changed,
                0,
            ))
        }
        MaintenanceJobKind::RecoverMissedChargeSessions => {
            let vehicle_id = vehicle_id
                .ok_or_else(|| anyhow::anyhow!("recovering charging sessions needs a vehicle"))?;
            let summary =
                charge_session_recovery::recover_missed_charge_sessions(pool, vehicle_id).await?;
            Ok(JobOutcome::from_counts(
                kind,
                summary.windows,
                summary.inserted + summary.closed,
                0,
            ))
        }
    }
}

/// One pass of the daily security log retention.
pub async fn security_log_cleanup(pool: &PgPool) -> anyhow::Result<JobOutcome> {
    let removed = security_audit::prune_expired(pool).await?;
    let removed = usize::try_from(removed).unwrap_or(usize::MAX);
    Ok(JobOutcome::from_counts(
        MaintenanceJobKind::SecurityLogCleanup,
        removed,
        removed,
        0,
    ))
}

async fn finish(
    pool: &PgPool,
    run_id: Uuid,
    outcome: &anyhow::Result<JobOutcome>,
) -> Result<(), sqlx::Error> {
    let (status, processed, changed, failed, summary, error) = match outcome {
        Ok(outcome) => (
            "done",
            Some(clamp_count(outcome.processed)),
            Some(clamp_count(outcome.changed)),
            Some(clamp_count(outcome.failed)),
            Some(outcome.summary.clone()),
            None,
        ),
        Err(error) => (
            "error",
            None,
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
               summary = $6,
               error = $7
           WHERE id = $1"#,
    )
    .bind(run_id)
    .bind(status)
    .bind(processed)
    .bind(changed)
    .bind(failed)
    .bind(summary)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

async fn expire_stale_runs(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE riviamigo.maintenance_job_runs
           SET status = 'error',
               finished_at = now(),
               error = $2
           WHERE status = 'running'
             AND started_at < now() - make_interval(mins => $1)"#,
    )
    .bind(STALE_AFTER_MINUTES)
    .bind(INTERRUPTED_MESSAGE)
    .execute(pool)
    .await?;
    Ok(())
}

/// Keep the table small: automatic jobs add a few rows a day. The latest run
/// of each job is always kept so the page never loses its last result.
async fn prune_old_runs(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM riviamigo.maintenance_job_runs AS run
           WHERE run.status <> 'running'
             AND run.started_at < now() - make_interval(days => $1)
             AND EXISTS (
               SELECT 1 FROM riviamigo.maintenance_job_runs AS newer
               WHERE newer.job_kind = run.job_kind
                 AND newer.vehicle_id IS NOT DISTINCT FROM run.vehicle_id
                 AND newer.started_at > run.started_at
             )"#,
    )
    .bind(KEEP_FINISHED_RUNS_DAYS)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
struct WeatherQueueRow {
    waiting: i64,
    failed: i64,
    finished_last_day: i64,
    last_completed_at: Option<DateTime<Utc>>,
}

/// The weather lookup worker runs continuously; its state is the queue.
async fn weather_lookups_status(pool: &PgPool) -> Result<MaintenanceJobStatus, sqlx::Error> {
    let queue = sqlx::query_as::<_, WeatherQueueRow>(
        r#"SELECT count(*) FILTER (WHERE status IN ('pending', 'running')) AS waiting,
                  count(*) FILTER (WHERE status = 'failed') AS failed,
                  count(*) FILTER (
                    WHERE status = 'succeeded' AND completed_at > now() - interval '24 hours'
                  ) AS finished_last_day,
                  max(completed_at) AS last_completed_at
           FROM riviamigo.weather_enrichment_jobs"#,
    )
    .fetch_one(pool)
    .await?;
    let enabled = match connections::load(pool, connections::OPEN_METEO).await {
        Ok(settings) => settings.is_active(),
        Err(crate::errors::AppError::Database(error)) => return Err(error),
        Err(_) => false,
    };
    let requests_today = sqlx::query_scalar::<_, i32>(
        r#"SELECT CASE WHEN usage_date = CURRENT_DATE THEN request_count ELSE 0 END
           FROM riviamigo.external_connection_activity WHERE connection_id = $1"#,
    )
    .bind(connections::OPEN_METEO)
    .fetch_optional(pool)
    .await?
    .unwrap_or(0);

    let state = weather_state(
        enabled,
        requests_today >= weather_enrichment::DAILY_REQUEST_BUDGET,
        &queue,
    );
    Ok(MaintenanceJobStatus {
        kind: WEATHER_LOOKUPS_SLUG,
        title: "Weather lookups",
        description: "Looks up the outside temperature for each finished trip, one at a time, \
             using the weather service in External Connections. Failed lookups are retried."
            .into(),
        automatic: true,
        schedule: Some("Continuous".into()),
        can_run: false,
        status: state.status.map(str::to_owned),
        trigger: state.status.map(|_| "automatic".to_owned()),
        started_at: queue.last_completed_at,
        finished_at: queue.last_completed_at,
        summary: state.summary,
        error: None,
    })
}

#[derive(Debug, PartialEq, Eq)]
struct DerivedState {
    status: Option<&'static str>,
    summary: Option<String>,
}

fn weather_state(enabled: bool, over_budget: bool, queue: &WeatherQueueRow) -> DerivedState {
    let mut parts = Vec::new();
    if queue.waiting > 0 {
        parts.push(format!("{} waiting", group_digits(queue.waiting)));
    }
    parts.push(format!(
        "{} finished in the last day",
        group_digits(queue.finished_last_day)
    ));
    if queue.failed > 0 {
        parts.push(format!("{} failed", group_digits(queue.failed)));
    }
    if !enabled {
        return DerivedState {
            status: Some("paused"),
            summary: Some("Turned off in External Connections".into()),
        };
    }
    if over_budget {
        parts.insert(0, "Daily lookup limit reached; continues tomorrow".into());
        return DerivedState {
            status: Some("paused"),
            summary: Some(parts.join(" · ")),
        };
    }
    if queue.waiting > 0 {
        return DerivedState {
            status: Some("running"),
            summary: Some(parts.join(" · ")),
        };
    }
    if queue.last_completed_at.is_some() {
        return DerivedState {
            status: Some("done"),
            summary: Some(parts.join(" · ")),
        };
    }
    DerivedState {
        status: None,
        summary: None,
    }
}

#[derive(Debug, sqlx::FromRow)]
struct BackupScheduleRow {
    enabled: bool,
    frequency: String,
    run_at: String,
    day_of_week: Option<i16>,
    day_of_month: Option<i16>,
}

#[derive(Debug, sqlx::FromRow)]
struct BackupRunRow {
    status: String,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    error_message: Option<String>,
}

/// Scheduled backups are configured and run from Settings > Backups; this
/// row only reports the schedule and the latest scheduled run.
async fn scheduled_backups_status(pool: &PgPool) -> Result<MaintenanceJobStatus, sqlx::Error> {
    let schedule = sqlx::query_as::<_, BackupScheduleRow>(
        r#"SELECT enabled, frequency, to_char(run_at, 'HH24:MI') AS run_at,
                  day_of_week, day_of_month
           FROM riviamigo.backup_settings
           WHERE id"#,
    )
    .fetch_optional(pool)
    .await?;
    let latest = sqlx::query_as::<_, BackupRunRow>(
        r#"SELECT status, created_at, started_at, completed_at, error_message
           FROM riviamigo.backup_runs
           WHERE trigger = 'scheduled'
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .fetch_optional(pool)
    .await?;

    let enabled = schedule.as_ref().is_some_and(|row| row.enabled);
    let run_status = latest.as_ref().map(|run| backup_run_status(&run.status));
    let status = if enabled { run_status } else { Some("paused") };
    let summary = if enabled {
        None
    } else {
        Some("Turned off in Backups".to_owned())
    };
    let error = latest.as_ref().and_then(|run| match run.status.as_str() {
        "failed" => Some(
            run.error_message
                .clone()
                .unwrap_or_else(|| "The backup failed.".into()),
        ),
        "canceled" => Some("The backup was canceled.".into()),
        _ => None,
    });
    Ok(MaintenanceJobStatus {
        kind: SCHEDULED_BACKUPS_SLUG,
        title: "Scheduled backups",
        description: "Backs up the database on the schedule set in Settings > Backups, where \
             you can also run one now and restore."
            .into(),
        automatic: true,
        schedule: Some(match schedule.as_ref() {
            Some(row) if row.enabled => describe_backup_schedule(row),
            _ => "Off".into(),
        }),
        can_run: false,
        status: status.map(str::to_owned),
        trigger: latest.as_ref().map(|_| "automatic".to_owned()),
        started_at: latest
            .as_ref()
            .map(|run| run.started_at.unwrap_or(run.created_at)),
        finished_at: latest.as_ref().and_then(|run| run.completed_at),
        summary,
        error: if enabled { error } else { None },
    })
}

fn backup_run_status(status: &str) -> &'static str {
    match status {
        "succeeded" => "done",
        "pending" | "running" => "running",
        _ => "error",
    }
}

fn describe_backup_schedule(row: &BackupScheduleRow) -> String {
    match row.frequency.as_str() {
        "daily" => format!("Daily at {}", row.run_at),
        "monthly" => format!(
            "Monthly on day {} at {}",
            row.day_of_month.unwrap_or(1),
            row.run_at
        ),
        _ => {
            const DAYS: [&str; 7] = [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
            ];
            let day = usize::try_from(row.day_of_week.unwrap_or(0))
                .ok()
                .and_then(|index| DAYS.get(index))
                .copied()
                .unwrap_or("Sunday");
            format!("Weekly on {day} at {}", row.run_at)
        }
    }
}

fn status_for(kind: MaintenanceJobKind, latest: Option<&LatestRunRow>) -> MaintenanceJobStatus {
    MaintenanceJobStatus {
        kind: kind.slug(),
        title: kind.title(),
        description: kind.description().to_owned(),
        automatic: kind.automatic(),
        schedule: kind.schedule().map(str::to_owned),
        can_run: kind.runnable(),
        status: latest.map(|row| row.status.clone()),
        trigger: latest.map(|row| row.trigger.clone()),
        started_at: latest.map(|row| row.started_at),
        finished_at: latest.and_then(|row| row.finished_at),
        summary: latest.and_then(|row| stored_summary(kind, row)),
        error: latest.and_then(|row| row.error.clone()),
    }
}

/// Runs recorded before summaries were stored only have counts.
fn stored_summary(kind: MaintenanceJobKind, row: &LatestRunRow) -> Option<String> {
    if row.summary.is_some() {
        return row.summary.clone();
    }
    let processed = usize::try_from(row.processed_count?).ok()?;
    let changed = row
        .changed_count
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(0);
    let failed = row
        .failed_count
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(0);
    Some(count_summary(kind, processed, changed, failed))
}

fn count_summary(
    kind: MaintenanceJobKind,
    processed: usize,
    changed: usize,
    failed: usize,
) -> String {
    let mut parts = match kind {
        MaintenanceJobKind::RecomputeChargingCosts => vec![
            format!("{} checked", count(processed, "session", "sessions")),
            format!("{} changed", group_digits(changed)),
        ],
        MaintenanceJobKind::RecomputeTripEnergy => vec![
            format!("{} checked", count(processed, "trip", "trips")),
            format!("{} changed", group_digits(changed)),
        ],
        MaintenanceJobKind::RecoverMissedChargeSessions => vec![
            format!(
                "{} checked",
                count(processed, "charging window", "charging windows")
            ),
            format!("{} recovered", group_digits(changed)),
        ],
        MaintenanceJobKind::SecurityLogCleanup => {
            vec![format!(
                "{} removed",
                count(changed, "old event", "old events")
            )]
        }
        MaintenanceJobKind::LocationWeatherCatchUp => vec![
            format!("{} checked", count(processed, "item", "items")),
            format!("{} filled or queued", group_digits(changed)),
        ],
    };
    if failed > 0 {
        parts.push(format!("{} failed", group_digits(failed)));
    }
    parts.join(" · ")
}

/// "1 trip" / "1,204 trips".
pub fn count(value: usize, singular: &str, plural: &str) -> String {
    let noun = if value == 1 { singular } else { plural };
    format!("{} {noun}", group_digits(value))
}

fn group_digits(value: impl ToString) -> String {
    let digits = value.to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    grouped
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

    fn run_row(kind: MaintenanceJobKind) -> LatestRunRow {
        LatestRunRow {
            job_kind: kind.slug().into(),
            status: "done".into(),
            trigger: "manual".into(),
            started_at: Utc::now(),
            finished_at: Some(Utc::now()),
            processed_count: Some(1204),
            changed_count: Some(3),
            failed_count: Some(0),
            summary: None,
            error: None,
        }
    }

    fn queue(waiting: i64, failed: i64, finished: i64, completed: bool) -> WeatherQueueRow {
        WeatherQueueRow {
            waiting,
            failed,
            finished_last_day: finished,
            last_completed_at: completed.then(Utc::now),
        }
    }

    #[test]
    fn every_kind_round_trips_through_its_slug() {
        for &kind in MaintenanceJobKind::ALL {
            assert_eq!(MaintenanceJobKind::parse(kind.slug()), Some(kind));
        }
        assert_eq!(MaintenanceJobKind::parse("drop_everything"), None);
        // Folded into the location and weather catch-up.
        assert_eq!(MaintenanceJobKind::parse("fill_addresses"), None);
        assert_eq!(MaintenanceJobKind::parse("fill_outside_temperatures"), None);
    }

    #[test]
    fn only_session_recovery_is_a_vehicle_job() {
        let vehicle: Vec<_> = MaintenanceJobKind::ALL
            .iter()
            .filter(|kind| kind.scope() == JobScope::Vehicle)
            .collect();
        assert_eq!(vehicle, [&MaintenanceJobKind::RecoverMissedChargeSessions]);
    }

    #[test]
    fn automatic_jobs_have_a_schedule_and_manual_ones_do_not() {
        for &kind in MaintenanceJobKind::ALL {
            assert_eq!(kind.automatic(), kind.schedule().is_some(), "{kind:?}");
        }
        assert!(!MaintenanceJobKind::SecurityLogCleanup.runnable());
        assert!(MaintenanceJobKind::LocationWeatherCatchUp.runnable());
    }

    #[test]
    fn never_run_jobs_still_list_with_their_metadata() {
        let status = status_for(MaintenanceJobKind::LocationWeatherCatchUp, None);
        assert_eq!(status.kind, "location_weather_catch_up");
        assert_eq!(status.schedule.as_deref(), Some("Every 6 hours"));
        assert!(status.automatic);
        assert!(status.can_run);
        assert_eq!(status.status, None);
        assert_eq!(status.summary, None);
    }

    #[test]
    fn older_runs_without_a_summary_get_one_from_their_counts() {
        let row = run_row(MaintenanceJobKind::RecomputeChargingCosts);
        let status = status_for(MaintenanceJobKind::RecomputeChargingCosts, Some(&row));
        assert_eq!(
            status.summary.as_deref(),
            Some("1,204 sessions checked · 3 changed")
        );
    }

    #[test]
    fn a_stored_summary_wins_over_counts() {
        let mut row = run_row(MaintenanceJobKind::LocationWeatherCatchUp);
        row.summary = Some("37 addresses filled · 12 weather lookups queued".into());
        let status = status_for(MaintenanceJobKind::LocationWeatherCatchUp, Some(&row));
        assert_eq!(
            status.summary.as_deref(),
            Some("37 addresses filled · 12 weather lookups queued")
        );
    }

    #[test]
    fn summaries_use_singular_nouns_and_show_failures() {
        assert_eq!(
            count_summary(MaintenanceJobKind::RecoverMissedChargeSessions, 1, 0, 2),
            "1 charging window checked · 0 recovered · 2 failed"
        );
        assert_eq!(
            count_summary(MaintenanceJobKind::SecurityLogCleanup, 0, 0, 0),
            "0 old events removed"
        );
    }

    #[test]
    fn digits_are_grouped_in_thousands() {
        assert_eq!(group_digits(0), "0");
        assert_eq!(group_digits(999), "999");
        assert_eq!(group_digits(1000), "1,000");
        assert_eq!(group_digits(1_234_567), "1,234,567");
    }

    #[test]
    fn weather_lookups_report_their_queue() {
        assert_eq!(
            weather_state(true, false, &queue(12, 1, 40, true)),
            DerivedState {
                status: Some("running"),
                summary: Some("12 waiting · 40 finished in the last day · 1 failed".into()),
            }
        );
        assert_eq!(
            weather_state(true, false, &queue(0, 0, 3, true)).status,
            Some("done")
        );
        assert_eq!(
            weather_state(true, false, &queue(0, 0, 0, false)),
            DerivedState {
                status: None,
                summary: None
            }
        );
    }

    #[test]
    fn weather_lookups_pause_when_off_or_over_budget() {
        assert_eq!(
            weather_state(false, false, &queue(5, 0, 0, true)),
            DerivedState {
                status: Some("paused"),
                summary: Some("Turned off in External Connections".into()),
            }
        );
        let over = weather_state(true, true, &queue(5, 0, 0, true));
        assert_eq!(over.status, Some("paused"));
        assert!(over
            .summary
            .unwrap()
            .starts_with("Daily lookup limit reached; continues tomorrow · 5 waiting"));
    }

    #[test]
    fn backup_schedules_read_like_the_backups_page() {
        let row = |frequency: &str| BackupScheduleRow {
            enabled: true,
            frequency: frequency.into(),
            run_at: "03:00".into(),
            day_of_week: Some(2),
            day_of_month: Some(15),
        };
        assert_eq!(describe_backup_schedule(&row("daily")), "Daily at 03:00");
        assert_eq!(
            describe_backup_schedule(&row("weekly")),
            "Weekly on Tuesday at 03:00"
        );
        assert_eq!(
            describe_backup_schedule(&row("monthly")),
            "Monthly on day 15 at 03:00"
        );
        assert_eq!(backup_run_status("succeeded"), "done");
        assert_eq!(backup_run_status("pending"), "running");
        assert_eq!(backup_run_status("canceled"), "error");
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
