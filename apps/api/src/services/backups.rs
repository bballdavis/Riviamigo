use std::{
    fs::File,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration as StdDuration,
};

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use flate2::{write::GzEncoder, Compression};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use tar::Builder;
use tokio::{fs, process::Command, time::MissedTickBehavior};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{config::Config, errors::AppError};

const BACKUP_ADVISORY_LOCK_ID: i64 = 2_042_051_101;
pub const RESTORE_CONFIRMATION_PHRASE: &str = "RESTORE";
static PG_DUMP_UNAVAILABLE_LOGGED: AtomicBool = AtomicBool::new(false);
const PG_DUMP_UNAVAILABLE_MESSAGE: &str = "pg_dump is not installed or not on PATH; install PostgreSQL client tools before creating a full recovery package";
const BACKUP_DRIVER_UNSUPPORTED_MESSAGE: &str = "manifest-only JSON backups are not valid recovery packages; use BACKUP_DRIVER=pg_dump";
const RECOVERY_PACKAGE_FORMAT: &str = "riviamigo-recovery-v1";

#[derive(Debug, Clone, Copy)]
pub enum BackupRunTrigger {
    Manual,
    Scheduled,
}

impl BackupRunTrigger {
    fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Scheduled => "scheduled",
        }
    }
}

#[derive(Debug)]
pub struct BackupExecutionResult {
    pub run_id: Uuid,
    pub artifact_id: Uuid,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BackupRuntimeReadiness {
    pub pg_dump_available: bool,
    pub run_now_allowed: bool,
    pub reason: Option<String>,
}

#[derive(Debug, FromRow)]
struct BackupSettingsRow {
    enabled: bool,
    frequency: String,
    run_at: NaiveTime,
    timezone: String,
    day_of_week: Option<i16>,
    day_of_month: Option<i16>,
    retention_count: i32,
    prefix: String,
}

#[derive(Debug)]
struct BackupSettings {
    enabled: bool,
    frequency: BackupFrequency,
    run_at: NaiveTime,
    timezone: Tz,
    day_of_week: Option<i16>,
    day_of_month: Option<i16>,
    retention_count: i32,
    prefix: String,
}

#[derive(Debug, Clone, Copy)]
enum BackupFrequency {
    Daily,
    Weekly,
    Monthly,
}

impl TryFrom<&str> for BackupFrequency {
    type Error = AppError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "daily" => Ok(Self::Daily),
            "weekly" => Ok(Self::Weekly),
            "monthly" => Ok(Self::Monthly),
            _ => Err(AppError::Validation(
                "frequency must be daily, weekly, or monthly".into(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BackupDriver {
    PgDump,
}

impl BackupDriver {
    fn from_config(value: &str) -> Self {
        let _ = value;
        Self::PgDump
    }

    fn label(self) -> &'static str {
        "recovery_package"
    }
}

#[derive(Debug, FromRow)]
struct PrunableArtifactRow {
    id: Uuid,
    run_id: Uuid,
    storage_path: String,
}

pub fn start_backup_scheduler(pool: PgPool, config: Config) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let interval_secs = config.backup_poll_interval_seconds.max(30);
        let mut interval = tokio::time::interval(StdDuration::from_secs(interval_secs));
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut last_failure_signature: Option<String> = None;

        loop {
            interval.tick().await;
            if let Err(error) = maybe_run_scheduled_backup(&pool, &config).await {
                if should_log_scheduler_failure(&mut last_failure_signature, &error) {
                    tracing::error!(error = ?error, "backup.scheduler.tick_failed");
                } else {
                    tracing::debug!(error = ?error, "backup.scheduler.tick_failed_repeat");
                }
            } else {
                last_failure_signature = None;
            }
        }
    })
}

pub async fn run_backup_now(
    pool: &PgPool,
    config: &Config,
    requested_by: Option<Uuid>,
    trigger: BackupRunTrigger,
) -> Result<BackupExecutionResult, AppError> {
    ensure_backup_runtime_available(config).await?;

    // Acquire a dedicated connection so the advisory lock and its matching
    // unlock always run on the exact same PostgreSQL backend session.
    // Using different pool connections for lock vs unlock causes the unlock to
    // silently no-op (pg_advisory_unlock returns false for a session that never
    // held the lock), permanently leaking the lock until the connection is closed.
    let mut lock_conn = pool.acquire().await.map_err(AppError::from)?;

    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(BACKUP_ADVISORY_LOCK_ID)
        .fetch_one(&mut *lock_conn)
        .await
        .map_err(AppError::from)?;

    if !locked {
        return Err(AppError::Conflict(
            "A backup job is already running.".into(),
        ));
    }

    let result = run_backup_inner(pool, config, requested_by, trigger).await;

    let unlock_result: Result<bool, _> = sqlx::query_scalar("SELECT pg_advisory_unlock($1)")
        .bind(BACKUP_ADVISORY_LOCK_ID)
        .fetch_one(&mut *lock_conn)
        .await;
    if let Err(unlock_error) = unlock_result {
        tracing::error!(error = %unlock_error, "backup.lock.release_failed");
    }

    result
}

pub async fn create_restore_request(
    pool: &PgPool,
    artifact_id: Uuid,
    requested_by: Uuid,
    confirmation_phrase: &str,
    notes: Option<String>,
) -> Result<Uuid, AppError> {
    if confirmation_phrase.trim() != RESTORE_CONFIRMATION_PHRASE {
        return Err(AppError::Validation(format!(
            "Type {RESTORE_CONFIRMATION_PHRASE} to request a restore"
        )));
    }

    let exists: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM riviamigo.backup_artifacts WHERE id = $1")
            .bind(artifact_id)
            .fetch_optional(pool)
            .await?;

    if exists.is_none() {
        return Err(AppError::NotFound);
    }

    let pending: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT id
        FROM riviamigo.backup_restore_requests
        WHERE artifact_id = $1
          AND status IN ('pending', 'approved', 'running')
        ORDER BY requested_at DESC
        LIMIT 1
        "#,
    )
    .bind(artifact_id)
    .fetch_optional(pool)
    .await?;

