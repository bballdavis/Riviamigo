//! Provider-neutral OIDC protocol helpers.
//! Secrets and provider tokens stay server-side; Redis holds only short-lived
//! authorization transactions.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use openidconnect::{
    core::{
        CoreAuthDisplay, CoreAuthPrompt, CoreErrorResponseType, CoreGenderClaim, CoreJsonWebKey,
        CoreJweContentEncryptionAlgorithm, CoreJwsSigningAlgorithm, CoreProviderMetadata,
        CoreRevocableToken, CoreRevocationErrorResponse, CoreTokenIntrospectionResponse,
        CoreTokenType,
    },
    reqwest as oidc_reqwest, AdditionalClaims, AsyncHttpClient, AuthType, AuthorizationCode,
    Client, ClientId, ClientSecret, EmptyExtraTokenFields, HttpClientError, HttpRequest,
    HttpResponse, IdTokenFields, IssuerUrl, Nonce, PkceCodeVerifier, RedirectUrl,
    StandardErrorResponse, StandardTokenResponse,
};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::{future::Future, pin::Pin};
use url::Url;

use crate::{
    errors::AppError,
    services::authentication_settings::{self, EffectiveAuthenticationSettings},
};

/// OIDC providers commonly put authorization data such as `groups` or a
/// tenant marker in non-core ID-token claims.  Flattening preserves those
/// values while the surrounding `openidconnect` types still verify the token
/// before this map is ever exposed to policy evaluation.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct ProviderClaims {
    #[serde(flatten)]
    values: BTreeMap<String, serde_json::Value>,
}
impl AdditionalClaims for ProviderClaims {}

type OidcTokenFields = IdTokenFields<
    ProviderClaims,
    EmptyExtraTokenFields,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJwsSigningAlgorithm,
>;
type OidcTokenResponse = StandardTokenResponse<OidcTokenFields, CoreTokenType>;

#[derive(Debug, thiserror::Error)]
enum HttpsOnlyClientError {
    #[error("OIDC provider attempted a non-HTTPS request")]
    UnsafeEndpoint,
    #[error(transparent)]
    Request(#[from] HttpClientError<oidc_reqwest::Error>),
}

struct HttpsOnlyClient(oidc_reqwest::Client);

impl<'c> AsyncHttpClient<'c> for HttpsOnlyClient {
    type Error = HttpsOnlyClientError;
    type Future =
        Pin<Box<dyn Future<Output = Result<HttpResponse, Self::Error>> + Send + Sync + 'c>>;

    fn call(&'c self, request: HttpRequest) -> Self::Future {
        Box::pin(async move {
            let request_url = request.uri().to_string();
            validate_https_provider_endpoint("request", &request_url)
                .map_err(|_| HttpsOnlyClientError::UnsafeEndpoint)?;
            AsyncHttpClient::call(&self.0, request)
                .await
                .map_err(HttpsOnlyClientError::Request)
        })
    }
}

fn https_only_client() -> Result<HttpsOnlyClient, AppError> {
    oidc_reqwest::ClientBuilder::new()
        .redirect(oidc_reqwest::redirect::Policy::none())
        .build()
        .map(HttpsOnlyClient)
        .map_err(|_| AppError::Internal(anyhow::anyhow!("failed to create OIDC HTTP client")))
}
type OidcClient<
    HasAuthUrl = openidconnect::EndpointNotSet,
    HasDeviceAuthUrl = openidconnect::EndpointNotSet,
    HasIntrospectionUrl = openidconnect::EndpointNotSet,
    HasRevocationUrl = openidconnect::EndpointNotSet,
    HasTokenUrl = openidconnect::EndpointNotSet,
    HasUserInfoUrl = openidconnect::EndpointNotSet,
> = Client<
    ProviderClaims,
    CoreAuthDisplay,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJsonWebKey,
    CoreAuthPrompt,
    StandardErrorResponse<CoreErrorResponseType>,
    OidcTokenResponse,
    CoreTokenIntrospectionResponse,
    CoreRevocableToken,
    CoreRevocationErrorResponse,
    HasAuthUrl,
    HasDeviceAuthUrl,
    HasIntrospectionUrl,
    HasRevocationUrl,
    HasTokenUrl,
    HasUserInfoUrl,
>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub state: String,
    /// SHA-256 of a separate browser-only cookie; it is intentionally not the
    /// OAuth state value so a leaked authorization URL cannot satisfy binding.
    pub browser_binding: String,
    pub nonce: String,
    pub verifier: String,
    pub return_to: String,
    pub user_id: Option<uuid::Uuid>,
    pub link: bool,
}

