use std::net::{IpAddr, SocketAddr};

use http::{header::AUTHORIZATION, HeaderMap, Request, Response};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use sha2::{Digest, Sha256};
use tower_governor::{
    governor::{GovernorConfig, GovernorConfigBuilder},
    key_extractor::KeyExtractor,
    GovernorError,
};

use crate::middleware::auth::Claims;

#[derive(Clone, Debug)]
pub struct TrustedProxyIpKeyExtractor;

#[derive(Clone, Debug)]
pub struct AuthIdentityKeyExtractor {
    decoding_key: DecodingKey,
}

#[derive(Clone, Copy, Debug)]
pub enum RateLimitClass {
    AuthPublic,
    AuthRead,
    AuthWrite,
    HeavyRead,
}

impl RateLimitClass {
    pub fn as_header_value(self) -> &'static str {
        match self {
            Self::AuthPublic => "auth_public",
            Self::AuthRead => "auth_read",
            Self::AuthWrite => "auth_write",
            Self::HeavyRead => "heavy_read",
        }
    }
}

impl AuthIdentityKeyExtractor {
    pub fn new(decoding_key: DecodingKey) -> Self {
        Self { decoding_key }
    }
}

impl KeyExtractor for TrustedProxyIpKeyExtractor {
    type Key = String;

    fn extract<T>(&self, req: &Request<T>) -> Result<Self::Key, GovernorError> {
        Ok(format!("ip:{}", trusted_client_ip(req).ok_or(GovernorError::UnableToExtractKey)?))
    }
}

impl KeyExtractor for AuthIdentityKeyExtractor {
    type Key = String;

    fn extract<T>(&self, req: &Request<T>) -> Result<Self::Key, GovernorError> {
        if let Some(identity) = infer_identity_key(req.headers(), &self.decoding_key) {
            return Ok(identity);
        }

        Ok(format!("ip:{}", trusted_client_ip(req).ok_or(GovernorError::UnableToExtractKey)?))
    }
}

pub fn infer_key_type(headers: &HeaderMap, decoding_key: &DecodingKey) -> &'static str {
    let auth_header = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let token = auth_header.strip_prefix("Bearer ").unwrap_or_default();

    if token.starts_with("rmigo_") {
        return "api_key";
    }

    if decode_jwt_sub(token, decoding_key).is_some() {
        return "jwt_user";
    }

    "ip_fallback"
}

pub fn build_ip_limiter(
    class: RateLimitClass,
    per_second: u64,
    burst_size: u32,
) -> GovernorConfig<TrustedProxyIpKeyExtractor, tower_governor::governor::NoOpMiddleware> {
    let mut builder = GovernorConfigBuilder::default()
        .key_extractor(TrustedProxyIpKeyExtractor);
    builder
        .per_second(per_second)
        .burst_size(burst_size)
        .error_handler(move |mut error| {
            let mut response: Response<axum::body::Body> = error.as_response();
            response.headers_mut().insert(
                "x-riviamigo-ratelimit-class",
                http::HeaderValue::from_static(class.as_header_value()),
            );
            response
        });
    builder.finish().expect("valid rate limiter config")
}

pub fn build_identity_limiter(
    class: RateLimitClass,
    per_second: u64,
    burst_size: u32,
    decoding_key: DecodingKey,
    methods: Option<Vec<http::Method>>,
) -> GovernorConfig<AuthIdentityKeyExtractor, tower_governor::governor::NoOpMiddleware> {
    let mut builder = GovernorConfigBuilder::default()
        .key_extractor(AuthIdentityKeyExtractor::new(decoding_key));
    builder
        .per_second(per_second)
        .burst_size(burst_size)
        .error_handler(move |mut error| {
            let mut response: Response<axum::body::Body> = error.as_response();
            response.headers_mut().insert(
                "x-riviamigo-ratelimit-class",
                http::HeaderValue::from_static(class.as_header_value()),
            );
            response
        });
    if let Some(configured_methods) = methods {
        builder.methods(configured_methods);
    }
    builder.finish().expect("valid rate limiter config")
}

fn infer_identity_key(headers: &HeaderMap, decoding_key: &DecodingKey) -> Option<String> {
    let auth_header = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())?;
    let token = auth_header.strip_prefix("Bearer ")?;

    if token.starts_with("rmigo_") {
        return Some(format!("api:{}", hash_token(token)));
    }

    decode_jwt_sub(token, decoding_key).map(|sub| format!("user:{sub}"))
}

fn decode_jwt_sub(token: &str, decoding_key: &DecodingKey) -> Option<uuid::Uuid> {
    if token.is_empty() {
        return None;
    }
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&["riviamigo.app"]);
    validation.leeway = 0;

    decode::<Claims>(token, decoding_key, &validation)
        .ok()
        .map(|decoded| decoded.claims.sub)
}

fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

fn trusted_client_ip<T>(req: &Request<T>) -> Option<IpAddr> {
    let peer_ip = req
        .extensions()
        .get::<axum::extract::ConnectInfo<SocketAddr>>()
        .map(|addr| addr.ip())?;

    if !is_trusted_proxy(peer_ip) {
        return Some(peer_ip);
    }

    parse_forwarded_ip(req.headers()).or(Some(peer_ip))
}

fn parse_forwarded_ip(headers: &HeaderMap) -> Option<IpAddr> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|raw| raw.split(',').find_map(|part| part.trim().parse().ok()))
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
                .and_then(|raw| raw.parse().ok())
        })
}

fn is_trusted_proxy(ip: IpAddr) -> bool {
    ip.is_loopback()
}
