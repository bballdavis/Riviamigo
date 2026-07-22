use std::{
    collections::HashMap,
    fs::File,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration as StdDuration,
};

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use tar::{Archive, Builder};
use tokio::{fs, process::Command, time::MissedTickBehavior};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    config::Config,
    errors::AppError,
    ingestion::session_store::decrypt_json,
    services::{
        restore_compatibility::{self, RECOVERY_FORMAT_V1, RECOVERY_FORMAT_V2},
        s3_backups::{self, S3Settings},
    },
};

const BACKUP_ADVISORY_LOCK_ID: i64 = 2_042_051_101;
pub const RESTORE_CONFIRMATION_PHRASE: &str = "RESTORE";
static PG_DUMP_UNAVAILABLE_LOGGED: AtomicBool = AtomicBool::new(false);
const PG_DUMP_UNAVAILABLE_MESSAGE: &str = "pg_dump is not installed or not on PATH; install PostgreSQL client tools before creating a full recovery package";
const BACKUP_DRIVER_UNSUPPORTED_MESSAGE: &str =
    "manifest-only JSON backups are not valid recovery packages; use BACKUP_DRIVER=pg_dump";
const RECOVERY_PACKAGE_FORMAT: &str = RECOVERY_FORMAT_V2;

#[derive(Debug, Clone, Copy)]
pub enum BackupRunTrigger {
    Manual,
    Scheduled,
    PreRestore,
}

impl BackupRunTrigger {
    fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Scheduled => "scheduled",
            Self::PreRestore => "pre_restore",
        }
    }
}

#[derive(Debug)]
pub struct BackupExecutionResult {
    pub run_id: Uuid,
    pub artifact_ids: Vec<Uuid>,
}

#[derive(Debug, Clone)]
pub struct ValidatedRecoveryPackage {
    pub manifest: serde_json::Value,
    pub checksum_sha256: String,
    pub size_bytes: i64,
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
    local_enabled: bool,
    s3_enabled: bool,
    endpoint: String,
    region: Option<String>,
    bucket: String,
    access_key: Option<String>,
    secret_key_encrypted: Option<Vec<u8>>,
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
    local_enabled: bool,
    s3_enabled: bool,
    s3: Option<S3Settings>,
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
    let settings = load_settings(pool, config).await?;
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

        let package_manifest = execute_recovery_package(pool, config, &artifact_path, trigger, created_at).await?;

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
        let base_manifest = json!({
            "artifact_kind": driver.label(),
            "format": RECOVERY_PACKAGE_FORMAT,
            "package": package_manifest,
            "created_at": created_at,
            "database": database_name,
            "timescale_version": timescale_version,
            "trigger": trigger.as_str(),
            "prefix": settings.prefix,
            "retention_count": settings.retention_count,
        });
        let size_bytes = i64::try_from(metadata.len()).unwrap_or(i64::MAX);
        let retain_local = settings.local_enabled || matches!(trigger, BackupRunTrigger::PreRestore);
        let mut artifact_ids = Vec::new();
        if retain_local {
            let storage_type = if matches!(trigger, BackupRunTrigger::PreRestore) { "safety" } else { "local" };
            artifact_ids.push(insert_artifact(pool, Some(run_id), storage_type, &file_name, &storage_path, size_bytes, &checksum_sha256, with_storage(&base_manifest, storage_type, false)).await?);
        }

        let mut published_key = retain_local.then_some(storage_path.clone());
        if settings.s3_enabled && !matches!(trigger, BackupRunTrigger::PreRestore) {
            let s3 = settings.s3.as_ref().ok_or_else(|| AppError::Validation("S3 is enabled but its credentials are incomplete".into()))?;
            let key = s3_backups::object_key(&settings.prefix, created_at, run_id);
            if let Err(error) = s3_backups::upload(s3, &key, &artifact_path, &checksum_sha256, run_id, created_at).await {
                if !retain_local {
                    artifact_ids.push(insert_artifact(pool, Some(run_id), "local", &file_name, &storage_path, size_bytes, &checksum_sha256, with_storage(&base_manifest, "local", true)).await?);
                }
                return Err(AppError::DependencyUnavailable(format!("S3 upload failed; the recovery package was retained locally at {storage_path}: {error}")));
            }
            let remote_locator = s3_backups::locator(&s3.bucket, &key);
            artifact_ids.push(insert_artifact(pool, Some(run_id), "s3", &file_name, &remote_locator, size_bytes, &checksum_sha256, with_storage(&base_manifest, "s3", false)).await?);
            published_key = Some(remote_locator);
        }

        sqlx::query(
            r#"
            UPDATE riviamigo.backup_runs
            SET status = 'succeeded', artifact_key = $2, completed_at = now(), updated_at = now(), error_message = NULL
            WHERE id = $1
            "#,
        )
        .bind(run_id)
        .bind(published_key)
        .execute(pool)
        .await?;

