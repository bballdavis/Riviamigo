use axum::{
    extract::{Path, Query, State},
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    db::users::{
        can_manage_user, get_user_role, require_admin_or_super_user, require_super_user, UserRole,
    },
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/users", get(list_users).post(create_user))
        .route("/admin/users/:id", patch(update_user).delete(delete_user))
        .route("/admin/users/:id/vehicles", get(list_user_vehicle_memberships))
        .route(
            "/admin/users/:id/vehicles/:vehicle_id",
            post(grant_user_vehicle_membership)
                .patch(update_user_vehicle_membership)
                .delete(remove_user_vehicle_membership),
        )
}

#[derive(Deserialize)]
struct ListUsersQuery {
    search: Option<String>,
}

#[derive(Deserialize)]
struct CreateUserBody {
    email: String,
    password: String,
    role: Option<String>,
}

#[derive(Deserialize)]
struct UpdateUserBody {
    email: Option<String>,
    role: Option<String>,
    is_disabled: Option<bool>,
}

#[derive(Deserialize)]
struct RepairMembershipBody {
    role: String,
}

async fn list_users(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListUsersQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;

    let search = query.search.unwrap_or_default().trim().to_string();
    let pattern = if search.is_empty() {
        "%".to_string()
    } else {
        format!("%{}%", search.to_lowercase())
    };

    let rows = sqlx::query(
        "SELECT u.id, u.email, u.role, u.is_disabled, u.created_at, u.updated_at,
                COUNT(vm.vehicle_id)::INT AS vehicle_count
         FROM riviamigo.users u
         LEFT JOIN riviamigo.vehicle_memberships vm ON vm.user_id = u.id
         WHERE lower(u.email) LIKE $1
         GROUP BY u.id
         ORDER BY u.created_at DESC",
    )
    .bind(pattern)
    .fetch_all(&state.pool)
    .await?;

    let users: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<Uuid, _>("id"),
                "email": row.get::<String, _>("email"),
                "role": row.get::<String, _>("role"),
                "is_disabled": row.get::<bool, _>("is_disabled"),
                "vehicle_count": row.get::<i32, _>("vehicle_count"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
                "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({ "users": users })))
}

async fn create_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateUserBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let actor_role = require_admin_or_super_user(&state.pool, auth.user_id).await?;
    if body.password.len() < 12 {
        return Err(AppError::Validation("password min 12 chars".into()));
    }
    let email = body.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err(AppError::Validation("valid email required".into()));
    }

    let requested_role = parse_role(body.role.as_deref().unwrap_or("user"))?;
    if !can_manage_user(actor_role, requested_role) {
        return Err(AppError::Forbidden);
    }

    let hash = hash_password(&body.password)?;
    let user_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO riviamigo.users (email, password_hash, role)
         VALUES ($1, $2, $3)
         RETURNING id",
    )
    .bind(email)
    .bind(hash)
    .bind(requested_role.as_str())
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.constraint() == Some("users_email_key") => {
            AppError::Validation("email already registered".into())
        }
        other => AppError::Database(other),
    })?;

    let _ = sqlx::query("INSERT INTO riviamigo.user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(user_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "id": user_id })))
}

