use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_role,
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api-keys", get(list_api_keys).post(create_api_key))
        .route("/api-keys/:id", delete(revoke_api_key))
        .route("/api/catalog", get(api_catalog))
        .route("/admin/api/catalog", get(admin_api_catalog))
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ApiAccessLevel {
    View,
    Edit,
    Admin,
}

impl ApiAccessLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::View => "view",
            Self::Edit => "edit",
            Self::Admin => "admin",
        }
    }
}

impl TryFrom<&str> for ApiAccessLevel {
    type Error = AppError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "view" => Ok(Self::View),
            "edit" => Ok(Self::Edit),
            "admin" => Ok(Self::Admin),
            _ => Err(AppError::Validation(
                "access_level must be view, edit, or admin".into(),
            )),
        }
    }
}

#[derive(Debug, Serialize)]
struct ApiKeyRecord {
    id: Uuid,
    vehicle_id: Uuid,
    name: String,
    access_level: ApiAccessLevel,
    created_at: chrono::DateTime<chrono::Utc>,
    last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
    revoked_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Deserialize)]
struct CreateApiKeyBody {
    vehicle_id: Uuid,
    name: String,
    access_level: ApiAccessLevel,
}

#[derive(Debug, Serialize)]
struct CreateApiKeyResponse {
    key: String,
    record: ApiKeyRecord,
}

#[derive(Debug, Serialize)]
struct ApiCatalogResponse {
    access_levels: Vec<ApiAccessLevelDoc>,
    endpoints: Vec<ApiEndpointDoc>,
}

