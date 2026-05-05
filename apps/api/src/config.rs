use serde::Deserialize;

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
}

fn default_port() -> u16 {
    3001
}
fn default_origins() -> Vec<String> {
    vec!["http://localhost:3000".into()]
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
        envy::from_env::<Config>().map_err(|e| anyhow::anyhow!("Config error: {}", e))
    }
}
