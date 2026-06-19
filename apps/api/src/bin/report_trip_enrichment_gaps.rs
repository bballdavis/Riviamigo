//! Report trip enrichment gaps per vehicle and per day.
//!
//! Usage:
//!   DATABASE_URL=... cargo run --bin report_trip_enrichment_gaps -- [--vehicle <uuid>]

use anyhow::{anyhow, Context, Result};
use riviamigo_api::services::trip_enrichment::report_trip_enrichment_gaps;
use sqlx::postgres::PgPoolOptions;
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

    let rows = report_trip_enrichment_gaps(&pool, args.vehicle_id).await?;
    println!("{}", serde_json::to_string_pretty(&rows)?);
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
                println!(
                    "Usage: cargo run --bin report_trip_enrichment_gaps -- [--vehicle <uuid>]"
                );
                std::process::exit(0);
            }
            other => return Err(anyhow!("unknown argument: {other}")),
        }
    }

    Ok(Args { vehicle_id })
}
