//! Create and validate a synthetic populated database for charge-identity
//! upgrade acceptance. This binary is CI-only and must never receive live
//! telemetry.

use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;

const PAYLOAD_COUNT: i64 = 250_000;
const DISTINCT_IDENTITY_COUNT: i64 = 200_000;

#[tokio::main]
async fn main() -> Result<()> {
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let mode = std::env::args().nth(1).unwrap_or_else(|| "--stats".into());
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&database_url)
        .await?;

    match mode.as_str() {
        "--seed" => seed(&pool).await?,
        "--check-complete" => check_complete(&pool).await?,
        "--stats" => print_stats(&pool).await?,
        other => anyhow::bail!("unknown mode {other}; use --seed, --stats, or --check-complete"),
    }

    pool.close().await;
    Ok(())
}

async fn seed(pool: &sqlx::PgPool) -> Result<()> {
    let mut transaction = pool.begin().await?;
    sqlx::query("DELETE FROM riviamigo.rivian_charge_payloads")
        .execute(&mut *transaction)
        .await?;

    let user_id: uuid::Uuid = match sqlx::query_scalar(
        "SELECT id FROM riviamigo.users
         WHERE email = 'charge-identity-upgrade-fixture@example.test'
         LIMIT 1",
    )
    .fetch_optional(&mut *transaction)
    .await?
    {
        Some(id) => id,
        None => {
            sqlx::query_scalar(
                "INSERT INTO riviamigo.users (email, password_hash, role)
             VALUES ('charge-identity-upgrade-fixture@example.test', 'fixture-only', 'admin')
             RETURNING id",
            )
            .fetch_one(&mut *transaction)
            .await?
        }
    };

    let vehicle_id: uuid::Uuid = match sqlx::query_scalar(
        "SELECT id FROM riviamigo.vehicles
         WHERE user_id = $1 AND rivian_vehicle_id = 'charge-identity-upgrade-fixture'
         LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(&mut *transaction)
    .await?
    {
        Some(id) => id,
        None => {
            sqlx::query_scalar(
                "INSERT INTO riviamigo.vehicles (user_id, rivian_vehicle_id, model, name)
             VALUES ($1, 'charge-identity-upgrade-fixture', 'fixture', 'Charge identity fixture')
             RETURNING id",
            )
            .bind(user_id)
            .fetch_one(&mut *transaction)
            .await?
        }
    };

    sqlx::query(
        "INSERT INTO riviamigo.rivian_charge_payloads
             (vehicle_id, operation, rivian_transaction_id, rivian_vehicle_id, captured_at, payload)
         SELECT $1,
                'getCompletedSessionSummaries',
                format('fixture-transaction-%s', series.value % $2),
                'fixture-rivian-vehicle',
                now() - (series.value || ' seconds')::interval,
                jsonb_build_object(
                    'sequence', series.value % $2,
                    'state', CASE WHEN (series.value % 2) = 0 THEN 'complete' ELSE 'active' END,
                    'updatedAt', now()
                )
         FROM generate_series(1, $3::bigint) AS series(value)",
    )
    .bind(vehicle_id)
    .bind(DISTINCT_IDENTITY_COUNT)
    .bind(PAYLOAD_COUNT)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    println!(
        "Seeded {PAYLOAD_COUNT} synthetic charge payloads with {DISTINCT_IDENTITY_COUNT} expected identities."
    );
    Ok(())
}

async fn print_stats(pool: &sqlx::PgPool) -> Result<()> {
    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint
         FROM riviamigo.rivian_charge_payloads
         WHERE payload_fingerprint IS NULL",
    )
    .fetch_one(pool)
    .await?;
    let payloads: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM riviamigo.rivian_charge_payloads")
            .fetch_one(pool)
            .await?;
    let identities: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM riviamigo.rivian_charge_payload_identities",
    )
    .fetch_one(pool)
    .await?;
    let status: String = sqlx::query_scalar(
        "SELECT status
         FROM riviamigo.charge_payload_identity_backfill_status
         WHERE job_key = 'charge_payload_identity'",
    )
    .fetch_one(pool)
    .await?;
    println!("status={status} pending={pending} payloads={payloads} identities={identities}");
    Ok(())
}

async fn check_complete(pool: &sqlx::PgPool) -> Result<()> {
    print_stats(pool).await?;
    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint
         FROM riviamigo.rivian_charge_payloads
         WHERE payload_fingerprint IS NULL",
    )
    .fetch_one(pool)
    .await?;
    let payloads: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM riviamigo.rivian_charge_payloads")
            .fetch_one(pool)
            .await?;
    let identities: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM riviamigo.rivian_charge_payload_identities",
    )
    .fetch_one(pool)
    .await?;
    let status: String = sqlx::query_scalar(
        "SELECT status
         FROM riviamigo.charge_payload_identity_backfill_status
         WHERE job_key = 'charge_payload_identity'",
    )
    .fetch_one(pool)
    .await?;
    let non_oldest_canonical: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint
         FROM riviamigo.rivian_charge_payload_identities identity
         JOIN riviamigo.rivian_charge_payloads canonical
           ON canonical.id = identity.canonical_payload_id
         WHERE canonical.rivian_transaction_id = 'fixture-transaction-1'
           AND canonical.id IS DISTINCT FROM (
               SELECT duplicate.id
               FROM riviamigo.rivian_charge_payloads duplicate
               WHERE duplicate.vehicle_id = canonical.vehicle_id
                 AND duplicate.operation = canonical.operation
                 AND duplicate.rivian_transaction_id = canonical.rivian_transaction_id
                 AND duplicate.rivian_vehicle_id = canonical.rivian_vehicle_id
                 AND riviamigo.charge_payload_identity_key(
                         duplicate.vehicle_id, duplicate.operation,
                         duplicate.rivian_transaction_id,
                         duplicate.rivian_vehicle_id,
                         duplicate.payload_fingerprint
                     ) = riviamigo.charge_payload_identity_key(
                         canonical.vehicle_id, canonical.operation,
                         canonical.rivian_transaction_id,
                         canonical.rivian_vehicle_id,
                         canonical.payload_fingerprint
                     )
               ORDER BY duplicate.captured_at, duplicate.id
               LIMIT 1
           )",
    )
    .fetch_one(pool)
    .await?;

    if status != "complete"
        || pending != 0
        || payloads != PAYLOAD_COUNT
        || identities != DISTINCT_IDENTITY_COUNT
        || non_oldest_canonical != 0
    {
        anyhow::bail!(
            "fixture is not complete: status={status} pending={pending} payloads={payloads} identities={identities} non_oldest_canonical={non_oldest_canonical}"
        );
    }
    Ok(())
}