        prune_retained_artifacts(pool, settings.retention_count).await?;
        if let Some(s3) = settings.s3.as_ref().filter(|_| settings.s3_enabled && !matches!(trigger, BackupRunTrigger::PreRestore)) {
            if let Err(error) = prune_remote_artifacts(pool, s3, settings.retention_count).await {
                if !retain_local {
                    artifact_ids.push(insert_artifact(pool, Some(run_id), "local", &file_name, &storage_path, size_bytes, &checksum_sha256, with_storage(&base_manifest, "local", true)).await?);
                }
                return Err(AppError::DependencyUnavailable(format!(
                    "S3 retention failed; the recovery package was retained locally at {storage_path}: {error}"
                )));
            }
        }
        if settings.s3_enabled && !retain_local && !matches!(trigger, BackupRunTrigger::PreRestore) {
            if let Err(error) = fs::remove_file(&artifact_path).await {
                tracing::warn!(
                    path = %artifact_path.display(),
                    error = %error,
                    "backup.cleanup.s3_staging_failed"
                );
            }
        }

        Ok::<BackupExecutionResult, AppError>(BackupExecutionResult { run_id, artifact_ids })
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

        let package_is_cataloged_locally: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM riviamigo.backup_artifacts
                WHERE run_id = $1 AND storage_type IN ('local', 'safety')
            )
            "#,
        )
        .bind(run_id)
        .fetch_one(pool)
        .await?;
        if !package_is_cataloged_locally && fs::try_exists(&artifact_path).await.unwrap_or(false) {
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

    let settings = load_settings(pool, config).await?;
    if !settings.enabled {
        return Ok(None);
    }

    let due_at = compute_due_run_at(&settings, Utc::now())?;
    let existing = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id
        FROM riviamigo.backup_runs
        WHERE trigger IN ('manual', 'scheduled')
          AND status IN ('pending', 'running', 'succeeded', 'failed')
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

async fn load_settings(pool: &PgPool, config: &Config) -> Result<BackupSettings, AppError> {
    let row = sqlx::query_as::<_, BackupSettingsRow>(
        r#"
        SELECT enabled, frequency, run_at, timezone, day_of_week, day_of_month, retention_count, prefix,
               local_enabled, s3_enabled, endpoint, region, bucket, access_key, secret_key_encrypted
        FROM riviamigo.backup_settings
        WHERE id = TRUE
        "#,
    )
    .fetch_optional(pool)
    .await?;

    match row {
        Some(row) => {
            let s3 = resolve_s3_settings(&row, config)?;
            Ok(BackupSettings {
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
                local_enabled: row.local_enabled,
                s3_enabled: row.s3_enabled,
                s3,
            })
        }
        None => Ok(BackupSettings {
            enabled: false,
            frequency: BackupFrequency::Weekly,
            run_at: NaiveTime::from_hms_opt(3, 0, 0).expect("valid default time"),
            timezone: "UTC".parse::<Tz>().expect("valid timezone"),
            day_of_week: Some(0),
            day_of_month: Some(1),
            retention_count: 8,
            prefix: "riviamigo".into(),
            local_enabled: true,
            s3_enabled: false,
            s3: None,
        }),
    }
}

fn resolve_s3_settings(
    row: &BackupSettingsRow,
    config: &Config,
) -> Result<Option<S3Settings>, AppError> {
    if !row.s3_enabled {
        return Ok(None);
    }
    let saved_secret = match row.secret_key_encrypted.as_deref() {
        Some(ciphertext) => {
            let identity = config
                .age_encryption_key
                .as_deref()
                .ok_or_else(|| {
                    AppError::Internal(anyhow::anyhow!("age encryption key is unavailable"))
                })?
                .parse::<age::x25519::Identity>()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid age encryption key")))?;
            Some(decrypt_json::<String>(ciphertext, &identity).map_err(AppError::Internal)?)
        }
        None => None,
    };
    let saved_pair = row.access_key.clone().zip(saved_secret);
    let env_pair = config
        .s3_access_key
        .clone()
        .zip(config.s3_secret_key.clone());
    let (access_key, secret_key) = saved_pair
        .or(env_pair)
        .ok_or_else(|| AppError::Validation("S3 access key and secret key are required".into()))?;
    let endpoint = if row.endpoint.trim().is_empty() {
        config.s3_endpoint.clone().unwrap_or_default()
    } else {
        row.endpoint.clone()
    };
    if row.bucket.trim().is_empty() {
        return Err(AppError::Validation("S3 bucket is required".into()));
    }
    Ok(Some(S3Settings {
        endpoint,
        region: row
            .region
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "us-east-1".into()),
        bucket: row.bucket.clone(),
        prefix: row.prefix.clone(),
        access_key,
        secret_key,
    }))
}

