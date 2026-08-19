//! Report or remove exact duplicate Rivian charge-history payloads.
//!
//! Usage:
//!   cargo run --bin compact_charge_payloads -- [--vehicle <uuid>] [--apply] [--batch-size <count>]

use anyhow::{anyhow, Context, Result};
use riviamigo_api::db::pool::create_pool;
use uuid::Uuid;

#[derive(Debug, Clone)]
struct Args {
    vehicle_id: Option<Uuid>,
    apply: bool,
    batch_size: i64,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let args = parse_args()?;
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let pool = create_pool(&database_url).await?;

    let (relation_bytes, payload_bytes): (i64, i64) = sqlx::query_as(
        r#"SELECT pg_total_relation_size('riviamigo.rivian_charge_payloads')::bigint,
                  COALESCE(SUM(pg_column_size(payload)), 0)::bigint
           FROM riviamigo.rivian_charge_payloads
           WHERE ($1::uuid IS NULL OR vehicle_id = $1)"#,
    )
    .bind(args.vehicle_id)
    .fetch_one(&pool)
    .await?;

    let duplicate_count: i64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(duplicate_count), 0)::bigint
           FROM (
               SELECT COUNT(*) - 1 AS duplicate_count
               FROM riviamigo.rivian_charge_payloads
               WHERE ($1::uuid IS NULL OR vehicle_id = $1)
               GROUP BY riviamigo.charge_payload_identity_key(
                            vehicle_id, operation, rivian_transaction_id,
                            rivian_vehicle_id, payload_fingerprint
                        )
               HAVING COUNT(*) > 1
           ) duplicates"#,
    )
    .bind(args.vehicle_id)
    .fetch_one(&pool)
    .await?;

    let pending_identity_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)::bigint
           FROM riviamigo.rivian_charge_payloads
           WHERE ($1::uuid IS NULL OR vehicle_id = $1)
             AND payload_fingerprint IS NULL"#,
    )
    .bind(args.vehicle_id)
    .fetch_one(&pool)
    .await?;

    if !args.apply {
        println!(
            "Charge payload storage: {relation_bytes} relation bytes, {payload_bytes} payload bytes."
        );
        println!(
            "Found {duplicate_count} semantically duplicate charge payloads. Re-run with --apply to remove them."
        );
        println!(
            "Identity backfill has {pending_identity_count} payloads remaining; compaction will refuse to apply until it reaches zero."
        );
        return Ok(());
    }

    if pending_identity_count > 0 {
        return Err(anyhow!(
            "charge-payload compaction is unsafe while {pending_identity_count} payloads lack semantic identities; wait for the identity backfill to complete"
        ));
    }

    let mut transaction = pool.begin().await?;
    let compaction_lock: bool = sqlx::query_scalar(
        "SELECT pg_try_advisory_xact_lock(hashtextextended('riviamigo-charge-payload-compaction', 0))",
    )
    .fetch_one(&mut *transaction)
    .await?;
    if !compaction_lock {
        transaction.rollback().await?;
        return Err(anyhow!(
            "charge-payload compaction is already running; retry after it finishes"
        ));
    }

    let result = sqlx::query(
        r#"WITH ranked AS (
               SELECT payload.id,
                      payload.captured_at,
                      ROW_NUMBER() OVER duplicate_group AS duplicate_rank,
                      FIRST_VALUE(payload.id) OVER duplicate_group AS keeper_id,
                      FIRST_VALUE(payload.captured_at) OVER duplicate_group AS keeper_captured_at
               FROM riviamigo.rivian_charge_payloads payload
               LEFT JOIN riviamigo.charge_sessions session
                 ON session.id = payload.charge_session_id
                AND session.vehicle_id = payload.vehicle_id
               WHERE ($1::uuid IS NULL OR payload.vehicle_id = $1)
               WINDOW duplicate_group AS (
                   PARTITION BY riviamigo.charge_payload_identity_key(
                                    payload.vehicle_id, payload.operation,
                                    payload.rivian_transaction_id,
                                    payload.rivian_vehicle_id,
                                    payload.payload_fingerprint
                                )
                   ORDER BY (session.id IS NOT NULL) DESC,
                            payload.captured_at ASC, payload.id ASC
               )
           ), victims AS (
               SELECT id, captured_at, keeper_id, keeper_captured_at
               FROM ranked
               WHERE duplicate_rank > 1
               ORDER BY captured_at, id
               LIMIT $2
           ), repointed_aliases AS (
               UPDATE riviamigo.charge_session_external_aliases alias
               SET latest_payload_id = victims.keeper_id,
                   latest_payload_captured_at = victims.keeper_captured_at
               FROM victims
               WHERE alias.latest_payload_id = victims.id
                 AND (alias.latest_payload_id, alias.latest_payload_captured_at)
                     IS DISTINCT FROM (victims.keeper_id, victims.keeper_captured_at)
               RETURNING alias.charge_session_id
           ), repointed_identities AS (
               UPDATE riviamigo.rivian_charge_payload_identities identities
               SET canonical_payload_id = victims.keeper_id
               FROM victims
               WHERE identities.canonical_payload_id = victims.id
               RETURNING identities.identity_key
           )
           DELETE FROM riviamigo.rivian_charge_payloads payload
           USING victims
           WHERE payload.id = victims.id
             AND payload.captured_at = victims.captured_at"#,
    )
    .bind(args.vehicle_id)
    .bind(args.batch_size)
    .execute(&mut *transaction)
    .await;

    let result = match result {
        Ok(result) => result,
        Err(error) => {
            transaction.rollback().await?;
            return Err(error.into());
        }
    };
    transaction.commit().await?;

    let removed = result.rows_affected();
    println!(
        "Removed {} exact duplicate charge payloads; retained one linked payload when available.",
        removed
    );
    if removed as i64 == args.batch_size && duplicate_count > args.batch_size {
        println!("More duplicates remain; run the same command again for the next bounded batch.");
    }
    Ok(())
}

fn parse_args() -> Result<Args> {
    let mut vehicle_id = None;
    let mut apply = false;
    let mut batch_size = 5_000_i64;
    let mut iter = std::env::args().skip(1);

    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--vehicle" => {
                let raw = iter
                    .next()
                    .ok_or_else(|| anyhow!("--vehicle requires a UUID argument"))?;
                vehicle_id = Some(raw.parse().context("invalid --vehicle UUID")?);
            }
            "--apply" => apply = true,
            "--batch-size" => {
                let raw = iter
                    .next()
                    .ok_or_else(|| anyhow!("--batch-size requires an integer argument"))?;
                batch_size = raw.parse().context("invalid --batch-size")?;
                if !(1..=50_000).contains(&batch_size) {
                    return Err(anyhow!("--batch-size must be between 1 and 50000"));
                }
            }
            "--help" | "-h" => {
                println!(
                    "Usage: cargo run --bin compact_charge_payloads -- [--vehicle <uuid>] [--apply] [--batch-size <count>]"
                );
                std::process::exit(0);
            }
            other => return Err(anyhow!("unknown argument: {other}")),
        }
    }

    Ok(Args {
        vehicle_id,
        apply,
        batch_size,
    })
}
