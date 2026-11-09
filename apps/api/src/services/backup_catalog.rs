//! Reconcile backup history against independently verified local files.
use crate::{config::Config, errors::AppError, services::backups::validate_open_recovery_package};
use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::PgPool;
use std::path::{Path, PathBuf};
use tokio::fs;
use uuid::Uuid;
use walkdir::WalkDir;

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
        if let Some(run_id) = backup_run_id_from_artifact_path(&path) {
            let active_run: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM riviamigo.backup_runs WHERE id = $1 AND status IN ('pending', 'running'))",
            )
            .bind(run_id)
            .fetch_one(pool)
            .await?;
            if active_run {
                continue;
            }
        }

        let storage_path = path.to_string_lossy().into_owned();
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM riviamigo.backup_artifacts WHERE storage_type <> 's3' AND storage_path = $1)",
        )
        .bind(&storage_path)
        .fetch_one(pool)
        .await?;

        if exists {
            let needs_verification: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM riviamigo.backup_artifacts WHERE storage_type <> 's3' AND storage_path=$1 AND manifest->>'restore_availability'='unavailable')").bind(&storage_path).fetch_one(pool).await?;
            if !needs_verification {
                continue;
            }
        }
        let file = match crate::services::artifact_files::open(
            Path::new(&config.backup_artifact_dir),
            &path,
        ) {
            Ok(file) => file,
            Err(error) => {
                tracing::warn!(error = %error, "backup.catalog.unsafe_local_path");
                continue;
            }
        };
        let validated = match validate_open_recovery_package(file, &config.recovery).await {
            Ok(validated) => validated,
            Err(error) => {
                tracing::warn!(path = %path.display(), error = %error, "backup.catalog.invalid_local_package");
                continue;
            }
        };
        if exists {
            sqlx::query("UPDATE riviamigo.backup_artifacts SET checksum_sha256=$2, size_bytes=$3, manifest=CASE WHEN jsonb_typeof(manifest)='object' THEN manifest ELSE '{}'::jsonb END || jsonb_build_object('restore_availability','available','package',$4::jsonb) WHERE storage_type <> 's3' AND storage_path=$1")
                .bind(&storage_path).bind(&validated.checksum_sha256).bind(validated.size_bytes).bind(&validated.manifest).execute(pool).await?;
            continue;
        }
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

fn backup_run_id_from_artifact_path(path: &Path) -> Option<Uuid> {
    let file_name = path.file_name()?.to_str()?.strip_suffix(".rma.tar.gz")?;
    let (_, run_id) = file_name.rsplit_once('-')?;
    Uuid::parse_str(run_id).ok()
}