    if pending.is_some() {
        return Err(AppError::Conflict(
            "A restore request for this artifact is already pending.".into(),
        ));
    }

    let request_id = sqlx::query_scalar(
        r#"
        INSERT INTO riviamigo.backup_restore_requests (
            artifact_id, requested_by, status, confirmation_phrase, notes, updated_at
        )
        VALUES ($1, $2, 'pending', $3, $4, now())
        RETURNING id
        "#,
    )
    .bind(artifact_id)
    .bind(requested_by)
    .bind(confirmation_phrase.trim())
    .bind(notes.and_then(|value| {
        let trimmed = value.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    }))
    .fetch_one(pool)
    .await?;

    Ok(request_id)
}

async fn run_backup_inner(
    pool: &PgPool,
    config: &Config,
    requested_by: Option<Uuid>,
    trigger: BackupRunTrigger,
) -> Result<BackupExecutionResult, AppError> {
    let settings = load_settings(pool).await?;
    let run_id = sqlx::query_scalar(
        r#"
        INSERT INTO riviamigo.backup_runs (trigger, status, requested_by, started_at, updated_at)
        VALUES ($1, 'running', $2, now(), now())
        RETURNING id
        "#,
    )
    .bind(trigger.as_str())
    .bind(requested_by)
    .fetch_one(pool)
    .await?;

    let driver = BackupDriver::from_config(&config.backup_driver);
    let created_at = Utc::now();
    let artifact_path = build_artifact_path(config, &settings.prefix, created_at, run_id);

    let execution = async {
        if let Some(parent) = artifact_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        execute_recovery_package(pool, config, &artifact_path, trigger, created_at).await?;

        let storage_path = artifact_path.to_string_lossy().into_owned();
        let file_name = artifact_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("backup artifact path is invalid")))?
            .to_string();
        let metadata = fs::metadata(&artifact_path).await?;
        let checksum_sha256 = compute_sha256(&artifact_path).await?;
        let database_name = current_database_name(pool).await?;
        let timescale_version = current_timescale_version(pool).await?;
        let manifest = json!({
            "artifact_kind": driver.label(),
            "format": RECOVERY_PACKAGE_FORMAT,
            "created_at": created_at,
            "database": database_name,
            "timescale_version": timescale_version,
            "trigger": trigger.as_str(),
            "prefix": settings.prefix,
            "retention_count": settings.retention_count,
            "storage_type": "local",
        });

        let artifact_id = sqlx::query_scalar(
            r#"
            INSERT INTO riviamigo.backup_artifacts (
                run_id, storage_type, file_name, storage_path, size_bytes, checksum_sha256, manifest
            )
            VALUES ($1, 'local', $2, $3, $4, $5, $6)
            RETURNING id
            "#,
        )
        .bind(run_id)
        .bind(&file_name)
        .bind(&storage_path)
        .bind(i64::try_from(metadata.len()).unwrap_or(i64::MAX))
        .bind(&checksum_sha256)
        .bind(manifest)
        .fetch_one(pool)
        .await?;

        sqlx::query(
            r#"
            UPDATE riviamigo.backup_runs
            SET status = 'succeeded', artifact_key = $2, completed_at = now(), updated_at = now(), error_message = NULL
            WHERE id = $1
            "#,
        )
        .bind(run_id)
        .bind(&storage_path)
        .execute(pool)
        .await?;

        prune_retained_artifacts(pool, settings.retention_count).await?;

        Ok::<BackupExecutionResult, AppError>(BackupExecutionResult { run_id, artifact_id })
    }
    .await;

    if let Err(error) = &execution {
        sqlx::query(
            r#"
            UPDATE riviamigo.backup_runs
            SET status = 'failed', completed_at = now(), updated_at = now(), error_message = $2
            WHERE id = $1
            "#,
        )
        .bind(run_id)
        .bind(error.to_string())
        .execute(pool)
        .await?;

        if fs::try_exists(&artifact_path).await.unwrap_or(false) {
            let _ = fs::remove_file(&artifact_path).await;
        }
    }

    execution
}

