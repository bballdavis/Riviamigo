use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    /// RSA private key PEM. Required in production; development may bootstrap it.
    pub jwt_secret: Option<String>,
    /// RSA public key PEM. Required in production; development may bootstrap it.
    pub jwt_public_key: Option<String>,
    /// age X25519 secret key. Required in production; development may bootstrap it.
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
    #[serde(default = "default_rivian_ws_reconnect_initial_seconds")]
    pub rivian_ws_reconnect_initial_seconds: u64,
    #[serde(default = "default_rivian_ws_reconnect_max_seconds")]
    pub rivian_ws_reconnect_max_seconds: u64,
    #[serde(default = "default_rivian_raw_event_retention_days")]
    pub rivian_raw_event_retention_days: i64,
    #[serde(default = "default_true")]
    pub rivian_persist_raw_events: bool,
    #[serde(default = "default_true")]
    pub rivian_parallax_capture_enabled: bool,
    #[serde(default = "default_true")]
    pub rivian_suppress_duplicate_telemetry: bool,
    /// Defaults to production; set to development only for local development.
    #[serde(default = "default_riviamigo_env")]
    pub riviamigo_env: Option<String>,
    /// Set to any value to allow insecure (non-Secure) cookies. Must NOT be
    /// set when `RIVIAMIGO_ENV=production`.
    pub cookie_insecure: Option<String>,
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
                anyhow::bail!(
                    "ALLOWED_ORIGINS must contain the external HTTPS origin in production"
                );
            }

            for origin in &self.allowed_origins {
                let parsed = url::Url::parse(origin).map_err(|error| {
                    anyhow::anyhow!(
                        "ALLOWED_ORIGINS contains an invalid origin `{origin}`: {error}"
                    )
                })?;
                if parsed.scheme() != "https"
                    || parsed.host_str().is_none()
                    || parsed.path() != "/"
                    || parsed.query().is_some()
                    || parsed.fragment().is_some()
                {
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

        Ok(())
    }

    fn is_production(&self) -> bool {
        self.riviamigo_env
            .as_deref()
            .is_some_and(|environment| environment.eq_ignore_ascii_case("production"))
    }
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
            rivian_ws_reconnect_initial_seconds: default_rivian_ws_reconnect_initial_seconds(),
            rivian_ws_reconnect_max_seconds: default_rivian_ws_reconnect_max_seconds(),
            rivian_raw_event_retention_days: default_rivian_raw_event_retention_days(),
            rivian_persist_raw_events: true,
            rivian_parallax_capture_enabled: true,
            rivian_suppress_duplicate_telemetry: true,
            riviamigo_env: Some("production".into()),
            cookie_insecure: None,
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
