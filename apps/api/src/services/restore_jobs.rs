use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::fs;
use uuid::Uuid;

use crate::{config::Config, errors::AppError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RestorePhase {
    Queued,
    SafetyBackup,
    StoppingApplication,
    RestoringDatabase,
    RestoringSettings,
    RestoringArtwork,
    StartingApplication,
    VerifyingHealth,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreJob {
    pub id: Uuid,
    pub artifact_id: Uuid,
    pub artifact_path: String,
    pub safety_artifact_path: Option<String>,
    #[serde(default)]
    pub safety_run_id: Option<Uuid>,
    #[serde(default)]
    pub safety_artifact_id: Option<Uuid>,
    pub restore_request_id: Uuid,
    pub phase: RestorePhase,
    pub progress_percent: u8,
    pub message: String,
    pub error_message: Option<String>,
    pub capability_sha256: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub reconciled_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub catalog_snapshot: Option<BackupCatalogSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BackupCatalogSnapshot {
    pub runs: Vec<BackupRunSnapshot>,
    pub artifacts: Vec<BackupArtifactSnapshot>,
    pub restore_requests: Vec<BackupRestoreRequestSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupRunSnapshot {
    pub id: Uuid,
    pub trigger: String,
    pub status: String,
    pub artifact_key: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupArtifactSnapshot {
    pub id: Uuid,
    pub run_id: Uuid,
    pub storage_type: String,
    pub file_name: String,
    pub storage_path: String,
    pub size_bytes: i64,
    pub checksum_sha256: String,
    pub manifest: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupRestoreRequestSnapshot {
    pub id: Uuid,
    pub artifact_id: Uuid,
    pub status: String,
    pub confirmation_phrase: String,
    pub notes: Option<String>,
    pub error_message: Option<String>,
    pub requested_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RestoreJobPublic {
    pub id: Uuid,
    pub artifact_id: Uuid,
    pub phase: RestorePhase,
    pub progress_percent: u8,
    pub message: String,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl RestoreJob {
    pub fn public(&self) -> RestoreJobPublic {
        RestoreJobPublic {
            id: self.id,
            artifact_id: self.artifact_id,
            phase: self.phase.clone(),
            progress_percent: self.progress_percent,
            message: self.message.clone(),
            error_message: self.error_message.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

pub async fn create(
    config: &Config,
    artifact_id: Uuid,
    artifact_path: String,
    restore_request_id: Uuid,
) -> Result<(RestoreJob, String), AppError> {
    let mut token_bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut token_bytes);
    let token = hex::encode(token_bytes);
    let now = Utc::now();
    let job = RestoreJob {
        id: Uuid::new_v4(),
        artifact_id,
        artifact_path,
        safety_artifact_path: None,
        safety_run_id: None,
        safety_artifact_id: None,
        restore_request_id,
        phase: RestorePhase::Queued,
        progress_percent: 5,
        message: "Restore queued".into(),
        error_message: None,
        capability_sha256: token_hash(&token),
        created_at: now,
        updated_at: now,
        reconciled_at: None,
        catalog_snapshot: None,
    };
    write(config, &job).await?;
    Ok((job, token))
}

pub async fn snapshot_catalog(pool: &PgPool) -> Result<BackupCatalogSnapshot, AppError> {
    let runs = sqlx::query_as::<_, (Uuid, String, String, Option<String>, Option<DateTime<Utc>>, Option<DateTime<Utc>>, Option<String>, DateTime<Utc>, DateTime<Utc>)>(
        "SELECT id, trigger, status, artifact_key, started_at, completed_at, error_message, created_at, updated_at FROM riviamigo.backup_runs ORDER BY created_at",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| BackupRunSnapshot { id: row.0, trigger: row.1, status: row.2, artifact_key: row.3, started_at: row.4, completed_at: row.5, error_message: row.6, created_at: row.7, updated_at: row.8 })
    .collect();
    let artifacts = sqlx::query_as::<_, (Uuid, Uuid, String, String, String, i64, String, Value, DateTime<Utc>)>(
        "SELECT id, run_id, storage_type, file_name, storage_path, size_bytes, checksum_sha256, manifest, created_at FROM riviamigo.backup_artifacts ORDER BY created_at",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| BackupArtifactSnapshot { id: row.0, run_id: row.1, storage_type: row.2, file_name: row.3, storage_path: row.4, size_bytes: row.5, checksum_sha256: row.6, manifest: row.7, created_at: row.8 })
    .collect();
    let restore_requests = sqlx::query_as::<_, (Uuid, Uuid, String, String, Option<String>, Option<String>, DateTime<Utc>, DateTime<Utc>)>(
        "SELECT id, artifact_id, status, confirmation_phrase, notes, error_message, requested_at, updated_at FROM riviamigo.backup_restore_requests ORDER BY requested_at",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| BackupRestoreRequestSnapshot { id: row.0, artifact_id: row.1, status: row.2, confirmation_phrase: row.3, notes: row.4, error_message: row.5, requested_at: row.6, updated_at: row.7 })
    .collect();
    Ok(BackupCatalogSnapshot {
        runs,
        artifacts,
        restore_requests,
    })
}

pub async fn read(config: &Config, id: Uuid) -> Result<RestoreJob, AppError> {
    let bytes = fs::read(job_path(config, id))
        .await
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound,
            _ => AppError::Io(error),
        })?;
    serde_json::from_slice(&bytes)
        .map_err(|error| AppError::Internal(anyhow::anyhow!("invalid restore job record: {error}")))
}

pub async fn write(config: &Config, job: &RestoreJob) -> Result<(), AppError> {
    let directory = jobs_dir(config);
    fs::create_dir_all(&directory).await?;
    let path = job_path(config, job.id);
    let temporary = directory.join(format!(".{}.tmp", job.id));
    let bytes = serde_json::to_vec_pretty(job)
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;
    fs::write(&temporary, bytes).await?;
    fs::rename(&temporary, &path).await?;
    Ok(())
}

pub async fn update(
    config: &Config,
    id: Uuid,
    phase: RestorePhase,
    progress_percent: u8,
    message: impl Into<String>,
) -> Result<RestoreJob, AppError> {
    let mut job = read(config, id).await?;
    job.phase = phase;
    job.progress_percent = progress_percent.min(100);
    job.message = message.into();
    job.updated_at = Utc::now();
    write(config, &job).await?;
    Ok(job)
}

pub async fn fail(config: &Config, id: Uuid, error: impl ToString) -> Result<(), AppError> {
    let mut job = read(config, id).await?;
    let message = error.to_string();
    job.phase = RestorePhase::Failed;
    job.progress_percent = job.progress_percent.min(99);
    job.message = "Restore failed".into();
    job.error_message = Some(message);
    job.updated_at = Utc::now();
    write(config, &job).await
}

pub fn token_matches(job: &RestoreJob, token: &str) -> bool {
    job.capability_sha256 == token_hash(token)
}

pub fn agent_key_path(config: &Config) -> PathBuf {
    PathBuf::from(&config.restore_agent_key_file)
}

pub async fn agent_readiness(config: &Config) -> Result<(), String> {
    let key = fs::read_to_string(agent_key_path(config))
        .await
        .map_err(|error| format!("restore supervisor key is unavailable: {error}"))?;
    if key.trim().is_empty() {
        return Err("restore supervisor key is empty".into());
    }

    let health_url = format!("{}/health", config.restore_agent_url.trim_end_matches('/'));
    reqwest::Client::new()
        .get(health_url)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .map_err(|error| format!("restore supervisor is not reachable: {error}"))?
        .error_for_status()
        .map_err(|error| format!("restore supervisor health check failed: {error}"))?;
    Ok(())
}

pub async fn agent_is_ready(config: &Config) -> bool {
    agent_readiness(config).await.is_ok()
}

pub async fn reconcile_completed_jobs(pool: &PgPool, config: &Config) -> Result<(), AppError> {
    let directory = jobs_dir(config);
    if !fs::try_exists(&directory).await.unwrap_or(false) {
        return Ok(());
    }
    let mut entries = fs::read_dir(&directory).await?;
    while let Some(entry) = entries.next_entry().await? {
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let bytes = match fs::read(entry.path()).await {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let mut job: RestoreJob = match serde_json::from_slice(&bytes) {
            Ok(job) => job,
            Err(_) => continue,
        };
        if job.phase != RestorePhase::Completed || job.reconciled_at.is_some() {
            continue;
        }

        if let Some(snapshot) = &job.catalog_snapshot {
            restore_catalog_snapshot(pool, snapshot).await?;
        }

        if job.catalog_snapshot.is_none() {
            let imported =
                crate::services::backups::validate_recovery_package(Path::new(&job.artifact_path))
                    .await?;
            insert_reconciled_artifact(
                pool,
                job.id,
                job.artifact_id,
                "restore",
                "uploaded",
                &job.artifact_path,
                imported,
            )
            .await?;
        }
        if let (Some(run_id), Some(artifact_id), Some(path)) = (
            job.safety_run_id,
            job.safety_artifact_id,
            job.safety_artifact_path.as_deref(),
        ) {
            let safety =
                crate::services::backups::validate_recovery_package(Path::new(path)).await?;
            insert_reconciled_artifact(
                pool,
                run_id,
                artifact_id,
                "pre_restore",
                "safety",
                path,
                safety,
            )
            .await?;
        }
        sqlx::query(
            r#"
            INSERT INTO riviamigo.backup_restore_requests (
                id, artifact_id, requested_by, status, confirmation_phrase, notes, requested_at, updated_at
            ) VALUES ($1, $2, NULL, 'completed', 'RESTORE', 'Automated in-app restore completed', $3, now())
            ON CONFLICT (id) DO UPDATE SET
                status = 'completed', error_message = NULL, updated_at = now()
            "#,
        )
        .bind(job.restore_request_id)
        .bind(job.artifact_id)
        .bind(job.created_at)
        .execute(pool)
        .await?;
        job.reconciled_at = Some(Utc::now());
        write(config, &job).await?;
    }
    Ok(())
}

async fn restore_catalog_snapshot(
    pool: &PgPool,
    snapshot: &BackupCatalogSnapshot,
) -> Result<(), AppError> {
    for run in &snapshot.runs {
        sqlx::query(r#"
            INSERT INTO riviamigo.backup_runs (id, trigger, status, requested_by, artifact_key, started_at, completed_at, error_message, created_at, updated_at)
            VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET trigger = EXCLUDED.trigger, status = EXCLUDED.status,
                artifact_key = EXCLUDED.artifact_key, started_at = EXCLUDED.started_at,
                completed_at = EXCLUDED.completed_at, error_message = EXCLUDED.error_message,
                created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at
        "#).bind(run.id).bind(&run.trigger).bind(&run.status).bind(&run.artifact_key)
            .bind(run.started_at).bind(run.completed_at).bind(&run.error_message)
            .bind(run.created_at).bind(run.updated_at).execute(pool).await?;
    }
    for artifact in &snapshot.artifacts {
        sqlx::query(r#"
            INSERT INTO riviamigo.backup_artifacts (id, run_id, storage_type, file_name, storage_path, size_bytes, checksum_sha256, manifest, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET run_id = EXCLUDED.run_id, storage_type = EXCLUDED.storage_type,
                file_name = EXCLUDED.file_name, storage_path = EXCLUDED.storage_path,
                size_bytes = EXCLUDED.size_bytes, checksum_sha256 = EXCLUDED.checksum_sha256,
                manifest = EXCLUDED.manifest, created_at = EXCLUDED.created_at
        "#).bind(artifact.id).bind(artifact.run_id).bind(&artifact.storage_type)
            .bind(&artifact.file_name).bind(&artifact.storage_path).bind(artifact.size_bytes)
            .bind(&artifact.checksum_sha256).bind(&artifact.manifest).bind(artifact.created_at)
            .execute(pool).await?;
    }
    for request in &snapshot.restore_requests {
        sqlx::query(r#"
            INSERT INTO riviamigo.backup_restore_requests (id, artifact_id, requested_by, status, confirmation_phrase, notes, error_message, requested_at, updated_at)
            VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET artifact_id = EXCLUDED.artifact_id, status = EXCLUDED.status,
                confirmation_phrase = EXCLUDED.confirmation_phrase, notes = EXCLUDED.notes,
                error_message = EXCLUDED.error_message, requested_at = EXCLUDED.requested_at,
                updated_at = EXCLUDED.updated_at
        "#).bind(request.id).bind(request.artifact_id).bind(&request.status)
            .bind(&request.confirmation_phrase).bind(&request.notes).bind(&request.error_message)
            .bind(request.requested_at).bind(request.updated_at).execute(pool).await?;
    }
    Ok(())
}

pub fn start_reconciler(pool: PgPool, config: Config) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            interval.tick().await;
            if let Err(error) = reconcile_completed_jobs(&pool, &config).await {
                tracing::error!(error = ?error, "restore job journal reconciliation failed");
            }
        }
    })
}

async fn insert_reconciled_artifact(
    pool: &PgPool,
    run_id: Uuid,
    artifact_id: Uuid,
    trigger: &str,
    storage_type: &str,
    path: &str,
    validated: crate::services::backups::ValidatedRecoveryPackage,
) -> Result<(), AppError> {
    let file_name = Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("recovery-package.rma.tar.gz");
    sqlx::query(
        r#"
        INSERT INTO riviamigo.backup_runs (
            id, trigger, status, requested_by, artifact_key, started_at, completed_at, created_at, updated_at
        ) VALUES ($1, $2, 'succeeded', NULL, $3, now(), now(), now(), now())
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(run_id)
    .bind(trigger)
    .bind(path)
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO riviamigo.backup_artifacts (
            id, run_id, storage_type, file_name, storage_path, size_bytes, checksum_sha256, manifest
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(artifact_id)
    .bind(run_id)
    .bind(storage_type)
    .bind(file_name)
    .bind(path)
    .bind(validated.size_bytes)
    .bind(validated.checksum_sha256)
    .bind(serde_json::json!({
        "artifact_kind": "recovery_package",
        "format": "riviamigo-recovery-v1",
        "package": validated.manifest,
    }))
    .execute(pool)
    .await?;
    Ok(())
}

pub fn jobs_dir(config: &Config) -> PathBuf {
    Path::new(&config.backup_artifact_dir).join(".restore-jobs")
}

fn job_path(config: &Config, id: Uuid) -> PathBuf {
    jobs_dir(config).join(format!("{id}.json"))
}

fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}
