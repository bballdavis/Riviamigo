use crate::errors::AppError;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserRole {
    SuperUser,
    Admin,
    User,
}

impl UserRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SuperUser => "super_user",
            Self::Admin => "admin",
            Self::User => "user",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "super_user" => Some(Self::SuperUser),
            "admin" => Some(Self::Admin),
            "user" => Some(Self::User),
            _ => None,
        }
    }
}

pub async fn get_user_role(pool: &PgPool, user_id: Uuid) -> Result<UserRole, AppError> {
    let role = sqlx::query_scalar::<_, Option<String>>("SELECT role FROM riviamigo.users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .flatten()
        .ok_or(AppError::Forbidden)?;

    UserRole::from_str(&role).ok_or_else(|| AppError::Validation("unknown user role".into()))
}

pub async fn require_admin_or_super_user(pool: &PgPool, user_id: Uuid) -> Result<UserRole, AppError> {
    let role = get_user_role(pool, user_id).await?;
    match role {
        UserRole::SuperUser | UserRole::Admin => Ok(role),
        UserRole::User => Err(AppError::Forbidden),
    }
}

pub async fn require_super_user(pool: &PgPool, user_id: Uuid) -> Result<(), AppError> {
    let role = get_user_role(pool, user_id).await?;
    if role == UserRole::SuperUser {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

pub fn can_manage_user(actor: UserRole, target: UserRole) -> bool {
    match actor {
        UserRole::SuperUser => true,
        UserRole::Admin => target == UserRole::User,
        UserRole::User => false,
    }
}

pub async fn get_electricity_rate(pool: &PgPool, user_id: Uuid) -> Result<f64, AppError> {
    let rate = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT electricity_rate_per_kwh FROM riviamigo.user_preferences WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .flatten()
    .unwrap_or(0.13);
    Ok(rate)
}
