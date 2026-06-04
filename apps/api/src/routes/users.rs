use axum::{
    extract::{Path, Query, State},
    routing::{get, patch, post},
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
    routes::users_support::{hash_password, parse_membership_role, parse_role},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/users", get(list_users).post(create_user))
        .route("/admin/users/:id", patch(update_user).delete(delete_user))
        .route("/admin/users/:id/detail", get(get_user_detail))
        .route(
            "/admin/users/:id/vehicles",
            get(list_user_vehicle_memberships),
        )
        .route("/admin/users/:id/invites", get(list_user_invites))
        .route(
            "/admin/users/:id/invites/:invite_id/revoke",
            post(revoke_user_invite),
        )
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

    let _ = sqlx::query(
        "INSERT INTO riviamigo.user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
    )
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
        if target_user_id == auth.user_id
            && target_role == UserRole::SuperUser
            && new_role != UserRole::SuperUser
        {
            return Err(AppError::Validation(
                "cannot demote yourself from super_user".into(),
            ));
        }
    }

    if target_role == UserRole::SuperUser && body.is_disabled == Some(true) {
        let super_user_count: i64 = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM riviamigo.users WHERE role = 'super_user' AND is_disabled = FALSE",
        )
        .fetch_one(&state.pool)
        .await?;
        if super_user_count <= 1 {
            return Err(AppError::Validation(
                "cannot disable the last super_user".into(),
            ));
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
    support_audit(
        state.pool.clone(),
        "admin_user_update",
        Some(auth.user_id),
        format!("target_user_id={target_user_id}"),
    );

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
        let super_user_count: i64 = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM riviamigo.users WHERE role = 'super_user'",
        )
        .fetch_one(&state.pool)
        .await?;
        if super_user_count <= 1 {
            return Err(AppError::Validation(
                "cannot delete the last super_user".into(),
            ));
        }
    }

    sqlx::query("DELETE FROM riviamigo.users WHERE id = $1")
        .bind(target_user_id)
        .execute(&state.pool)
        .await?;
    support_audit(
        state.pool.clone(),
        "admin_user_delete",
        Some(auth.user_id),
        format!("target_user_id={target_user_id}"),
    );

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn get_user_detail(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(target_user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    let user_row = sqlx::query(
        "SELECT id, email, role, is_disabled, created_at, updated_at
         FROM riviamigo.users
         WHERE id = $1",
    )
    .bind(target_user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let memberships = list_user_memberships_payload(&state.pool, target_user_id).await?;
    let email = user_row.get::<String, _>("email");
    let invites = list_user_invites_payload(&state.pool, &email).await?;

    Ok(Json(serde_json::json!({
        "user": {
            "id": user_row.get::<Uuid, _>("id"),
            "email": email,
            "role": user_row.get::<String, _>("role"),
            "is_disabled": user_row.get::<bool, _>("is_disabled"),
            "created_at": user_row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "updated_at": user_row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
        },
        "memberships": memberships,
        "invites": invites,
    })))
}

async fn list_user_vehicle_memberships(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(target_user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    let memberships = list_user_memberships_payload(&state.pool, target_user_id).await?;
    Ok(Json(serde_json::json!({ "memberships": memberships })))
}

async fn list_user_invites(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(target_user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    let email =
        sqlx::query_scalar::<_, Option<String>>("SELECT email FROM riviamigo.users WHERE id = $1")
            .bind(target_user_id)
            .fetch_optional(&state.pool)
            .await?
            .flatten()
            .ok_or(AppError::NotFound)?;
    let invites = list_user_invites_payload(&state.pool, &email).await?;
    Ok(Json(serde_json::json!({ "invites": invites })))
}

async fn revoke_user_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((target_user_id, invite_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin_or_super_user(&state.pool, auth.user_id).await?;
    let email =
        sqlx::query_scalar::<_, Option<String>>("SELECT email FROM riviamigo.users WHERE id = $1")
            .bind(target_user_id)
            .fetch_optional(&state.pool)
            .await?
            .flatten()
            .ok_or(AppError::NotFound)?;

    sqlx::query(
        "UPDATE riviamigo.vehicle_invites
         SET revoked_at = now(), updated_at = now()
         WHERE id = $1 AND lower(invitee_email) = lower($2) AND accepted_at IS NULL",
    )
    .bind(invite_id)
    .bind(email)
    .execute(&state.pool)
    .await?;
    support_audit(
        state.pool.clone(),
        "admin_invite_revoke",
        Some(auth.user_id),
        format!("invite_id={invite_id} target_user_id={target_user_id}"),
    );
    Ok(Json(serde_json::json!({ "ok": true })))
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
    support_audit(
        state.pool.clone(),
        "admin_membership_grant",
        Some(auth.user_id),
        format!("target_user_id={target_user_id} vehicle_id={vehicle_id} role={role}"),
    );

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
    support_audit(
        state.pool.clone(),
        "admin_membership_update",
        Some(auth.user_id),
        format!("target_user_id={target_user_id} vehicle_id={vehicle_id} role={role}"),
    );
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
        let owner_count: i64 = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM riviamigo.vehicle_memberships WHERE vehicle_id = $1 AND role = 'owner'",
        )
        .bind(vehicle_id)
        .fetch_one(&state.pool)
        .await?;
        if owner_count <= 1 {
            return Err(AppError::Validation(
                "vehicle must keep at least one owner".into(),
            ));
        }
    }

    sqlx::query("DELETE FROM riviamigo.vehicle_memberships WHERE user_id = $1 AND vehicle_id = $2")
        .bind(target_user_id)
        .bind(vehicle_id)
        .execute(&state.pool)
        .await?;
    support_audit(
        state.pool.clone(),
        "admin_membership_remove",
        Some(auth.user_id),
        format!("target_user_id={target_user_id} vehicle_id={vehicle_id}"),
    );

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn list_user_memberships_payload(
    pool: &sqlx::PgPool,
    target_user_id: Uuid,
) -> Result<Vec<serde_json::Value>, AppError> {
    let rows = sqlx::query(
        "SELECT vm.vehicle_id, vm.role, vm.is_default, vm.created_at, v.model, COALESCE(vus.display_name, v.name) AS display_name
         FROM riviamigo.vehicle_memberships vm
         JOIN riviamigo.vehicles v ON v.id = vm.vehicle_id
         LEFT JOIN riviamigo.vehicle_user_settings vus ON vus.vehicle_id = vm.vehicle_id AND vus.user_id = vm.user_id
         WHERE vm.user_id = $1
         ORDER BY vm.created_at DESC",
    )
    .bind(target_user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
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
        .collect())
}

async fn list_user_invites_payload(
    pool: &sqlx::PgPool,
    email: &str,
) -> Result<Vec<serde_json::Value>, AppError> {
    let rows = sqlx::query(
        "SELECT i.id, i.vehicle_id, i.invitee_email, i.role, i.expires_at, i.accepted_at, i.revoked_at,
                i.created_at, COALESCE(v.name, v.model) AS vehicle_name
         FROM riviamigo.vehicle_invites i
         JOIN riviamigo.vehicles v ON v.id = i.vehicle_id
         WHERE lower(i.invitee_email) = lower($1)
         ORDER BY i.created_at DESC",
    )
    .bind(email)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<Uuid, _>("id"),
                "vehicle_id": row.get::<Uuid, _>("vehicle_id"),
                "vehicle_name": row.get::<String, _>("vehicle_name"),
                "invitee_email": row.get::<String, _>("invitee_email"),
                "role": row.get::<String, _>("role"),
                "expires_at": row.get::<chrono::DateTime<chrono::Utc>, _>("expires_at"),
                "accepted_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("accepted_at"),
                "revoked_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            })
        })
        .collect())
}

fn support_audit(pool: sqlx::PgPool, event: &'static str, user_id: Option<Uuid>, detail: String) {
    tokio::spawn(async move {
        let result = sqlx::query(
            "INSERT INTO riviamigo.security_events (event_type, user_id, detail, created_at) VALUES ($1, $2, $3, now())",
        )
        .bind(event)
        .bind(user_id)
        .bind(detail)
        .execute(&pool)
        .await;
        if let Err(error) = result {
            tracing::warn!(error = %error, event, "support audit insert failed");
        }
    });
}
