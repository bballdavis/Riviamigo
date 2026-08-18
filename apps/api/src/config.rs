use anyhow::Context;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::net::IpAddr;
use std::path::PathBuf;

const MIN_SETUP_TOKEN_BYTES: usize = 32;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    /// Optional externally managed RSA private key PEM. Supply all three key
    /// overrides together; otherwise Riviamigo uses its database-backed keys.
    pub jwt_secret: Option<String>,
    /// Optional externally managed RSA public verification key PEM.
    pub jwt_public_key: Option<String>,
    /// Optional externally managed age X25519 secret key.
    pub age_encryption_key: Option<String>,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_origins")]
    pub allowed_origins: Vec<String>,
    pub s3_endpoint: Option<String>,
    pub s3_access_key: Option<String>,
    pub s3_secret_key: Option<String>,
    #[serde(default = "default_backup_artifact_dir")]
    pub backup_artifact_dir: String,
    #[serde(default = "default_vehicle_image_cache_dir")]
    pub vehicle_image_cache_dir: String,
    #[serde(default = "default_backup_driver")]
    pub backup_driver: String,
    #[serde(default = "default_backup_poll_interval_seconds")]
    pub backup_poll_interval_seconds: u64,
    #[serde(default = "default_restore_agent_url")]
    pub restore_agent_url: String,
    #[serde(default = "default_restore_agent_key_file")]
    pub restore_agent_key_file: String,
    #[serde(flatten)]
    pub recovery: RecoveryConfig,
    #[serde(flatten)]
    pub origin_bind: OriginBindConfig,
    #[serde(default = "default_rivian_ws_reconnect_initial_seconds")]
    pub rivian_ws_reconnect_initial_seconds: u64,
    #[serde(default = "default_rivian_ws_reconnect_max_seconds")]
    pub rivian_ws_reconnect_max_seconds: u64,
    #[serde(default = "default_rivian_raw_event_retention_days")]
    pub rivian_raw_event_retention_days: i64,
    #[serde(default = "default_true")]
    pub rivian_persist_raw_events: bool,
    #[serde(default = "default_true")]
    pub rivian_suppress_duplicate_telemetry: bool,
    /// Defaults to production; set to development only for local development.
    #[serde(default = "default_riviamigo_env")]
    pub riviamigo_env: Option<String>,
    /// Set to any value to allow insecure (non-Secure) cookies. Must NOT be
    /// set when `RIVIAMIGO_ENV=production`.
    pub cookie_insecure: Option<String>,
    /// Explicit, LAN-only production exception for browser clients that cannot
    /// use HTTPS. This is deliberately a boolean so values such as `false`
    /// never make refresh cookies insecure.
    #[serde(default)]
    pub allow_insecure_lan_http_auth: bool,
    #[serde(default)]
    pub rate_limit: RateLimitConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RateLimitConfig {
    #[serde(default = "default_auth_public_per_minute")]
    pub auth_public_per_minute: u32,
    #[serde(default = "default_auth_public_burst")]
    pub auth_public_burst: u32,
    #[serde(default = "default_auth_metadata_per_minute")]
    pub auth_metadata_per_minute: u32,
    #[serde(default = "default_auth_metadata_burst")]
    pub auth_metadata_burst: u32,
    #[serde(default = "default_auth_read_per_minute")]
    pub auth_read_per_minute: u32,
    #[serde(default = "default_auth_read_burst")]
    pub auth_read_burst: u32,
    #[serde(default = "default_auth_write_per_minute")]
    pub auth_write_per_minute: u32,
    #[serde(default = "default_auth_write_burst")]
    pub auth_write_burst: u32,
    #[serde(default = "default_heavy_read_per_minute")]
    pub heavy_read_per_minute: u32,
    #[serde(default = "default_heavy_read_burst")]
    pub heavy_read_burst: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RecoveryConfig {
    #[serde(
        rename = "recovery_max_upload_bytes",
        default = "default_recovery_max_upload_bytes"
    )]
    pub max_upload_bytes: u64,
    #[serde(
        rename = "recovery_max_expanded_bytes",
        default = "default_recovery_max_expanded_bytes"
    )]
    pub max_expanded_bytes: u64,
    #[serde(
        rename = "recovery_max_member_bytes",
        default = "default_recovery_max_member_bytes"
    )]
    pub max_member_bytes: u64,
    #[serde(
        rename = "recovery_max_members",
        default = "default_recovery_max_members"
    )]
    pub max_members: usize,
    #[serde(
        rename = "recovery_max_compression_ratio",
        default = "default_recovery_max_compression_ratio"
    )]
    pub max_compression_ratio: u64,
    #[serde(
        rename = "recovery_min_free_bytes",
        default = "default_recovery_min_free_bytes"
    )]
    pub min_free_bytes: u64,
    #[serde(
        rename = "recovery_upload_deadline_seconds",
        default = "default_recovery_upload_deadline_seconds"
    )]
    pub upload_deadline_seconds: u64,
    #[serde(
        rename = "recovery_restore_deadline_seconds",
        default = "default_recovery_restore_deadline_seconds"
    )]
    pub restore_deadline_seconds: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OriginBindConfig {
    #[serde(default = "default_riviamigo_bind_address")]
    pub riviamigo_bind_address: String,
    #[serde(default)]
    pub allow_public_origin_bind: bool,
}

