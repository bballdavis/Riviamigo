use crate::errors::AppError;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn require_vehicle_owned(
    pool: &PgPool,
    user_id: Uuid,
    vehicle_id: Uuid,
) -> Result<(), AppError> {
    let owns = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
            SELECT 1
            FROM riviamigo.vehicle_memberships
            WHERE vehicle_id = $1 AND user_id = $2
        )",
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

pub async fn require_vehicle_role(
    pool: &PgPool,
    user_id: Uuid,
    vehicle_id: Uuid,
    allowed_roles: &[&str],
) -> Result<(), AppError> {
    let role = sqlx::query_scalar::<_, Option<String>>(
        "SELECT role
         FROM riviamigo.vehicle_memberships
         WHERE vehicle_id = $1 AND user_id = $2",
    )
    .bind(vehicle_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .flatten();

    match role.as_deref() {
        Some(role) if allowed_roles.contains(&role) => Ok(()),
        Some(_) => Err(AppError::Forbidden),
        None => Err(AppError::Forbidden),
    }
}

pub async fn get_default_vehicle_id(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<Uuid>, AppError> {
    let row = sqlx::query_scalar::<_, Uuid>(
        "SELECT vehicle_id
         FROM riviamigo.vehicle_memberships
         WHERE user_id = $1 AND is_default = TRUE
         LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if row.is_some() {
        return Ok(row);
    }

    let fallback = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT default_vehicle_id FROM riviamigo.users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(fallback.flatten())
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
    let owner_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id
         FROM riviamigo.vehicle_memberships
         WHERE vehicle_id = $1 AND role = 'owner'
         ORDER BY created_at
         LIMIT 1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?;

    Ok(owner_id)
}
