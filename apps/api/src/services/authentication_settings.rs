use chrono::{DateTime, Utc};
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use url::Url;
use uuid::Uuid;

use crate::{
    config::OidcEnvOverrides,
    errors::AppError,
    ingestion::session_store::{decrypt_json, encrypt_json},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingSource {
    Default,
    Database,
    Environment,
}

#[derive(Debug, Clone, Serialize)]
pub struct EffectiveValue<T> {
    pub value: T,
    pub source: SettingSource,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthenticationSettingsResponse {
    pub oidc_enabled: EffectiveValue<bool>,
    pub password_login_enabled: EffectiveValue<bool>,
    pub issuer_url: EffectiveValue<Option<String>>,
    pub public_base_url: EffectiveValue<Option<String>>,
    pub client_id: EffectiveValue<Option<String>>,
    pub client_secret: SecretStatus,
    pub button_label: EffectiveValue<String>,
    pub scopes: EffectiveValue<String>,
    pub token_auth_method: EffectiveValue<String>,
    pub auto_signup: EffectiveValue<bool>,
    pub auto_link_verified_email: EffectiveValue<bool>,
    pub allowed_email_domains: EffectiveValue<Vec<String>>,
    pub required_claim_name: EffectiveValue<Option<String>>,
    pub required_claim_value: EffectiveValue<Option<String>>,
    pub last_validation_at: Option<DateTime<Utc>>,
    pub callback_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SecretStatus {
    pub configured: bool,
    pub source: SettingSource,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct AuthenticationSettingsUpdate {
    pub oidc_enabled: Option<bool>,
    pub password_login_enabled: Option<bool>,
    pub issuer_url: Option<Option<String>>,
    pub public_base_url: Option<Option<String>>,
    pub client_id: Option<Option<String>>,
    pub client_secret: Option<Option<String>>,
    pub button_label: Option<String>,
    pub scopes: Option<String>,
    pub token_auth_method: Option<String>,
    pub auto_signup: Option<bool>,
    pub auto_link_verified_email: Option<bool>,
    pub allowed_email_domains: Option<Vec<String>>,
    pub required_claim_name: Option<Option<String>>,
    pub required_claim_value: Option<Option<String>>,
}

#[derive(Debug, Clone)]
struct StoredSettings {
    oidc_enabled: bool,
    password_login_enabled: bool,
    issuer_url: Option<String>,
    public_base_url: Option<String>,
    client_id: Option<String>,
    client_secret_encrypted: Option<Vec<u8>>,
    button_label: String,
    scopes: String,
    token_auth_method: String,
    auto_signup: bool,
    auto_link_verified_email: bool,
    allowed_email_domains: Vec<String>,
    required_claim_name: Option<String>,
    required_claim_value: Option<String>,
    last_validation_at: Option<DateTime<Utc>>,
    last_validation_fingerprint: Option<String>,
}

/// Internal, server-only view of the effective provider configuration.  The
/// client secret deliberately has no representation in the public response.
#[derive(Debug, Clone)]
pub struct EffectiveAuthenticationSettings {
    pub oidc_enabled: bool,
    pub password_login_enabled: bool,
    pub issuer_url: Option<String>,
    pub public_base_url: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub button_label: String,
    pub scopes: String,
    pub token_auth_method: String,
    pub auto_signup: bool,
    pub auto_link_verified_email: bool,
    pub allowed_email_domains: Vec<String>,
    pub required_claim_name: Option<String>,
    pub required_claim_value: Option<String>,
}

pub async fn load_effective(
    pool: &PgPool,
    age_key: &str,
) -> Result<EffectiveAuthenticationSettings, AppError> {
    let stored = load_stored(pool).await?;
    let env = OidcEnvOverrides::from_env().map_err(|e| AppError::Validation(e.to_string()))?;
    env.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let db_secret = match stored.client_secret_encrypted.as_deref() {
        Some(bytes) => {
            let identity = age_key
                .parse::<age::x25519::Identity>()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid age key")))?;
            Some(decrypt_json::<String>(bytes, &identity).map_err(AppError::Internal)?)
        }
        None => None,
    };
    let effective = EffectiveAuthenticationSettings {
        oidc_enabled: env.oidc_enabled.unwrap_or(stored.oidc_enabled),
        password_login_enabled: env
            .password_login_enabled
            .unwrap_or(stored.password_login_enabled),
        issuer_url: env
            .issuer_url
            .as_deref()
            .map(canonicalize_issuer)
            .or(stored.issuer_url),
        public_base_url: env.public_base_url.clone().or(stored.public_base_url),
        client_id: env.client_id.clone().or(stored.client_id),
        client_secret: env.client_secret.clone().or(db_secret),
        button_label: env.button_label.clone().unwrap_or(stored.button_label),
        scopes: env.scopes.clone().unwrap_or(stored.scopes),
        token_auth_method: env
            .token_auth_method
            .clone()
            .unwrap_or(stored.token_auth_method),
        auto_signup: env.auto_signup.unwrap_or(stored.auto_signup),
        auto_link_verified_email: env
            .auto_link_verified_email
            .unwrap_or(stored.auto_link_verified_email),
        allowed_email_domains: env
            .allowed_email_domains
            .clone()
            .unwrap_or(stored.allowed_email_domains),
        required_claim_name: env
            .required_claim_name
            .clone()
            .or(stored.required_claim_name),
        required_claim_value: env
            .required_claim_value
            .clone()
            .or(stored.required_claim_value),
    };
    validate_required_claim_pair(
        effective.required_claim_name.as_deref(),
        effective.required_claim_value.as_deref(),
    )?;
    validate_auto_link_policy(
        effective.auto_link_verified_email,
        &effective.allowed_email_domains,
        effective.required_claim_name.as_deref(),
        effective.required_claim_value.as_deref(),
    )?;
    Ok(effective)
}

pub async fn load(
    pool: &PgPool,
    _age_key: &str,
) -> Result<AuthenticationSettingsResponse, AppError> {
    let stored = load_stored(pool).await?;
    let env = OidcEnvOverrides::from_env().map_err(|e| AppError::Validation(e.to_string()))?;
    env.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let response = effective(stored, &env);
    validate_required_claim_pair(
        response.required_claim_name.value.as_deref(),
        response.required_claim_value.value.as_deref(),
    )?;
    validate_auto_link_policy(
        response.auto_link_verified_email.value,
        &response.allowed_email_domains.value,
        response.required_claim_name.value.as_deref(),
        response.required_claim_value.value.as_deref(),
    )?;
    Ok(response)
}

pub async fn update(
    pool: &PgPool,
    age_key: &str,
    actor: Uuid,
    body: AuthenticationSettingsUpdate,
) -> Result<AuthenticationSettingsResponse, AppError> {
    let body = normalize_update(body)?;
    let current = load_stored(pool).await?;
    let env = OidcEnvOverrides::from_env().map_err(|e| AppError::Validation(e.to_string()))?;
    env.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    reject_environment_owned_update(&body, &env)?;
    let effective_before = load_effective(pool, age_key).await?;
    let resulting_password_login = env.password_login_enabled.unwrap_or(
        body.password_login_enabled
            .unwrap_or(current.password_login_enabled),
    );
    let resulting_oidc_enabled = env
        .oidc_enabled
        .unwrap_or(body.oidc_enabled.unwrap_or(current.oidc_enabled));
    let resulting_issuer = env.issuer_url.clone().or_else(|| {
        body.issuer_url
            .clone()
            .unwrap_or_else(|| current.issuer_url.clone())
    });
    let resulting_public_base = env.public_base_url.clone().or_else(|| {
        body.public_base_url
            .clone()
            .unwrap_or_else(|| current.public_base_url.clone())
    });
    if resulting_public_base.is_some() {
        oidc_callback_url(resulting_public_base.as_deref())?;
    }
    let invalidates_validation = body.issuer_url.is_some()
        || body.public_base_url.is_some()
        || body.client_id.is_some()
        || body.client_secret.is_some()
        || body.scopes.is_some()
        || body.token_auth_method.is_some();
    let required_claim_name = body
        .required_claim_name
        .clone()
        .unwrap_or_else(|| current.required_claim_name.clone());
    let required_claim_value = body
        .required_claim_value
        .clone()
        .unwrap_or_else(|| current.required_claim_value.clone());
    let effective_required_claim_name = env
        .required_claim_name
        .clone()
        .or_else(|| required_claim_name.clone());
    let effective_required_claim_value = env
        .required_claim_value
        .clone()
        .or_else(|| required_claim_value.clone());
    validate_required_claim_pair(
        effective_required_claim_name.as_deref(),
        effective_required_claim_value.as_deref(),
    )?;
    let resulting_auto_link = env.auto_link_verified_email.unwrap_or(
        body.auto_link_verified_email
            .unwrap_or(current.auto_link_verified_email),
    );
    let resulting_domains = env.allowed_email_domains.clone().unwrap_or_else(|| {
        body.allowed_email_domains
            .clone()
            .unwrap_or_else(|| current.allowed_email_domains.clone())
    });
    validate_auto_link_policy(
        resulting_auto_link,
        &resulting_domains,
        effective_required_claim_name.as_deref(),
        effective_required_claim_value.as_deref(),
    )?;
    if !resulting_password_login {
        if invalidates_validation {
            return Err(AppError::Validation(
                "save and test provider changes before disabling password login".into(),
            ));
        }
        let issuer = resulting_issuer.ok_or_else(|| {
            AppError::Validation(
                "password login cannot be disabled without a configured OIDC issuer".into(),
            )
        })?;
        let current_fingerprint = validation_fingerprint(&effective_before, age_key);
        if !resulting_oidc_enabled
            || current.last_validation_at.is_none()
            || current.last_validation_fingerprint.as_deref() != Some(current_fingerprint.as_str())
        {
            return Err(AppError::Validation(
                "password login cannot be disabled until the effective OIDC configuration has been successfully tested".into(),
            ));
        }
        let has_linked_super_user =
            has_linked_super_user_for_issuer(pool, &canonicalize_issuer(&issuer)).await?;
        if !has_linked_super_user {
            return Err(AppError::Validation(
                "password login cannot be disabled until a super user has linked OIDC".into(),
            ));
        }
    }
    let secret = match body.client_secret {
        Some(Some(value)) => {
            if value.trim().is_empty() {
                None
            } else {
                let identity = age_key
                    .parse::<age::x25519::Identity>()
                    .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid age key")))?;
                Some(
                    encrypt_json(&value.trim().to_owned(), &identity)
                        .map_err(AppError::Internal)?,
                )
            }
        }
        Some(None) => None,
        None => current.client_secret_encrypted,
    };
    sqlx::query("UPDATE riviamigo.authentication_settings SET oidc_enabled=$1,password_login_enabled=$2,issuer_url=$3,public_base_url=$4,client_id=$5,client_secret_encrypted=$6,button_label=$7,scopes=$8,token_auth_method=$9,auto_signup=$10,auto_link_verified_email=$11,allowed_email_domains=$12,required_claim_name=$13,required_claim_value=$14,last_validation_at=CASE WHEN $16 THEN NULL ELSE last_validation_at END,last_validation_fingerprint=CASE WHEN $16 THEN NULL ELSE last_validation_fingerprint END,updated_at=now(),updated_by=$15 WHERE id=TRUE")
        .bind(body.oidc_enabled.unwrap_or(current.oidc_enabled)).bind(body.password_login_enabled.unwrap_or(current.password_login_enabled))
        .bind(body.issuer_url.unwrap_or(current.issuer_url)).bind(body.public_base_url.unwrap_or(current.public_base_url)).bind(body.client_id.unwrap_or(current.client_id)).bind(secret)
        .bind(body.button_label.unwrap_or(current.button_label)).bind(body.scopes.unwrap_or(current.scopes)).bind(body.token_auth_method.unwrap_or(current.token_auth_method))
        .bind(body.auto_signup.unwrap_or(current.auto_signup)).bind(body.auto_link_verified_email.unwrap_or(current.auto_link_verified_email)).bind(body.allowed_email_domains.unwrap_or(current.allowed_email_domains))
        .bind(required_claim_name).bind(required_claim_value).bind(actor).bind(invalidates_validation).execute(pool).await?;
    load(pool, age_key).await
}

async fn has_linked_super_user_for_issuer(pool: &PgPool, issuer: &str) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM riviamigo.user_oidc_identities i JOIN riviamigo.users u ON u.id=i.user_id WHERE u.role='super_user' AND NOT u.is_disabled AND rtrim(i.issuer, '/')=rtrim($1, '/'))",
    )
    .bind(canonicalize_issuer(issuer))
    .fetch_one(pool)
    .await?)
}