fn default_port() -> u16 {
    3001
}

fn default_backup_artifact_dir() -> String {
    "/backups".into()
}

fn default_backup_driver() -> String {
    "pg_dump".into()
}

fn default_vehicle_image_cache_dir() -> String {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("XDG_DATA_HOME").map(PathBuf::from))
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })
        .unwrap_or_else(std::env::temp_dir);

    base.join("riviamigo")
        .join("vehicle-images")
        .to_string_lossy()
        .into_owned()
}

fn default_riviamigo_env() -> Option<String> {
    Some("production".into())
}

fn default_backup_poll_interval_seconds() -> u64 {
    60
}

fn default_restore_agent_url() -> String {
    "http://127.0.0.1:3002".into()
}

fn default_restore_agent_key_file() -> String {
    "/backups/.restore-agent-key".into()
}

fn default_recovery_max_upload_bytes() -> u64 {
    16 * 1024 * 1024 * 1024
}
fn default_recovery_max_expanded_bytes() -> u64 {
    64 * 1024 * 1024 * 1024
}
fn default_recovery_max_member_bytes() -> u64 {
    64 * 1024 * 1024 * 1024
}
fn default_recovery_max_members() -> usize {
    10_000
}
fn default_recovery_max_compression_ratio() -> u64 {
    200
}
fn default_recovery_min_free_bytes() -> u64 {
    2 * 1024 * 1024 * 1024
}
fn default_recovery_upload_deadline_seconds() -> u64 {
    1_800
}
fn default_recovery_restore_deadline_seconds() -> u64 {
    14_400
}
fn default_riviamigo_bind_address() -> String {
    "127.0.0.1".into()
}

fn default_origins() -> Vec<String> {
    vec![
        "http://localhost:3000".into(),
        "http://localhost:5173".into(),
    ]
}

fn default_rivian_ws_reconnect_initial_seconds() -> u64 {
    10
}

fn default_rivian_ws_reconnect_max_seconds() -> u64 {
    900
}

fn default_rivian_raw_event_retention_days() -> i64 {
    7
}

fn default_true() -> bool {
    true
}

fn default_auth_public_per_minute() -> u32 {
    30
}

fn default_auth_public_burst() -> u32 {
    10
}

fn default_auth_metadata_per_minute() -> u32 {
    1200
}

fn default_auth_metadata_burst() -> u32 {
    120
}

fn default_auth_read_per_minute() -> u32 {
    900
}

fn default_auth_read_burst() -> u32 {
    180
}

fn default_auth_write_per_minute() -> u32 {
    240
}

fn default_auth_write_burst() -> u32 {
    60
}

fn default_heavy_read_per_minute() -> u32 {
    300
}