pub async fn configured_s3_settings(
    pool: &PgPool,
    config: &Config,
) -> Result<Option<S3Settings>, AppError> {
    Ok(load_settings(pool, config).await?.s3)
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
) -> Result<serde_json::Value, AppError> {
    let temp_root = std::env::temp_dir().join(format!("riviamigo-recovery-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_root).await?;
    let dump_path = temp_root.join("database.dump");
    let settings_path = temp_root.join("backup-settings.json");
    let history_path = temp_root.join("operational-history.json");
    let cache_root = PathBuf::from(&config.vehicle_image_cache_dir);

    let result = async {
        execute_pg_dump(config, &dump_path).await?;
        write_sanitized_backup_settings(pool, &settings_path).await?;
        write_operational_history(pool, &history_path).await?;
        let manifest = build_recovery_manifest(
            pool,
            &dump_path,
            &settings_path,
            &history_path,
            &cache_root,
            trigger,
            created_at,
        )
        .await?;
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;
        write_recovery_archive(
            artifact_path,
            &dump_path,
            &settings_path,
            &history_path,
            &cache_root,
            &manifest_bytes,
        )
        .await?;
        validate_recovery_package(artifact_path).await?;
        Ok::<serde_json::Value, AppError>(manifest)
    }
    .await;

    let _ = fs::remove_dir_all(&temp_root).await;
    result
}

pub async fn validate_recovery_package(
    package_path: &Path,
) -> Result<ValidatedRecoveryPackage, AppError> {
    let package_path = package_path.to_path_buf();
    tokio::task::spawn_blocking(move || validate_recovery_package_sync(&package_path))
        .await
        .map_err(|error| {
            AppError::Internal(anyhow::anyhow!("package validation task failed: {error}"))
        })?
}

/// Rebuild missing local catalog rows from the persistent backup directory.
/// Restore never deletes this directory, so the files are authoritative when
/// operational-history rows are absent or came from a different host.
pub async fn reconcile_local_catalog(pool: &PgPool, config: &Config) -> Result<usize, AppError> {
    let root = PathBuf::from(&config.backup_artifact_dir);
    if !fs::try_exists(&root).await.unwrap_or(false) {
        return Ok(0);
    }
    let scan_root = root.clone();
    let paths = tokio::task::spawn_blocking(move || {
        let mut paths = WalkDir::new(scan_root)
            .into_iter()
            .filter_entry(|entry| {
                entry
                    .file_name()
                    .to_str()
                    .is_none_or(|name| !name.starts_with('.'))
            })
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| entry.into_path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.ends_with(".rma.tar.gz"))
            })
            .collect::<Vec<_>>();
        paths.sort();
        paths
    })
    .await
    .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;

    let mut inserted = 0;
    for path in paths {
        let storage_path = path.to_string_lossy().into_owned();
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM riviamigo.backup_artifacts WHERE storage_type <> 's3' AND storage_path = $1)",
        )
        .bind(&storage_path)
        .fetch_one(pool)
        .await?;
        if exists {
            continue;
        }
        let validated = match validate_recovery_package(&path).await {
            Ok(validated) => validated,
            Err(error) => {
                tracing::warn!(path = %path.display(), error = %error, "backup.catalog.invalid_local_package");
                continue;
            }
        };
        let storage_type = if path.starts_with(root.join("imports")) {
            "uploaded"
        } else if validated
            .manifest
            .get("trigger")
            .and_then(serde_json::Value::as_str)
            == Some("pre_restore")
        {
            "safety"
        } else {
            "local"
        };
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("recovery-package.rma.tar.gz");
        let created_at = validated
            .manifest
            .get("created_at")
            .and_then(serde_json::Value::as_str)
            .and_then(|value| value.parse::<DateTime<Utc>>().ok())
            .unwrap_or_else(Utc::now);
        let result = sqlx::query(
            r#"
            INSERT INTO riviamigo.backup_artifacts
              (run_id, storage_type, file_name, storage_path, size_bytes, checksum_sha256, manifest, created_at)
            SELECT NULL, $1, $2, $3, $4, $5, $6, $7
            WHERE NOT EXISTS (
              SELECT 1 FROM riviamigo.backup_artifacts
              WHERE storage_type <> 's3' AND storage_path = $3
            )
            "#,
        )
        .bind(storage_type)
        .bind(file_name)
        .bind(&storage_path)
        .bind(validated.size_bytes)
        .bind(&validated.checksum_sha256)
        .bind(json!({
            "artifact_kind": "recovery_package",
            "format": validated.manifest.get("format").cloned().unwrap_or(serde_json::Value::Null),
            "package": validated.manifest,
            "restore_availability": "available",
            "catalog_source": "filesystem_rescan"
        }))
        .bind(created_at)
        .execute(pool)
        .await?;
        inserted += result.rows_affected() as usize;
    }
    Ok(inserted)
}

