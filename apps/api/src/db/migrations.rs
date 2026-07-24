use anyhow::{bail, Context};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{migrate::Migrator, PgPool};

pub const MIGRATION_CHAIN_ID: &str = "riviamigo-schema-v1";

/// The one migration catalog used by startup, backup creation, restore
/// planning, candidate preparation, and explicit chain adoption.
pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// The public baseline is a schema snapshot. Later migrations are deliberately
/// not included here: callers use this to prove or reconstruct the baseline,
/// then run `MIGRATOR` for forward-only changes.
pub const BASELINE_MIGRATION_VERSION: i64 = 1;
const BASELINE_SCHEMA_SQL: &str = include_str!("../../migrations/0001_initial_schema.sql");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MigrationIdentity {
    pub version: i64,
    pub description: String,
    pub checksum_sha384: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerValidationKind {
    Empty,
    TooLong,
    Version,
    Description,
    Checksum,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerValidationError {
    pub kind: LedgerValidationKind,
    pub message: String,
}

impl std::fmt::Display for LedgerValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for LedgerValidationError {}

pub fn compiled_migration_ledger() -> Vec<MigrationIdentity> {
    MIGRATOR
        .migrations
        .iter()
        .map(|migration| MigrationIdentity {
            version: migration.version,
            description: migration.description.to_string(),
            checksum_sha384: hex::encode(migration.checksum.as_ref()),
        })
        .collect()
}

pub fn migration_catalog_digest() -> String {
    migration_ledger_digest(&compiled_migration_ledger())
}

pub fn migration_ledger_digest(ledger: &[MigrationIdentity]) -> String {
    let bytes = serde_json::to_vec(ledger).expect("migration ledger serializes");
    hex::encode(Sha256::digest(bytes))
}

pub fn latest_migration_version() -> i64 {
    MIGRATOR
        .migrations
        .last()
        .map(|migration| migration.version)
        .unwrap_or(0)
}

pub fn baseline_migration() -> anyhow::Result<MigrationIdentity> {
    compiled_migration_ledger()
        .into_iter()
        .find(|migration| migration.version == BASELINE_MIGRATION_VERSION)
        .context("compiled migration catalog is missing the public baseline")
}

/// Apply exactly the immutable public baseline to an empty disposable
/// database. This must not be replaced with `MIGRATOR.run`, because that would
/// include migrations created after the baseline and make future adoption
/// checks compare against the wrong schema.
pub async fn apply_baseline_schema(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::raw_sql(BASELINE_SCHEMA_SQL)
        .execute(pool)
        .await
        .context("apply immutable schema baseline")?;
    Ok(())
}

pub fn validate_ledger_prefix(ledger: &[MigrationIdentity]) -> Result<(), LedgerValidationError> {
    if ledger.is_empty() {
        return Err(LedgerValidationError {
            kind: LedgerValidationKind::Empty,
            message: "migration ledger is empty".into(),
        });
    }
    let compiled = compiled_migration_ledger();
    if ledger.len() > compiled.len() {
        return Err(LedgerValidationError {
            kind: LedgerValidationKind::TooLong,
            message: format!(
                "migration ledger has {} entries, but this release knows only {}",
                ledger.len(),
                compiled.len()
            ),
        });
    }
    for (position, (actual, expected)) in ledger.iter().zip(&compiled).enumerate() {
        if actual.version != expected.version {
            return Err(LedgerValidationError {
                kind: LedgerValidationKind::Version,
                message: format!(
                    "migration ledger entry {} has version {}; expected {}",
                    position + 1,
                    actual.version,
                    expected.version
                ),
            });
        }
        if actual.description != expected.description {
            return Err(LedgerValidationError {
                kind: LedgerValidationKind::Description,
                message: format!(
                    "migration {} description is {:?}; expected {:?}",
                    actual.version, actual.description, expected.description
                ),
            });
        }
        if !actual
            .checksum_sha384
            .eq_ignore_ascii_case(&expected.checksum_sha384)
        {
            return Err(LedgerValidationError {
                kind: LedgerValidationKind::Checksum,
                message: format!(
                    "migration {} checksum differs from this release",
                    actual.version
                ),
            });
        }
    }
    Ok(())
}

pub fn validate_complete_ledger(ledger: &[MigrationIdentity]) -> Result<(), LedgerValidationError> {
    validate_ledger_prefix(ledger)?;
    let expected = compiled_migration_ledger();
    if ledger.len() != expected.len() {
        return Err(LedgerValidationError {
            kind: LedgerValidationKind::Version,
            message: format!(
                "migration ledger stops at version {}; this release requires version {}",
                ledger.last().map(|item| item.version).unwrap_or(0),
                expected.last().map(|item| item.version).unwrap_or(0)
            ),
        });
    }
    Ok(())
}

/// Rebuild SQLx bookkeeping for an isolated restore candidate. The caller must
/// first validate the restored schema contract. Migration identity is copied
/// from the manifest only after it is proven to be an exact compiled prefix.
pub async fn restore_ledger(
    pool: &PgPool,
    source_ledger: &[MigrationIdentity],
) -> anyhow::Result<()> {
    validate_ledger_prefix(source_ledger)?;
    let latest = MIGRATOR
        .migrations
        .last()
        .context("no compiled migrations available")?;
    if source_ledger
        .last()
        .is_some_and(|entry| entry.version > latest.version)
    {
        bail!("recovery package migration ledger is newer than this release");
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
    sqlx::query("DROP TABLE IF EXISTS riviamigo._sqlx_migrations")
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM public._sqlx_migrations")
        .execute(&mut *transaction)
        .await?;

    for migration in source_ledger {
        let checksum = hex::decode(&migration.checksum_sha384)
            .context("decode validated migration checksum")?;
        sqlx::query(
            r#"
            INSERT INTO public._sqlx_migrations
                (version, description, success, checksum, execution_time)
            VALUES ($1, $2, TRUE, $3, 0)
            "#,
        )
        .bind(migration.version)
        .bind(&migration.description)
        .bind(checksum)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}

/// Normalize an already-proven baseline-compatible candidate to the public
/// ledger. This is intentionally separate from `restore_ledger`, which only
/// accepts an exact prefix supplied by a package manifest.
pub async fn restore_baseline_ledger(pool: &PgPool) -> anyhow::Result<()> {
    let baseline = baseline_migration()?;
    restore_ledger(pool, &[baseline]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiled_catalog_is_ordered_and_stable() {
        let catalog = compiled_migration_ledger();
        assert!(!catalog.is_empty());
        assert_eq!(catalog[0].version, BASELINE_MIGRATION_VERSION);
        assert_eq!(catalog[0].checksum_sha384.len(), 96);
        assert_eq!(migration_catalog_digest().len(), 64);
        validate_complete_ledger(&catalog).expect("compiled catalog validates");
    }

    #[test]
    fn exact_prefix_validation_rejects_checksum_and_order_drift() {
        let catalog = compiled_migration_ledger();
        validate_ledger_prefix(&catalog).expect("catalog is its own prefix");

        let mut checksum_drift = catalog.clone();
        checksum_drift[0].checksum_sha384.replace_range(0..2, "00");
        assert_eq!(
            validate_ledger_prefix(&checksum_drift)
                .expect_err("checksum drift must fail")
                .kind,
            LedgerValidationKind::Checksum
        );

        let mut version_drift = catalog;
        version_drift[0].version = 2;
        assert_eq!(
            validate_ledger_prefix(&version_drift)
                .expect_err("version drift must fail")
                .kind,
            LedgerValidationKind::Version
        );

        assert_eq!(
            validate_ledger_prefix(&[])
                .expect_err("empty ledger must fail")
                .kind,
            LedgerValidationKind::Empty
        );

        let mut newer = compiled_migration_ledger();
        newer.push(MigrationIdentity {
            version: 2,
            description: "future migration".into(),
            checksum_sha384: "00".repeat(48),
        });
        assert_eq!(
            validate_ledger_prefix(&newer)
                .expect_err("newer ledger must fail")
                .kind,
            LedgerValidationKind::TooLong
        );
    }
}