fn default_heavy_read_burst() -> u32 {
    90
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        populate_compose_connection_urls()?;
        let config =
            envy::from_env::<Config>().map_err(|e| anyhow::anyhow!("Config error: {e}"))?;
        config.validate()?;
        Ok(config)
    }

    /// Validate configuration for the current environment.
    ///
    /// Hard-rejects insecure configurations when `RIVIAMIGO_ENV=production`.
    pub fn validate(&self) -> anyhow::Result<()> {
        let is_production = self.is_production();
        let bind_address: IpAddr =
            self.origin_bind
                .riviamigo_bind_address
                .parse()
                .map_err(|_| {
                    anyhow::anyhow!("RIVIAMIGO_BIND_ADDRESS must be an IPv4 or IPv6 address")
                })?;

        // Resolve the proof during startup so an invalid or unreadable secret
        // fails explicitly instead of leaving first-owner setup mysteriously
        // unavailable. An entirely absent proof is allowed: an unclaimed
        // production installation stays healthy but registration fails closed.
        let _ = load_setup_token()?;

        let supplied_key_count = [
            self.jwt_secret.as_deref(),
            self.jwt_public_key.as_deref(),
            self.age_encryption_key.as_deref(),
        ]
        .into_iter()
        .filter(|value| value.is_some_and(|value| !value.trim().is_empty()))
        .count();
        if supplied_key_count != 0 && supplied_key_count != 3 {
            anyhow::bail!(
                "JWT_SECRET, JWT_PUBLIC_KEY, and AGE_ENCRYPTION_KEY must be supplied together or all omitted so Riviamigo can persist generated keys"
            );
        }

        if is_production {
            if self.cookie_insecure.is_some() {
                anyhow::bail!(
                    "COOKIE_INSECURE must not be set when RIVIAMIGO_ENV=production. \
                     Remove it from your environment before starting the API."
                );
            }

            if self.allowed_origins.is_empty() {
                anyhow::bail!("ALLOWED_ORIGINS must contain an exact browser origin in production");
            }

            if self.allow_insecure_lan_http_auth {
                if !self.origin_bind.allow_public_origin_bind {
                    anyhow::bail!(
                        "ALLOW_INSECURE_LAN_HTTP_AUTH=true requires ALLOW_PUBLIC_ORIGIN_BIND=true"
                    );
                }
                if !is_lan_accessible_bind_address(bind_address) {
                    anyhow::bail!(
                        "ALLOW_INSECURE_LAN_HTTP_AUTH=true requires RIVIAMIGO_BIND_ADDRESS to be an unspecified, private, or link-local IP address"
                    );
                }
            }

            for origin in &self.allowed_origins {
                let parsed = url::Url::parse(origin).map_err(|error| {
                    anyhow::anyhow!(
                        "ALLOWED_ORIGINS contains an invalid origin `{origin}`: {error}"
                    )
                })?;
                let common_invalid = parsed.host_str().is_none()
                    || parsed.username() != ""
                    || parsed.password().is_some()
                    || parsed.path() != "/"
                    || parsed.query().is_some()
                    || parsed.fragment().is_some();
                if common_invalid {
                    anyhow::bail!(
                        "ALLOWED_ORIGINS must contain exact origins without credentials, paths, queries, or fragments in production; found `{origin}`"
                    );
                }

                if self.allow_insecure_lan_http_auth {
                    let ip = match parsed.host() {
                        Some(url::Host::Ipv4(ip)) => IpAddr::V4(ip),
                        Some(url::Host::Ipv6(ip)) => IpAddr::V6(ip),
                        Some(url::Host::Domain(_)) | None => {
                            anyhow::bail!(
                                "ALLOW_INSECURE_LAN_HTTP_AUTH=true requires ALLOWED_ORIGINS to use private, loopback, or link-local literal IP hosts; found `{origin}`"
                            );
                        }
                    };
                    if parsed.scheme() != "http" || !is_lan_client_address(ip) {
                        anyhow::bail!(
                            "ALLOW_INSECURE_LAN_HTTP_AUTH=true requires exact HTTP origins using private, loopback, or link-local literal IP hosts; found `{origin}`"
                        );
                    }
                } else if parsed.scheme() != "https" {
                    anyhow::bail!(
                        "ALLOWED_ORIGINS must contain exact HTTPS origins without paths, queries, or fragments in production; found `{origin}`"
                    );
                }
            }

            let database_url = url::Url::parse(&self.database_url)
                .map_err(|error| anyhow::anyhow!("DATABASE_URL is invalid: {error}"))?;
            let password = database_url.password().unwrap_or_default();
            if password.is_empty()
                || matches!(password, "devpassword" | "CHANGE_ME" | "change_me")
                || password.starts_with("CHANGE_ME")
            {
                anyhow::bail!(
                    "DATABASE_URL must contain a non-default database password in production"
                );
            }

            let redis_url = url::Url::parse(&self.redis_url)
                .map_err(|error| anyhow::anyhow!("REDIS_URL is invalid: {error}"))?;
            let redis_password = redis_url.password().unwrap_or_default();
            if redis_password.is_empty()
                || matches!(redis_password, "devpassword" | "CHANGE_ME" | "change_me")
                || redis_password.starts_with("CHANGE_ME")
            {
                anyhow::bail!("REDIS_URL must contain a non-default Redis password in production");
            }
        }

        self.rate_limit.validate()?;
        self.validate_recovery_limits()?;

        if !bind_address.is_loopback() && !self.origin_bind.allow_public_origin_bind {
            anyhow::bail!(
                "RIVIAMIGO_BIND_ADDRESS may be non-loopback only when ALLOW_PUBLIC_ORIGIN_BIND=true"
            );
        }

        Ok(())
    }

    fn validate_recovery_limits(&self) -> anyhow::Result<()> {
        if self.recovery.max_upload_bytes == 0
            || self.recovery.max_expanded_bytes == 0
            || self.recovery.max_member_bytes == 0
            || self.recovery.max_members == 0
            || self.recovery.max_compression_ratio == 0
            || self.recovery.upload_deadline_seconds == 0
            || self.recovery.restore_deadline_seconds == 0
        {
            anyhow::bail!("recovery resource limits and deadlines must be greater than zero");
        }
        if self.recovery.max_member_bytes > self.recovery.max_expanded_bytes {
            anyhow::bail!("RECOVERY_MAX_MEMBER_BYTES cannot exceed RECOVERY_MAX_EXPANDED_BYTES");
        }
        if self.recovery.min_free_bytes < default_recovery_min_free_bytes() {
            anyhow::bail!("RECOVERY_MIN_FREE_BYTES cannot be less than 2 GiB");
        }
        Ok(())
    }

    pub fn is_production(&self) -> bool {
        self.riviamigo_env
            .as_deref()
            .is_some_and(|environment| environment.eq_ignore_ascii_case("production"))
    }

    pub fn is_development(&self) -> bool {
        self.riviamigo_env
            .as_deref()
            .is_some_and(|environment| environment.eq_ignore_ascii_case("development"))
    }

    /// Determines whether refresh cookies may omit the Secure attribute.
    /// Production reaches this state only through `validate`'s narrowly scoped
    /// LAN opt-in. The legacy development switch remains development-only.
    pub fn allows_insecure_refresh_cookies(&self) -> bool {
        self.allow_insecure_lan_http_auth
            || (self.is_development() && self.cookie_insecure.is_some())
    }

    /// Effective source for JWT signing and age encryption roots. This is safe
    /// to expose to administrators because it never includes key material.
    pub fn cryptographic_key_source(&self) -> &'static str {
        if self.jwt_secret.is_some()
            && self.jwt_public_key.is_some()
            && self.age_encryption_key.is_some()
        {
            "external"
        } else {
            "database"
        }
    }

    /// Whether this process can currently verify the one-time first-owner
    /// proof. This intentionally reports only availability, never the secret
    /// source or value.
    pub fn setup_proof_available(&self) -> bool {
        load_setup_token().is_ok_and(|token| token.is_some())
    }

    /// Verify a supplied first-owner proof without persisting or logging the
    /// configured secret. Both values are reduced to fixed-size digests before
    /// comparison so token length does not affect the comparison loop.
    pub fn verify_setup_token(&self, supplied: &str) -> anyhow::Result<bool> {
        let Some(expected) = load_setup_token()? else {
            return Ok(false);
        };
        let supplied = trim_one_trailing_line_ending(supplied);
        let expected_digest = Sha256::digest(expected.as_bytes());
        let supplied_digest = Sha256::digest(supplied.as_bytes());
        let difference = expected_digest
            .iter()
            .zip(supplied_digest.iter())
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            });
        Ok(difference == 0)
    }
}