async fn maybe_run_scheduled_backup(
    pool: &PgPool,
    config: &Config,
) -> Result<Option<Uuid>, AppError> {
    if config.backup_driver.trim().eq_ignore_ascii_case("json") {
        return Ok(None);
    }

    if BackupDriver::from_config(&config.backup_driver) == BackupDriver::PgDump {
        if !is_pg_dump_available().await {
            if !PG_DUMP_UNAVAILABLE_LOGGED.swap(true, Ordering::Relaxed) {
                tracing::warn!(
                    "backup.scheduler.skipped_pg_dump_unavailable: {}",
                    PG_DUMP_UNAVAILABLE_MESSAGE
                );
            }
            return Ok(None);
        }
        PG_DUMP_UNAVAILABLE_LOGGED.store(false, Ordering::Relaxed);
    }

    let settings = load_settings(pool).await?;
    if !settings.enabled {
        return Ok(None);
    }

    let due_at = compute_due_run_at(&settings, Utc::now())?;
    let existing = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id
        FROM riviamigo.backup_runs
        WHERE trigger IN ('manual', 'scheduled')
          AND status IN ('pending', 'running', 'succeeded')
          AND created_at >= $1
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(due_at)
    .fetch_optional(pool)
    .await?;

    if existing.is_some() {
        return Ok(None);
    }

    let result = run_backup_now(pool, config, None, BackupRunTrigger::Scheduled).await?;
    Ok(Some(result.run_id))
}

