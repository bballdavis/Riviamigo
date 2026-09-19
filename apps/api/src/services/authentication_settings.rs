use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
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
    pub last_validation_fingerprint: Option<String>,
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
    let db_secret = match stored.client_secret_encrypted.as_deref() {
        Some(bytes) => {
            let identity = age_key
                .parse::<age::x25519::Identity>()
                .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid age key")))?;
            Some(decrypt_json::<String>(bytes, &identity).map_err(AppError::Internal)?)
        }
        None => None,
    };
    Ok(EffectiveAuthenticationSettings {
        oidc_enabled: env.oidc_enabled.unwrap_or(stored.oidc_enabled),
        password_login_enabled: env
            .password_login_enabled
            .unwrap_or(stored.password_login_enabled),
        issuer_url: env.issuer_url.clone().or(stored.issuer_url),
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
    })
}

pub async fn load(
    pool: &PgPool,
    _age_key: &str,
) -> Result<AuthenticationSettingsResponse, AppError> {
    let stored = load_stored(pool).await?;
    let env = OidcEnvOverrides::from_env().map_err(|e| AppError::Validation(e.to_string()))?;
    Ok(effective(stored, &env))
}

pub async fn update(
    pool: &PgPool,
    age_key: &str,
    actor: Uuid,
    body: AuthenticationSettingsUpdate,
) -> Result<AuthenticationSettingsResponse, AppError> {
    let current = load_stored(pool).await?;
    let env = OidcEnvOverrides::from_env().map_err(|e| AppError::Validation(e.to_string()))?;
    reject_environment_owned_update(&body, &env)?;
    let resulting_password_login = body
        .password_login_enabled
        .unwrap_or(current.password_login_enabled);
    let resulting_oidc_enabled = body.oidc_enabled.unwrap_or(current.oidc_enabled);
    let resulting_issuer = body
        .issuer_url
        .clone()
        .unwrap_or_else(|| current.issuer_url.clone());
    let invalidates_validation = body.issuer_url.is_some()
        || body.public_base_url.is_some()
        || body.client_id.is_some()
        || body.client_secret.is_some()
        || body.scopes.is_some()
        || body.token_auth_method.is_some();
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
        if !resulting_oidc_enabled || current.last_validation_at.is_none() {
            return Err(AppError::Validation(
                "password login cannot be disabled until OIDC has been successfully tested".into(),
            ));
        }
        let has_linked_super_user: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM riviamigo.user_oidc_identities i JOIN riviamigo.users u ON u.id=i.user_id WHERE u.role='super_user' AND NOT u.is_disabled AND i.issuer=$1)",
        )
        .bind(issuer)
        .fetch_one(pool)
        .await?;
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
        .bind(body.required_claim_name.unwrap_or(current.required_claim_name)).bind(body.required_claim_value.unwrap_or(current.required_claim_value)).bind(actor).bind(invalidates_validation).execute(pool).await?;
    load(pool, age_key).await
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
) -> Result<(), AppError> {
    use sha2::{Digest, Sha256};
    // Fingerprint configuration only. The client secret must never be retained in
    // diagnostic state or returned by the settings API.
    let fingerprint = hex::encode(Sha256::digest(
        format!(
            "{:?}|{:?}|{:?}|{}",
            settings.issuer_url, settings.public_base_url, settings.client_id, settings.scopes
        )
        .as_bytes(),
    ));
    sqlx::query("UPDATE riviamigo.authentication_settings SET last_validation_at=now(),last_validation_fingerprint=$1 WHERE id=TRUE")
        .bind(fingerprint).execute(pool).await?;
    Ok(())
}

pub fn validate_effective(settings: &AuthenticationSettingsResponse) -> Result<(), AppError> {
    if !settings.oidc_enabled.value {
        return Ok(());
    }
    if settings.issuer_url.value.is_none()
        || settings.client_id.value.is_none()
        || !settings.client_secret.configured
    {
        return Err(AppError::Validation(
            "OIDC is enabled but issuer, client ID, or client secret is missing".into(),
        ));
    }
    Ok(())
}

async fn load_stored(pool: &PgPool) -> Result<StoredSettings, AppError> {
    let row = sqlx::query("SELECT oidc_enabled,password_login_enabled,issuer_url,public_base_url,client_id,client_secret_encrypted,button_label,scopes,token_auth_method,auto_signup,auto_link_verified_email,allowed_email_domains,required_claim_name,required_claim_value,last_validation_at,last_validation_fingerprint FROM riviamigo.authentication_settings WHERE id=TRUE")
        .fetch_optional(pool).await?.ok_or_else(|| AppError::Internal(anyhow::anyhow!("authentication settings row is missing")))?;
    Ok(StoredSettings {
        oidc_enabled: row.try_get("oidc_enabled")?,
        password_login_enabled: row.try_get("password_login_enabled")?,
        issuer_url: row.try_get("issuer_url")?,
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
    let issuer = optional_field!(s.issuer_url, e.issuer_url);
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
        last_validation_fingerprint: s.last_validation_fingerprint,
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
            last_validation_fingerprint: None,
            callback_url: None,
        };
        assert!(validate_effective(&s).is_err());
        s.issuer_url.value = Some("https://issuer.example".into());
        s.client_id.value = Some("client".into());
        s.client_secret.configured = true;
        assert!(validate_effective(&s).is_ok());
    }
}