fn validate_recovery_package_sync(
    package_path: &Path,
) -> Result<ValidatedRecoveryPackage, AppError> {
    let metadata = std::fs::metadata(package_path)?;
    let package_checksum = sha256_file(package_path).map_err(AppError::from)?;
    let file = File::open(package_path)?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    let mut manifest_bytes = None;
    let mut file_checksums = HashMap::<String, String>::new();
    let mut file_sizes = HashMap::<String, u64>::new();
    let mut database_magic = Vec::with_capacity(5);

    for entry in archive
        .entries()
        .map_err(|error| AppError::Validation(format!("Invalid recovery archive: {error}")))?
    {
        let mut entry = entry.map_err(|error| {
            AppError::Validation(format!("Invalid recovery archive entry: {error}"))
        })?;
        let path = entry
            .path()
            .map_err(|error| AppError::Validation(format!("Invalid archive path: {error}")))?;
        let normalized = path.to_string_lossy().replace('\\', "/");
        let entry_type = entry.header().entry_type();
        if !entry_type.is_file() && !entry_type.is_dir() {
            return Err(AppError::Validation(format!(
                "Recovery package member {normalized} has unsupported archive type {}.",
                entry_type.as_byte()
            )));
        }
        if path.is_absolute()
            || normalized.starts_with('/')
            || normalized.split('/').any(|segment| segment == "..")
        {
            return Err(AppError::Validation(format!(
                "Unsafe recovery package path: {normalized}"
            )));
        }
        let allowed = matches!(
            normalized.as_str(),
            "manifest.json" | "database.dump" | "backup-settings.json" | "operational-history.json"
        ) || normalized == "vehicle-image-cache"
            || normalized.starts_with("vehicle-image-cache/");
        if !allowed {
            return Err(AppError::Validation(format!(
                "Unexpected recovery package member: {normalized}"
            )));
        }
        if entry_type.is_dir() {
            continue;
        }

        if normalized == "manifest.json" {
            if entry.size() > 1024 * 1024 {
                return Err(AppError::Validation(
                    "Recovery package manifest is unexpectedly large.".into(),
                ));
            }
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut bytes)?;
            manifest_bytes = Some(bytes);
            continue;
        }

        let entry_size = entry.size();
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = entry.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            if normalized == "database.dump" && database_magic.len() < 5 {
                let remaining = 5 - database_magic.len();
                database_magic.extend_from_slice(&buffer[..read.min(remaining)]);
            }
            hasher.update(&buffer[..read]);
        }
        file_sizes.insert(normalized.clone(), entry_size);
        file_checksums.insert(normalized, hex::encode(hasher.finalize()));
    }

    let manifest_bytes = manifest_bytes
        .ok_or_else(|| AppError::Validation("Recovery package is missing manifest.json.".into()))?;
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes).map_err(|error| {
        AppError::Validation(format!("Recovery manifest is invalid JSON: {error}"))
    })?;
    let format = manifest
        .get("format")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let format_version = manifest
        .get("format_version")
        .and_then(|value| value.as_u64());
    let supported_format = matches!(
        (format, format_version),
        (RECOVERY_FORMAT_V1, Some(1)) | (RECOVERY_FORMAT_V2, Some(2))
    );
    if !supported_format {
        return Err(AppError::Validation(
            "Unsupported recovery package format.".into(),
        ));
    }
    if format == RECOVERY_FORMAT_V2 {
        for pointer in [
            "/source/postgres_major",
            "/source/migration_version",
            "/source/migration_ledger",
            "/source/schema_fingerprint",
            "/restore/engine_version",
        ] {
            if manifest.pointer(pointer).is_none() {
                return Err(AppError::Validation(format!(
                    "Recovery v2 manifest is missing {pointer}."
                )));
            }
        }
        let engine_version = manifest
            .pointer("/restore/engine_version")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or_default();
        if engine_version == 0
            || engine_version > u64::from(restore_compatibility::RESTORE_ENGINE_VERSION)
        {
            return Err(AppError::Validation(format!(
                "Recovery package requires unsupported restore engine version {engine_version}."
            )));
        }
        validate_v2_migration_ledger(&manifest)?;
        for component in [
            "database",
            "backup_settings",
            "operational_history",
            "vehicle_image_cache",
        ] {
            let value = manifest
                .pointer(&format!("/components/{component}"))
                .ok_or_else(|| {
                    AppError::Validation(format!(
                        "Recovery v2 manifest is missing component {component}."
                    ))
                })?;
            if value.get("version").and_then(serde_json::Value::as_u64) != Some(1)
                || value
                    .get("restore_policy")
                    .and_then(serde_json::Value::as_str)
                    .is_none_or(str::is_empty)
                || !value
                    .get("redactions")
                    .is_some_and(serde_json::Value::is_array)
            {
                return Err(AppError::Validation(format!(
                    "Recovery v2 component {component} has an invalid contract."
                )));
            }
        }
    }

    verify_manifest_component(
        &manifest,
        &file_checksums,
        &file_sizes,
        "database",
        "database.dump",
    )?;
    if database_magic != b"PGDMP" {
        return Err(AppError::Validation(
            "Recovery package database.dump is not a PostgreSQL custom-format dump.".into(),
        ));
    }
    verify_manifest_component(
        &manifest,
        &file_checksums,
        &file_sizes,
        "backup_settings",
        "backup-settings.json",
    )?;
    if format == RECOVERY_FORMAT_V2 {
        verify_manifest_component(
            &manifest,
            &file_checksums,
            &file_sizes,
            "operational_history",
            "operational-history.json",
        )?;
    }
    if let Some(files) = manifest
        .pointer("/components/vehicle_image_cache/files")
        .and_then(|value| value.as_array())
    {
        for file in files {
            let path = file
                .get("path")
                .and_then(|value| value.as_str())
                .ok_or_else(|| {
                    AppError::Validation("Artwork manifest entry is missing its path.".into())
                })?;
            let expected = file
                .get("sha256")
                .and_then(|value| value.as_str())
                .ok_or_else(|| {
                    AppError::Validation("Artwork manifest entry is missing its checksum.".into())
                })?;
            if file_checksums.get(path).map(String::as_str) != Some(expected) {
                return Err(AppError::Validation(format!(
                    "Recovery package checksum mismatch for {path}."
                )));
            }
            let expected_size = file
                .get("size_bytes")
                .and_then(serde_json::Value::as_u64)
                .ok_or_else(|| {
                    AppError::Validation("Artwork manifest entry is missing its size.".into())
                })?;
            if file_sizes.get(path).copied() != Some(expected_size) {
                return Err(AppError::Validation(format!(
                    "Recovery package size mismatch for {path}."
                )));
            }
        }
        if format == RECOVERY_FORMAT_V2 {
            validate_v2_artwork_component(&manifest, files)?;
        }
    }

    Ok(ValidatedRecoveryPackage {
        manifest,
        checksum_sha256: package_checksum,
        size_bytes: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
    })
}

