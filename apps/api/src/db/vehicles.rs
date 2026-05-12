use crate::errors::AppError;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn require_vehicle_owned(
    pool: &PgPool,
    user_id: Uuid,
    vehicle_id: Uuid,
) -> Result<(), AppError> {
    let owns = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM riviamigo.vehicles WHERE id = $1 AND user_id = $2)",
    )
    .bind(vehicle_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if !owns {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

pub async fn get_default_vehicle_id(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<Uuid>, AppError> {
    let row = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT default_vehicle_id FROM riviamigo.users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.flatten())
}

pub async fn get_vehicle_battery_capacity(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Result<Option<f64>, AppError> {
    let cap = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT battery_capacity_wh FROM riviamigo.vehicles WHERE id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?
    .flatten();
    Ok(cap)
}

pub async fn get_vehicle_owner_id(
    pool: &PgPool,
    vehicle_id: Uuid,
) -> Result<Option<Uuid>, AppError> {
    let owner_id =
        sqlx::query_scalar::<_, Uuid>("SELECT user_id FROM riviamigo.vehicles WHERE id = $1")
            .bind(vehicle_id)
            .fetch_optional(pool)
            .await?;

    Ok(owner_id)
}