/// Environment values are emergency/operator overrides, so the UI must not
/// imply that a database write can change their effective value.
fn reject_environment_owned_update(
    body: &AuthenticationSettingsUpdate,
    env: &OidcEnvOverrides,
) -> Result<(), AppError> {
    let overridden = [
        (body.oidc_enabled.is_some(), env.oidc_enabled.is_some()),
        (
            body.password_login_enabled.is_some(),
            env.password_login_enabled.is_some(),
        ),
        (body.issuer_url.is_some(), env.issuer_url.is_some()),
        (
            body.public_base_url.is_some(),
            env.public_base_url.is_some(),
        ),
        (body.client_id.is_some(), env.client_id.is_some()),
        (body.client_secret.is_some(), env.client_secret.is_some()),
        (body.button_label.is_some(), env.button_label.is_some()),
        (body.scopes.is_some(), env.scopes.is_some()),
        (
            body.token_auth_method.is_some(),
            env.token_auth_method.is_some(),
        ),
        (body.auto_signup.is_some(), env.auto_signup.is_some()),
        (
            body.auto_link_verified_email.is_some(),
            env.auto_link_verified_email.is_some(),
        ),
        (
            body.allowed_email_domains.is_some(),
            env.allowed_email_domains.is_some(),
        ),
        (
            body.required_claim_name.is_some(),
            env.required_claim_name.is_some(),
        ),
        (
            body.required_claim_value.is_some(),
            env.required_claim_value.is_some(),
        ),
    ];
    if overridden
        .iter()
        .any(|(submitted, owned)| *submitted && *owned)
    {
        return Err(AppError::Conflict(
            "an environment-owned authentication setting cannot be changed in the UI".into(),
        ));
    }
    Ok(())
}

