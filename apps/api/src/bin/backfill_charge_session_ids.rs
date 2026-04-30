//! Backfill charge_session_id on historical telemetry rows.
//!
//! For each completed charge session, stamps all telemetry rows that fall
//! within [started_at, ended_at] for the same vehicle.
//!
//! Run once after deploying migration 0011:
//!   cargo run --bin backfill_charge_session_ids

use anyhow::Result;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    backfill_charge_session_ids(&pool).await?;
    Ok(())
}

async fn backfill_charge_session_ids(pool: &PgPool) -> Result<()> {
    let sessions = sqlx::query!(
        r#"SELECT id, vehicle_id, started_at, ended_at
           FROM riviamigo.charge_sessions
           WHERE ended_at IS NOT NULL
           ORDER BY started_at"#
    )
    .fetch_all(pool)
    .await?;

    info!("Found {} completed charge sessions to backfill", sessions.len());

    for session in &sessions {
        let Some(ended_at) = session.ended_at else { continue };
        let result = sqlx::query!(
            r#"UPDATE timeseries.telemetry
               SET charge_session_id = $1
               WHERE vehicle_id = $2
                 AND ts >= $3
                 AND ts <= $4
                 AND charge_session_id IS NULL"#,
            session.id,
            session.vehicle_id,
            session.started_at,
            ended_at
        )
        .execute(pool)
        .await?;

        if result.rows_affected() > 0 {
            info!(
                session_id = %session.id,
                rows = result.rows_affected(),
                "Stamped telemetry rows"
            );
        }
    }

    info!("Backfill complete");
    Ok(())
}