fn is_lan_client_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}

fn is_lan_accessible_bind_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) if ip.is_unspecified() => true,
        IpAddr::V6(ip) if ip.is_unspecified() => true,
        IpAddr::V4(ip) => ip.is_private() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}

fn load_setup_token() -> anyhow::Result<Option<String>> {
    let inline = std::env::var("RIVIAMIGO_SETUP_TOKEN").ok();
    let file = std::env::var("RIVIAMIGO_SETUP_TOKEN_FILE").ok();
    if inline.is_some() && file.is_some() {
        anyhow::bail!(
            "RIVIAMIGO_SETUP_TOKEN and RIVIAMIGO_SETUP_TOKEN_FILE are mutually exclusive"
        );
    }

    let token = match (inline, file) {
        (Some(token), None) => token,
        (None, Some(path)) => std::fs::read_to_string(&path)
            .with_context(|| format!("read RIVIAMIGO_SETUP_TOKEN_FILE at {path}"))?,
        (None, None) => return Ok(None),
        (Some(_), Some(_)) => unreachable!("mutual exclusion checked above"),
    };
    let token = trim_one_trailing_line_ending(&token).to_owned();
    if token.as_bytes().len() < MIN_SETUP_TOKEN_BYTES {
        anyhow::bail!("Riviamigo setup token must contain at least {MIN_SETUP_TOKEN_BYTES} bytes");
    }
    Ok(Some(token))
}