pub async fn record_validation(
    pool: &PgPool,
    settings: &EffectiveAuthenticationSettings,
    age_key: &str,
) -> Result<(), AppError> {
    let fingerprint = validation_fingerprint(settings, age_key);
    sqlx::query("UPDATE riviamigo.authentication_settings SET last_validation_at=now(),last_validation_fingerprint=$1 WHERE id=TRUE")
        .bind(fingerprint).execute(pool).await?;
    Ok(())
}

fn validation_fingerprint(settings: &EffectiveAuthenticationSettings, age_key: &str) -> String {
    type HmacSha256 = Hmac<sha2::Sha256>;
    // The installation key makes this marker unusable as an offline guessing
    // oracle while still invalidating validation after a secret rotation. It
    // is never returned by the settings API or included in recovery packages.
    let mut mac = HmacSha256::new_from_slice(age_key.as_bytes())
        .expect("HMAC accepts installation keys of any length");
    mac.update(
        format!(
            "riviamigo-oidc-validation-v2|{:?}|{:?}|{:?}|{:?}|{}|{}",
            settings.issuer_url,
            settings.public_base_url,
            settings.client_id,
            settings.client_secret,
            settings.scopes,
            settings.token_auth_method,
        )
        .as_bytes(),
    );
    hex::encode(mac.finalize().into_bytes())
}

