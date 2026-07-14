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
    Read,
}

impl ApiAccessLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
        }
    }
}

impl TryFrom<&str> for ApiAccessLevel {
    type Error = AppError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "read" => Ok(Self::Read),
            _ => Err(AppError::Validation("access_level must be read".into())),
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
}

#[derive(Debug, Serialize)]
struct CreateApiKeyResponse {
    key: String,
    record: ApiKeyRecord,
}

#[derive(Debug, Serialize)]
struct ApiCatalogResponse {
    version: &'static str,
    authentication: &'static str,
    endpoints: Vec<ApiEndpointDoc>,
}

#[derive(Debug, Serialize)]
struct ApiEndpointDoc {
    method: &'static str,
    path: &'static str,
    vehicle_scoped: bool,
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
    .bind(ApiAccessLevel::Read.as_str())
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

async fn api_catalog(_auth: AuthUser) -> Json<ApiCatalogResponse> {
    Json(catalog())
}

async fn admin_api_catalog(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<ApiCatalogResponse>, AppError> {
    require_session_auth(&auth)?;
    require_user_admin(&state, auth.user_id).await?;
    Ok(Json(catalog()))
}

fn catalog() -> ApiCatalogResponse {
    let endpoints = vec![
        endpoint(
            "GET",
            "/v1/vehicles",
            false,
            "List the vehicle allowed by this integration key.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/status",
            true,
            "Read current runtime status.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/images",
            true,
            "Read cached vehicle imagery.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/raw-data",
            true,
            "Read bounded raw telemetry samples and coverage.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/health",
            true,
            "Read tire, closure, thermal, and software health.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/idle-drain",
            true,
            "Read validated parked-session drain history.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/state-timeline",
            true,
            "Read derived vehicle state periods.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/locations",
            true,
            "Read time-bucketed location history.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/live-session",
            true,
            "Read the latest live vehicle session.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/charging-schedule",
            true,
            "Read charging schedule configuration.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/departure-schedules",
            true,
            "Read departure schedules.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/wallboxes",
            true,
            "Read known wallbox details.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/ota-details",
            true,
            "Read OTA details.",
        ),
        endpoint(
            "GET",
            "/v1/battery/{series}",
            true,
            "Read state of charge, range, capacity, health, mileage, degradation, or drain series.",
        ),
        endpoint(
            "GET",
            "/v1/metrics/catalog",
            false,
            "List stable metric identifiers and units.",
        ),
        endpoint(
            "GET",
            "/v1/metrics/value",
            true,
            "Read one latest metric value.",
        ),
        endpoint(
            "GET",
            "/v1/metrics/series",
            true,
            "Read one metric time series.",
        ),
        endpoint(
            "POST",
            "/v1/metrics/batch",
            true,
            "Read deduplicated values and bounded sparklines.",
        ),
        endpoint("GET", "/v1/trips", true, "Read trip summaries."),
        endpoint(
            "GET",
            "/v1/trips/map",
            true,
            "Read compact trip-route previews.",
        ),
        endpoint(
            "GET",
            "/v1/trips/{id}",
            true,
            "Read a trip and detail, track, speed, elevation, power, or series data.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/drives/{trip_id}/power",
            true,
            "Read a trip power profile with the vehicle ID in the path.",
        ),
        endpoint(
            "GET",
            "/v1/charging",
            true,
            "Read sessions, summaries, chart series, curves, and analysis.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/charging-sessions",
            true,
            "Read charging sessions with the vehicle ID in the path.",
        ),
        endpoint(
            "GET",
            "/v1/vehicles/{id}/costs",
            true,
            "Read charging cost summaries with the vehicle ID in the path.",
        ),
        endpoint(
            "GET",
            "/v1/efficiency/{view}",
            true,
            "Read efficiency summaries, trends, and temperature analysis.",
        ),
        endpoint(
            "GET",
            "/v1/dashboard/overview/{vehicle_id}",
            true,
            "Read the combined dashboard overview.",
        ),
        endpoint(
            "GET",
            "/v1/grafana",
            false,
            "Check the Grafana compatibility datasource.",
        ),
        endpoint(
            "POST",
            "/v1/grafana/search",
            false,
            "List Grafana metric names.",
        ),
        endpoint(
            "POST",
            "/v1/grafana/query",
            true,
            "Use the legacy Grafana compatibility datasource.",
        ),
        endpoint(
            "POST",
            "/v1/grafana/annotations",
            false,
            "Read Grafana annotations (currently empty).",
        ),
        endpoint(
            "POST",
            "/v1/grafana/tag-keys",
            false,
            "Read Grafana tag keys (currently empty).",
        ),
        endpoint(
            "POST",
            "/v1/grafana/tag-values",
            false,
            "Read Grafana tag values (currently empty).",
        ),
    ];

    ApiCatalogResponse {
        version: "v1",
        authentication: "Bearer integration key; read-only and scoped to one vehicle.",
        endpoints,
    }
}

fn endpoint(
    method: &'static str,
    path: &'static str,
    vehicle_scoped: bool,
    purpose: &'static str,
) -> ApiEndpointDoc {
    ApiEndpointDoc {
        method,
        path,
        vehicle_scoped,
        purpose,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integration_catalog_contains_only_read_operations() {
        let catalog = catalog();

        assert!(catalog
            .endpoints
            .iter()
            .all(|endpoint| matches!(endpoint.method, "GET" | "POST")));
        assert!(catalog
            .endpoints
            .iter()
            .any(|endpoint| { endpoint.method == "POST" && endpoint.path == "/v1/metrics/batch" }));
        assert!(catalog.endpoints.iter().any(|endpoint| {
            endpoint.method == "GET" && endpoint.path == "/v1/vehicles/{id}/live-session"
        }));
        assert!(!catalog
            .endpoints
            .iter()
            .any(|endpoint| endpoint.path == "/v1/vehicles/live"));
    }
}