fn verify_manifest_component(
    manifest: &serde_json::Value,
    checksums: &HashMap<String, String>,
    sizes: &HashMap<String, u64>,
    component: &str,
    expected_path: &str,
) -> Result<(), AppError> {
    let component = manifest
        .pointer(&format!("/components/{component}"))
        .ok_or_else(|| {
            AppError::Validation(format!("Recovery manifest is missing {component}."))
        })?;
    let path = component
        .get("path")
        .and_then(|value| value.as_str())
        .unwrap_or(expected_path);
    let expected = component
        .get("sha256")
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Recovery manifest is missing the checksum for {component}."
            ))
        })?;
    if path != expected_path || checksums.get(path).map(String::as_str) != Some(expected) {
        return Err(AppError::Validation(format!(
            "Recovery package checksum mismatch for {expected_path}."
        )));
    }
    let expected_size = component
        .get("size_bytes")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Recovery manifest is missing the size for {expected_path}."
            ))
        })?;
    if sizes.get(path).copied() != Some(expected_size) {
        return Err(AppError::Validation(format!(
            "Recovery package size mismatch for {expected_path}."
        )));
    }
    Ok(())
}

fn validate_v2_migration_ledger(manifest: &serde_json::Value) -> Result<(), AppError> {
    let migration_version = manifest
        .pointer("/source/migration_version")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default();
    let ledger = manifest
        .pointer("/source/migration_ledger")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| AppError::Validation("Recovery v2 migration ledger is invalid.".into()))?;
    if migration_version < 1 || ledger.is_empty() {
        return Err(AppError::Validation(
            "Recovery v2 migration ledger is incomplete.".into(),
        ));
    }
    let mut previous_version = None;
    for migration in ledger {
        let version = migration
            .get("version")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or_default();
        if version < 1
            || previous_version.is_some_and(|previous| version <= previous)
            || migration
                .get("checksum_sha384")
                .and_then(serde_json::Value::as_str)
                .is_none_or(str::is_empty)
        {
            return Err(AppError::Validation(format!(
                "Recovery v2 migration ledger entry {version} is invalid."
            )));
        }
        previous_version = Some(version);
    }
    if previous_version != Some(migration_version) {
        return Err(AppError::Validation(
            "Recovery v2 migration ledger does not end at the declared migration version.".into(),
        ));
    }
    Ok(())
}

fn validate_v2_artwork_component(
    manifest: &serde_json::Value,
    files: &[serde_json::Value],
) -> Result<(), AppError> {
    let component = manifest
        .pointer("/components/vehicle_image_cache")
        .ok_or_else(|| AppError::Validation("Recovery v2 artwork component is missing.".into()))?;
    let expected_checksum = component
        .get("sha256")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            AppError::Validation("Recovery v2 artwork component checksum is missing.".into())
        })?;
    let actual_checksum = hex::encode(Sha256::digest(
        serde_json::to_vec(files).map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?,
    ));
    let actual_size = files
        .iter()
        .filter_map(|file| file.get("size_bytes").and_then(serde_json::Value::as_u64))
        .sum::<u64>();
    if expected_checksum != actual_checksum
        || component
            .get("size_bytes")
            .and_then(serde_json::Value::as_u64)
            != Some(actual_size)
        || component
            .get("file_count")
            .and_then(serde_json::Value::as_u64)
            != Some(files.len() as u64)
    {
        return Err(AppError::Validation(
            "Recovery v2 artwork component summary is inconsistent.".into(),
        ));
    }
    Ok(())
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
        // Activity rows reference redacted external connection settings and
        // cannot be restored without the corresponding provider records.
        .arg("--exclude-table-data=riviamigo.external_connection_activity")
        // Backup settings are restored from backup-settings.json after the
        // dump, which keeps the encrypted target secret out of the package.
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

