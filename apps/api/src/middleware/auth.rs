use std::{collections::HashMap, sync::Arc, time::Instant};

use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, Method},
};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::AppError, ingestion::supervisor::SupervisorHandle, routes::api_keys::hash_api_key,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub iss: String,
    pub exp: i64,
    pub iat: i64,
    pub default_vehicle_id: Option<Uuid>,
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub default_vehicle_id: Option<Uuid>,
    pub api_access_level: Option<String>,
    /// The one vehicle an integration key may read. Session-authenticated users
    /// have no key scope and continue to rely on their memberships.
    pub api_vehicle_id: Option<Uuid>,
}

pub struct JwtKeys {
    pub encoding: jsonwebtoken::EncodingKey,
    pub decoding: jsonwebtoken::DecodingKey,
}

impl std::fmt::Debug for JwtKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JwtKeys").finish_non_exhaustive()
    }
}

impl JwtKeys {
    pub fn new(private_pem: &str, public_pem: &str) -> anyhow::Result<Self> {
        Ok(Self {
            encoding: jsonwebtoken::EncodingKey::from_rsa_pem(private_pem.as_bytes())
                .map_err(|e| anyhow::anyhow!("invalid JWT private key: {e}"))?,
            decoding: jsonwebtoken::DecodingKey::from_rsa_pem(public_pem.as_bytes())
                .map_err(|e| anyhow::anyhow!("invalid JWT public key: {e}"))?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub redis: redis::Client,
    pub jwt_keys: Arc<JwtKeys>,
    pub age_key: String,
    pub config: crate::config::Config,
    /// Short-lived in-memory cache for address search results: normalised query -> (cached_at, json).
    /// Rate limiting is handled by the shared scheduler in `services::nominatim`.
    pub nominatim_cache: Arc<tokio::sync::RwLock<HashMap<String, (Instant, serde_json::Value)>>>,
    /// Handle for sending commands to the ingestion supervisor.
    pub supervisor: SupervisorHandle,
}

#[async_trait::async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Unauthorized)?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or(AppError::Unauthorized)?;

        if token.starts_with("rmigo_") {
            return authenticate_api_key(parts.method.clone(), parts.uri.path(), state, token)
                .await;
        }

        // Retrieve JWT public key from extensions (set by router middleware).
        let decoding_key = parts
            .extensions
            .get::<DecodingKey>()
            .ok_or(AppError::Unauthorized)?;

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&["riviamigo.app"]);
        // Pin leeway to 0 — do not rely on library defaults. Tokens have a
        // 15-minute lifetime; clock skew tolerance must be explicit and minimal.
        validation.leeway = 0;

        let claims = decode::<Claims>(token, decoding_key, &validation)
            .map_err(|_| AppError::Unauthorized)?
            .claims;

        let is_disabled = sqlx::query_scalar::<_, Option<bool>>(
            "SELECT is_disabled FROM riviamigo.users WHERE id = $1",
        )
        .bind(claims.sub)
        .fetch_optional(&state.pool)
        .await?
        .flatten()
        .unwrap_or(false);
        if is_disabled {
            return Err(AppError::Forbidden);
        }

        Ok(AuthUser {
            user_id: claims.sub,
            default_vehicle_id: claims.default_vehicle_id,
            api_access_level: None,
            api_vehicle_id: None,
        })
    }
}

async fn authenticate_api_key(
    method: Method,
    path: &str,
    state: &AppState,
    token: &str,
) -> Result<AuthUser, AppError> {
    let hash = hash_api_key(token);
    let row = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        r#"
        SELECT k.user_id, k.vehicle_id, k.access_level
        FROM riviamigo.api_keys k
        JOIN riviamigo.users u ON u.id = k.user_id
        WHERE k.key_hash = $1
          AND k.revoked_at IS NULL
          AND u.is_disabled = FALSE
          AND (k.expires_at IS NULL OR k.expires_at > now())
        "#,
    )
    .bind(hash.as_slice())
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    match row.2.as_str() {
        "read" if is_integration_read_request(&method, path) => {}
        _ => return Err(AppError::Forbidden),
    }

    // Only update last_used_at at most once per minute to avoid an UPDATE on every request.
    sqlx::query(
        "UPDATE riviamigo.api_keys \
         SET last_used_at = now(), updated_at = now() \
         WHERE key_hash = $1 \
           AND (last_used_at IS NULL OR last_used_at < now() - INTERVAL '1 minute')",
    )
    .bind(hash.as_slice())
    .execute(&state.pool)
    .await?;

    Ok(AuthUser {
        user_id: row.0,
        default_vehicle_id: Some(row.1),
        api_access_level: Some(row.2),
        api_vehicle_id: Some(row.1),
    })
}