fn trim_one_trailing_line_ending(value: &str) -> &str {
    value
        .strip_suffix("\r\n")
        .or_else(|| value.strip_suffix('\n'))
        .unwrap_or(value)
}

fn populate_compose_connection_urls() -> anyhow::Result<()> {
    if std::env::var_os("DATABASE_URL").is_none() {
        let password = std::env::var("POSTGRES_PASSWORD")
            .map_err(|_| anyhow::anyhow!("DATABASE_URL or POSTGRES_PASSWORD is required"))?;
        let user = std::env::var("POSTGRES_USER").unwrap_or_else(|_| "riviamigo".into());
        let mut url = url::Url::parse("postgresql://timescaledb:5432/riviamigo")?;
        url.set_username(&user)
            .map_err(|_| anyhow::anyhow!("POSTGRES_USER cannot be encoded in DATABASE_URL"))?;
        url.set_password(Some(&password))
            .map_err(|_| anyhow::anyhow!("POSTGRES_PASSWORD cannot be encoded in DATABASE_URL"))?;
        std::env::set_var("DATABASE_URL", url.as_str());
    }

    if std::env::var_os("REDIS_URL").is_none() {
        let password = std::env::var("REDIS_PASSWORD")
            .map_err(|_| anyhow::anyhow!("REDIS_URL or REDIS_PASSWORD is required"))?;
        std::env::set_var("REDIS_URL", compose_redis_url(&password)?);
    }

    Ok(())
}

