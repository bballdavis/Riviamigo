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

    let duplicate_count: i64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(duplicate_count), 0)::bigint
           FROM (
               SELECT COUNT(*) - 1 AS duplicate_count
               FROM riviamigo.rivian_charge_payloads
               WHERE ($1::uuid IS NULL OR vehicle_id = $1)
               GROUP BY vehicle_id, operation, rivian_transaction_id, rivian_vehicle_id, payload
               HAVING COUNT(*) > 1
           ) duplicates"#,
    )
    .bind(args.vehicle_id)
    .fetch_one(&pool)
    .await?;

    if !args.apply {
        println!(
            "Found {duplicate_count} exact duplicate charge payloads. Re-run with --apply to remove them."
        );
        return Ok(());
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
                   PARTITION BY payload.vehicle_id, payload.operation,
                                payload.rivian_transaction_id,
                                payload.rivian_vehicle_id, payload.payload
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
                   latest_payload_captured_at = victims.keeper_captured_at,
                   updated_at = now()
               FROM victims
               WHERE alias.latest_payload_id = victims.id
               RETURNING alias.charge_session_id
           )
           DELETE FROM riviamigo.rivian_charge_payloads payload
           USING victims
           WHERE payload.id = victims.id
             AND payload.captured_at = victims.captured_at"#,
    )
    .bind(args.vehicle_id)
    .bind(args.batch_size)
    .execute(&pool)
    .await?;

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