async fn load_settings(pool: &PgPool) -> Result<BackupSettings, AppError> {
    let row = sqlx::query_as::<_, BackupSettingsRow>(
        r#"
        SELECT enabled, frequency, run_at, timezone, day_of_week, day_of_month, retention_count, prefix
        FROM riviamigo.backup_settings
        WHERE id = TRUE
        "#,
    )
    .fetch_optional(pool)
    .await?;

    match row {
        Some(row) => Ok(BackupSettings {
            enabled: row.enabled,
            frequency: BackupFrequency::try_from(row.frequency.as_str())?,
            run_at: row.run_at,
            timezone: row.timezone.parse::<Tz>().map_err(|_| {
                AppError::Validation("timezone must be a valid IANA timezone".into())
            })?,
            day_of_week: row.day_of_week,
            day_of_month: row.day_of_month,
            retention_count: row.retention_count.max(1),
            prefix: normalize_prefix(&row.prefix),
        }),
        None => Ok(BackupSettings {
            enabled: false,
            frequency: BackupFrequency::Weekly,
            run_at: NaiveTime::from_hms_opt(3, 0, 0).expect("valid default time"),
            timezone: "UTC".parse::<Tz>().expect("valid timezone"),
            day_of_week: Some(0),
            day_of_month: Some(1),
            retention_count: 8,
            prefix: "riviamigo".into(),
        }),
    }
}

fn build_artifact_path(
    config: &Config,
    prefix: &str,
    created_at: DateTime<Utc>,
    run_id: Uuid,
) -> PathBuf {
    let mut path = PathBuf::from(&config.backup_artifact_dir);
    for segment in prefix.split('/').filter(|segment| !segment.is_empty()) {
        path.push(segment);
    }
    path.push(created_at.format("%Y").to_string());
    path.push(created_at.format("%m").to_string());
    path.push(format!(
        "backup-{}-{}.rma.tar.gz",
        created_at.format("%Y%m%dT%H%M%SZ"),
        run_id.simple(),
    ));
    path
}

async fn execute_recovery_package(
    pool: &PgPool,
    config: &Config,
    artifact_path: &Path,
    trigger: BackupRunTrigger,
    created_at: DateTime<Utc>,
) -> Result<(), AppError> {
    let temp_root = std::env::temp_dir().join(format!("riviamigo-recovery-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_root).await?;
    let dump_path = temp_root.join("database.dump");
    let cache_root = PathBuf::from(&config.vehicle_image_cache_dir);

    let result = async {
        execute_pg_dump(config, &dump_path).await?;
        let manifest = build_recovery_manifest(pool, &dump_path, &cache_root, trigger, created_at).await?;
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;
        write_recovery_archive(artifact_path, &dump_path, &cache_root, &manifest_bytes).await
    }
    .await;

    let _ = fs::remove_dir_all(&temp_root).await;
    result
}

async fn execute_pg_dump(config: &Config, dump_path: &Path) -> Result<(), AppError> {
    // Parse connection components from the URL so the password is not exposed
    // on the process command line (visible via `ps`).
    let url = url::Url::parse(&config.database_url)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("invalid DATABASE_URL: {e}")))?;

    let pg_dump = resolve_pg_dump_executable()
        .await
        .ok_or_else(|| AppError::DependencyUnavailable(PG_DUMP_UNAVAILABLE_MESSAGE.to_string()))?;
    let mut cmd = Command::new(pg_dump);
    if let Some(host) = url.host_str() {
        cmd.arg(format!("--host={host}"));
    }
    if let Some(port) = url.port() {
        cmd.arg(format!("--port={port}"));
    }
    if !url.username().is_empty() {
        cmd.arg(format!("--username={}", url.username()));
    }
    let dbname = url.path().trim_start_matches('/');
    if !dbname.is_empty() {
        cmd.arg(format!("--dbname={dbname}"));
    }
    if let Some(password) = url.password() {
        cmd.env("PGPASSWORD", password);
    }
    let output = cmd
        .arg("--format=custom")
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg("--exclude-table-data=riviamigo.vehicle_credentials")
        .arg("--exclude-table-data=riviamigo.external_connection_settings")
        .arg("--exclude-table-data=riviamigo.system_config")
        .arg("--exclude-table-data=riviamigo.refresh_tokens")
        .arg("--exclude-table-data=riviamigo.backup_settings")
        .arg("--exclude-table-data=riviamigo.backup_runs")
        .arg("--exclude-table-data=riviamigo.backup_artifacts")
        .arg("--exclude-table-data=riviamigo.backup_restore_requests")
        .arg(format!("--file={}", dump_path.display()))
        .output()
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("failed to spawn pg_dump: {error}")))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = if stderr.trim().is_empty() {
        format!("pg_dump failed with exit code {:?}", output.status.code())
    } else {
        stderr.trim().to_string()
    };
    Err(AppError::Internal(anyhow::anyhow!(message)))
}

