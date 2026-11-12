//! Re-derive stored trip energy and efficiency.
//!
//! The same work is available per vehicle from Settings > Jobs
//! ("Recalculate trip energy"); this binary covers every vehicle at once.
//!
//! Usage:
//!   DATABASE_URL=... cargo run --bin recompute_trip_energy -- [--vehicle <uuid>]
use anyhow::{anyhow, Context, Result};
use riviamigo_api::services::trip_energy::recompute_trip_energy;
use sqlx::postgres::PgPoolOptions;
use tracing::info;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;

    let mut vehicle_id = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--vehicle" => {
                let raw = args
                    .next()
                    .ok_or_else(|| anyhow!("--vehicle requires a UUID argument"))?;
                vehicle_id = Some(Uuid::parse_str(&raw).context("invalid --vehicle UUID")?);
            }
            other => return Err(anyhow!("unknown argument: {other}")),
        }
    }

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    let summary = recompute_trip_energy(&pool, vehicle_id).await?;
    info!(
        processed = summary.processed,
        changed = summary.changed,
        "trip energy recompute complete"
    );
    Ok(())
}
