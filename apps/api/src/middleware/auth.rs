use std::{collections::HashMap, sync::Arc, time::Instant};

use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, Method},
};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{errors::AppError, routes::api_keys::hash_api_key};

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
    /// Tracks when the next Nominatim call is allowed (rate limit: 1 req/1.1s).
    pub nominatim_next_call: Arc<tokio::sync::Mutex<Instant>>,
    /// Short-lived in-memory cache: normalised query -> (cached_at, json result).
    pub nominatim_cache: Arc<tokio::sync::RwLock<HashMap<String, (Instant, serde_json::Value)>>>,
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

        // Retrieve JWT public key from extensions (set by middleware)
        let decoding_key = parts
            .extensions
            .get::<DecodingKey>()
            .ok_or(AppError::Unauthorized)?;

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&["riviamigo"]);

        let claims = decode::<Claims>(token, decoding_key, &validation)
            .map_err(|_| AppError::Unauthorized)?
            .claims;

        Ok(AuthUser {
            user_id: claims.sub,
            default_vehicle_id: claims.default_vehicle_id,
            api_access_level: None,
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
    let row = sqlx::query!(
        r#"
        SELECT v.user_id, k.vehicle_id, k.access_level
        FROM riviamigo.api_keys k
        JOIN riviamigo.vehicles v ON v.id = k.vehicle_id
        WHERE k.key_hash = $1
          AND k.revoked_at IS NULL
          AND (k.expires_at IS NULL OR k.expires_at > now())
        "#,
        hash.as_slice()
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    match row.access_level.as_str() {
        "view" if method != Method::GET => return Err(AppError::Forbidden),
        "edit" if is_admin_path(path) => return Err(AppError::Forbidden),
        "view" if is_admin_path(path) => return Err(AppError::Forbidden),
        "admin" => {}
        "edit" | "view" => {}
        _ => return Err(AppError::Forbidden),
    }

    sqlx::query!(
        "UPDATE riviamigo.api_keys SET last_used_at = now(), updated_at = now() WHERE key_hash = $1",
        hash.as_slice()
    )
    .execute(&state.pool)
    .await?;

    Ok(AuthUser {
        user_id: row.user_id,
        default_vehicle_id: Some(row.vehicle_id),
        api_access_level: Some(row.access_level),
    })
}

fn is_admin_path(path: &str) -> bool {
    path.contains("/admin/")
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
        iss: "riviamigo".into(),
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