pub fn validate_effective(settings: &AuthenticationSettingsResponse) -> Result<(), AppError> {
    validate_required_claim_pair(
        settings.required_claim_name.value.as_deref(),
        settings.required_claim_value.value.as_deref(),
    )?;
    validate_auto_link_policy(
        settings.auto_link_verified_email.value,
        &settings.allowed_email_domains.value,
        settings.required_claim_name.value.as_deref(),
        settings.required_claim_value.value.as_deref(),
    )?;
    if !settings.oidc_enabled.value {
        return Ok(());
    }
    if settings.issuer_url.value.is_none()
        || settings.public_base_url.value.is_none()
        || settings.client_id.value.is_none()
        || !settings.client_secret.configured
    {
        return Err(AppError::Validation(
            "OIDC is enabled but issuer, public base URL, client ID, or client secret is missing"
                .into(),
        ));
    }
    normalize_oidc_scopes(&settings.scopes.value)?;
    oidc_callback_url(settings.public_base_url.value.as_deref())?;
    Ok(())
}

fn validate_auto_link_policy(
    auto_link_verified_email: bool,
    allowed_email_domains: &[String],
    required_claim_name: Option<&str>,
    required_claim_value: Option<&str>,
) -> Result<(), AppError> {
    if auto_link_verified_email
        && allowed_email_domains.is_empty()
        && !(required_claim_name.is_some() && required_claim_value.is_some())
    {
        return Err(AppError::Validation(
            "OIDC verified-email auto-link requires allowed email domains or a required claim restriction"
                .into(),
        ));
    }
    Ok(())
}

