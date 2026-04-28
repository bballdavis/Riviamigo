use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;

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
    pub user_id:            Uuid,
    pub default_vehicle_id: Option<Uuid>,
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
    pub pool:     sqlx::PgPool,
    pub redis:    redis::Client,
    pub jwt_keys: std::sync::Arc<JwtKeys>,
    pub age_key:  String,
    pub config:   crate::config::Config,
}

#[async_trait::async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Unauthorized)?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or(AppError::Unauthorized)?;

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
            user_id:            claims.sub,
            default_vehicle_id: claims.default_vehicle_id,
        })
    }
}

pub fn issue_access_token(
    user_id:            Uuid,
    default_vehicle_id: Option<Uuid>,
    keys:               &JwtKeys,
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
    Ok(encode(&Header::new(Algorithm::RS256), &claims, &keys.encoding)?)
}
