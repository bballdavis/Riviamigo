use chrono_tz::Tz;
use sqlx::PgPool;

use crate::errors::AppError;

pub const APP_TIMEZONE_KEY: &str = "app_timezone";

pub async fn load_app_timezone_name(pool: &PgPool) -> Result<String, AppError> {
    let value =
        sqlx::query_scalar::<_, String>("SELECT value FROM riviamigo.system_config WHERE key = $1")
            .bind(APP_TIMEZONE_KEY)
            .fetch_optional(pool)
            .await?;

    let value = match value {
        Some(value) if !value.trim().is_empty() => value,
        _ => sqlx::query_scalar::<_, String>(
            "SELECT timezone FROM riviamigo.backup_settings WHERE id = TRUE",
        )
        .fetch_optional(pool)
        .await?
        .unwrap_or_else(|| "UTC".to_string()),
    };

    value
        .parse::<Tz>()
        .map(|_| value)
        .map_err(|_| AppError::Validation("timezone must be a valid IANA timezone".into()))
}

pub async fn load_app_timezone(pool: &PgPool) -> Result<Tz, AppError> {
    load_app_timezone_name(pool)
        .await?
        .parse::<Tz>()
        .map_err(|_| AppError::Validation("timezone must be a valid IANA timezone".into()))
}

pub async fn set_app_timezone(pool: &PgPool, timezone: Tz) -> Result<(), AppError> {
    let timezone_name = timezone.name();
    let mut transaction = pool.begin().await?;
    sqlx::query(
        "INSERT INTO riviamigo.system_config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    .bind(APP_TIMEZONE_KEY)
    .bind(timezone_name)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE riviamigo.backup_settings SET timezone = $1, updated_at = now() WHERE id = TRUE",
    )
    .bind(timezone_name)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}