/// Identity information is constructed only after `openidconnect` has verified
/// the ID-token signature, issuer, audience/azp, expiry, and nonce.
#[derive(Debug, Clone)]
pub struct VerifiedIdentity {
    pub issuer: String,
    pub subject: String,
    pub email: Option<String>,
    pub email_verified: bool,
    pub claims: serde_json::Value,
}

pub fn random_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

pub fn browser_binding(cookie_value: &str) -> String {
    hex::encode(Sha256::digest(cookie_value.as_bytes()))
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn validate_return_to(value: Option<&str>) -> Result<String, AppError> {
    let value = value.unwrap_or("/");
    if !value.starts_with('/')
        || value.starts_with("//")
        || value.contains('\\')
        || value.to_ascii_lowercase().contains("%5c")
        || value.starts_with("/login?")
        || value == "/login"
    {
        return Err(AppError::Validation(
            "return_to must be a relative application path".into(),
        ));
    }
    let parsed = Url::parse(&format!("http://riviamigo.invalid{value}"))
        .map_err(|_| AppError::Validation("invalid return_to".into()))?;
    if parsed.host_str() != Some("riviamigo.invalid") {
        return Err(AppError::Validation("return_to must be internal".into()));
    }
    // Canonicalize dot segments while keeping valid in-app query and fragment
    // state.  This is the only value later used as a Location header.
    let mut canonical = parsed.path().to_owned();
    if let Some(query) = parsed.query() {
        canonical.push('?');
        canonical.push_str(query);
    }
    if let Some(fragment) = parsed.fragment() {
        canonical.push('#');
        canonical.push_str(fragment);
    }
    Ok(canonical)
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProviderMetadata {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    #[serde(default)]
    pub jwks_uri: Option<String>,
    #[serde(default)]
    pub token_endpoint_auth_methods_supported: Vec<String>,
    #[serde(default)]
    pub code_challenge_methods_supported: Vec<String>,
}

pub async fn discover(
    settings: &EffectiveAuthenticationSettings,
) -> Result<ProviderMetadata, AppError> {
    let issuer = settings
        .issuer_url
        .as_deref()
        .ok_or_else(|| AppError::Validation("OIDC issuer is not configured".into()))?;
    let issuer_url = IssuerUrl::new(issuer.to_owned())
        .map_err(|_| AppError::Validation("OIDC issuer is invalid".into()))?;
    if issuer_url.url().scheme() != "https" {
        return Err(AppError::Validation("OIDC issuer must use HTTPS".into()));
    }
    // Do not use URL::join with a leading slash: that would discard Keycloak
    // realm and other issuer path segments.
    let endpoint = Url::parse(&format!(
        "{}/.well-known/openid-configuration",
        issuer.trim_end_matches('/')
    ))
    .map_err(|_| AppError::Validation("OIDC issuer is invalid".into()))?;
    let metadata = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("failed to create OIDC HTTP client")))?
        .get(endpoint)
        .send()
        .await
        .map_err(|_| AppError::Validation("OIDC provider is unavailable".into()))?
        .error_for_status()
        .map_err(|_| AppError::Validation("OIDC provider discovery failed".into()))?
        .json::<ProviderMetadata>()
        .await
        .map_err(|_| AppError::Validation("OIDC provider metadata is invalid".into()))?;
    if metadata.issuer.trim_end_matches('/') != issuer.trim_end_matches('/') {
        return Err(AppError::Validation("OIDC issuer mismatch".into()));
    }
    validate_https_provider_endpoint("authorization", &metadata.authorization_endpoint)?;
    validate_https_provider_endpoint("token", &metadata.token_endpoint)?;
    if let Some(jwks_uri) = metadata.jwks_uri.as_deref() {
        validate_https_provider_endpoint("JWKS", jwks_uri)?;
    }
    if !settings.oidc_enabled {
        return Err(AppError::Validation("OIDC is disabled".into()));
    }
    if !metadata.code_challenge_methods_supported.is_empty()
        && !metadata
            .code_challenge_methods_supported
            .iter()
            .any(|m| m == "S256")
    {
        return Err(AppError::Validation(
            "OIDC provider does not support PKCE S256".into(),
        ));
    }
    Ok(metadata)
}

fn validate_https_provider_endpoint(name: &str, value: &str) -> Result<(), AppError> {
    let parsed = Url::parse(value)
        .map_err(|_| AppError::Validation(format!("OIDC {name} endpoint is invalid")))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err(AppError::Validation(format!(
            "OIDC {name} endpoint must be absolute HTTPS without credentials or fragment"
        )));
    }
    Ok(())
}

fn callback_url(settings: &EffectiveAuthenticationSettings) -> Result<RedirectUrl, AppError> {
    let url = authentication_settings::oidc_callback_url(settings.public_base_url.as_deref())?;
    RedirectUrl::new(url).map_err(|_| AppError::Validation("OIDC callback URL is invalid".into()))
}