async fn is_pg_dump_available() -> bool {
    resolve_pg_dump_executable().await.is_some()
}

async fn resolve_pg_dump_executable() -> Option<PathBuf> {
    match Command::new("pg_dump").arg("--version").output().await {
        Ok(output) if output.status.success() => Some(PathBuf::from("pg_dump")),
        _ => find_windows_pg_dump_executable(),
    }
}

#[cfg(windows)]
fn find_windows_pg_dump_executable() -> Option<PathBuf> {
    for root in [
        std::env::var_os("ProgramFiles"),
        std::env::var_os("ProgramFiles(x86)"),
    ] {
        let Some(root) = root else { continue };
        let postgres_dir = PathBuf::from(root).join("PostgreSQL");
        let Ok(entries) = std::fs::read_dir(&postgres_dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let candidate = entry.path().join("bin").join("pg_dump.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(not(windows))]
fn find_windows_pg_dump_executable() -> Option<PathBuf> {
    None
}

async fn ensure_backup_runtime_available(config: &Config) -> Result<(), AppError> {
    if config.backup_driver.trim().eq_ignore_ascii_case("json") {
        return Err(AppError::DependencyUnavailable(
            BACKUP_DRIVER_UNSUPPORTED_MESSAGE.to_string(),
        ));
    }

    let driver = BackupDriver::from_config(&config.backup_driver);
    let pg_dump_available = is_pg_dump_available().await;
    if let Some(error) = runtime_dependency_error_if_unavailable(driver, pg_dump_available) {
        return Err(error);
    }
    Ok(())
}

fn runtime_dependency_error_if_unavailable(
    driver: BackupDriver,
    pg_dump_available: bool,
) -> Option<AppError> {
    if driver == BackupDriver::PgDump && !pg_dump_available {
        return Some(AppError::DependencyUnavailable(
            PG_DUMP_UNAVAILABLE_MESSAGE.to_string(),
        ));
    }
    None
}

pub async fn runtime_readiness(config: &Config) -> BackupRuntimeReadiness {
    if config.backup_driver.trim().eq_ignore_ascii_case("json") {
        return BackupRuntimeReadiness {
            pg_dump_available: false,
            run_now_allowed: false,
            reason: Some(BACKUP_DRIVER_UNSUPPORTED_MESSAGE.to_string()),
        };
    }

    if BackupDriver::from_config(&config.backup_driver) != BackupDriver::PgDump {
        return BackupRuntimeReadiness {
            pg_dump_available: false,
            run_now_allowed: true,
            reason: None,
        };
    }

    let pg_dump_available = is_pg_dump_available().await;
    BackupRuntimeReadiness {
        pg_dump_available,
        run_now_allowed: pg_dump_available,
        reason: (!pg_dump_available).then_some(PG_DUMP_UNAVAILABLE_MESSAGE.to_string()),
    }
}

/// Writes a JSON **manifest** file — metadata only (driver, database, trigger,
/// created_at). No table data is exported. This driver is intentionally lightweight:
/// it records *that* a backup was requested and documents the environment, but the
/// actual data resides in TimescaleDB. Use the `pg_dump` driver for full data backups.
async fn build_recovery_manifest(
    pool: &PgPool,
    dump_path: &Path,
    cache_root: &Path,
    trigger: BackupRunTrigger,
    created_at: DateTime<Utc>,
) -> Result<serde_json::Value, AppError> {
    let current_database = current_database_name(pool).await?;
    let timescale_version = current_timescale_version(pool).await?;
    let migration_version: Option<i64> = sqlx::query_scalar(
        "SELECT max(version) FROM _sqlx_migrations WHERE success = TRUE",
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::from)?;
    let database_checksum = compute_sha256(dump_path).await?;
    let cache_files = collect_cache_files(cache_root).await?;

    Ok(json!({
        "format": RECOVERY_PACKAGE_FORMAT,
        "format_version": 1,
        "created_at": created_at,
        "trigger": trigger.as_str(),
        "source": {
            "app_version": env!("CARGO_PKG_VERSION"),
            "database": current_database,
            "timescale_version": timescale_version,
            "migration_version": migration_version,
        },
        "scope": {
            "included": [
                "PostgreSQL durable application data",
                "TimescaleDB telemetry and enrichment data",
                "vehicle artwork cache files"
            ],
            "redacted": [
                "vehicle_credentials.encrypted_tokens",
                "external_connection_settings.bearer_token_encrypted",
                "system_config installation keys",
                "refresh_tokens",
                "backup target secrets"
            ],
            "excluded": [
                "Redis live state, pub/sub messages, and OTP challenges",
                "backup artifact catalog and restore request history",
                "browser localStorage and sessionStorage"
            ]
        },
        "components": {
            "database": {
                "path": "database.dump",
                "sha256": database_checksum,
                "size_bytes": std::fs::metadata(dump_path).map(|metadata| metadata.len()).unwrap_or(0)
            },
            "vehicle_image_cache": {
                "path": "vehicle-image-cache",
                "file_count": cache_files.len(),
                "files": cache_files
            }
        },
        "restore": {
            "requires": "same or newer Riviamigo release",
            "provider_credentials": "re-authenticate after restore",
            "operator_command": "node scripts/restore-backup.mjs <package>"
        }
    }))
}

async fn collect_cache_files(cache_root: &Path) -> Result<Vec<serde_json::Value>, AppError> {
    let cache_root = cache_root.to_path_buf();
    tokio::task::spawn_blocking(move || {
        if !cache_root.exists() {
            return Ok(Vec::new());
        }

        let mut files = Vec::new();
        for entry in WalkDir::new(&cache_root) {
            let entry = entry.map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(&cache_root)
                .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;
            let relative = relative.to_string_lossy().replace('\\', "/");
            let sha256 = sha256_file(entry.path())?;
            let size_bytes = entry.metadata()?.len();
            files.push(json!({
                "path": format!("vehicle-image-cache/{relative}"),
                "sha256": sha256,
                "size_bytes": size_bytes,
            }));
        }
        files.sort_by(|left, right| left["path"].as_str().cmp(&right["path"].as_str()));
        Ok(files)
    })
    .await
    .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
}

async fn write_recovery_archive(
    artifact_path: &Path,
    dump_path: &Path,
    cache_root: &Path,
    manifest_bytes: &[u8],
) -> Result<(), AppError> {
    let artifact_path = artifact_path.to_path_buf();
    let dump_path = dump_path.to_path_buf();
    let cache_root = cache_root.to_path_buf();
    let manifest_bytes = manifest_bytes.to_vec();
    tokio::task::spawn_blocking(move || {
        let file = File::create(&artifact_path)?;
        let encoder = GzEncoder::new(file, Compression::default());
        let mut archive = Builder::new(encoder);

        let mut manifest_header = tar::Header::new_gnu();
        manifest_header.set_size(manifest_bytes.len() as u64);
        manifest_header.set_mode(0o600);
        manifest_header.set_cksum();
        archive.append_data(
            &mut manifest_header,
            "manifest.json",
            Cursor::new(manifest_bytes),
        )?;
        archive.append_path_with_name(&dump_path, "database.dump")?;

        if cache_root.is_dir() {
            archive.append_dir_all("vehicle-image-cache", &cache_root)?;
        } else {
            let mut directory_header = tar::Header::new_gnu();
            directory_header.set_entry_type(tar::EntryType::Directory);
            directory_header.set_size(0);
            directory_header.set_mode(0o700);
            directory_header.set_cksum();
            archive.append_data(
                &mut directory_header,
                "vehicle-image-cache",
                Cursor::new(Vec::<u8>::new()),
            )?;
        }

        let encoder = archive.into_inner()?;
        encoder.finish()?.sync_all()?;
        Ok::<(), anyhow::Error>(())
    })
    .await
    .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
    .map_err(AppError::from)
}

fn sha256_file(path: &Path) -> Result<String, anyhow::Error> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn current_database_name(pool: &PgPool) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT current_database()")
        .fetch_one(pool)
        .await
        .map_err(AppError::from)
}

async fn current_timescale_version(pool: &PgPool) -> Result<Option<String>, AppError> {
    sqlx::query_scalar("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'")
        .fetch_optional(pool)
        .await
        .map_err(AppError::from)
}

async fn compute_sha256(path: &Path) -> Result<String, AppError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let mut file = File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 16 * 1024];

        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }

        Ok::<String, anyhow::Error>(format!("{:x}", hasher.finalize()))
    })
    .await
    .map_err(|error| AppError::Internal(anyhow::anyhow!("checksum task failed: {error}")))?
    .map_err(AppError::from)
}

