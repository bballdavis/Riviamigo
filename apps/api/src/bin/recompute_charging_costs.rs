use anyhow::Result;
use riviamigo_api::{models::cost_profile::compute_cost, services::cost::resolve_profile};
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
    let sessions = sqlx::query!(
        r#"SELECT id, vehicle_id, geofence_id, cost_profile_id, started_at, ended_at, duration_minutes,
                  kwh_added, energy_added_wh, energy_used_wh, rivian_paid_total, is_public, is_rivian_network
           FROM riviamigo.charge_sessions"#
    )
    .fetch_all(pool)
    .await?;

    for session in sessions {
        let profile = resolve_profile(
            pool,
            session.cost_profile_id,
            session.geofence_id,
            session.vehicle_id,
        )
        .await?;
        let authoritative_paid_total = (session.is_public == Some(true)
            || session.is_rivian_network == Some(true))
        .then_some(session.rivian_paid_total)
        .flatten();
        let cost_usd = authoritative_paid_total.or_else(|| {
            profile.as_ref().and_then(|profile| {
                compute_cost(
                    profile,
                    session
                        .energy_added_wh
                        .map(|wh| wh / 1000.0)
                        .or(session.kwh_added),
                    session.energy_used_wh.map(|wh| wh / 1000.0),
                    session.duration_minutes.unwrap_or(0),
                    session.started_at,
                    session.ended_at,
                )
            })
        });

        let (cost_profile_id, cost_method) = match profile {
            _ if authoritative_paid_total.is_some() => {
                (None, Some(String::from("rivian_paid_total")))
            }
            Some(profile) => (Some(profile.id), Some(String::from("profile"))),
            None => (None, Some(String::from("unknown"))),
        };

        sqlx::query!(
            r#"UPDATE riviamigo.charge_sessions
               SET cost_profile_id = $2,
                   cost_method = $3,
                   cost_usd = $4
               WHERE id = $1"#,
            session.id,
            cost_profile_id,
            cost_method,
            cost_usd,
        )
        .execute(pool)
        .await?;
    }

    info!("charging cost recompute complete");
    Ok(())
}