#[derive(Debug, Serialize)]
struct ApiAccessLevelDoc {
    level: &'static str,
    description: &'static str,
    allows: Vec<&'static str>,
    restricts: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
struct ApiEndpointDoc {
    method: &'static str,
    path: &'static str,
    minimum_access: &'static str,
    purpose: &'static str,
}

async fn list_api_keys(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<ApiKeyRecord>>, AppError> {
    require_session_auth(&auth)?;

    let rows = sqlx::query(
        r#"
        SELECT k.id, k.vehicle_id, COALESCE(k.name, k.label, 'API key') AS "name!",
               k.access_level, k.created_at, k.last_used_at, k.expires_at, k.revoked_at
        FROM riviamigo.api_keys k
        WHERE k.user_id = $1
        ORDER BY k.created_at DESC
        "#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.pool)
    .await?;

    let records = rows
        .into_iter()
        .map(|r| {
            Ok(ApiKeyRecord {
                id: r.try_get("id")?,
                vehicle_id: r.try_get::<Option<Uuid>, _>("vehicle_id")?.ok_or_else(|| {
                    AppError::Validation("vehicle-scoped API key missing vehicle_id".into())
                })?,
                name: r.try_get("name")?,
                access_level: ApiAccessLevel::try_from(
                    r.try_get::<String, _>("access_level")?.as_str(),
                )?,
                created_at: r.try_get("created_at")?,
                last_used_at: r.try_get("last_used_at")?,
                expires_at: r.try_get("expires_at")?,
                revoked_at: r.try_get("revoked_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(Json(records))
}

async fn create_api_key(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateApiKeyBody>,
) -> Result<(StatusCode, Json<CreateApiKeyResponse>), AppError> {
    require_session_auth(&auth)?;
    require_vehicle_role(
        &state.pool,
        auth.user_id,
        body.vehicle_id,
        &["owner", "manager"],
    )
    .await?;

    if body.name.trim().is_empty() {
        return Err(AppError::Validation("API key name is required".into()));
    }

    if body.access_level == ApiAccessLevel::Admin {
        require_user_admin(&state, auth.user_id).await?;
    }

    let secret = generate_api_key();
    let key_hash = hash_api_key(&secret);

    let row = sqlx::query(
        r#"
        INSERT INTO riviamigo.api_keys (user_id, vehicle_id, key_hash, label, name, access_level)
        VALUES ($1, $2, $3, $4, $4, $5)
        RETURNING id, vehicle_id, COALESCE(name, label, 'API key') AS "name!",
                  access_level, created_at, last_used_at, expires_at, revoked_at
        "#,
    )
    .bind(auth.user_id)
    .bind(body.vehicle_id)
    .bind(key_hash.as_slice())
    .bind(body.name.trim())
    .bind(body.access_level.as_str())
    .fetch_one(&state.pool)
    .await?;

    let record = ApiKeyRecord {
        id: row.try_get("id")?,
        vehicle_id: row
            .try_get::<Option<Uuid>, _>("vehicle_id")?
            .ok_or_else(|| AppError::Validation("created API key missing vehicle_id".into()))?,
        name: row.try_get("name")?,
        access_level: ApiAccessLevel::try_from(row.try_get::<String, _>("access_level")?.as_str())?,
        created_at: row.try_get("created_at")?,
        last_used_at: row.try_get("last_used_at")?,
        expires_at: row.try_get("expires_at")?,
        revoked_at: row.try_get("revoked_at")?,
    };

    Ok((
        StatusCode::CREATED,
        Json(CreateApiKeyResponse {
            key: secret,
            record,
        }),
    ))
}

async fn revoke_api_key(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    require_session_auth(&auth)?;

    let result = sqlx::query(
        r#"
        UPDATE riviamigo.api_keys k
        SET revoked_at = now(), updated_at = now()
        WHERE k.id = $1
          AND k.user_id = $2
          AND k.revoked_at IS NULL
        "#,
    )
    .bind(id)
    .bind(auth.user_id)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn api_catalog() -> Json<ApiCatalogResponse> {
    Json(catalog(false))
}

async fn admin_api_catalog(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<ApiCatalogResponse>, AppError> {
    require_user_admin(&state, auth.user_id).await?;
    Ok(Json(catalog(true)))
}

fn catalog(include_admin: bool) -> ApiCatalogResponse {
    let mut endpoints = vec![
        ApiEndpointDoc {
            method: "GET",
            path: "/v1/vehicles",
            minimum_access: "view",
            purpose: "List connected vehicles and identifiers.",
        },
        ApiEndpointDoc {
            method: "GET",
            path: "/v1/vehicles/{id}/status",
            minimum_access: "view",
            purpose: "Read current runtime status for a vehicle.",
        },
        ApiEndpointDoc {
            method: "GET",
            path: "/v1/vehicles/{id}/raw-data",
            minimum_access: "view",
            purpose: "Inspect raw telemetry samples and field coverage for dashboard debugging.",
        },
        ApiEndpointDoc {
            method: "GET",
            path: "/v1/battery/soc",
            minimum_access: "view",
            purpose: "Read state-of-charge time series.",
        },
        ApiEndpointDoc {
            method: "GET",
            path: "/v1/battery/range",
            minimum_access: "view",
            purpose: "Read range time series.",
        },
        ApiEndpointDoc {
            method: "GET",
            path: "/v1/stats/summary",
            minimum_access: "view",
            purpose: "Read lifetime summary metrics.",
        },
        ApiEndpointDoc {
            method: "POST",
            path: "/v1/metrics/batch",
            minimum_access: "view",
            purpose: "Read deduplicated dashboard metric values and bounded sparklines.",
        },
        ApiEndpointDoc {
            method: "GET",
            path: "/v1/trips",
            minimum_access: "view",
            purpose: "Read trip summaries.",
        },
        ApiEndpointDoc {
            method: "GET",
            path: "/v1/trips/map",
            minimum_access: "view",
            purpose: "Read compact route previews for all trips in a timeframe.",
        },
        ApiEndpointDoc {
            method: "GET",
            path: "/v1/trips/{id}/detail",
            minimum_access: "view",
            purpose: "Read one adaptive, synchronized trip telemetry payload.",
        },
        ApiEndpointDoc {
            method: "GET",
            path: "/v1/charging",
            minimum_access: "view",
            purpose: "Read charging session summaries.",
        },
        ApiEndpointDoc {
            method: "POST",
            path: "/v1/dashboards",
            minimum_access: "edit",
            purpose: "Create a user dashboard.",
        },
        ApiEndpointDoc {
            method: "PUT",
            path: "/v1/dashboards/{id}",
            minimum_access: "edit",
            purpose: "Update a user dashboard.",
        },
        ApiEndpointDoc {
            method: "DELETE",
            path: "/v1/dashboards/{id}",
            minimum_access: "edit",
            purpose: "Delete a user dashboard.",
        },
    ];

    if include_admin {
        endpoints.extend([
            ApiEndpointDoc {
                method: "PUT",
                path: "/v1/admin/dashboards/{id}",
                minimum_access: "admin",
                purpose: "Update a system or user dashboard as an admin.",
            },
            ApiEndpointDoc {
                method: "POST",
                path: "/v1/admin/dashboards/{id}/lock",
                minimum_access: "admin",
                purpose: "Lock or unlock a dashboard.",
            },
            ApiEndpointDoc {
                method: "GET",
                path: "/v1/admin/api/catalog",
                minimum_access: "admin",
                purpose: "Read admin endpoint catalog entries.",
            },
        ]);
    }

    ApiCatalogResponse {
        access_levels: vec![
            ApiAccessLevelDoc {
                level: "view",
                description: "Read-only diagnostics and dashboard data access.",
                allows: vec!["GET requests to vehicle, battery, stats, trip, charging, live, and dashboard data."],
                restricts: vec!["POST, PUT, PATCH, and DELETE requests.", "Admin endpoints."],
            },
            ApiAccessLevelDoc {
                level: "edit",
                description: "Read access plus user-owned dashboard and configuration updates.",
                allows: vec!["All view permissions.", "Non-admin POST, PUT, PATCH, and DELETE routes for owned resources."],
                restricts: vec!["Admin endpoints.", "Resources owned by other users."],
            },
            ApiAccessLevelDoc {
                level: "admin",
                description: "Administrative access for users with the admin role.",
                allows: vec!["All edit permissions.", "Admin catalog and admin dashboard routes."],
                restricts: vec!["Creation is limited to users with role=admin.", "Vehicle ownership checks still apply."],
            },
        ],
        endpoints,
    }
}

fn generate_api_key() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("rmigo_{}", URL_SAFE_NO_PAD.encode(bytes))
}

pub fn hash_api_key(secret: &str) -> Vec<u8> {
    Sha256::digest(secret.as_bytes()).to_vec()
}

async fn require_user_admin(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    let role: Option<String> =
        sqlx::query_scalar!("SELECT role FROM riviamigo.users WHERE id = $1", user_id)
            .fetch_optional(&state.pool)
            .await?;

    match role.as_deref() {
        Some("admin") | Some("super_user") => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}

fn require_session_auth(auth: &AuthUser) -> Result<(), AppError> {
    if auth.api_access_level.is_some() {
        return Err(AppError::Forbidden);
    }

    Ok(())
}