async fn prune_retained_artifacts(pool: &PgPool, retention_count: i32) -> Result<(), AppError> {
    let rows = sqlx::query_as::<_, PrunableArtifactRow>(
        r#"
        SELECT a.id, a.run_id, a.storage_path
        FROM riviamigo.backup_artifacts a
        ORDER BY a.created_at DESC
        OFFSET $1
        "#,
    )
    .bind(i64::from(retention_count.max(1)))
    .fetch_all(pool)
    .await?;

    for row in rows {
        let _ = fs::remove_file(&row.storage_path).await;
        sqlx::query("UPDATE riviamigo.backup_runs SET artifact_key = NULL, updated_at = now() WHERE id = $1")
            .bind(row.run_id)
            .execute(pool)
            .await?;
        sqlx::query("DELETE FROM riviamigo.backup_artifacts WHERE id = $1")
            .bind(row.id)
            .execute(pool)
            .await?;
    }

    Ok(())
}

fn normalize_prefix(value: &str) -> String {
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        "riviamigo".into()
    } else {
        trimmed.into()
    }
}

fn compute_due_run_at(
    settings: &BackupSettings,
    now_utc: DateTime<Utc>,
) -> Result<DateTime<Utc>, AppError> {
    let now_local = now_utc.with_timezone(&settings.timezone);
    let due_local = match settings.frequency {
        BackupFrequency::Daily => most_recent_daily_run(now_local, settings.run_at),
        BackupFrequency::Weekly => most_recent_weekly_run(
            now_local,
            settings.run_at,
            settings.day_of_week.unwrap_or(0),
        ),
        BackupFrequency::Monthly => most_recent_monthly_run(
            now_local,
            settings.run_at,
            settings.day_of_month.unwrap_or(1),
        ),
    };

    Ok(due_local.with_timezone(&Utc))
}

