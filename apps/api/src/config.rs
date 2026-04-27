use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub database_url:     String,
    pub redis_url:        String,
    pub jwt_secret:       String,
    pub jwt_public_key:   String,
    pub age_key:          String,
    #[serde(default = "default_port")]
    pub port:             u16,
    #[serde(default = "default_origins")]
    pub allowed_origins:  Vec<String>,
    pub minio_endpoint:   Option<String>,
    pub minio_access_key: Option<String>,
    pub minio_secret_key: Option<String>,
}

fn default_port() -> u16 { 3001 }
fn default_origins() -> Vec<String> { vec!["http://localhost:3000".into()] }

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        envy::from_env::<Config>().map_err(|e| anyhow::anyhow!("Config error: {}", e))
    }
}
