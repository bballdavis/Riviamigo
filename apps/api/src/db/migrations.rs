use anyhow::{bail, Context};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{migrate::Migrator, Connection, PgConnection, PgPool, Row};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MigrationLedgerAction {
    InitializedFresh,
    UsedPublic,
    RelocatedLegacy,
    RemovedRedundantLegacy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MigrationRunSummary {
    pub ledger_action: MigrationLedgerAction,
    pub latest_version: i64,
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

/// Apply Riviamigo's immutable baseline and forward-only migrations through a
/// single, validated public SQLx ledger.
///
/// SQL migration 0001 is a schema snapshot which intentionally changes the
/// session search path. Running it directly through the SQLx CLI can therefore
/// place bookkeeping in a schema that a later invocation does not see. This
/// coordinator records the immutable baseline explicitly, restores the public
/// search path, validates any existing/legacy ledger, and only then lets SQLx
/// apply later migrations.
pub async fn run_current_migrations(pool: &PgPool) -> anyhow::Result<MigrationRunSummary> {
    let mut connection = pool
        .acquire()
        .await
        .context("acquire migration coordinator lock connection")?;
    sqlx::query("SELECT pg_advisory_lock(hashtext('riviamigo-schema-migrations'))")
        .execute(&mut *connection)
        .await
        .context("acquire migration coordinator advisory lock")?;

    let result = run_current_migrations_locked(&mut connection).await;
    let unlock_result =
        sqlx::query("SELECT pg_advisory_unlock(hashtext('riviamigo-schema-migrations'))")
            .execute(&mut *connection)
            .await
            .context("release migration coordinator advisory lock");
    match (result, unlock_result) {
        (Ok(summary), Ok(_)) => Ok(summary),
        (Err(error), Ok(_)) => Err(error),
        (Ok(_), Err(unlock_error)) => Err(unlock_error),
        (Err(error), Err(unlock_error)) => Err(error.context(unlock_error.to_string())),
    }
}

async fn run_current_migrations_locked(
    connection: &mut PgConnection,
) -> anyhow::Result<MigrationRunSummary> {
    set_public_search_path(connection).await?;
    let public_exists = ledger_exists(connection, "public").await?;
    let legacy_exists = ledger_exists(connection, "riviamigo").await?;
    let schema_has_users: bool =
        sqlx::query_scalar("SELECT to_regclass('riviamigo.users') IS NOT NULL")
            .fetch_one(&mut *connection)
            .await
            .context("inspect Riviamigo schema state")?;

    let ledger_action = match (public_exists, legacy_exists) {
        (false, false) if !schema_has_users && database_is_empty(connection).await? => {
            sqlx::raw_sql(BASELINE_SCHEMA_SQL)
                .execute(&mut *connection)
                .await
                .context("apply immutable schema baseline")?;
            // The baseline snapshot ends with Riviamigo first in search_path;
            // all bookkeeping after it must be explicitly public.
            set_public_search_path(connection).await?;
            let baseline = baseline_migration()?;
            replace_ledger(connection, &[baseline]).await?;
            MigrationLedgerAction::InitializedFresh
        }
        (false, false) => {
            bail!(
                "database contains an untracked or pre-release schema; run `pnpm db:rebaseline` after taking a verified backup"
            )
        }
        (true, false) => {
            let public = read_ledger(connection, "public").await?;
            validate_ledger_prefix(&public).context("validate public migration ledger")?;
            require_baseline_schema(schema_has_users, &public)?;
            MigrationLedgerAction::UsedPublic
        }
        (false, true) => {
            let legacy = read_ledger(connection, "riviamigo").await?;
            validate_ledger_prefix(&legacy).context("validate legacy migration ledger")?;
            require_baseline_schema(schema_has_users, &legacy)?;
            replace_ledger(connection, &legacy).await?;
            MigrationLedgerAction::RelocatedLegacy
        }
        (true, true) => {
            let public = read_ledger(connection, "public").await?;
            let legacy = read_ledger(connection, "riviamigo").await?;
            validate_ledger_prefix(&public).context("validate public migration ledger")?;
            validate_ledger_prefix(&legacy).context("validate legacy migration ledger")?;
            require_baseline_schema(schema_has_users, &public)?;
            if public != legacy {
                bail!(
                    "public and legacy SQLx migration ledgers disagree; refusing automatic repair"
                );
            }
            sqlx::query("DROP TABLE riviamigo._sqlx_migrations")
                .execute(&mut *connection)
                .await
                .context("remove redundant legacy migration ledger")?;
            MigrationLedgerAction::RemovedRedundantLegacy
        }
    };

    set_public_search_path(connection).await?;
    MIGRATOR
        .run_direct(None, &mut *connection, false)
        .await
        .context("apply current Riviamigo migrations")?;
    let completed = read_ledger(connection, "public").await?;
    validate_complete_ledger(&completed).context("validate completed public migration ledger")?;
    if ledger_exists(connection, "riviamigo").await? {
        bail!("legacy riviamigo._sqlx_migrations still exists after migration");
    }
    Ok(MigrationRunSummary {
        ledger_action,
        latest_version: latest_migration_version(),
    })
}

fn require_baseline_schema(
    schema_has_users: bool,
    ledger: &[MigrationIdentity],
) -> anyhow::Result<()> {
    if !schema_has_users
        && ledger
            .iter()
            .any(|migration| migration.version == BASELINE_MIGRATION_VERSION)
    {
        bail!("migration ledger records the baseline, but riviamigo.users is missing");
    }
    Ok(())
}

async fn set_public_search_path(connection: &mut PgConnection) -> anyhow::Result<()> {
    sqlx::query("SET search_path = public")
        .execute(&mut *connection)
        .await
        .context("restore migration connection search_path")?;
    Ok(())
}

async fn database_is_empty(connection: &mut PgConnection) -> anyhow::Result<bool> {
    let has_objects: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
          SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
            AND n.nspname NOT LIKE 'pg_toast%'
            AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
            AND NOT (n.nspname = 'public' AND c.relname = '_sqlx_migrations')
            AND NOT EXISTS (
              SELECT 1
              FROM pg_depend dependency
              WHERE dependency.classid = 'pg_class'::regclass
                AND dependency.objid = c.oid
                AND dependency.deptype = 'e'
            )
        )
        "#,
    )
    .fetch_one(&mut *connection)
    .await
    .context("inspect database object inventory")?;
    Ok(!has_objects)
}

