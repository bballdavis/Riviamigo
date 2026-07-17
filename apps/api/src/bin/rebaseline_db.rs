use std::{env, path::Path};

use anyhow::{bail, Context};
use sha2::{Digest, Sha384};
use sqlx::{postgres::PgPoolOptions, Row};

const BASELINE: &str = include_str!("../../migrations/0001_initial_schema.sql");

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let (confirm, backup_path) = parse_args()?;
    let database_url = env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .context("connect to the database")?;

    let checksum = Sha384::digest(BASELINE.as_bytes()).to_vec();
    if is_adopted(&pool, &checksum).await? {
        println!("Database is already adopted by the release baseline; no rebaseline is needed.");
        return Ok(());
    }

    verify_pre_release_schema(&pool).await?;

    if !confirm {
        println!(
            "Preflight passed. No changes were made. Re-run with --yes --backup <path-to-backup> to adopt this database."
        );
        return Ok(());
    }

    let backup_path = backup_path.context("--backup <path> is required with --yes")?;
    if !Path::new(&backup_path).is_file() {
        bail!("backup file does not exist: {backup_path}");
    }

    let mut transaction = pool.begin().await?;

    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('riviamigo-schema-rebaseline'))")
        .execute(&mut *transaction)
        .await?;

    let current =
        sqlx::query("SELECT version, checksum FROM riviamigo._sqlx_migrations ORDER BY version")
            .fetch_all(&mut *transaction)
            .await?;

    if current.len() == 1 && current[0].get::<i64, _>("version") == 1 {
        let current_checksum: Vec<u8> = current[0].get("checksum");
        if current_checksum == checksum {
            println!("Database is already adopted by the release baseline.");
            transaction.commit().await?;
            return Ok(());
        }
        bail!("database has a version-1 migration ledger with an unexpected checksum");
    }

    if current.len() != 51
        || current.first().map(|row| row.get::<i64, _>("version")) != Some(1)
        || current.last().map(|row| row.get::<i64, _>("version")) != Some(51)
    {
        bail!(
            "database does not have the expected pre-release SQLx ledger (versions 1 through 51)"
        );
    }

    let public_ledger_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations') IS NOT NULL")
            .fetch_one(&mut *transaction)
            .await?;
    if public_ledger_exists {
        let public_ledger_rows: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM public._sqlx_migrations")
                .fetch_one(&mut *transaction)
                .await?;
        if public_ledger_rows != 0 {
            bail!("public._sqlx_migrations already contains migration records");
        }
        sqlx::query("DROP TABLE public._sqlx_migrations")
            .execute(&mut *transaction)
            .await?;
    }

    sqlx::query("ALTER TABLE riviamigo._sqlx_migrations SET SCHEMA public")
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM public._sqlx_migrations")
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "INSERT INTO public._sqlx_migrations
         (version, description, success, checksum, execution_time)
         VALUES (1, 'initial schema', TRUE, $1, 0)",
    )
    .bind(checksum)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    println!(
        "Database adopted by the release baseline. Run pnpm db:migrate or start the API normally to verify."
    );
    Ok(())
}

async fn is_adopted(pool: &sqlx::PgPool, expected_checksum: &[u8]) -> anyhow::Result<bool> {
    let exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations') IS NOT NULL")
            .fetch_one(pool)
            .await?;
    if !exists {
        return Ok(false);
    }

    let row = sqlx::query("SELECT version, checksum FROM public._sqlx_migrations")
        .fetch_optional(pool)
        .await?;
    let Some(row) = row else {
        return Ok(false);
    };

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM public._sqlx_migrations")
        .fetch_one(pool)
        .await?;
    if count != 1 {
        bail!("public._sqlx_migrations contains unexpected migration records");
    }

    let version: i64 = row.get("version");
    let checksum: Vec<u8> = row.get("checksum");
    if version != 1 || checksum != expected_checksum {
        bail!("public._sqlx_migrations does not match the release baseline");
    }

    Ok(true)
}

fn parse_args() -> anyhow::Result<(bool, Option<String>)> {
    let mut confirm = false;
    let mut backup_path = None;
    let mut args = env::args().skip(1);

    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--yes" => confirm = true,
            "--backup" => {
                backup_path = Some(args.next().context("--backup requires a path argument")?);
            }
            "--help" | "-h" => {
                println!(
                    "Usage: cargo run --bin rebaseline_db -- [--yes --backup <path>]\n\
                     Without --yes, validates the pre-release database without writing to it."
                );
                std::process::exit(0);
            }
            _ => bail!("unknown argument: {argument}"),
        }
    }

    Ok((confirm, backup_path))
}

async fn verify_pre_release_schema(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    let migration_table_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('riviamigo._sqlx_migrations') IS NOT NULL")
            .fetch_one(pool)
            .await?;
    if !migration_table_exists {
        bail!("riviamigo._sqlx_migrations is missing; this is not the pre-release database");
    }

    let expected_schema: bool = sqlx::query_scalar(
        "SELECT
            EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')
            AND to_regclass('timeseries.telemetry') IS NOT NULL
            AND to_regclass('riviamigo.account_invitations') IS NOT NULL
            AND to_regclass('riviamigo.rivian_parallax_events') IS NOT NULL
            AND to_regclass('riviamigo.external_connection_settings') IS NOT NULL
            AND to_regclass('riviamigo.vehicle_artwork_cache_state') IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'riviamigo'
                  AND table_name = 'trips'
                  AND column_name = 'route_preview'
            )
            AND EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'riviamigo'
                  AND table_name = 'account_invitations'
                  AND column_name = 'vehicle_id'
            )",
    )
    .fetch_one(pool)
    .await?;

    if !expected_schema {
        bail!(
            "database does not match the expected release schema; restore or migrate it before rebaselining"
        );
    }

    Ok(())
}