/// Builds the exact redirect URI accepted by the OIDC runtime. Keeping this
/// validation at the settings boundary prevents the UI from advertising a
/// provider configuration that the callback exchange will reject later.
pub fn oidc_callback_url(public_base_url: Option<&str>) -> Result<String, AppError> {
    let base = public_base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Validation("OIDC public base URL is not configured".into()))?;
    let callback = format!("{}/v1/auth/oidc/callback", base.trim_end_matches('/'));
    let parsed = Url::parse(&callback)
        .map_err(|_| AppError::Validation("OIDC callback URL is invalid".into()))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(AppError::Validation(
            "OIDC callback URL must be absolute HTTPS without credentials, query, or fragment"
                .into(),
        ));
    }
    Ok(callback)
}

fn validate_required_claim_pair(name: Option<&str>, value: Option<&str>) -> Result<(), AppError> {
    match (
        name.map(str::trim).filter(|value| !value.is_empty()),
        value.map(str::trim).filter(|value| !value.is_empty()),
    ) {
        (None, None) => Ok(()),
        (Some(_), Some(_)) => Ok(()),
        _ => Err(AppError::Validation(
            "OIDC required claim name and value must be configured together".into(),
        )),
    }
}

/// Normalize human-entered settings before they are compared, validated, or
/// persisted. In particular, an empty optional field means "clear it" rather
/// than a configured-but-unusable empty string.
fn normalize_update(
    mut body: AuthenticationSettingsUpdate,
) -> Result<AuthenticationSettingsUpdate, AppError> {
    body.issuer_url = normalize_optional_update(body.issuer_url);
    body.issuer_url = body
        .issuer_url
        .map(|value| value.map(|value| canonicalize_issuer(&value)));
    body.public_base_url = normalize_optional_update(body.public_base_url);
    body.client_id = normalize_optional_update(body.client_id);
    body.required_claim_name = normalize_optional_update(body.required_claim_name);
    body.required_claim_value = normalize_optional_update(body.required_claim_value);

    if let Some(label) = body.button_label.take() {
        let label = label.trim();
        if label.is_empty() {
            return Err(AppError::Validation(
                "OIDC button label cannot be empty".into(),
            ));
        }
        body.button_label = Some(label.to_owned());
    }
    if let Some(scopes) = body.scopes.take() {
        body.scopes = Some(normalize_oidc_scopes(&scopes)?);
    }
    if let Some(method) = body.token_auth_method.take() {
        let method = method.trim();
        if !matches!(
            method,
            "auto" | "client_secret_basic" | "client_secret_post"
        ) {
            return Err(AppError::Validation(
                "OIDC token authentication method is invalid".into(),
            ));
        }
        body.token_auth_method = Some(method.to_owned());
    }
    if let Some(domains) = body.allowed_email_domains.take() {
        let mut normalized = domains
            .into_iter()
            .map(|domain| domain.trim().trim_start_matches('@').to_ascii_lowercase())
            .filter(|domain| !domain.is_empty())
            .collect::<Vec<_>>();
        normalized.sort();
        normalized.dedup();
        body.allowed_email_domains = Some(normalized);
    }
    Ok(body)
}

fn normalize_optional_update(value: Option<Option<String>>) -> Option<Option<String>> {
    value.map(|value| {
        value
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    })
}