fn validate_client_configuration(
    settings: &EffectiveAuthenticationSettings,
) -> Result<(), AppError> {
    let _id = settings
        .client_id
        .clone()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::Validation("OIDC client ID is not configured".into()))?;
    let _secret = settings
        .client_secret
        .clone()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::Validation("OIDC client secret is not configured".into()))?;
    match settings.token_auth_method.as_str() {
        "auto" | "client_secret_basic" | "client_secret_post" => Ok(()),
        _ => Err(AppError::Validation(
            "OIDC token authentication method is invalid".into(),
        )),
    }
}

async fn secure_metadata(
    settings: &EffectiveAuthenticationSettings,
) -> Result<CoreProviderMetadata, AppError> {
    if !settings.oidc_enabled {
        return Err(AppError::NotFound);
    }
    let issuer = settings
        .issuer_url
        .as_deref()
        .ok_or_else(|| AppError::Validation("OIDC issuer is not configured".into()))?;
    let issuer = IssuerUrl::new(issuer.to_owned())
        .map_err(|_| AppError::Validation("OIDC issuer is invalid".into()))?;
    if issuer.url().scheme() != "https" {
        return Err(AppError::Validation("OIDC issuer must use HTTPS".into()));
    }
    let http = https_only_client()?;
    let metadata = CoreProviderMetadata::discover_async(issuer, &http)
        .await
        .map_err(|_| {
            AppError::Validation("OIDC provider discovery or JWKS retrieval failed".into())
        })?;
    validate_https_provider_endpoint(
        "authorization",
        metadata.authorization_endpoint().url().as_str(),
    )?;
    let token_endpoint = metadata
        .token_endpoint()
        .ok_or_else(|| AppError::Validation("OIDC provider has no token endpoint".into()))?;
    validate_https_provider_endpoint("token", token_endpoint.url().as_str())?;
    validate_https_provider_endpoint("JWKS", metadata.jwks_uri().url().as_str())?;
    Ok(metadata)
}

pub async fn exchange_and_verify(
    settings: &EffectiveAuthenticationSettings,
    transaction: &Transaction,
    code: &str,
) -> Result<VerifiedIdentity, AppError> {
    let redirect = callback_url(settings)?;
    let metadata = secure_metadata(settings).await?;
    let issuer = metadata.issuer().as_str().trim_end_matches('/').to_owned();
    validate_client_configuration(settings)?;
    let id = settings.client_id.clone().expect("validated client id");
    let secret = settings
        .client_secret
        .clone()
        .expect("validated client secret");
    let http = https_only_client()?;
    macro_rules! verify_with {
        ($client:expr) => {{
            let client = $client;
            let response = client
                .exchange_code(AuthorizationCode::new(code.to_owned()))
                .map_err(|_| AppError::Unauthorized)?
                .set_pkce_verifier(PkceCodeVerifier::new(transaction.verifier.clone()))
                .request_async(&http)
                .await
                .map_err(|_| AppError::Unauthorized)?;
            let token = response
                .extra_fields()
                .id_token()
                .ok_or(AppError::Unauthorized)?;
            let claims = token
                .claims(
                    &client.id_token_verifier(),
                    &Nonce::new(transaction.nonce.clone()),
                )
                .map_err(|_| AppError::Unauthorized)?;
            let email = claims
                .email()
                .map(|v| v.as_str().trim().to_ascii_lowercase())
                .filter(|v| !v.is_empty());
            Ok(VerifiedIdentity {
                issuer,
                subject: claims.subject().as_str().to_owned(),
                email,
                email_verified: claims.email_verified() == Some(true),
                claims: serde_json::to_value(&claims.additional_claims().values)
                    .map_err(|_| AppError::Unauthorized)?,
            })
        }};
    }
    let base = || {
        OidcClient::from_provider_metadata(
            metadata.clone(),
            ClientId::new(id.clone()),
            Some(ClientSecret::new(secret.clone())),
        )
        .set_redirect_uri(redirect.clone())
    };
    match settings.token_auth_method.as_str() {
        "client_secret_basic" => verify_with!(base().set_auth_type(AuthType::BasicAuth)),
        "client_secret_post" => verify_with!(base().set_auth_type(AuthType::RequestBody)),
        "auto" => verify_with!(base()),
        _ => Err(AppError::Validation(
            "OIDC token authentication method is invalid".into(),
        )),
    }
}

pub async fn test_provider(settings: &EffectiveAuthenticationSettings) -> Result<(), AppError> {
    let _ = callback_url(settings)?;
    let _ = secure_metadata(settings).await?;
    validate_client_configuration(settings)?;
    Ok(())
}

