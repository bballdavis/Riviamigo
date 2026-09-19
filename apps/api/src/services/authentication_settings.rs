use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{config::OidcEnvOverrides, errors::AppError, ingestion::session_store::encrypt_json};

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
    sqlx::query("UPDATE riviamigo.authentication_settings SET oidc_enabled=$1,password_login_enabled=$2,issuer_url=$3,public_base_url=$4,client_id=$5,client_secret_encrypted=$6,button_label=$7,scopes=$8,token_auth_method=$9,auto_signup=$10,auto_link_verified_email=$11,allowed_email_domains=$12,required_claim_name=$13,required_claim_value=$14,updated_at=now(),updated_by=$15 WHERE id=TRUE")
        .bind(body.oidc_enabled.unwrap_or(current.oidc_enabled)).bind(body.password_login_enabled.unwrap_or(current.password_login_enabled))
        .bind(body.issuer_url.unwrap_or(current.issuer_url)).bind(body.public_base_url.unwrap_or(current.public_base_url)).bind(body.client_id.unwrap_or(current.client_id)).bind(secret)
        .bind(body.button_label.unwrap_or(current.button_label)).bind(body.scopes.unwrap_or(current.scopes)).bind(body.token_auth_method.unwrap_or(current.token_auth_method))
        .bind(body.auto_signup.unwrap_or(current.auto_signup)).bind(body.auto_link_verified_email.unwrap_or(current.auto_link_verified_email)).bind(body.allowed_email_domains.unwrap_or(current.allowed_email_domains))
        .bind(body.required_claim_name.unwrap_or(current.required_claim_name)).bind(body.required_claim_value.unwrap_or(current.required_claim_value)).bind(actor).execute(pool).await?;
    load(pool, age_key).await
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