/// Treat an issuer's trailing slash as presentation-only. OIDC discovery and
/// identity mappings use the same canonical issuer, while accepting the
/// slash variation commonly shown by provider documentation.
pub fn canonicalize_issuer(value: &str) -> String {
    value.trim().trim_end_matches('/').to_owned()
}

pub fn normalize_oidc_scopes(scopes: &str) -> Result<String, AppError> {
    let mut normalized = Vec::new();
    for scope in scopes.split_whitespace() {
        let valid = scope.bytes().all(|byte| {
            byte == 0x21 || (0x23..=0x5b).contains(&byte) || (0x5d..=0x7e).contains(&byte)
        });
        if !valid {
            return Err(AppError::Validation(
                "OIDC scopes contain an invalid character".into(),
            ));
        }
        if !normalized.contains(&scope) {
            normalized.push(scope);
        }
    }
    if !normalized.contains(&"openid") {
        return Err(AppError::Validation(
            "OIDC scopes must include openid".into(),
        ));
    }
    Ok(normalized.join(" "))
}

async fn load_stored(pool: &PgPool) -> Result<StoredSettings, AppError> {
    let row = sqlx::query("SELECT oidc_enabled,password_login_enabled,issuer_url,public_base_url,client_id,client_secret_encrypted,button_label,scopes,token_auth_method,auto_signup,auto_link_verified_email,allowed_email_domains,required_claim_name,required_claim_value,last_validation_at,last_validation_fingerprint FROM riviamigo.authentication_settings WHERE id=TRUE")
        .fetch_optional(pool).await?.ok_or_else(|| AppError::Internal(anyhow::anyhow!("authentication settings row is missing")))?;
    Ok(StoredSettings {
        oidc_enabled: row.try_get("oidc_enabled")?,
        password_login_enabled: row.try_get("password_login_enabled")?,
        issuer_url: row
            .try_get::<Option<String>, _>("issuer_url")?
            .map(|value| canonicalize_issuer(&value)),
        public_base_url: row.try_get("public_base_url")?,
        client_id: row.try_get("client_id")?,
        client_secret_encrypted: row.try_get("client_secret_encrypted")?,
        button_label: row.try_get("button_label")?,
        scopes: row.try_get("scopes")?,
        token_auth_method: row.try_get("token_auth_method")?,
        auto_signup: row.try_get("auto_signup")?,
        auto_link_verified_email: row.try_get("auto_link_verified_email")?,
        allowed_email_domains: row.try_get("allowed_email_domains")?,
        required_claim_name: row.try_get("required_claim_name")?,
        required_claim_value: row.try_get("required_claim_value")?,
        last_validation_at: row.try_get("last_validation_at")?,
        last_validation_fingerprint: row.try_get("last_validation_fingerprint")?,
    })
}

