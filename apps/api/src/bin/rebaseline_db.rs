use std::{env, path::Path};

use anyhow::{bail, Context};
use riviamigo_api::{
    db::migrations::{self, MigrationIdentity, MIGRATOR},
    services::{backups, restore_compatibility},
};
use sqlx::{postgres::PgPoolOptions, AssertSqlSafe};
use tokio::process::Command;
use url::Url;
use uuid::Uuid;

const ADOPTION_LOCK: &str = "riviamigo-schema-rebaseline";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let (confirm, backup_path) = parse_args()?;
    let database_url = env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .context("connect to the database")?;

    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock(hashtext($1))")
        .bind(ADOPTION_LOCK)
        .fetch_one(&pool)
        .await?;
    if !locked {
        bail!("another baseline adoption process holds the database lock");
    }

    let result = adopt(&database_url, &pool, confirm, backup_path.as_deref()).await;
    let _ = sqlx::query("SELECT pg_advisory_unlock(hashtext($1))")
        .bind(ADOPTION_LOCK)
        .execute(&pool)
        .await;
    result
}

async fn adopt(
    database_url: &str,
    pool: &sqlx::PgPool,
    confirm: bool,
    backup_path: Option<&str>,
) -> anyhow::Result<()> {
    let compiled = migrations::compiled_migration_ledger();
    if is_adopted(pool, &compiled).await? {
        println!("Database already uses the compiled migration chain; no adoption is needed.");
        return Ok(());
    }

    verify_existing_ledger(pool).await?;
    refuse_active_clients(pool).await?;
    let live_contract = restore_compatibility::schema_contract_description(pool)
        .await
        .context("describe live database schema")?;
    let live_fingerprint = contract_fingerprint(&live_contract)?;
    let (baseline_fingerprint, baseline_contract) = scratch_baseline_contract(database_url).await?;
    if live_fingerprint != baseline_fingerprint {
        bail!(
            "database schema contract differs from the compiled baseline (live={live_fingerprint}, baseline={baseline_fingerprint}): {}",
            contract_difference(&live_contract, &baseline_contract)
        );
    }

    if !confirm {
        println!(
            "Preflight passed. The live schema exactly matches the compiled baseline. No changes were made."
        );
        return Ok(());
    }

    let backup_path = backup_path.context("--backup <path> is required with --yes")?;
    verify_backup_evidence(backup_path).await?;
    refuse_active_clients(pool).await?;

    let baseline = compiled
        .first()
        .context("compiled migration catalog is empty")?;
    if compiled.len() != 1 {
        bail!(
            "baseline adoption is only valid at a chain epoch containing one compiled migration; found {}",
            compiled.len()
        );
    }
    let checksum = hex::decode(&baseline.checksum_sha384)?;
    let mut transaction = pool.begin().await?;
    let public_ledger_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations') IS NOT NULL")
            .fetch_one(&mut *transaction)
            .await?;
    if !public_ledger_exists {
        let historical_ledger_exists: bool =
            sqlx::query_scalar("SELECT to_regclass('riviamigo._sqlx_migrations') IS NOT NULL")
                .fetch_one(&mut *transaction)
                .await?;
        if !historical_ledger_exists {
            bail!("the current SQLx migration ledger is missing");
        }
        sqlx::query("ALTER TABLE riviamigo._sqlx_migrations SET SCHEMA public")
            .execute(&mut *transaction)
            .await?;
    }
    sqlx::query("DROP TABLE IF EXISTS riviamigo._sqlx_migrations")
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM public._sqlx_migrations")
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "INSERT INTO public._sqlx_migrations
         (version, description, success, checksum, execution_time)
         VALUES ($1, $2, TRUE, $3, 0)",
    )
    .bind(baseline.version)
    .bind(&baseline.description)
    .bind(checksum)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    let adopted = read_public_ledger(pool).await?;
    migrations::validate_complete_ledger(&adopted).context("validate adopted migration ledger")?;
    println!(
        "Database adopted migration chain {} at catalog {}.",
        migrations::MIGRATION_CHAIN_ID,
        migrations::migration_catalog_digest()
    );
    Ok(())
}

async fn is_adopted(pool: &sqlx::PgPool, expected: &[MigrationIdentity]) -> anyhow::Result<bool> {
    let exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations') IS NOT NULL")
            .fetch_one(pool)
            .await?;
    if !exists {
        return Ok(false);
    }
    let ledger = read_public_ledger(pool).await?;
    Ok(migrations::validate_complete_ledger(&ledger).is_ok() && ledger == expected)
}