async fn ledger_exists(connection: &mut PgConnection, schema: &str) -> anyhow::Result<bool> {
    let relation = match schema {
        "public" => "public._sqlx_migrations",
        "riviamigo" => "riviamigo._sqlx_migrations",
        _ => bail!("unsupported migration ledger schema {schema}"),
    };
    sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
        .bind(relation)
        .fetch_one(&mut *connection)
        .await
        .with_context(|| format!("inspect {relation}"))
}

async fn read_ledger(
    connection: &mut PgConnection,
    schema: &str,
) -> anyhow::Result<Vec<MigrationIdentity>> {
    let query = match schema {
        "public" => {
            "SELECT version, description, success, encode(checksum, 'hex') AS checksum FROM public._sqlx_migrations ORDER BY version"
        }
        "riviamigo" => {
            "SELECT version, description, success, encode(checksum, 'hex') AS checksum FROM riviamigo._sqlx_migrations ORDER BY version"
        }
        _ => bail!("unsupported migration ledger schema {schema}"),
    };
    let rows = sqlx::query(query)
        .fetch_all(&mut *connection)
        .await
        .with_context(|| format!("read {schema} migration ledger"))?;
    let mut ledger = Vec::with_capacity(rows.len());
    for row in rows {
        let version: i64 = row.try_get("version")?;
        let success: bool = row.try_get("success")?;
        if !success {
            bail!("migration {version} is recorded as failed in the {schema} ledger");
        }
        ledger.push(MigrationIdentity {
            version,
            description: row.try_get("description")?,
            checksum_sha384: row.try_get("checksum")?,
        });
    }
    Ok(ledger)
}

async fn replace_ledger(
    connection: &mut PgConnection,
    source_ledger: &[MigrationIdentity],
) -> anyhow::Result<()> {
    validate_ledger_prefix(source_ledger)?;
    let mut transaction = connection.begin().await?;
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