fn effective(s: StoredSettings, e: &OidcEnvOverrides) -> AuthenticationSettingsResponse {
    macro_rules! field {
        ($db:expr, $env:expr) => {
            EffectiveValue {
                value: $env.clone().unwrap_or($db),
                source: if $env.is_some() {
                    SettingSource::Environment
                } else {
                    SettingSource::Database
                },
            }
        };
    }
    macro_rules! optional_field {
        ($db:expr, $env:expr) => {
            EffectiveValue {
                value: $env.clone().or($db),
                source: if $env.is_some() {
                    SettingSource::Environment
                } else {
                    SettingSource::Database
                },
            }
        };
    }
    let issuer = EffectiveValue {
        value: e
            .issuer_url
            .as_deref()
            .map(canonicalize_issuer)
            .or(s.issuer_url),
        source: if e.issuer_url.is_some() {
            SettingSource::Environment
        } else {
            SettingSource::Database
        },
    };
    let public_base = optional_field!(s.public_base_url, e.public_base_url);
    let callback_url = public_base
        .value
        .as_ref()
        .map(|base| format!("{}/v1/auth/oidc/callback", base.trim_end_matches('/')));
    AuthenticationSettingsResponse {
        oidc_enabled: field!(s.oidc_enabled, e.oidc_enabled),
        password_login_enabled: field!(s.password_login_enabled, e.password_login_enabled),
        issuer_url: issuer,
        public_base_url: public_base,
        client_id: optional_field!(s.client_id, e.client_id),
        client_secret: SecretStatus {
            configured: e.client_secret.is_some() || s.client_secret_encrypted.is_some(),
            source: if e.client_secret.is_some() {
                SettingSource::Environment
            } else {
                SettingSource::Database
            },
        },
        button_label: field!(s.button_label, e.button_label),
        scopes: field!(s.scopes, e.scopes),
        token_auth_method: field!(s.token_auth_method, e.token_auth_method),
        auto_signup: field!(s.auto_signup, e.auto_signup),
        auto_link_verified_email: field!(s.auto_link_verified_email, e.auto_link_verified_email),
        allowed_email_domains: field!(s.allowed_email_domains, e.allowed_email_domains),
        required_claim_name: optional_field!(s.required_claim_name, e.required_claim_name),
        required_claim_value: optional_field!(s.required_claim_value, e.required_claim_value),
        last_validation_at: s.last_validation_at,
        callback_url,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn enabled_oidc_requires_minimum_credentials() {
        let mut s = AuthenticationSettingsResponse {
            oidc_enabled: EffectiveValue {
                value: true,
                source: SettingSource::Default,
            },
            password_login_enabled: EffectiveValue {
                value: true,
                source: SettingSource::Default,
            },
            issuer_url: EffectiveValue {
                value: None,
                source: SettingSource::Default,
            },
            public_base_url: EffectiveValue {
                value: None,
                source: SettingSource::Default,
            },
            client_id: EffectiveValue {
                value: None,
                source: SettingSource::Default,
            },
            client_secret: SecretStatus {
                configured: false,
                source: SettingSource::Default,
            },
            button_label: EffectiveValue {
                value: "SSO".into(),
                source: SettingSource::Default,
            },
            scopes: EffectiveValue {
                value: "openid".into(),
                source: SettingSource::Default,
            },
            token_auth_method: EffectiveValue {
                value: "auto".into(),
                source: SettingSource::Default,
            },
            auto_signup: EffectiveValue {
                value: false,
                source: SettingSource::Default,
            },
            auto_link_verified_email: EffectiveValue {
                value: false,
                source: SettingSource::Default,
            },
            allowed_email_domains: EffectiveValue {
                value: vec![],
                source: SettingSource::Default,
            },
            required_claim_name: EffectiveValue {
                value: None,
                source: SettingSource::Default,
            },
            required_claim_value: EffectiveValue {
                value: None,
                source: SettingSource::Default,
            },
            last_validation_at: None,
            callback_url: None,
        };
        assert!(validate_effective(&s).is_err());
        s.issuer_url.value = Some("https://issuer.example".into());
        s.public_base_url.value = Some("https://riviamigo.example".into());
        s.client_id.value = Some("client".into());
        s.client_secret.configured = true;
        assert!(validate_effective(&s).is_ok());
    }

    #[test]
    fn required_claim_settings_must_be_configured_as_a_pair() {
        assert!(validate_required_claim_pair(Some("groups"), None).is_err());
        assert!(validate_required_claim_pair(None, Some("fleet")).is_err());
        assert!(validate_required_claim_pair(Some(" "), Some("fleet")).is_err());
        assert!(validate_required_claim_pair(Some("groups"), Some("fleet")).is_ok());
        assert!(validate_required_claim_pair(None, None).is_ok());
    }

    #[test]
    fn update_normalization_clears_empty_optional_fields() {
        let normalized = normalize_update(AuthenticationSettingsUpdate {
            issuer_url: Some(Some("  ".into())),
            client_id: Some(Some(" client ".into())),
            required_claim_name: Some(Some("".into())),
            required_claim_value: Some(Some(" ".into())),
            scopes: Some("openid  email openid".into()),
            allowed_email_domains: Some(vec![
                " Example.COM ".into(),
                "@example.com".into(),
                "".into(),
            ]),
            ..Default::default()
        })
        .unwrap();

        assert_eq!(normalized.issuer_url, Some(None));
        assert_eq!(normalized.client_id, Some(Some("client".into())));
        assert_eq!(normalized.required_claim_name, Some(None));
        assert_eq!(normalized.required_claim_value, Some(None));
        assert_eq!(normalized.scopes.as_deref(), Some("openid email"));
        assert_eq!(
            normalized.allowed_email_domains,
            Some(vec!["example.com".into()])
        );
    }

    #[test]
    fn oidc_scopes_require_openid_and_valid_scope_tokens() {
        assert_eq!(
            normalize_oidc_scopes(" profile  openid email ").unwrap(),
            "profile openid email"
        );
        assert!(normalize_oidc_scopes("email profile").is_err());
        assert!(normalize_oidc_scopes("openid bad\\scope").is_err());
    }

    #[test]
    fn canonicalize_issuer_ignores_documentation_trailing_slashes() {
        assert_eq!(
            canonicalize_issuer(" https://issuer.example/ "),
            "https://issuer.example"
        );
        assert_eq!(
            canonicalize_issuer("https://issuer.example"),
            "https://issuer.example"
        );
    }

    #[test]
    fn auto_link_requires_an_explicit_admission_boundary() {
        assert!(validate_auto_link_policy(true, &[], None, None).is_err());
        assert!(validate_auto_link_policy(true, &["example.com".into()], None, None).is_ok());
        assert!(validate_auto_link_policy(true, &[], Some("groups"), Some("rivian")).is_ok());
        assert!(validate_auto_link_policy(false, &[], None, None).is_ok());
    }

    #[test]
    fn oidc_callback_url_requires_a_safe_https_base() {
        assert_eq!(
            oidc_callback_url(Some("https://riviamigo.example/")).unwrap(),
            "https://riviamigo.example/v1/auth/oidc/callback"
        );
        for invalid in [
            None,
            Some("http://riviamigo.example"),
            Some("https://user:password@riviamigo.example"),
            Some("https://riviamigo.example?tenant=fleet"),
            Some("https://riviamigo.example#fragment"),
            Some("not a URL"),
        ] {
            assert!(oidc_callback_url(invalid).is_err(), "accepted {invalid:?}");
        }
    }

    #[test]
    fn validation_fingerprint_changes_when_the_effective_secret_changes() {
        let mut settings = EffectiveAuthenticationSettings {
            oidc_enabled: true,
            password_login_enabled: true,
            issuer_url: Some("https://issuer.example".into()),
            public_base_url: Some("https://riviamigo.example".into()),
            client_id: Some("client".into()),
            client_secret: Some("first-secret".into()),
            button_label: "Sign in with SSO".into(),
            scopes: "openid email profile".into(),
            token_auth_method: "auto".into(),
            auto_signup: false,
            auto_link_verified_email: false,
            allowed_email_domains: vec![],
            required_claim_name: None,
            required_claim_value: None,
        };
        let first = validation_fingerprint(&settings, "installation-key");
        settings.client_secret = Some("rotated-secret".into());
        assert_ne!(first, validation_fingerprint(&settings, "installation-key"));
        assert_ne!(
            validation_fingerprint(&settings, "installation-key"),
            validation_fingerprint(&settings, "different-installation-key")
        );
    }

    #[tokio::test]
    #[ignore = "requires a migrated PostgreSQL database"]
    async fn linked_super_user_lookup_accepts_a_trailing_slash_issuer() {
        let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .expect("database connection");
        let user_id = Uuid::new_v4();
        let email = format!("oidc_issuer_{}@example.com", user_id);
        let issuer = format!("https://issuer-{}.example", Uuid::new_v4());
        sqlx::query(
            "INSERT INTO riviamigo.users(id,email,password_hash,role) VALUES($1,$2,NULL,'super_user')",
        )
        .bind(user_id)
        .bind(&email)
        .execute(&pool)
        .await
        .expect("seed super user");
        sqlx::query(
            "INSERT INTO riviamigo.user_oidc_identities(user_id,issuer,subject,email) VALUES($1,$2,$3,$4)",
        )
        .bind(user_id)
        .bind(&issuer)
        .bind(Uuid::new_v4().to_string())
        .bind(&email)
        .execute(&pool)
        .await
        .expect("seed linked identity");

        assert!(
            has_linked_super_user_for_issuer(&pool, &format!("{issuer}/"))
                .await
                .expect("lookup linked super user")
        );

        sqlx::query("DELETE FROM riviamigo.users WHERE id=$1")
            .bind(user_id)
            .execute(&pool)
            .await
            .expect("delete test user");
    }
}
