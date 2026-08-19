use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| anyhow::anyhow!("DATABASE_URL is required for migrations"))?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("SET search_path = public")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&database_url)
        .await?;
    let summary = riviamigo_api::db::migrations::run_current_migrations(&pool).await?;
    println!(
        "Riviamigo migrations are current at version {} ({:?})",
        summary.latest_version, summary.ledger_action
    );
    pool.close().await;
    Ok(())
}
