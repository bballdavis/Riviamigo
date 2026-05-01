use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Dashboard {
    pub id: Uuid,
    pub owner_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub is_locked: bool,
    pub config: Value,
}

#[derive(Debug, Deserialize)]
pub struct CreateDashboard {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub config: Value,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDashboard {
    pub name: Option<String>,
    pub description: Option<String>,
    pub config: Option<Value>,
}

// ─── Router ──────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/dashboards", get(list).post(create))
        .route("/dashboards/by-slug/:slug", get(by_slug))
        .route("/dashboards/:id", get(fetch).put(update).delete(remove))
        .route("/dashboards/:id/clone", post(clone_dashboard))
        .route("/admin/dashboards/:id", put(admin_update))
        .route("/admin/dashboards/:id/lock", post(admin_set_lock))
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/// List the current user's dashboards plus all visible system defaults.
async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<Dashboard>>, AppError> {
    let rows = sqlx::query_as!(
        Dashboard,
        r#"
        SELECT id, owner_id, slug, name, description, is_default, is_locked, config
        FROM dashboards
        WHERE owner_id = $1 OR owner_id IS NULL
        ORDER BY is_default DESC, name ASC
        "#,
        auth.user_id
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

/// Fetch a single dashboard by id.
async fn fetch(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Dashboard>, AppError> {
    let row = sqlx::query_as!(
        Dashboard,
        r#"
        SELECT id, owner_id, slug, name, description, is_default, is_locked, config
        FROM dashboards WHERE id = $1
        "#,
        id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    check_read_access(&row, auth.user_id)?;
    Ok(Json(row))
}

/// Resolve slug → config. User's own dashboard takes priority over system default.
async fn by_slug(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(slug): Path<String>,
) -> Result<Json<Dashboard>, AppError> {
    // User-owned variant first, then system default
    let row = sqlx::query_as!(
        Dashboard,
        r#"
        SELECT id, owner_id, slug, name, description, is_default, is_locked, config
        FROM dashboards
        WHERE slug = $1 AND (owner_id = $2 OR owner_id IS NULL)
        ORDER BY (owner_id = $2) DESC
        LIMIT 1
        "#,
        slug,
        auth.user_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}

/// Create a user-owned dashboard.
async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateDashboard>,
) -> Result<(StatusCode, Json<Dashboard>), AppError> {
    validate_slug(&body.slug)?;

    let id = Uuid::new_v4();
    let row = sqlx::query_as!(
        Dashboard,
        r#"
        INSERT INTO dashboards (id, owner_id, slug, name, description, is_default, is_locked, config)
        VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $6)
        RETURNING id, owner_id, slug, name, description, is_default, is_locked, config
        "#,
        id,
        auth.user_id,
        body.slug,
        body.name,
        body.description,
        body.config
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        if e.to_string().contains("unique") {
            AppError::Validation("A dashboard with that slug already exists".into())
        } else {
            AppError::Database(e)
        }
    })?;

    Ok((StatusCode::CREATED, Json(row)))
}

/// Update a user-owned dashboard (non-admin cannot touch system defaults).
async fn update(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDashboard>,
) -> Result<Json<Dashboard>, AppError> {
    let existing = get_dashboard(&state, id).await?;
    check_write_access(&existing, auth.user_id, false)?;

    let row = sqlx::query_as!(
        Dashboard,
        r#"
        UPDATE dashboards
        SET name        = COALESCE($1, name),
            description = COALESCE($2, description),
            config      = COALESCE($3, config),
            updated_at  = NOW()
        WHERE id = $4
        RETURNING id, owner_id, slug, name, description, is_default, is_locked, config
        "#,
        body.name,
        body.description,
        body.config,
        id
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row))
}

/// Delete a user-owned dashboard.
async fn remove(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let existing = get_dashboard(&state, id).await?;
    check_write_access(&existing, auth.user_id, false)?;

    sqlx::query!("DELETE FROM dashboards WHERE id = $1", id)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Clone a dashboard (system default → user copy, or copy any accessible dashboard).
async fn clone_dashboard(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<Dashboard>), AppError> {
    let source = get_dashboard(&state, id).await?;
    check_read_access(&source, auth.user_id)?;

    let new_id = Uuid::new_v4();
    let new_slug = format!("{}-copy", source.slug);

    let row = sqlx::query_as!(
        Dashboard,
        r#"
        INSERT INTO dashboards (id, owner_id, slug, name, description, is_default, is_locked, config)
        VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $6)
        RETURNING id, owner_id, slug, name, description, is_default, is_locked, config
        "#,
        new_id,
        auth.user_id,
        new_slug,
        format!("{} (copy)", source.name),
        source.description,
        source.config
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        if e.to_string().contains("unique") {
            AppError::Validation("You already have a dashboard with that slug".into())
        } else {
            AppError::Database(e)
        }
    })?;

    Ok((StatusCode::CREATED, Json(row)))
}

// ─── Admin handlers ───────────────────────────────────────────────────────────

async fn admin_update(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDashboard>,
) -> Result<Json<Dashboard>, AppError> {
    require_admin(&state, auth.user_id).await?;

    let row = sqlx::query_as!(
        Dashboard,
        r#"
        UPDATE dashboards
        SET name        = COALESCE($1, name),
            description = COALESCE($2, description),
            config      = COALESCE($3, config),
            updated_at  = NOW()
        WHERE id = $4
        RETURNING id, owner_id, slug, name, description, is_default, is_locked, config
        "#,
        body.name,
        body.description,
        body.config,
        id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}

#[derive(Deserialize)]
struct LockBody {
    locked: bool,
}

async fn admin_set_lock(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<LockBody>,
) -> Result<Json<Dashboard>, AppError> {
    require_admin(&state, auth.user_id).await?;

    let row = sqlx::query_as!(
        Dashboard,
        r#"
        UPDATE dashboards SET is_locked = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, owner_id, slug, name, description, is_default, is_locked, config
        "#,
        body.locked,
        id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async fn get_dashboard(state: &AppState, id: Uuid) -> Result<Dashboard, AppError> {
    sqlx::query_as!(
        Dashboard,
        r#"
        SELECT id, owner_id, slug, name, description, is_default, is_locked, config
        FROM dashboards WHERE id = $1
        "#,
        id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)
}

fn check_read_access(d: &Dashboard, user_id: Uuid) -> Result<(), AppError> {
    // System defaults are readable by all authenticated users
    if d.owner_id.is_none() {
        return Ok(());
    }
    if d.owner_id == Some(user_id) {
        return Ok(());
    }
    Err(AppError::Forbidden)
}

fn check_write_access(d: &Dashboard, user_id: Uuid, is_admin: bool) -> Result<(), AppError> {
    if d.is_locked && !is_admin {
        return Err(AppError::Forbidden);
    }
    if d.owner_id.is_none() && !is_admin {
        return Err(AppError::Forbidden);
    }
    if d.owner_id != Some(user_id) && !is_admin {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

async fn require_admin(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    let role: Option<String> = sqlx::query_scalar!("SELECT role FROM users WHERE id = $1", user_id)
        .fetch_optional(&state.pool)
        .await?;

    match role.as_deref() {
        Some("admin") => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}

fn validate_slug(slug: &str) -> Result<(), AppError> {
    if slug.is_empty()
        || !slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c == '-' || c.is_ascii_digit())
    {
        return Err(AppError::Validation(
            "Slug must be lowercase letters, digits, and hyphens only".into(),
        ));
    }
    Ok(())
}

// ─── Seed ────────────────────────────────────────────────────────────────────

/// Idempotently insert system default dashboards on startup.
/// Defaults are embedded JSON files; call this once from main.rs after pool is ready.
pub async fn seed_defaults(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    let defaults: &[(&str, &str)] = &[
        (
            "00000000-0000-0000-0000-000000000001",
            include_str!("../../dashboards/dashboard.json"),
        ),
        (
            "00000000-0000-0000-0000-000000000002",
            include_str!("../../dashboards/battery.json"),
        ),
        (
            "00000000-0000-0000-0000-000000000003",
            include_str!("../../dashboards/efficiency.json"),
        ),
        (
            "00000000-0000-0000-0000-000000000004",
            include_str!("../../dashboards/charging.json"),
        ),
        (
            "00000000-0000-0000-0000-000000000005",
            include_str!("../../dashboards/trips.json"),
        ),
    ];

    for (id_str, json_str) in defaults {
        let id: Uuid = id_str.parse()?;
        let config: Value = serde_json::from_str(json_str)?;
        let name = config["name"].as_str().unwrap_or("Dashboard").to_string();
        let slug = config["slug"].as_str().unwrap_or("dashboard").to_string();

        sqlx::query!(
            r#"
            INSERT INTO dashboards (id, owner_id, slug, name, is_default, is_locked, config)
            VALUES ($1, NULL, $2, $3, TRUE, TRUE, $4)
            ON CONFLICT (id) DO UPDATE
                SET config     = EXCLUDED.config,
                    name       = EXCLUDED.name,
                    updated_at = NOW()
            "#,
            id,
            slug,
            name,
            config
        )
        .execute(pool)
        .await?;
    }

    Ok(())
}