/// Builds the manifest for the portable recovery package.
async fn build_recovery_manifest(
    pool: &PgPool,
    dump_path: &Path,
    settings_path: &Path,
    history_path: &Path,
    cache_root: &Path,
    trigger: BackupRunTrigger,
    created_at: DateTime<Utc>,
) -> Result<serde_json::Value, AppError> {
    let current_database = current_database_name(pool).await?;
    let database_profile = restore_compatibility::runtime_database_profile(pool).await?;
    let database_checksum = compute_sha256(dump_path).await?;
    let settings_checksum = compute_sha256(settings_path).await?;
    let history_checksum = compute_sha256(history_path).await?;
    let cache_files = collect_cache_files(cache_root).await?;
    let cache_size_bytes = cache_files
        .iter()
        .filter_map(|file| file.get("size_bytes").and_then(serde_json::Value::as_u64))
        .sum::<u64>();
    let cache_checksum = hex::encode(Sha256::digest(
        serde_json::to_vec(&cache_files)
            .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?,
    ));

    Ok(json!({
        "format": RECOVERY_PACKAGE_FORMAT,
        "format_version": 2,
        "created_at": created_at,
        "trigger": trigger.as_str(),
        "source": {
            "app_version": std::env::var("RIVIAMIGO_BUILD_VERSION").unwrap_or_else(|_| env!("CARGO_PKG_VERSION").into()),
            "database": current_database,
            "postgres_major": database_profile.postgres_major,
            "timescale_version": database_profile.timescale_version,
            "migration_version": database_profile.migration_version,
            "migration_ledger": database_profile.migration_ledger,
            "schema_fingerprint": database_profile.schema_fingerprint,
        },
        "scope": {
            "included": [
                "PostgreSQL durable application data",
                "TimescaleDB telemetry and enrichment data",
                "vehicle artwork cache files",
                "sanitized backup schedule and target configuration",
                "backup execution, package catalog, and restore request history"
            ],
            "redacted": [
                "vehicle_credentials table data (provider credential tokens)",
                "external_connection_settings table data (provider bearer tokens and target secrets)",
                "system_config table data (installation cryptographic keys)",
                "refresh_tokens",
                "backup_settings.secret_key_encrypted"
            ],
            "excluded": [
                "Redis live state, pub/sub messages, and OTP challenges",
                "browser localStorage and sessionStorage",
                "external provider connection cache state and activity history"
            ]
        },
        "components": {
            "database": {
                "version": 1,
                "path": "database.dump",
                "sha256": database_checksum,
                "size_bytes": std::fs::metadata(dump_path).map(|metadata| metadata.len()).unwrap_or(0),
                "restore_policy": "replace_isolated_candidate",
                "redactions": ["vehicle_credentials", "external_connection_settings", "system_config", "refresh_tokens", "external_connection_activity", "backup_settings", "backup_runs", "backup_artifacts", "backup_restore_requests"]
            },
            "backup_settings": {
                "version": 1,
                "path": "backup-settings.json",
                "sha256": settings_checksum,
                "size_bytes": std::fs::metadata(settings_path).map(|metadata| metadata.len()).unwrap_or(0),
                "restore_policy": "replace_sanitized_settings",
                "redactions": ["secret_key_encrypted"]
            },
            "operational_history": {
                "version": 1,
                "path": "operational-history.json",
                "sha256": history_checksum,
                "size_bytes": std::fs::metadata(history_path).map(|metadata| metadata.len()).unwrap_or(0),
                "restore_policy": "merge_target_wins",
                "redactions": ["requested_by"]
            },
            "vehicle_image_cache": {
                "version": 1,
                "path": "vehicle-image-cache",
                "sha256": cache_checksum,
                "size_bytes": cache_size_bytes,
                "file_count": cache_files.len(),
                "restore_policy": "replace_atomically",
                "redactions": [],
                "files": cache_files
            }
        },
        "restore": {
            "engine_version": restore_compatibility::RESTORE_ENGINE_VERSION,
            "requires": "same or newer Riviamigo release",
            "provider_credentials": "re-authenticate after restore",
            "operator_command": "node scripts/restore-backup.mjs <package>"
        }
    }))
}

async fn write_sanitized_backup_settings(pool: &PgPool, path: &Path) -> Result<(), AppError> {
    let settings: serde_json::Value = sqlx::query_scalar(
        r#"SELECT COALESCE((
            SELECT jsonb_build_object(
                'present', TRUE,
                'enabled', enabled,
                'frequency', frequency,
                'run_at', run_at,
                'timezone', timezone,
                'day_of_week', day_of_week,
                'day_of_month', day_of_month,
                'retention_count', retention_count,
                'local_enabled', local_enabled,
                's3_enabled', s3_enabled,
                'target_type', target_type,
                'endpoint', endpoint,
                'region', region,
                'bucket', bucket,
                'prefix', prefix,
                'access_key', access_key
            )
            FROM riviamigo.backup_settings
            WHERE id = TRUE
        ), '{"present": false}'::jsonb)"#,
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::from)?;
    let bytes = serde_json::to_vec_pretty(&settings)
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;
    fs::write(path, bytes).await.map_err(AppError::from)
}