async fn read_public_ledger(pool: &sqlx::PgPool) -> anyhow::Result<Vec<MigrationIdentity>> {
    Ok(sqlx::query_as::<_, (i64, String, bool, String)>(
        "SELECT version, description, success, encode(checksum, 'hex') FROM public._sqlx_migrations ORDER BY version",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(
        |(version, description, _success, checksum_sha384)| MigrationIdentity {
            version,
            description,
            checksum_sha384,
        },
    )
    .collect())
}

async fn verify_existing_ledger(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    let public_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations') IS NOT NULL")
            .fetch_one(pool)
            .await?;
    let historical_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('riviamigo._sqlx_migrations') IS NOT NULL")
            .fetch_one(pool)
            .await?;
    let table = match (public_exists, historical_exists) {
        (true, false) => "public._sqlx_migrations",
        (false, true) => "riviamigo._sqlx_migrations",
        (false, false) => bail!("the current SQLx migration ledger is missing"),
        (true, true) => {
            bail!("both public and historical SQLx ledgers exist; adoption is ambiguous")
        }
    };
    let rows = if table == "public._sqlx_migrations" {
        sqlx::query_as::<_, (i64, bool)>(
            "SELECT version, success FROM public._sqlx_migrations ORDER BY version",
        )
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, (i64, bool)>(
            "SELECT version, success FROM riviamigo._sqlx_migrations ORDER BY version",
        )
        .fetch_all(pool)
        .await?
    };
    if rows.is_empty() {
        bail!("the existing SQLx migration ledger is empty");
    }
    if rows.iter().any(|row| !row.1) {
        bail!("the existing SQLx migration ledger contains a failed migration");
    }
    if rows[0].0 < 1
        || rows
            .windows(2)
            .any(|pair| pair[1].0 != pair[0].0.saturating_add(1))
    {
        bail!("the existing SQLx migration ledger is not contiguous and ordered");
    }
    Ok(())
}

async fn refuse_active_clients(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    let active_clients: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_stat_activity
         WHERE datname = current_database()
           AND pid <> pg_backend_pid()
           AND backend_type = 'client backend'",
    )
    .fetch_one(pool)
    .await?;
    if active_clients > 0 {
        bail!(
            "baseline adoption requires stopped API and ingestion writers; found {active_clients} other database client connection(s)"
        );
    }
    Ok(())
}

async fn verify_backup_evidence(path: &str) -> anyhow::Result<()> {
    let path = Path::new(path);
    let metadata = path
        .metadata()
        .with_context(|| format!("backup evidence does not exist: {}", path.display()))?;
    if !metadata.is_file() || metadata.len() == 0 {
        bail!(
            "backup evidence must be a non-empty file: {}",
            path.display()
        );
    }
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".rma.tar.gz"))
    {
        backups::validate_recovery_package(path)
            .await
            .context("validate recovery package supplied as backup evidence")?;
    } else {
        let output = Command::new("pg_restore")
            .arg("--list")
            .arg(path)
            .output()
            .await
            .context(
                "verify raw dump with pg_restore; install PostgreSQL client tools or provide a validated .rma.tar.gz package",
            )?;
        if !output.status.success() {
            bail!(
                "pg_restore could not verify backup evidence: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
    }
    Ok(())
}

fn contract_fingerprint(contract: &serde_json::Value) -> anyhow::Result<String> {
    use sha2::{Digest, Sha256};
    let canonical = serde_json::to_vec(&serde_json::json!({
        "version": restore_compatibility::SCHEMA_CONTRACT_VERSION,
        "items": contract,
    }))?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

fn contract_difference(live: &serde_json::Value, baseline: &serde_json::Value) -> String {
    let item_set = |value: &serde_json::Value| {
        value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| serde_json::to_string(item).ok())
            .collect::<std::collections::BTreeSet<_>>()
    };
    let live = item_set(live);
    let baseline = item_set(baseline);
    let live_only = live
        .difference(&baseline)
        .take(8)
        .cloned()
        .collect::<Vec<_>>();
    let baseline_only = baseline
        .difference(&live)
        .take(8)
        .cloned()
        .collect::<Vec<_>>();
    format!("live-only={live_only:?}; baseline-only={baseline_only:?}")
}

async fn scratch_baseline_contract(
    database_url: &str,
) -> anyhow::Result<(String, serde_json::Value)> {
    let mut admin_url = Url::parse(database_url).context("parse DATABASE_URL")?;
    admin_url.set_path("/postgres");
    let admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(admin_url.as_str())
        .await
        .context("connect to postgres maintenance database")?;
    let database_name = format!("riviamigo_baseline_verify_{}", Uuid::new_v4().simple());
    sqlx::query(AssertSqlSafe(format!(
        "CREATE DATABASE \"{database_name}\" TEMPLATE template0"
    )))
    .execute(&admin_pool)
    .await
    .context("create disposable baseline database")?;

    let mut scratch_url = Url::parse(database_url)?;
    scratch_url.set_path(&format!("/{database_name}"));
    let outcome = async {
        let scratch_pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(scratch_url.as_str())
            .await
            .context("connect to disposable baseline database")?;
        MIGRATOR
            .run(&scratch_pool)
            .await
            .context("apply compiled baseline to disposable database")?;
        let contract = restore_compatibility::schema_contract_description(&scratch_pool)
            .await
            .context("describe disposable baseline")?;
        let fingerprint = contract_fingerprint(&contract)?;
        scratch_pool.close().await;
        Ok::<_, anyhow::Error>((fingerprint, contract))
    }
    .await;

    let drop_result = sqlx::query(AssertSqlSafe(format!(
        "DROP DATABASE IF EXISTS \"{database_name}\" WITH (FORCE)"
    )))
    .execute(&admin_pool)
    .await;
    admin_pool.close().await;
    if let Err(error) = drop_result {
        return Err(error).context("drop disposable baseline database");
    }
    outcome
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
                     Without --yes, creates a disposable database and proves the live schema matches the compiled baseline without writing to the live database."
                );
                std::process::exit(0);
            }
            _ => bail!("unknown argument: {argument}"),
        }
    }
    Ok((confirm, backup_path))
}