async fn update_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(target_user_id): Path<Uuid>,
    Json(body): Json<UpdateUserBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let actor_role = require_admin_or_super_user(&state.pool, auth.user_id).await?;
    let target_role = get_user_role(&state.pool, target_user_id).await?;
    if !can_manage_user(actor_role, target_role) {
        return Err(AppError::Forbidden);
    }

    if let Some(role_value) = body.role.as_deref() {
        let new_role = parse_role(role_value)?;
        if !can_manage_user(actor_role, new_role) {
            return Err(AppError::Forbidden);
        }
        if target_user_id == auth.user_id && target_role == UserRole::SuperUser && new_role != UserRole::SuperUser {
            return Err(AppError::Validation("cannot demote yourself from super_user".into()));
        }
    }

    if target_role == UserRole::SuperUser && body.is_disabled == Some(true) {
        let super_user_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM riviamigo.users WHERE role = 'super_user' AND is_disabled = FALSE",
        )
        .fetch_one(&state.pool)
        .await?
        .unwrap_or(0);
        if super_user_count <= 1 {
            return Err(AppError::Validation("cannot disable the last super_user".into()));
        }
    }

    let email = body.email.as_ref().map(|v| v.trim().to_lowercase());
    let role_str = body
        .role
        .as_deref()
        .map(parse_role)
        .transpose()?
        .map(|role| role.as_str().to_string());

    sqlx::query(
        "UPDATE riviamigo.users
         SET email = COALESCE($2, email),
             role = COALESCE($3, role),
             is_disabled = COALESCE($4, is_disabled),
             updated_at = now()
         WHERE id = $1",
    )
    .bind(target_user_id)
    .bind(email)
    .bind(role_str)
    .bind(body.is_disabled)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn delete_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(target_user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    if auth.user_id == target_user_id {
        return Err(AppError::Validation("cannot delete yourself".into()));
    }
    require_super_user(&state.pool, auth.user_id).await?;
    let target_role = get_user_role(&state.pool, target_user_id).await?;
    if target_role == UserRole::SuperUser {
        let super_user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM riviamigo.users WHERE role = 'super_user'")
            .fetch_one(&state.pool)
            .await?
            .unwrap_or(0);
        if super_user_count <= 1 {
            return Err(AppError::Validation("cannot delete the last super_user".into()));
        }
    }

    sqlx::query("DELETE FROM riviamigo.users WHERE id = $1")
        .bind(target_user_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn list_user_vehicle_memberships(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(target_user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;

    let rows = sqlx::query(
        "SELECT vm.vehicle_id, vm.role, vm.is_default, vm.created_at, v.model, COALESCE(vus.display_name, v.name) AS display_name
         FROM riviamigo.vehicle_memberships vm
         JOIN riviamigo.vehicles v ON v.id = vm.vehicle_id
         LEFT JOIN riviamigo.vehicle_user_settings vus ON vus.vehicle_id = vm.vehicle_id AND vus.user_id = vm.user_id
         WHERE vm.user_id = $1
         ORDER BY vm.created_at DESC",
    )
    .bind(target_user_id)
    .fetch_all(&state.pool)
    .await?;

    let memberships: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "vehicle_id": row.get::<Uuid, _>("vehicle_id"),
                "role": row.get::<String, _>("role"),
                "is_default": row.get::<bool, _>("is_default"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
                "model": row.get::<String, _>("model"),
                "display_name": row.get::<Option<String>, _>("display_name"),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({ "memberships": memberships })))
}

async fn grant_user_vehicle_membership(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((target_user_id, vehicle_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<RepairMembershipBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    let role = parse_membership_role(&body.role)?;

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
         VALUES ($1, $2, $3, FALSE)
         ON CONFLICT (vehicle_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, updated_at = now()",
    )
    .bind(vehicle_id)
    .bind(target_user_id)
    .bind(role)
    .execute(&state.pool)
    .await?;

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_user_settings (vehicle_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (vehicle_id, user_id) DO NOTHING",
    )
    .bind(vehicle_id)
    .bind(target_user_id)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn update_user_vehicle_membership(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((target_user_id, vehicle_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<RepairMembershipBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    let role = parse_membership_role(&body.role)?;
    sqlx::query(
        "UPDATE riviamigo.vehicle_memberships
         SET role = $3, updated_at = now()
         WHERE user_id = $1 AND vehicle_id = $2",
    )
    .bind(target_user_id)
    .bind(vehicle_id)
    .bind(role)
    .execute(&state.pool)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn remove_user_vehicle_membership(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((target_user_id, vehicle_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;

    let current_role = sqlx::query_scalar::<_, Option<String>>(
        "SELECT role FROM riviamigo.vehicle_memberships WHERE user_id = $1 AND vehicle_id = $2",
    )
    .bind(target_user_id)
    .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await?
    .flatten()
    .ok_or(AppError::NotFound)?;

    if current_role == "owner" {
        let owner_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM riviamigo.vehicle_memberships WHERE vehicle_id = $1 AND role = 'owner'",
        )
        .bind(vehicle_id)
        .fetch_one(&state.pool)
        .await?
        .unwrap_or(0);
        if owner_count <= 1 {
            return Err(AppError::Validation("vehicle must keep at least one owner".into()));
        }
    }

    sqlx::query("DELETE FROM riviamigo.vehicle_memberships WHERE user_id = $1 AND vehicle_id = $2")
        .bind(target_user_id)
        .bind(vehicle_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

fn parse_role(raw: &str) -> Result<UserRole, AppError> {
    UserRole::from_str(raw).ok_or_else(|| {
        AppError::Validation("role must be one of super_user, admin, or user".into())
    })
}

fn parse_membership_role(raw: &str) -> Result<&str, AppError> {
    if matches!(raw, "owner" | "manager" | "viewer") {
        Ok(raw)
    } else {
        Err(AppError::Validation(
            "membership role must be owner, manager, or viewer".into(),
        ))
    }
}

fn hash_password(password: &str) -> Result<String, AppError> {
    use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = argon2::Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|ph| ph.to_string())
        .map_err(|_| AppError::Validation("invalid password".into()))
}
