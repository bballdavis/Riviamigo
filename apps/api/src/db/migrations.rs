use anyhow::{bail, Context};
use sqlx::{migrate::Migrator, PgPool};

/// The compiled migration set used by both normal startup and restore-ledger
/// reconstruction. A recovery package contains the schema at its source
/// migration version, but older packages may not contain SQLx bookkeeping.
pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// Rebuild SQLx's bookkeeping after restoring a package whose dump did not
/// carry a usable `_sqlx_migrations` table. The schema itself is not changed:
/// the package's source migration version determines which migrations are
/// already represented, and normal startup applies only later migrations.
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
