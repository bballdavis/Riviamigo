//! One-off canonical charge-session repair and API-history recovery.
//!
//! Usage:
//!   cargo run --bin canonicalize_charge_sessions -- [--vehicle <uuid>]

use anyhow::{anyhow, Context, Result};
use riviamigo_api::services::charge_sessions::{
    canonicalize_charge_sessions, diagnose_charge_sessions,
};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[derive(Debug, Clone)]
struct Args {
    vehicle_id: Option<Uuid>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let args = parse_args()?;
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    let stats = canonicalize_charge_sessions(&pool, args.vehicle_id).await?;
    let diagnostics = diagnose_charge_sessions(&pool, args.vehicle_id).await?;

    println!("repair_stats={}", serde_json::to_string_pretty(&stats)?);
    println!(
        "post_repair_diagnostics={}",
        serde_json::to_string_pretty(&diagnostics)?
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
                println!(
                    "Usage: cargo run --bin canonicalize_charge_sessions -- [--vehicle <uuid>]"
                );
                std::process::exit(0);
            }
            other => return Err(anyhow!("unknown argument: {other}")),
        }
    }

    Ok(Args { vehicle_id })
}