pub fn require_vehicle_access(auth: &AuthUser, vehicle_id: Uuid) -> Result<(), AppError> {
    if let Some(scoped_vehicle_id) = auth.api_vehicle_id {
        if scoped_vehicle_id != vehicle_id {
            return Err(AppError::Forbidden);
        }
    }
    Ok(())
}

/// Integration keys may read only this deliberate, stable data surface.  The
/// list is kept here with authentication so adding a route cannot accidentally
/// make it available just because it happens to use GET.  `metrics/batch` and
/// the Grafana compatibility calls are read operations despite using POST.
fn is_integration_read_request(method: &Method, path: &str) -> bool {
    if *method == Method::POST {
        return matches!(
            path,
            "/v1/metrics/batch"
                | "/v1/grafana/search"
                | "/v1/grafana/query"
                | "/v1/grafana/annotations"
                | "/v1/grafana/tag-keys"
                | "/v1/grafana/tag-values"
        );
    }

    if *method != Method::GET {
        return false;
    }

    path == "/v1/api/catalog"
        || path == "/v1/vehicles"
        || path.starts_with("/v1/battery/")
        || path.starts_with("/v1/metrics/")
        || path.starts_with("/v1/trips")
        || path.starts_with("/v1/charging")
        || path.starts_with("/v1/efficiency/")
        || path.starts_with("/v1/dashboard/overview/")
        || path.starts_with("/v1/grafana")
        || is_scoped_vehicle_read_path(path)
}

fn is_scoped_vehicle_read_path(path: &str) -> bool {
    let Some(suffix) = path.strip_prefix("/v1/vehicles/") else {
        return false;
    };
    matches!(
        suffix.split('/').skip(1).collect::<Vec<_>>().as_slice(),
        ["status"]
            | ["images"]
            | ["raw-data"]
            | ["health"]
            | ["idle-drain"]
            | ["state-timeline"]
            | ["locations"]
            | ["live-session"]
            | ["charging-sessions"]
            | ["charging-sessions", _]
            | ["charging-sessions", _, "curve"]
            | ["costs"]
            | ["drives", _, "power"]
            | ["charging-schedule"]
            | ["departure-schedules"]
            | ["wallboxes"]
            | ["ota-details"]
            | ["backfill-status"]
    )
}

pub fn issue_access_token(
    user_id: Uuid,
    default_vehicle_id: Option<Uuid>,
    keys: &JwtKeys,
) -> anyhow::Result<String> {
    use jsonwebtoken::{encode, Header};
    let now = chrono::Utc::now().timestamp();
    let claims = Claims {
        sub: user_id,
        iss: "riviamigo.app".into(),
        exp: now + 900, // 15 min
        iat: now,
        default_vehicle_id,
    };
    Ok(encode(
        &Header::new(Algorithm::RS256),
        &claims,
        &keys.encoding,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integration_keys_allow_declared_read_posts_but_no_writes() {
        assert!(is_integration_read_request(
            &Method::POST,
            "/v1/metrics/batch"
        ));
        assert!(is_integration_read_request(
            &Method::POST,
            "/v1/grafana/query"
        ));
        assert!(!is_integration_read_request(
            &Method::POST,
            "/v1/dashboards"
        ));
        assert!(!is_integration_read_request(
            &Method::PUT,
            "/v1/vehicles/id/settings"
        ));
    }

    #[test]
    fn integration_keys_do_not_gain_unlisted_get_routes() {
        assert!(is_integration_read_request(
            &Method::GET,
            "/v1/vehicles/id/status"
        ));
        assert!(is_integration_read_request(
            &Method::GET,
            "/v1/vehicles/id/charging-sessions/session-id/curve"
        ));
        assert!(!is_integration_read_request(&Method::GET, "/v1/api-keys"));
        assert!(!is_integration_read_request(
            &Method::GET,
            "/v1/vehicles/live"
        ));
        assert!(!is_integration_read_request(
            &Method::GET,
            "/v1/admin/users"
        ));
    }

    #[test]
    fn vehicle_scope_rejects_other_vehicles() {
        let allowed = Uuid::new_v4();
        let auth = AuthUser {
            user_id: Uuid::new_v4(),
            default_vehicle_id: Some(allowed),
            api_access_level: Some("read".into()),
            api_vehicle_id: Some(allowed),
        };

        assert!(require_vehicle_access(&auth, allowed).is_ok());
        assert!(matches!(
            require_vehicle_access(&auth, Uuid::new_v4()),
            Err(AppError::Forbidden)
        ));
    }
}
