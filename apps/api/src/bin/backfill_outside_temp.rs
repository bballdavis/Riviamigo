//! Queue idempotent route-aware weather enrichment for existing trips.
//!
//! Safe to re-run: completed or already-pending jobs are left untouched.
//!
//! Usage:
//!   DATABASE_URL=... cargo run --bin backfill_outside_temp -- [--vehicle <uuid>]

use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use riviamigo_api::services::trip_enrichment::backfill_trip_outside_temps;
use sqlx::postgres::PgPoolOptions;
use tracing::info;
use uuid::Uuid;

#[derive(Debug, Clone, Copy)]
struct Args {
    vehicle_id: Option<Uuid>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let args = parse_args()?;
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    let http_client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    let stats = backfill_trip_outside_temps(&pool, &http_client, args.vehicle_id).await?;
    info!(
        vehicle_id = ?args.vehicle_id,
        scanned = stats.scanned,
        queued = stats.filled,
        failed = stats.failed,
        skipped = stats.skipped,
        "trip outside temp backfill complete"
    );
    Ok(())
}

fn parse_args() -> Result<Args> {
    let mut vehicle_id = None;
    let mut iter = std::env::args().skip(1);

    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--vehicle" => {
                let raw = iter
                    .next()
                    .ok_or_else(|| anyhow!("--vehicle requires a UUID argument"))?;
                vehicle_id = Some(raw.parse().context("invalid --vehicle UUID")?);
            }
            "--help" | "-h" => {
                println!("Usage: cargo run --bin backfill_outside_temp -- [--vehicle <uuid>]");
                std::process::exit(0);
            }
            other => return Err(anyhow!("unknown argument: {other}")),
        }
    }

    Ok(Args { vehicle_id })
}