fn most_recent_daily_run(
    now_local: chrono::DateTime<Tz>,
    run_at: NaiveTime,
) -> chrono::DateTime<Tz> {
    let candidate = combine_local(now_local.timezone(), now_local.date_naive(), run_at);
    if candidate <= now_local {
        candidate
    } else {
        combine_local(
            now_local.timezone(),
            now_local.date_naive() - Duration::days(1),
            run_at,
        )
    }
}

fn most_recent_weekly_run(
    now_local: chrono::DateTime<Tz>,
    run_at: NaiveTime,
    day_of_week: i16,
) -> chrono::DateTime<Tz> {
    let current = now_local.weekday().num_days_from_sunday() as i16;
    let mut days_back = (current - day_of_week + 7) % 7;
    let mut candidate_date = now_local.date_naive() - Duration::days(i64::from(days_back));
    let mut candidate = combine_local(now_local.timezone(), candidate_date, run_at);

    if candidate > now_local {
        days_back = 7;
        candidate_date -= Duration::days(i64::from(days_back));
        candidate = combine_local(now_local.timezone(), candidate_date, run_at);
    }

    candidate
}

fn most_recent_monthly_run(
    now_local: chrono::DateTime<Tz>,
    run_at: NaiveTime,
    day_of_month: i16,
) -> chrono::DateTime<Tz> {
    let current_date = now_local.date_naive();
    let current_month_day =
        clamp_day_of_month(current_date.year(), current_date.month(), day_of_month);
    let mut candidate_date =
        NaiveDate::from_ymd_opt(current_date.year(), current_date.month(), current_month_day)
            .unwrap_or(current_date);
    let mut candidate = combine_local(now_local.timezone(), candidate_date, run_at);

    if candidate > now_local {
        let (year, month) = if current_date.month() == 1 {
            (current_date.year() - 1, 12)
        } else {
            (current_date.year(), current_date.month() - 1)
        };
        let previous_day = clamp_day_of_month(year, month, day_of_month);
        candidate_date = NaiveDate::from_ymd_opt(year, month, previous_day).unwrap_or(current_date);
        candidate = combine_local(now_local.timezone(), candidate_date, run_at);
    }

    candidate
}

