use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};

use crate::errors::AppError;

pub const RIVIAN_ACCOUNT: &str = "rivian_account";
pub const OPEN_METEO: &str = "open_meteo";
pub const NOMINATIM: &str = "nominatim";
pub const BASEMAP: &str = "basemap";
pub const ICONIFY: &str = "iconify";
pub const RIVIAN_ARTWORK: &str = "rivian_artwork";
pub const S3_BACKUP: &str = "s3_backup";

pub const OPTIONAL_CONNECTIONS: &[&str] =
    &[OPEN_METEO, NOMINATIM, BASEMAP, ICONIFY, RIVIAN_ARTWORK];

#[derive(Debug, Clone, FromRow)]
pub struct ConnectionSettingsRow {
    pub id: String,
    pub enabled: bool,
    pub mode: String,
    pub weather_precision: Option<String>,
    pub forecast_url: Option<String>,
    pub archive_url: Option<String>,
    pub base_url: Option<String>,
    pub light_url_template: Option<String>,
    pub dark_url_template: Option<String>,
    pub attribution: Option<String>,
    pub attribution_url: Option<String>,
    pub request_identifier: Option<String>,
    pub custom_autocomplete: bool,
    pub allow_private_network: bool,
    pub api_key_encrypted: Option<Vec<u8>>,
    pub bearer_token_encrypted: Option<Vec<u8>>,
    pub updated_at: DateTime<Utc>,
}

impl ConnectionSettingsRow {
    pub fn is_active(&self) -> bool {
        self.enabled && self.mode != "disabled"
    }
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ConnectionActivityRow {
    pub last_attempt_at: Option<DateTime<Utc>>,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub usage_date: NaiveDate,
    pub request_count: i32,
}

pub async fn load(pool: &PgPool, id: &str) -> Result<ConnectionSettingsRow, AppError> {
    sqlx::query_as::<_, ConnectionSettingsRow>(
        r#"SELECT id, enabled, mode, weather_precision, forecast_url, archive_url,
                  base_url, light_url_template, dark_url_template, attribution,
                  attribution_url, request_identifier, custom_autocomplete,
                  allow_private_network, api_key_encrypted, bearer_token_encrypted,
                  updated_at
           FROM riviamigo.external_connection_settings
           WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

pub async fn list(
    pool: &PgPool,
) -> Result<Vec<(ConnectionSettingsRow, ConnectionActivityRow)>, AppError> {
    #[derive(FromRow)]
    struct JoinedRow {
        id: String,
        enabled: bool,
        mode: String,
        weather_precision: Option<String>,
        forecast_url: Option<String>,
        archive_url: Option<String>,
        base_url: Option<String>,
        light_url_template: Option<String>,
        dark_url_template: Option<String>,
        attribution: Option<String>,
        attribution_url: Option<String>,
        request_identifier: Option<String>,
        custom_autocomplete: bool,
        allow_private_network: bool,
        api_key_encrypted: Option<Vec<u8>>,
        bearer_token_encrypted: Option<Vec<u8>>,
        updated_at: DateTime<Utc>,
        last_attempt_at: Option<DateTime<Utc>>,
        last_success_at: Option<DateTime<Utc>>,
        last_error: Option<String>,
        usage_date: NaiveDate,
        request_count: i32,
    }

    let rows = sqlx::query_as::<_, JoinedRow>(
        r#"SELECT s.id, s.enabled, s.mode, s.weather_precision, s.forecast_url,
                  s.archive_url, s.base_url, s.light_url_template, s.dark_url_template,
                  s.attribution, s.attribution_url, s.request_identifier,
                  s.custom_autocomplete, s.allow_private_network, s.api_key_encrypted,
                  s.bearer_token_encrypted, s.updated_at,
                  a.last_attempt_at, a.last_success_at, a.last_error,
                  COALESCE(a.usage_date, CURRENT_DATE) AS usage_date,
                  COALESCE(a.request_count, 0) AS request_count
           FROM riviamigo.external_connection_settings s
           LEFT JOIN riviamigo.external_connection_activity a ON a.connection_id = s.id
           ORDER BY CASE s.id
             WHEN 'rivian_account' THEN 1 WHEN 'open_meteo' THEN 2
             WHEN 'nominatim' THEN 3 WHEN 'basemap' THEN 4
             WHEN 'iconify' THEN 5 WHEN 'rivian_artwork' THEN 6 ELSE 7 END"#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            (
                ConnectionSettingsRow {
                    id: row.id,
                    enabled: row.enabled,
                    mode: row.mode,
                    weather_precision: row.weather_precision,
                    forecast_url: row.forecast_url,
                    archive_url: row.archive_url,
                    base_url: row.base_url,
                    light_url_template: row.light_url_template,
                    dark_url_template: row.dark_url_template,
                    attribution: row.attribution,
                    attribution_url: row.attribution_url,
                    request_identifier: row.request_identifier,
                    custom_autocomplete: row.custom_autocomplete,
                    allow_private_network: row.allow_private_network,
                    api_key_encrypted: row.api_key_encrypted,
                    bearer_token_encrypted: row.bearer_token_encrypted,
                    updated_at: row.updated_at,
                },
                ConnectionActivityRow {
                    last_attempt_at: row.last_attempt_at,
                    last_success_at: row.last_success_at,
                    last_error: row.last_error,
                    usage_date: row.usage_date,
                    request_count: row.request_count,
                },
            )
        })
        .collect())
}

pub async fn require_enabled(pool: &PgPool, id: &str) -> Result<ConnectionSettingsRow, AppError> {
    let settings = load(pool, id).await?;
    if settings.is_active() {
        Ok(settings)
    } else {
        Err(AppError::ExternalConnectionDisabled(id.to_string()))
    }
}

pub async fn record_attempt(pool: &PgPool, id: &str) {
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.external_connection_activity
             (connection_id, last_attempt_at, usage_date, request_count)
           VALUES ($1, now(), CURRENT_DATE, 1)
           ON CONFLICT (connection_id) DO UPDATE SET
             last_attempt_at = now(),
             usage_date = CURRENT_DATE,
             request_count = CASE
               WHEN riviamigo.external_connection_activity.usage_date = CURRENT_DATE
                 THEN riviamigo.external_connection_activity.request_count + 1
               ELSE 1 END"#,
    )
    .bind(id)
    .execute(pool)
    .await;
}

pub async fn record_success(pool: &PgPool, id: &str) {
    let _ = sqlx::query(
        "UPDATE riviamigo.external_connection_activity SET last_success_at = now(), last_error = NULL WHERE connection_id = $1",
    )
    .bind(id)
    .execute(pool)
    .await;
}

pub async fn record_failure(pool: &PgPool, id: &str, message: &str) {
    let sanitized = sanitize_error(message);
    let _ = sqlx::query(
        "UPDATE riviamigo.external_connection_activity SET last_error = $2 WHERE connection_id = $1",
    )
    .bind(id)
    .bind(sanitized)
    .execute(pool)
    .await;
}

fn sanitize_error(message: &str) -> String {
    let first_line = message.lines().next().unwrap_or("External request failed");
    let without_query = first_line.split('?').next().unwrap_or(first_line);
    without_query.chars().take(240).collect()
}

#[cfg(test)]
mod tests {
    use super::sanitize_error;

    #[test]
    fn strips_query_strings_and_bounds_error_text() {
        let result = sanitize_error(&format!(
            "request https://example.test/path?lat=1&lng=2 {}",
            "x".repeat(300)
        ));
        assert!(!result.contains("lat="));
        assert!(result.len() <= 240);
    }
}
