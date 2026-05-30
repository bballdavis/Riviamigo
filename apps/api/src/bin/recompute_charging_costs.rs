use anyhow::Result;
use riviamigo_api::services::cost::recompute_charge_session_cost;
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

    recompute_charging_costs(&pool).await
}

async fn recompute_charging_costs(pool: &PgPool) -> Result<()> {
    let session_ids =
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM riviamigo.charge_sessions")
            .fetch_all(pool)
            .await?;

    for session_id in session_ids {
        let _ = recompute_charge_session_cost(pool, session_id).await?;
    }

    info!("charging cost recompute complete");
    Ok(())
}
