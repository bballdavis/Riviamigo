use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    /// RSA private key PEM. Auto-generated and persisted to DB if not set.
    pub jwt_secret: Option<String>,
    /// RSA public key PEM. Auto-generated and persisted to DB if not set.
    pub jwt_public_key: Option<String>,
    /// age X25519 secret key. Auto-generated and persisted to DB if not set.
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
    /// Set to "production" to enable production-mode validation guards.
    pub riviamigo_env: Option<String>,
    /// Set to any value to allow insecure (non-Secure) cookies. Must NOT be
    /// set when `RIVIAMIGO_ENV=production`.
    pub cookie_insecure: Option<String>,
}

fn default_port() -> u16 {
    3001
}

fn default_backup_artifact_dir() -> String {
    std::env::temp_dir()
        .join("riviamigo-backups")
        .to_string_lossy()
        .into_owned()
}

fn default_backup_driver() -> String {
    "pg_dump".into()
}

fn default_vehicle_image_cache_dir() -> String {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_DATA_HOME").map(PathBuf::from))
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })
        .unwrap_or_else(std::env::temp_dir);

    base.join("riviamigo")
        .join("vehicle-image-cache")
        .to_string_lossy()
        .into_owned()
}

fn default_backup_poll_interval_seconds() -> u64 {
    60
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

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let config =
            envy::from_env::<Config>().map_err(|e| anyhow::anyhow!("Config error: {}", e))?;
        config.validate()?;
        Ok(config)
    }

    /// Validate configuration for the current environment.
    ///
    /// Hard-rejects insecure configurations when `RIVIAMIGO_ENV=production`.
    pub fn validate(&self) -> anyhow::Result<()> {
        let is_production = self
            .riviamigo_env
            .as_deref()
            .map(|e| e.eq_ignore_ascii_case("production"))
            .unwrap_or(false);

        if is_production {
            if self.cookie_insecure.is_some() {
                anyhow::bail!(
                    "COOKIE_INSECURE must not be set when RIVIAMIGO_ENV=production. \
                     Remove it from your environment before starting the API."
                );
            }
        }

        Ok(())
    }
}
