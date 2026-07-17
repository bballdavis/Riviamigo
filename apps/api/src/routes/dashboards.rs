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
        .route("/dashboards/{id}", get(fetch).put(update).delete(remove))
        .route("/dashboards/{id}/clone", post(clone_dashboard))
        .route("/admin/dashboards/{id}", put(admin_update))
        .route("/admin/dashboards/{id}/lock", post(admin_set_lock))
        .route(
            "/admin/dashboards/{id}/restore-default",
            post(admin_restore_default),
        )
}

pub fn metadata_router() -> Router<AppState> {
    Router::new().route("/dashboards/by-slug/{slug}", get(by_slug))
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/// List the current user's dashboards plus all visible system defaults.
async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<Dashboard>>, AppError> {
    let rows = sqlx::query_as::<_, Dashboard>(
        r#"
        SELECT id, owner_id, slug, name, description, is_default, is_locked, config
        FROM dashboards
        WHERE owner_id = $1 OR owner_id IS NULL
        ORDER BY is_default DESC, name ASC
        "#,
    )
    .bind(auth.user_id)
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
    let row = sqlx::query_as::<_, Dashboard>(
        r#"
        SELECT id, owner_id, slug, name, description, is_default, is_locked, config
        FROM dashboards WHERE id = $1
        "#,
    )
    .bind(id)
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
    let row = sqlx::query_as::<_, Dashboard>(
        r#"
        SELECT id, owner_id, slug, name, description, is_default, is_locked, config
        FROM dashboards
        WHERE slug = $1 AND (owner_id = $2 OR owner_id IS NULL)
        ORDER BY (owner_id = $2) DESC
        LIMIT 1
        "#,
    )
    .bind(slug)
    .bind(auth.user_id)
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
    let config = dashboard_config_with_metadata(
        body.config,
        id,
        Some(auth.user_id),
        &body.slug,
        &body.name,
        body.description.as_deref(),
        false,
        false,
    );
    let row = sqlx::query_as::<_, Dashboard>(
        r#"
        INSERT INTO dashboards (id, owner_id, slug, name, description, is_default, is_locked, config)
        VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $6)
        ON CONFLICT (owner_id, slug) DO UPDATE
        SET name        = EXCLUDED.name,
            description = EXCLUDED.description,
            config      = EXCLUDED.config,
            is_default  = FALSE,
            is_locked   = FALSE,
            updated_at  = NOW()
        RETURNING id, owner_id, slug, name, description, is_default, is_locked, config
        "#
    )
    .bind(id)
    .bind(auth.user_id)
    .bind(body.slug)
    .bind(body.name)
    .bind(body.description)
    .bind(config)
    .fetch_one(&state.pool)
    .await?;

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
    let next_name = body.name.as_deref().unwrap_or(&existing.name);
    let next_description = body
        .description
        .as_deref()
        .or(existing.description.as_deref());
    let next_config = body.config.map(|config| {
        dashboard_config_with_metadata(
            config,
            existing.id,
            existing.owner_id,
            &existing.slug,
            next_name,
            next_description,
            existing.is_default,
            existing.is_locked,
        )
    });

    let row = sqlx::query_as::<_, Dashboard>(
        r#"
        UPDATE dashboards
        SET name        = COALESCE($1, name),
            description = COALESCE($2, description),
            config      = COALESCE($3, config),
            updated_at  = NOW()
        WHERE id = $4
        RETURNING id, owner_id, slug, name, description, is_default, is_locked, config
        "#,
    )
    .bind(body.name)
    .bind(body.description)
    .bind(next_config)
    .bind(id)
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

    sqlx::query("DELETE FROM dashboards WHERE id = $1")
        .bind(id)
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
    let new_name = format!("{} (copy)", source.name);
    let config = dashboard_config_with_metadata(
        source.config.clone(),
        new_id,
        Some(auth.user_id),
        &new_slug,
        &new_name,
        source.description.as_deref(),
        false,
        false,
    );

    let row = sqlx::query_as::<_, Dashboard>(
        r#"
        INSERT INTO dashboards (id, owner_id, slug, name, description, is_default, is_locked, config)
        VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $6)
        RETURNING id, owner_id, slug, name, description, is_default, is_locked, config
        "#
    )
    .bind(new_id)
    .bind(auth.user_id)
    .bind(new_slug)
    .bind(new_name)
    .bind(source.description)
    .bind(config)
    .fetch_one(&state.pool)
    .await
    .map_err(|e: sqlx::Error| {
        if let Some(db) = e.as_database_error() {
            if db.constraint().is_some() {
                return AppError::Validation("You already have a dashboard with that slug".into());
            }
        }
        AppError::Database(e)
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
    let existing = get_dashboard(&state, id).await?;
    let next_name = body.name.as_deref().unwrap_or(&existing.name);
    let next_description = body
        .description
        .as_deref()
        .or(existing.description.as_deref());
    let next_config = body.config.map(|config| {
        dashboard_config_with_metadata(
            config,
            existing.id,
            existing.owner_id,
            &existing.slug,
            next_name,
            next_description,
            existing.is_default,
            existing.is_locked,
        )
    });

    let row = sqlx::query_as::<_, Dashboard>(
        r#"
        UPDATE dashboards
        SET name        = COALESCE($1, name),
            description = COALESCE($2, description),
            config      = COALESCE($3, config),
            updated_at  = NOW()
        WHERE id = $4
        RETURNING id, owner_id, slug, name, description, is_default, is_locked, config
        "#,
    )
    .bind(body.name)
    .bind(body.description)
    .bind(next_config)
    .bind(id)
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

    let row = sqlx::query_as::<_, Dashboard>(
        r#"
        UPDATE dashboards SET is_locked = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, owner_id, slug, name, description, is_default, is_locked, config
        "#,
    )
    .bind(body.locked)
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}

async fn admin_restore_default(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Dashboard>, AppError> {
    require_admin(&state, auth.user_id).await?;

    let existing = get_dashboard(&state, id).await?;
    if existing.owner_id.is_some() || !existing.is_default {
        return Err(AppError::Validation(
            "Only system default dashboards can be restored".into(),
        ));
    }

    let config = bundled_default_config(id).ok_or(AppError::NotFound)?;
    let name = config["name"]
        .as_str()
        .unwrap_or(&existing.name)
        .to_string();
    let config = dashboard_config_with_metadata(
        config,
        existing.id,
        existing.owner_id,
        &existing.slug,
        &name,
        existing.description.as_deref(),
        true,
        true,
    );

    let row = sqlx::query_as::<_, Dashboard>(
        r#"
        UPDATE dashboards
        SET name = $1,
            config = $2,
            is_default = TRUE,
            is_locked = TRUE,
            updated_at = NOW()
        WHERE id = $3
        RETURNING id, owner_id, slug, name, description, is_default, is_locked, config
        "#,
    )
    .bind(name)
    .bind(config)
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async fn get_dashboard(state: &AppState, id: Uuid) -> Result<Dashboard, AppError> {
    sqlx::query_as::<_, Dashboard>(
        r#"
        SELECT id, owner_id, slug, name, description, is_default, is_locked, config
        FROM dashboards WHERE id = $1
        "#,
    )
    .bind(id)
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
    let role = sqlx::query_scalar!("SELECT role FROM riviamigo.users WHERE id = $1", user_id)
        .fetch_optional(&state.pool)
        .await?;

    match role.as_deref() {
        Some("admin") | Some("super_user") => Ok(()),
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

#[allow(clippy::too_many_arguments)]
fn dashboard_config_with_metadata(
    mut config: Value,
    id: Uuid,
    owner_id: Option<Uuid>,
    slug: &str,
    name: &str,
    description: Option<&str>,
    is_default: bool,
    is_locked: bool,
) -> Value {
    if let Value::Object(ref mut object) = config {
        object.insert("id".into(), Value::String(id.to_string()));
        object.insert("slug".into(), Value::String(slug.to_string()));
        object.insert("name".into(), Value::String(name.to_string()));
        match description {
            Some(description) => {
                object.insert("description".into(), Value::String(description.to_string()));
            }
            None => {
                object.remove("description");
            }
        }
        object.insert("isDefault".into(), Value::Bool(is_default));
        object.insert("isLocked".into(), Value::Bool(is_locked));
        object.insert(
            "ownerId".into(),
            owner_id
                .map(|id| Value::String(id.to_string()))
                .unwrap_or(Value::Null),
        );
    }
    config
}

fn bundled_default_config(id: Uuid) -> Option<Value> {
    let id_str = id.to_string();
    let json_str = match id_str.as_str() {
        "00000000-0000-0000-0000-000000000001" => include_str!("../../dashboards/dashboard.json"),
        "00000000-0000-0000-0000-000000000002" => include_str!("../../dashboards/battery.json"),
        "00000000-0000-0000-0000-000000000003" => include_str!("../../dashboards/efficiency.json"),
        "00000000-0000-0000-0000-000000000004" => include_str!("../../dashboards/charging.json"),
        "00000000-0000-0000-0000-000000000005" => include_str!("../../dashboards/trips.json"),
        _ => return None,
    };

    serde_json::from_str(json_str).ok()
}

// ─── Seed ────────────────────────────────────────────────────────────────────

/// Insert missing system default dashboards on startup.
///
/// Existing system defaults are deliberately left untouched: administrators may
/// manage them in the UI, and an explicit restore action applies the bundled
/// baseline when that is wanted. User-owned dashboards are never seeded here.
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
        let config =
            dashboard_config_with_metadata(config, id, None, &slug, &name, None, true, true);

        sqlx::query(
            r#"
            INSERT INTO dashboards (id, owner_id, slug, name, is_default, is_locked, config)
            VALUES ($1, NULL, $2, $3, TRUE, TRUE, $4)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(id)
        .bind(slug)
        .bind(name)
        .bind(config)
        .execute(pool)
        .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_system_seed_matches_the_canonical_dashboard_source() {
        for (file_name, api_source, frontend_source) in [
            (
                "dashboard.json",
                include_str!("../../dashboards/dashboard.json"),
                include_str!("../../../../packages/dashboards/src/defaults/dashboard.json"),
            ),
            (
                "battery.json",
                include_str!("../../dashboards/battery.json"),
                include_str!("../../../../packages/dashboards/src/defaults/battery.json"),
            ),
            (
                "efficiency.json",
                include_str!("../../dashboards/efficiency.json"),
                include_str!("../../../../packages/dashboards/src/defaults/efficiency.json"),
            ),
            (
                "charging.json",
                include_str!("../../dashboards/charging.json"),
                include_str!("../../../../packages/dashboards/src/defaults/charging.json"),
            ),
            (
                "trips.json",
                include_str!("../../dashboards/trips.json"),
                include_str!("../../../../packages/dashboards/src/defaults/trips.json"),
            ),
        ] {
            let api_config: Value = serde_json::from_str(api_source).unwrap();
            let frontend_config: Value = serde_json::from_str(frontend_source).unwrap();
            assert_eq!(api_config, frontend_config, "seed drift in {file_name}");
        }
    }

    #[test]
    fn bundled_default_config_resolves_known_dashboard_ids() {
        let id: Uuid = "00000000-0000-0000-0000-000000000004".parse().unwrap();
        let config = bundled_default_config(id).expect("charging default");

        assert_eq!(config["slug"], "charging");
        assert!(config["widgets"]
            .as_array()
            .is_some_and(|widgets| !widgets.is_empty()));
    }

    #[test]
    fn dashboard_config_metadata_matches_owning_row() {
        let id: Uuid = "11111111-1111-1111-1111-111111111111".parse().unwrap();
        let owner_id: Uuid = "22222222-2222-2222-2222-222222222222".parse().unwrap();
        let config = serde_json::json!({
            "schemaVersion": 2,
            "id": "00000000-0000-0000-0000-000000000001",
            "slug": "dashboard",
            "name": "Overview",
            "description": "old",
            "isDefault": true,
            "isLocked": true,
            "ownerId": null,
            "controls": { "dateRange": true },
            "widgets": []
        });

        let normalized = dashboard_config_with_metadata(
            config,
            id,
            Some(owner_id),
            "dashboard-copy",
            "Dashboard Copy",
            None,
            false,
            false,
        );

        assert_eq!(normalized["id"], id.to_string());
        assert_eq!(normalized["ownerId"], owner_id.to_string());
        assert_eq!(normalized["slug"], "dashboard-copy");
        assert_eq!(normalized["name"], "Dashboard Copy");
        assert_eq!(normalized["isDefault"], false);
        assert_eq!(normalized["isLocked"], false);
        assert!(normalized.get("description").is_none());
    }

    // ── integration tests (require DATABASE_URL) ─────────────────────────────

    /// Regression test: `require_admin` must use the `riviamigo.` schema prefix.
    /// Without the prefix the query fails with "relation 'users' does not exist"
    /// and returns 500 instead of 403.
    ///
    /// This test registers a non-admin user and verifies that the admin-only
    /// `POST /v1/admin/dashboards` endpoint returns 403, not 500.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn require_admin_returns_403_not_500_for_non_admin() {
        use crate::middleware::auth::{AppState, JwtKeys};
        use axum::{
            body::Body,
            http::{Request, StatusCode},
        };
        use std::sync::Arc;
        use tower::ServiceExt;

        let database_url =
            std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");
        let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".into());

        let pool = crate::db::pool::create_pool(&database_url)
            .await
            .expect("pool");
        let redis = redis::Client::open(&*redis_url).expect("redis");

        // Generate a test RSA keypair without touching the DB.
        let (private_pem, public_pem) = {
            use rsa::{
                pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
                RsaPrivateKey,
            };
            let priv_key = RsaPrivateKey::new(&mut rand::thread_rng(), 2048).unwrap();
            (
                priv_key.to_pkcs8_pem(LineEnding::LF).unwrap().to_string(),
                priv_key
                    .to_public_key()
                    .to_public_key_pem(LineEnding::LF)
                    .unwrap(),
            )
        };
        let jwt_keys = Arc::new(JwtKeys::new(&private_pem, &public_pem).unwrap());

        let config = crate::config::Config {
            database_url: database_url.clone(),
            redis_url: redis_url.clone(),
            jwt_secret: None,
            jwt_public_key: None,
            age_encryption_key: None,
            port: 3001,
            allowed_origins: vec![],
            s3_endpoint: None,
            s3_access_key: None,
            s3_secret_key: None,
            backup_artifact_dir: std::env::temp_dir()
                .join("riviamigo-dashboard-test")
                .to_string_lossy()
                .into_owned(),
            vehicle_image_cache_dir: std::env::temp_dir()
                .join("riviamigo-dashboard-test-vehicle-images")
                .to_string_lossy()
                .into_owned(),
            backup_driver: "pg_dump".into(),
            backup_poll_interval_seconds: 60,
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: false,
            rivian_parallax_capture_enabled: false,
            rivian_suppress_duplicate_telemetry: true,
            riviamigo_env: None,
            cookie_insecure: Some("1".into()),
            rate_limit: crate::config::RateLimitConfig::default(),
        };

        let state = AppState {
            pool: pool.clone(),
            redis,
            jwt_keys: jwt_keys.clone(),
            age_key: "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"
                .into(),
            config,
            nominatim_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
            supervisor: crate::ingestion::supervisor::SupervisorHandle::noop(),
        };
        let app = crate::routes::build_router(state);

        // Register a fresh non-admin user.
        let email = format!("require-admin-test-{}@example.com", uuid::Uuid::new_v4());
        let reg_req = Request::builder()
            .method("POST")
            .uri("/v1/auth/register")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(
                    &serde_json::json!({"email": email, "password": "strongpassword123"}),
                )
                .unwrap(),
            ))
            .unwrap();
        let reg_resp = app.clone().oneshot(reg_req).await.unwrap();
        assert!(
            reg_resp.status().is_success(),
            "registration failed: {}",
            reg_resp.status()
        );

        let reg_body = axum::body::to_bytes(reg_resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let tokens: serde_json::Value = serde_json::from_slice(&reg_body).unwrap();
        let access_token = tokens["access_token"]
            .as_str()
            .expect("access_token in response");

        // Non-admin trying to update a global dashboard must get 403 (not 500).
        let req = Request::builder()
            .method("PUT")
            .uri(format!("/v1/admin/dashboards/{}", uuid::Uuid::nil()))
            .header("authorization", format!("Bearer {access_token}"))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"name":"Test"}"#))
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::FORBIDDEN,
            "non-admin must get 403; 500 would indicate the riviamigo. prefix is missing"
        );

        // Clean up the test user.
        let _ = sqlx::query("DELETE FROM riviamigo.users WHERE email = $1")
            .bind(&email)
            .execute(&pool)
            .await;
    }
}