async fn write_operational_history(pool: &PgPool, path: &Path) -> Result<(), AppError> {
    let snapshot = crate::services::restore_jobs::snapshot_catalog(pool).await?;
    let bytes = serde_json::to_vec_pretty(&snapshot)
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;
    fs::write(path, bytes).await.map_err(AppError::from)
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
            let size_bytes = entry
                .metadata()
                .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
                .len();
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
    settings_path: &Path,
    history_path: &Path,
    cache_root: &Path,
    manifest_bytes: &[u8],
) -> Result<(), AppError> {
    let artifact_path = artifact_path.to_path_buf();
    let dump_path = dump_path.to_path_buf();
    let settings_path = settings_path.to_path_buf();
    let history_path = history_path.to_path_buf();
    let cache_root = cache_root.to_path_buf();
    let manifest_bytes = manifest_bytes.to_vec();
    tokio::task::spawn_blocking(move || {
        fn append_regular_file(
            archive: &mut Builder<GzEncoder<File>>,
            source: &Path,
            archive_path: &str,
        ) -> Result<(), anyhow::Error> {
            let mut source_file = File::open(source)?;
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(tar::EntryType::Regular);
            header.set_size(source_file.metadata()?.len());
            header.set_mode(0o600);
            header.set_cksum();
            archive.append_data(&mut header, archive_path, &mut source_file)?;
            Ok(())
        }

        fn append_directory(
            archive: &mut Builder<GzEncoder<File>>,
            archive_path: &str,
        ) -> Result<(), anyhow::Error> {
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(tar::EntryType::Directory);
            header.set_size(0);
            header.set_mode(0o700);
            header.set_cksum();
            archive.append_data(&mut header, archive_path, Cursor::new(Vec::<u8>::new()))?;
            Ok(())
        }

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
        append_regular_file(&mut archive, &dump_path, "database.dump")?;
        append_regular_file(&mut archive, &settings_path, "backup-settings.json")?;
        append_regular_file(&mut archive, &history_path, "operational-history.json")?;

        append_directory(&mut archive, "vehicle-image-cache")?;
        if cache_root.is_dir() {
            let mut cache_files = WalkDir::new(&cache_root)
                .follow_links(false)
                .into_iter()
                .filter_map(|entry| match entry {
                    Ok(entry) if entry.file_type().is_file() => Some(Ok(entry.into_path())),
                    Ok(_) => None,
                    Err(error) => Some(Err(anyhow::anyhow!(error))),
                })
                .collect::<Result<Vec<_>, _>>()?;
            cache_files.sort();
            for cache_file in cache_files {
                let relative = cache_file.strip_prefix(&cache_root)?;
                let relative = relative.to_string_lossy().replace('\\', "/");
                append_regular_file(
                    &mut archive,
                    &cache_file,
                    &format!("vehicle-image-cache/{relative}"),
                )?;
            }
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
    Ok(hex::encode(hasher.finalize()))
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

        Ok::<String, anyhow::Error>(hex::encode(hasher.finalize()))
    })
    .await
    .map_err(|error| AppError::Internal(anyhow::anyhow!("checksum task failed: {error}")))?
    .map_err(AppError::from)
}

fn with_storage(
    base: &serde_json::Value,
    storage_type: &str,
    emergency_fallback: bool,
) -> serde_json::Value {
    let mut value = base.clone();
    if let Some(object) = value.as_object_mut() {
        object.insert("storage_type".into(), json!(storage_type));
        if emergency_fallback {
            object.insert("emergency_fallback".into(), json!(true));
        }
    }
    value
}

async fn insert_artifact(
    pool: &PgPool,
    run_id: Option<Uuid>,
    storage_type: &str,
    file_name: &str,
    storage_path: &str,
    size_bytes: i64,
    checksum_sha256: &str,
    manifest: serde_json::Value,
) -> Result<Uuid, AppError> {
    Ok(sqlx::query_scalar(
        r#"INSERT INTO riviamigo.backup_artifacts
           (run_id, storage_type, file_name, storage_path, size_bytes, checksum_sha256, manifest)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (storage_path) WHERE storage_type = 's3'
           DO UPDATE SET file_name = EXCLUDED.file_name, size_bytes = EXCLUDED.size_bytes,
                         checksum_sha256 = EXCLUDED.checksum_sha256, manifest = EXCLUDED.manifest
           RETURNING id"#,
    )
    .bind(run_id)
    .bind(storage_type)
    .bind(file_name)
    .bind(storage_path)
    .bind(size_bytes)
    .bind(checksum_sha256)
    .bind(manifest)
    .fetch_one(pool)
    .await?)
}

async fn prune_retained_artifacts(pool: &PgPool, retention_count: i32) -> Result<(), AppError> {
    let rows = sqlx::query_as::<_, PrunableArtifactRow>(
        r#"
        SELECT a.id, a.run_id, a.storage_path
        FROM riviamigo.backup_artifacts a
        WHERE a.storage_type = 'local'
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

async fn prune_remote_artifacts(
    pool: &PgPool,
    settings: &S3Settings,
    retention_count: i32,
) -> Result<(), AppError> {
    let rows = s3_backups::list(settings)
        .await
        .map_err(|error| AppError::DependencyUnavailable(error.to_string()))?;
    for row in rows.into_iter().skip(retention_count.max(1) as usize) {
        s3_backups::delete(settings, &row.key)
            .await
            .map_err(|error| AppError::DependencyUnavailable(error.to_string()))?;
        sqlx::query("DELETE FROM riviamigo.backup_artifacts WHERE storage_type = 's3' AND storage_path = $1")
            .bind(s3_backups::locator(&settings.bucket, &row.key))
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
        runtime_dependency_error_if_unavailable, sha256_file, should_log_scheduler_failure,
        validate_recovery_package, write_recovery_archive, BackupDriver,
    };
    use crate::{errors::AppError, services::restore_compatibility};
    use flate2::read::GzDecoder;
    use sha2::{Digest, Sha256};
    use std::io::Read;
    use tar::Archive;
    use uuid::Uuid;

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

    #[tokio::test]
    async fn recovery_archive_contains_manifest_database_and_artwork() {
        let root = std::env::temp_dir().join(format!("riviamigo-backup-test-{}", Uuid::new_v4()));
        let cache = root.join("cache");
        let dump = root.join("database.dump");
        let settings = root.join("backup-settings.json");
        let history = root.join("operational-history.json");
        let archive = root.join("backup.rma.tar.gz");
        std::fs::create_dir_all(cache.join("vehicle-1")).expect("cache directory");
        std::fs::write(cache.join("vehicle-1/artwork.webp"), b"artwork").expect("artwork");
        std::fs::write(&dump, b"PGDMPdatabase").expect("dump");
        std::fs::write(&settings, br#"{"present":false}"#).expect("settings");
        std::fs::write(
            &history,
            br#"{"runs":[],"artifacts":[],"restore_requests":[]}"#,
        )
        .expect("history");

        let manifest = serde_json::json!({
            "format": "riviamigo-recovery-v1",
            "format_version": 1,
            "components": {
                "database": { "path": "database.dump", "sha256": sha256_file(&dump).expect("dump checksum"), "size_bytes": std::fs::metadata(&dump).expect("dump metadata").len() },
                "backup_settings": { "path": "backup-settings.json", "sha256": sha256_file(&settings).expect("settings checksum"), "size_bytes": std::fs::metadata(&settings).expect("settings metadata").len() },
                "vehicle_image_cache": {
                    "files": [{
                        "path": "vehicle-image-cache/vehicle-1/artwork.webp",
                        "sha256": sha256_file(&cache.join("vehicle-1/artwork.webp")).expect("artwork checksum"),
                        "size_bytes": std::fs::metadata(cache.join("vehicle-1/artwork.webp")).expect("artwork metadata").len()
                    }]
                }
            }
        });
        write_recovery_archive(
            &archive,
            &dump,
            &settings,
            &history,
            &cache,
            &serde_json::to_vec(&manifest).expect("manifest"),
        )
        .await
        .expect("archive");

        let validated = validate_recovery_package(&archive)
            .await
            .expect("valid package");
        assert_eq!(validated.manifest["format"], "riviamigo-recovery-v1");

        let file = std::fs::File::open(&archive).expect("open archive");
        let decoder = GzDecoder::new(file);
        let mut tar = Archive::new(decoder);
        let mut names = Vec::new();
        for entry in tar.entries().expect("entries") {
            let mut entry = entry.expect("entry");
            names.push(
                entry
                    .path()
                    .expect("path")
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
            let mut contents = Vec::new();
            entry.read_to_end(&mut contents).expect("read entry");
        }

        assert!(names.iter().any(|name| name == "manifest.json"));
        assert!(names.iter().any(|name| name == "database.dump"));
        assert!(names.iter().any(|name| name == "backup-settings.json"));
        assert!(names.iter().any(|name| name == "operational-history.json"));
        assert!(names
            .iter()
            .any(|name| name.ends_with("vehicle-1/artwork.webp")));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn recovery_v2_archive_enforces_the_versioned_component_contract() {
        let root = std::env::temp_dir().join(format!("riviamigo-backup-v2-{}", Uuid::new_v4()));
        let cache = root.join("cache");
        let artwork = cache.join("vehicle-1/artwork.webp");
        let dump = root.join("database.dump");
        let settings = root.join("backup-settings.json");
        let history = root.join("operational-history.json");
        let archive = root.join("backup-v2.rma.tar.gz");
        std::fs::create_dir_all(artwork.parent().expect("artwork parent")).expect("cache");
        std::fs::write(&artwork, b"artwork").expect("artwork");
        std::fs::write(&dump, b"PGDMPdatabase").expect("dump");
        std::fs::write(&settings, br#"{"present":false}"#).expect("settings");
        std::fs::write(
            &history,
            br#"{"runs":[],"artifacts":[],"restore_requests":[]}"#,
        )
        .expect("history");
        let cache_files = vec![serde_json::json!({
            "path": "vehicle-image-cache/vehicle-1/artwork.webp",
            "sha256": sha256_file(&artwork).expect("artwork checksum"),
            "size_bytes": std::fs::metadata(&artwork).expect("artwork metadata").len()
        })];
        let cache_checksum = hex::encode(Sha256::digest(
            serde_json::to_vec(&cache_files).expect("cache manifest"),
        ));
        let contract = |path: &str, checksum: String, size: u64, policy: &str| {
            serde_json::json!({
                "version": 1,
                "path": path,
                "sha256": checksum,
                "size_bytes": size,
                "restore_policy": policy,
                "redactions": []
            })
        };
        let manifest = serde_json::json!({
            "format": "riviamigo-recovery-v2",
            "format_version": 2,
            "source": {
                "postgres_major": 18,
                "timescale_version": "2.28.3",
                "migration_version": restore_compatibility::latest_migration_version(),
                "migration_ledger": restore_compatibility::compiled_migration_ledger(),
                "schema_fingerprint": "test-fingerprint"
            },
            "components": {
                "database": contract("database.dump", sha256_file(&dump).expect("dump checksum"), std::fs::metadata(&dump).expect("dump metadata").len(), "replace_isolated_candidate"),
                "backup_settings": contract("backup-settings.json", sha256_file(&settings).expect("settings checksum"), std::fs::metadata(&settings).expect("settings metadata").len(), "replace_sanitized_settings"),
                "operational_history": contract("operational-history.json", sha256_file(&history).expect("history checksum"), std::fs::metadata(&history).expect("history metadata").len(), "merge_target_wins"),
                "vehicle_image_cache": {
                    "version": 1,
                    "path": "vehicle-image-cache",
                    "sha256": cache_checksum,
                    "size_bytes": std::fs::metadata(&artwork).expect("artwork metadata").len(),
                    "file_count": 1,
                    "restore_policy": "replace_atomically",
                    "redactions": [],
                    "files": cache_files
                }
            },
            "restore": { "engine_version": restore_compatibility::RESTORE_ENGINE_VERSION }
        });
        write_recovery_archive(
            &archive,
            &dump,
            &settings,
            &history,
            &cache,
            &serde_json::to_vec(&manifest).expect("manifest"),
        )
        .await
        .expect("archive");

        let validated = validate_recovery_package(&archive)
            .await
            .expect("valid v2 package");
        assert_eq!(validated.manifest["format"], "riviamigo-recovery-v2");
        let _ = std::fs::remove_dir_all(root);
    }
}
