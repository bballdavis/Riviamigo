//! Reverse-geocode trip start/end points and charge session locations that
//! have no address row yet.
//!
//! Run after `backfill_geofence_matches` so geofence-linked addresses are
//! already in place. This binary only touches rows where `address_id` is NULL
//! and the corresponding lat/lng is known.
//!
//! Usage:
//!   DATABASE_URL=... cargo run --bin backfill_trip_addresses -- [--vehicle <uuid>]

use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use riviamigo_api::services::trip_enrichment::{
    backfill_charge_session_addresses, backfill_trip_addresses,
};
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
        .max_connections(3)
        .connect(&database_url)
        .await?;

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    let trip_stats = backfill_trip_addresses(&pool, &client, args.vehicle_id).await?;
    let session_stats = backfill_charge_session_addresses(&pool, &client, args.vehicle_id).await?;

    info!(
        vehicle_id = ?args.vehicle_id,
        trip_scanned = trip_stats.scanned,
        trip_filled = trip_stats.filled,
        trip_failed = trip_stats.failed,
        trip_skipped = trip_stats.skipped,
        session_scanned = session_stats.scanned,
        session_filled = session_stats.filled,
        session_failed = session_stats.failed,
        session_skipped = session_stats.skipped,
        "trip address backfill complete"
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
                println!("Usage: cargo run --bin backfill_trip_addresses -- [--vehicle <uuid>]");
                std::process::exit(0);
            }
            other => return Err(anyhow!("unknown argument: {other}")),
        }
    }

    Ok(Args { vehicle_id })
}