fn compose_redis_url(password: &str) -> anyhow::Result<String> {
    let mut url = url::Url::parse("redis://redis:6379")?;
    // Redis `requirepass` authenticates the built-in ACL `default` user. An
    // empty username in a redis URL is parsed by current clients as an ACL
    // username rather than as the legacy one-argument AUTH form.
    url.set_username("default")
        .map_err(|_| anyhow::anyhow!("REDIS_URL cannot contain the Redis username"))?;
    url.set_password(Some(password))
        .map_err(|_| anyhow::anyhow!("REDIS_PASSWORD cannot be encoded in REDIS_URL"))?;
    Ok(url.into())
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            auth_public_per_minute: default_auth_public_per_minute(),
            auth_public_burst: default_auth_public_burst(),
            auth_metadata_per_minute: default_auth_metadata_per_minute(),
            auth_metadata_burst: default_auth_metadata_burst(),
            auth_read_per_minute: default_auth_read_per_minute(),
            auth_read_burst: default_auth_read_burst(),
            auth_write_per_minute: default_auth_write_per_minute(),
            auth_write_burst: default_auth_write_burst(),
            heavy_read_per_minute: default_heavy_read_per_minute(),
            heavy_read_burst: default_heavy_read_burst(),
        }
    }
}

impl Default for RecoveryConfig {
    fn default() -> Self {
        Self {
            max_upload_bytes: default_recovery_max_upload_bytes(),
            max_expanded_bytes: default_recovery_max_expanded_bytes(),
            max_member_bytes: default_recovery_max_member_bytes(),
            max_members: default_recovery_max_members(),
            max_compression_ratio: default_recovery_max_compression_ratio(),
            min_free_bytes: default_recovery_min_free_bytes(),
            upload_deadline_seconds: default_recovery_upload_deadline_seconds(),
            restore_deadline_seconds: default_recovery_restore_deadline_seconds(),
        }
    }
}

impl Default for OriginBindConfig {
    fn default() -> Self {
        Self {
            riviamigo_bind_address: default_riviamigo_bind_address(),
            allow_public_origin_bind: false,
        }
    }
}

