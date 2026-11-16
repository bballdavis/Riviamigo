use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> std::process::ExitCode {
    riviamigo_api::logging::run(run()).await
}

async fn run() -> anyhow::Result<()> {
    use anyhow::Context;
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
        .await
        .context("connecting to the database")?;
    let summary = riviamigo_api::db::migrations::run_current_migrations(&pool)
        .await
        .context("applying database migrations")?;
    tracing::info!(
        latest_version = summary.latest_version,
        ledger_action = ?summary.ledger_action,
        "database migrations are current"
    );
    pool.close().await;
    Ok(())
}
