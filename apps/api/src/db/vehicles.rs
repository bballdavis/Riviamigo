use crate::errors::AppError;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn require_vehicle_owned(
    pool: &PgPool,
    user_id: Uuid,
    vehicle_id: Uuid,
) -> Result<(), AppError> {
    let owns = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM riviamigo.vehicles WHERE id = $1 AND user_id = $2)",
        vehicle_id,
        user_id,
    )
    .fetch_one(pool)
    .await?
    .unwrap_or(false);

    if !owns {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

pub async fn get_default_vehicle_id(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<Uuid>, AppError> {
    let row = sqlx::query_scalar!(
        "SELECT default_vehicle_id FROM riviamigo.users WHERE id = $1",
        user_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.flatten())
}

pub async fn get_vehicle_battery_capacity(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Result<Option<f64>, AppError> {
    let cap = sqlx::query_scalar!(
        "SELECT battery_capacity_wh FROM riviamigo.vehicles WHERE id = $1",
        vehicle_id
    )
    .fetch_optional(pool)
    .await?
    .flatten();
    Ok(cap)
}

pub async fn get_vehicle_owner_id(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Result<Option<Uuid>, AppError> {
    let owner_id = sqlx::query_scalar!(
        "SELECT user_id FROM riviamigo.vehicles WHERE id = $1",
        vehicle_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(owner_id)
}