impl RateLimitConfig {
    fn validate(&self) -> anyhow::Result<()> {
        for (name, per_minute, burst) in [
            (
                "RATE_LIMIT_AUTH_PUBLIC_PER_MINUTE",
                self.auth_public_per_minute,
                self.auth_public_burst,
            ),
            (
                "RATE_LIMIT_AUTH_METADATA_PER_MINUTE",
                self.auth_metadata_per_minute,
                self.auth_metadata_burst,
            ),
            (
                "RATE_LIMIT_AUTH_READ_PER_MINUTE",
                self.auth_read_per_minute,
                self.auth_read_burst,
            ),
            (
                "RATE_LIMIT_AUTH_WRITE_PER_MINUTE",
                self.auth_write_per_minute,
                self.auth_write_burst,
            ),
            (
                "RATE_LIMIT_HEAVY_READ_PER_MINUTE",
                self.heavy_read_per_minute,
                self.heavy_read_burst,
            ),
        ] {
            if per_minute == 0 {
                anyhow::bail!("{name} must be greater than 0");
            }
            if burst == 0 {
                anyhow::bail!("{name} burst size must be greater than 0");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use redis::IntoConnectionInfo;

    fn production_config() -> Config {
        Config {
            database_url: "postgresql://riviamigo:strong-password@timescaledb:5432/riviamigo"
                .into(),
            redis_url: "redis://:strong-redis-password@redis:6379".into(),
            jwt_secret: Some("private".into()),
            jwt_public_key: Some("public".into()),
            age_encryption_key: Some("age-key".into()),
            port: 3001,
            allowed_origins: vec!["https://riviamigo.example.com".into()],
            s3_endpoint: None,
            s3_access_key: None,
            s3_secret_key: None,
            backup_artifact_dir: default_backup_artifact_dir(),
            vehicle_image_cache_dir: default_vehicle_image_cache_dir(),
            backup_driver: default_backup_driver(),
            backup_poll_interval_seconds: default_backup_poll_interval_seconds(),
            restore_agent_url: default_restore_agent_url(),
            restore_agent_key_file: default_restore_agent_key_file(),
            recovery: RecoveryConfig::default(),
            origin_bind: OriginBindConfig::default(),
            rivian_ws_reconnect_initial_seconds: default_rivian_ws_reconnect_initial_seconds(),
            rivian_ws_reconnect_max_seconds: default_rivian_ws_reconnect_max_seconds(),
            rivian_raw_event_retention_days: default_rivian_raw_event_retention_days(),
            rivian_persist_raw_events: true,
            rivian_suppress_duplicate_telemetry: true,
            riviamigo_env: Some("production".into()),
            cookie_insecure: None,
            allow_insecure_lan_http_auth: false,
            rate_limit: RateLimitConfig::default(),
        }
    }

    #[test]
    fn compose_redis_url_round_trips_uri_sensitive_passwords() {
        let password = "session:@/?#% password";
        let url = compose_redis_url(password).expect("compose Redis URL");
        let connection = url.into_connection_info().expect("parse Redis URL");

        assert_eq!(connection.redis_settings().username(), Some("default"));
        assert_eq!(connection.redis_settings().password(), Some(password));
    }

    #[test]
    fn production_allows_database_bootstrapped_keys() {
        let mut config = production_config();
        config.jwt_secret = None;
        config.jwt_public_key = None;
        config.age_encryption_key = None;
        config
            .validate()
            .expect("production keys may bootstrap into the database");
    }

    #[test]
    fn key_overrides_must_be_complete() {
        let mut config = production_config();
        config.age_encryption_key = None;

        assert!(config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("must be supplied together"));
    }

    #[test]
    fn rejects_public_origin_without_explicit_acknowledgement_and_weak_recovery_reserve() {
        let mut config = production_config();
        config.origin_bind.riviamigo_bind_address = "0.0.0.0".into();
        assert!(config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("ALLOW_PUBLIC_ORIGIN_BIND"));

        config.origin_bind.allow_public_origin_bind = true;
        config.recovery.min_free_bytes = 1024;
        assert!(config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("cannot be less than 2 GiB"));
    }

    #[test]
    fn recovery_and_origin_env_names_are_deserialized_from_uppercase_variables() {
        let recovery = envy::from_iter::<_, RecoveryConfig>([
            ("RECOVERY_MAX_UPLOAD_BYTES".to_owned(), "1234".to_owned()),
            ("RECOVERY_MAX_MEMBERS".to_owned(), "42".to_owned()),
        ])
        .expect("recovery environment configuration");
        assert_eq!(recovery.max_upload_bytes, 1234);
        assert_eq!(recovery.max_members, 42);

        let origin = envy::from_iter::<_, OriginBindConfig>([
            ("RIVIAMIGO_BIND_ADDRESS".to_owned(), "0.0.0.0".to_owned()),
            ("ALLOW_PUBLIC_ORIGIN_BIND".to_owned(), "true".to_owned()),
        ])
        .expect("origin environment configuration");
        assert_eq!(origin.riviamigo_bind_address, "0.0.0.0");
        assert!(origin.allow_public_origin_bind);
    }

    #[test]
    fn production_rejects_non_https_origins_and_default_database_passwords() {
        let mut config = production_config();
        config.allowed_origins = vec!["http://riviamigo.example.com".into()];
        assert!(config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("exact HTTPS origins"));

        config.allowed_origins = vec!["https://riviamigo.example.com".into()];
        config.database_url =
            "postgresql://riviamigo:devpassword@timescaledb:5432/riviamigo".into();
        assert!(config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("non-default database password"));
    }

    #[test]
    fn production_lan_http_auth_requires_the_complete_private_literal_opt_in() {
        let mut config = production_config();
        config.allow_insecure_lan_http_auth = true;
        config.allowed_origins = vec!["http://192.168.1.20:8080".into()];

        assert!(config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("ALLOW_PUBLIC_ORIGIN_BIND"));

        config.origin_bind.allow_public_origin_bind = true;
        config.origin_bind.riviamigo_bind_address = "127.0.0.1".into();
        assert!(
            config.validate().is_err(),
            "a loopback-only bind is not LAN-accessible"
        );

        config.origin_bind.riviamigo_bind_address = "0.0.0.0".into();
        config
            .validate()
            .expect("the fully acknowledged private-literal LAN configuration is valid");
    }

    #[test]
    fn production_lan_http_auth_rejects_public_hostname_credentials_and_mixed_origins() {
        let mut config = production_config();
        config.allow_insecure_lan_http_auth = true;
        config.origin_bind.allow_public_origin_bind = true;
        config.origin_bind.riviamigo_bind_address = "192.168.1.20".into();

        for invalid_origin in [
            "http://riviamigo.local:8080",
            "http://8.8.8.8:8080",
            "http://user:password@192.168.1.20:8080",
            "https://192.168.1.20:8080",
            "http://192.168.1.20:8080/app",
        ] {
            config.allowed_origins = vec![invalid_origin.into()];
            assert!(
                config.validate().is_err(),
                "expected {invalid_origin} to be rejected"
            );
        }

        config.allowed_origins = vec![
            "http://192.168.1.20:8080".into(),
            "https://192.168.1.21:8080".into(),
        ];
        assert!(config.validate().is_err(), "mixed origin schemes must fail");
    }

    #[test]
    fn only_the_explicit_lan_opt_in_allows_insecure_production_refresh_cookies() {
        let mut config = production_config();
        assert!(!config.allows_insecure_refresh_cookies());

        config.allow_insecure_lan_http_auth = true;
        assert!(config.allows_insecure_refresh_cookies());

        config.allow_insecure_lan_http_auth = false;
        config.cookie_insecure = Some("false".into());
        assert!(
            !config.allows_insecure_refresh_cookies(),
            "the legacy environment value must not weaken production cookies"
        );
    }

    #[test]
    fn cookie_insecure_remains_available_only_in_explicit_development_mode() {
        let mut config = production_config();
        config.riviamigo_env = Some("staging".into());
        config.cookie_insecure = Some("1".into());
        assert!(!config.allows_insecure_refresh_cookies());

        config.riviamigo_env = Some("development".into());
        assert!(config.allows_insecure_refresh_cookies());
    }

    #[test]
    fn lan_address_helpers_only_accept_private_loopback_or_link_local_clients() {
        assert!(is_lan_client_address("127.0.0.1".parse().unwrap()));
        assert!(is_lan_client_address("169.254.10.2".parse().unwrap()));
        assert!(is_lan_client_address("192.168.1.20".parse().unwrap()));
        assert!(is_lan_client_address("fd00::20".parse().unwrap()));
        assert!(!is_lan_client_address("8.8.8.8".parse().unwrap()));
        assert!(!is_lan_client_address(
            "2001:4860:4860::8888".parse().unwrap()
        ));
    }

    #[test]
    fn lan_http_auth_environment_value_is_a_strict_boolean() {
        let base = vec![
            (
                "DATABASE_URL".to_owned(),
                "postgresql://riviamigo:password@localhost/riviamigo".to_owned(),
            ),
            (
                "REDIS_URL".to_owned(),
                "redis://:password@localhost/".to_owned(),
            ),
        ];

        let mut explicitly_false = base.clone();
        explicitly_false.push((
            "ALLOW_INSECURE_LAN_HTTP_AUTH".to_owned(),
            "false".to_owned(),
        ));
        let config = envy::from_iter::<_, Config>(explicitly_false)
            .expect("false is a valid explicit boolean");
        assert!(!config.allow_insecure_lan_http_auth);

        let mut invalid = base;
        invalid.push(("ALLOW_INSECURE_LAN_HTTP_AUTH".to_owned(), "1".to_owned()));
        assert!(
            envy::from_iter::<_, Config>(invalid).is_err(),
            "presence-like values must not enable insecure LAN cookies"
        );
    }

    #[test]
    fn development_keeps_key_bootstrap_available() {
        let mut config = production_config();
        config.riviamigo_env = Some("development".into());
        config.jwt_secret = None;
        config.jwt_public_key = None;
        config.age_encryption_key = None;
        config.allowed_origins = default_origins();
        config.database_url =
            "postgresql://riviamigo:devpassword@timescaledb:5432/riviamigo".into();

        config
            .validate()
            .expect("development bootstrap stays supported");
    }
}
