use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    backfill_software_versions(&pool).await
}

async fn backfill_software_versions(pool: &PgPool) -> Result<()> {
    let vehicles = sqlx::query_scalar!("SELECT id FROM riviamigo.vehicles")
        .fetch_all(pool)
        .await?;

    for vehicle_id in vehicles {
        rebuild_vehicle_versions(pool, vehicle_id).await?;
    }

    Ok(())
}

async fn rebuild_vehicle_versions(pool: &PgPool, vehicle_id: Uuid) -> Result<()> {
    info!(%vehicle_id, "rebuilding software version history");

    sqlx::query!(
        "DELETE FROM riviamigo.software_versions WHERE vehicle_id = $1",
        vehicle_id
    )
    .execute(pool)
    .await?;

    let rows = sqlx::query!(
        r#"SELECT ts, ota_current_version
           FROM timeseries.telemetry
           WHERE vehicle_id = $1 AND ota_current_version IS NOT NULL
           ORDER BY ts ASC"#,
        vehicle_id
    )
    .fetch_all(pool)
    .await?;

    let mut current_version: Option<String> = None;
    let mut installed_at: Option<DateTime<Utc>> = None;

    for row in rows {
        let ts = row.ts;
        let Some(version) = row.ota_current_version else {
            continue;
        };
        if current_version.as_deref() != Some(version.as_str()) {
            if let (Some(prev_version), Some(prev_installed_at)) =
                (current_version.take(), installed_at.take())
            {
                sqlx::query!(
                    r#"INSERT INTO riviamigo.software_versions
                       (vehicle_id, version, installed_at, observed_until)
                       VALUES ($1, $2, $3, $4)"#,
                    vehicle_id,
                    prev_version,
                    prev_installed_at,
                    ts
                )
                .execute(pool)
                .await?;
            }

            current_version = Some(version);
            installed_at = Some(ts);
        }
    }

    if let (Some(version), Some(installed_at)) = (current_version, installed_at) {
        sqlx::query!(
            r#"INSERT INTO riviamigo.software_versions
               (vehicle_id, version, installed_at, observed_until)
               VALUES ($1, $2, $3, NULL)"#,
            vehicle_id,
            version,
            installed_at,
        )
        .execute(pool)
        .await?;
    }

    Ok(())
}