pub fn claim_matches(
    identity: &VerifiedIdentity,
    name: Option<&str>,
    expected: Option<&str>,
) -> bool {
    let (name, expected) = match (name, expected) {
        (None, None) => return true,
        (Some(name), Some(expected)) if !name.trim().is_empty() && !expected.trim().is_empty() => {
            (name, expected)
        }
        _ => return false,
    };
    match identity.claims.get(name) {
        Some(serde_json::Value::String(v)) => v == expected,
        Some(serde_json::Value::Array(v)) => v.iter().any(|item| item.as_str() == Some(expected)),
        _ => false,
    }
}

pub fn domain_allowed(email: &str, domains: &[String]) -> bool {
    domains.is_empty()
        || email
            .rsplit_once('@')
            .map(|(_, domain)| {
                domains
                    .iter()
                    .any(|allowed| allowed.eq_ignore_ascii_case(domain))
            })
            .unwrap_or(false)
}

pub fn authorization_url(
    metadata: &ProviderMetadata,
    settings: &EffectiveAuthenticationSettings,
    tx: &Transaction,
    callback: &str,
) -> Result<Url, AppError> {
    let mut url = Url::parse(&metadata.authorization_endpoint)
        .map_err(|_| AppError::Validation("OIDC authorization endpoint is invalid".into()))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair(
            "client_id",
            settings
                .client_id
                .as_deref()
                .ok_or_else(|| AppError::Validation("OIDC client ID is not configured".into()))?,
        )
        .append_pair("redirect_uri", callback)
        .append_pair("scope", &settings.scopes)
        .append_pair("state", &tx.state)
        .append_pair("nonce", &tx.nonce)
        .append_pair("code_challenge", &pkce_challenge(&tx.verifier))
        .append_pair("code_challenge_method", "S256");
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pkce_is_url_safe_and_deterministic() {
        assert_eq!(pkce_challenge("abc"), pkce_challenge("abc"));
        assert!(!pkce_challenge("abc").contains('='));
    }
    #[test]
    fn rejects_external_return_targets() {
        assert!(validate_return_to(Some("https://evil.invalid")).is_err());
        assert!(validate_return_to(Some("//evil.invalid")).is_err());
        assert!(validate_return_to(Some("/\\attacker.example")).is_err());
        assert!(validate_return_to(Some("/%5Cattacker.example")).is_err());
        assert!(validate_return_to(Some("/%5cattacker.example")).is_err());
    }

    #[test]
    fn preserves_safe_internal_return_query_and_fragment() {
        assert_eq!(
            validate_return_to(Some("/page?next=%2Fdashboard#details")).unwrap(),
            "/page?next=%2Fdashboard#details"
        );
    }

    #[test]
    fn browser_binding_is_not_the_oauth_state_value() {
        assert_ne!(browser_binding("state-value"), "state-value");
        assert_ne!(browser_binding("one"), browser_binding("two"));
    }

    #[test]
    fn accepts_path_segment_issuer_discovery_url() {
        let issuer = "https://id.example.test/realms/riviamigo";
        let discovery = format!(
            "{}/.well-known/openid-configuration",
            issuer.trim_end_matches('/')
        );
        assert_eq!(
            Url::parse(&discovery).unwrap().path(),
            "/realms/riviamigo/.well-known/openid-configuration"
        );
    }

    fn verified_identity_with_claim(name: &str, value: serde_json::Value) -> VerifiedIdentity {
        VerifiedIdentity {
            issuer: "https://issuer.example.test".into(),
            subject: "subject".into(),
            email: None,
            email_verified: false,
            claims: serde_json::json!({ name: value }),
        }
    }

    #[test]
    fn required_claim_matches_verified_scalar_claim() {
        let identity = verified_identity_with_claim("tenant", serde_json::json!("rivian"));
        assert!(claim_matches(&identity, Some("tenant"), Some("rivian")));
        assert!(!claim_matches(&identity, Some("tenant"), Some("other")));
    }

    #[test]
    fn required_claim_matches_verified_array_claim() {
        let identity =
            verified_identity_with_claim("groups", serde_json::json!(["users", "fleet"]));
        assert!(claim_matches(&identity, Some("groups"), Some("fleet")));
        assert!(!claim_matches(&identity, Some("groups"), Some("admins")));
    }

    #[test]
    fn provider_endpoints_require_safe_https_urls() {
        assert!(validate_https_provider_endpoint(
            "authorization",
            "https://identity.example/authorize?tenant=fleet"
        )
        .is_ok());
        for invalid in [
            "http://identity.example/authorize",
            "https://user:password@identity.example/authorize",
            "https://identity.example/authorize#fragment",
            "not a URL",
        ] {
            assert!(
                validate_https_provider_endpoint("authorization", invalid).is_err(),
                "accepted {invalid}"
            );
        }
    }
}
