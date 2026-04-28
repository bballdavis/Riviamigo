use crate::errors::AppError;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn get_electricity_rate(pool: &PgPool, user_id: Uuid) -> Result<f64, AppError> {
    let rate = sqlx::query_scalar!(
        "SELECT electricity_rate_per_kwh FROM riviamigo.user_preferences WHERE user_id = $1",
        user_id
    )
    .fetch_optional(pool)
    .await?
    .flatten()
    .unwrap_or(0.13);
    Ok(rate)
}
