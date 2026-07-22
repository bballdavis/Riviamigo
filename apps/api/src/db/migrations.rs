use std::path::{Path, PathBuf};

use anyhow::{bail, Context};
use serde_json::Value;
use sqlx::{migrate::Migrator, PgPool};
use tokio::fs;

use crate::config::Config;

/// The compiled migration set used by both normal startup and restore-ledger
/// reconstruction. A recovery package contains the schema at its source
/// migration version, but older packages may not contain SQLx bookkeeping.
pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// Rebuild SQLx's bookkeeping after restoring a package whose dump did not
/// carry a usable `_sqlx_migrations` table. The schema itself is not changed:
/// the package's source migration version determines which migrations are
/// already represented, and normal startup applies only later migrations.
/// Refuse to reconstruct the ledger when the restore left the baseline schema
/// incomplete; marking migrations as applied in that state would hide a
/// partial restore and make later migrations fail with misleading errors.
pub async fn restore_ledger(pool: &PgPool, source_version: i64) -> anyhow::Result<()> {
    if source_version < 1 {
        bail!("recovery package has an invalid source migration version: {source_version}");
    }
    let migrations = MIGRATOR.migrations.iter().collect::<Vec<_>>();
    let latest = migrations
        .last()
        .context("no compiled migrations available")?;
    if source_version > latest.version {
        bail!(
            "recovery package requires migration version {source_version}, but this release only knows through {}",
            latest.version
        );
    }

    let schema_ready: bool = sqlx::query_scalar(
        "SELECT to_regclass('timeseries.telemetry') IS NOT NULL AND to_regclass('riviamigo.backup_runs') IS NOT NULL AND to_regclass('riviamigo.users') IS NOT NULL AND to_regclass('riviamigo.vehicles') IS NOT NULL",
    )
    .fetch_one(pool)
    .await?;
    if !schema_ready {
        bail!(
            "cannot reconstruct the migration ledger because the restored application schema is incomplete"
        );
    }

    let mut transaction = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('riviamigo-restore-migration-ledger'))")
        .execute(&mut *transaction)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS public._sqlx_migrations (
            version BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            installed_on TIMESTAMPTZ NOT NULL DEFAULT now(),
            success BOOLEAN NOT NULL,
            checksum BYTEA NOT NULL,
            execution_time BIGINT NOT NULL
        )
        "#,
    )
    .execute(&mut *transaction)
    .await?;

    // A pre-release database used the schema-qualified ledger. It is only
    // bookkeeping, and the restored package is the authoritative state, so
    // remove the obsolete copy after the public ledger is guaranteed to exist.
    sqlx::query("DROP TABLE IF EXISTS riviamigo._sqlx_migrations")
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM public._sqlx_migrations")
        .execute(&mut *transaction)
        .await?;

    for migration in migrations
        .into_iter()
        .filter(|migration| migration.version <= source_version)
    {
        sqlx::query(
            r#"
            INSERT INTO public._sqlx_migrations
                (version, description, success, checksum, execution_time)
            VALUES ($1, $2, TRUE, $3, 0)
            "#,
        )
        .bind(migration.version)
        .bind(migration.description.as_ref())
        .bind(migration.checksum.as_ref())
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    Ok(())
}

/// Recover an interrupted restore before SQLx startup runs. The restore agent
/// leaves its extracted package under `.restore-staging` while waiting for the
/// API to become healthy; if the old image died during migration startup, the
/// next container boot can safely rebuild the ledger from that durable manifest.
pub async fn recover_interrupted_restore_ledger(
    pool: &PgPool,
    config: &Config,
) -> anyhow::Result<bool> {
    let staging_root = Path::new(&config.backup_artifact_dir).join(".restore-staging");
    if !fs::try_exists(&staging_root).await.unwrap_or(false) {
        return Ok(false);
    }

    let restore_schema_exists: bool = sqlx::query_scalar(
        "SELECT to_regclass('timeseries.telemetry') IS NOT NULL AND to_regclass('riviamigo.backup_runs') IS NOT NULL AND to_regclass('riviamigo.users') IS NOT NULL AND to_regclass('riviamigo.vehicles') IS NOT NULL",
    )
    .fetch_one(pool)
    .await?;
    if !restore_schema_exists {
        return Ok(false);
    }

    let ledger_count: Option<i64> = sqlx::query_scalar(
        "SELECT CASE WHEN to_regclass('public._sqlx_migrations') IS NULL THEN NULL ELSE (SELECT COUNT(*) FROM public._sqlx_migrations) END",
    )
    .fetch_one(pool)
    .await?;
    if ledger_count.unwrap_or(0) > 0 {
        return Ok(false);
    }

    let mut entries = fs::read_dir(&staging_root).await?;
    let mut manifests = Vec::<PathBuf>::new();
    while let Some(entry) = entries.next_entry().await? {
        let manifest = entry.path().join("manifest.json");
        if fs::try_exists(&manifest).await.unwrap_or(false) {
            manifests.push(manifest);
        }
    }
    if manifests.is_empty() {
        return Ok(false);
    }
    if manifests.len() > 1 {
        bail!(
            "multiple interrupted restore packages are staged; preserve them and resolve the restore job before restarting"
        );
    }

    let manifest: Value = serde_json::from_slice(&fs::read(&manifests[0]).await?)?;
    let source_version = manifest
        .get("source")
        .and_then(|source| source.get("migration_version"))
        .and_then(Value::as_i64)
        .ok_or_else(|| {
            anyhow::anyhow!("staged recovery manifest is missing source.migration_version")
        })?;
    restore_ledger(pool, source_version).await?;
    Ok(true)
}