fn clamp_day_of_month(year: i32, month: u32, day_of_month: i16) -> u32 {
    let max_day = days_in_month(year, month);
    (day_of_month.max(1) as u32).min(max_day)
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_of_next_month = NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(year, month, 1).expect("valid month"));
    let last_of_current_month = first_of_next_month - Duration::days(1);
    last_of_current_month.day()
}

fn combine_local(timezone: Tz, date: NaiveDate, time: NaiveTime) -> chrono::DateTime<Tz> {
    let naive = NaiveDateTime::new(date, time);
    match timezone.from_local_datetime(&naive) {
        chrono::LocalResult::Single(value) => value,
        chrono::LocalResult::Ambiguous(first, second) => first.min(second),
        chrono::LocalResult::None => timezone.from_utc_datetime(&naive),
    }
}

fn should_log_scheduler_failure(
    last_failure_signature: &mut Option<String>,
    error: &AppError,
) -> bool {
    let signature = format!("{error:?}");
    if last_failure_signature.as_deref() == Some(signature.as_str()) {
        false
    } else {
        *last_failure_signature = Some(signature);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{
        runtime_dependency_error_if_unavailable, should_log_scheduler_failure, BackupDriver,
    };
    use crate::errors::AppError;

    #[test]
    fn scheduler_failure_logging_is_deduplicated() {
        let mut last_failure_signature = None;
        let error = AppError::Conflict("backup already running".into());

        assert!(should_log_scheduler_failure(
            &mut last_failure_signature,
            &error
        ));
        assert!(!should_log_scheduler_failure(
            &mut last_failure_signature,
            &error
        ));
    }

    #[test]
    fn scheduler_failure_logging_resets_for_new_errors() {
        let mut last_failure_signature = None;
        let first = AppError::Conflict("first".into());
        let second = AppError::Conflict("second".into());

        assert!(should_log_scheduler_failure(
            &mut last_failure_signature,
            &first
        ));
        assert!(should_log_scheduler_failure(
            &mut last_failure_signature,
            &second
        ));
    }

    #[test]
    fn runtime_dependency_error_is_returned_when_pg_dump_is_missing() {
        let err = runtime_dependency_error_if_unavailable(BackupDriver::PgDump, false)
            .expect("expected dependency error");
        assert!(matches!(err, AppError::DependencyUnavailable(_)));
    }

}
