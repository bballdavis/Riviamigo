use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};

use crate::errors::AppError;

pub const RIVIAN_ACCOUNT: &str = "rivian_account";
pub const OPEN_METEO: &str = "open_meteo";
pub const NOMINATIM: &str = "nominatim";
pub const BASEMAP: &str = "basemap";
pub const ICONIFY: &str = "iconify";
pub const S3_BACKUP: &str = "s3_backup";

pub const OPTIONAL_CONNECTIONS: &[&str] = &[OPEN_METEO, NOMINATIM, BASEMAP, ICONIFY];

/// Advisory policy based on observed Rivian ecosystem behavior, not an
/// authoritative provider contract.
pub const RIVIAN_RENEWAL_INTERVAL: Duration = Duration::days(180);
pub const RIVIAN_RENEWAL_WARNING: Duration = Duration::days(7);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RivianRenewalState {
    Healthy,
    RenewalSoon,
    RenewalDue,
    ReauthRequired,
}

#[derive(Debug, Clone, Serialize)]
pub struct RivianConnectionStatus {
    pub credential_issued_at: Option<DateTime<Utc>>,
    pub expected_renewal_at: Option<DateTime<Utc>>,
    pub renewal_state: Option<RivianRenewalState>,
    pub observed_health: Option<String>,
    pub observed_error: Option<String>,
}

pub fn rivian_renewal_state(
    issued_at: DateTime<Utc>,
    now: DateTime<Utc>,
    auth_failed: bool,
) -> RivianRenewalState {
    if auth_failed {
        return RivianRenewalState::ReauthRequired;
    }
    let renewal_at = issued_at + RIVIAN_RENEWAL_INTERVAL;
    if now >= renewal_at {
        RivianRenewalState::RenewalDue
    } else if now >= renewal_at - RIVIAN_RENEWAL_WARNING {
        RivianRenewalState::RenewalSoon
    } else {
        RivianRenewalState::Healthy
    }
}

pub async fn rivian_status(pool: &PgPool) -> Result<RivianConnectionStatus, AppError> {
    let issued_at = sqlx::query_scalar::<_, DateTime<Utc>>(
        "SELECT MIN(token_created_at) FROM riviamigo.vehicle_credentials",
    )
    .fetch_optional(pool)
    .await?;
    let runtime = sqlx::query_as::<_, (Option<String>, bool, Option<String>)>(
        "SELECT MIN(worker_health), EXISTS(SELECT 1 FROM riviamigo.vehicle_runtime_state WHERE auth_state = 'needs_reauth'), MIN(worker_health_msg) FROM riviamigo.vehicle_runtime_state",
    )
    .fetch_one(pool)
    .await?;
    let auth_failed = runtime.1;
    let expected = issued_at.map(|at| at + RIVIAN_RENEWAL_INTERVAL);
    Ok(RivianConnectionStatus {
        credential_issued_at: issued_at,
        expected_renewal_at: expected,
        renewal_state: issued_at.map(|at| rivian_renewal_state(at, Utc::now(), auth_failed)),
        observed_health: runtime.0,
        observed_error: runtime.2,
    })
}

/// Restore the non-secret provider defaults after a fresh install or a
/// sanitized restore. Custom endpoints and encrypted credentials always win:
/// this only fills rows that are entirely absent.
pub async fn ensure_defaults(pool: &PgPool) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO riviamigo.external_connection_settings
             (id, enabled, mode, weather_precision, forecast_url, archive_url, base_url,
              light_url_template, dark_url_template, attribution, attribution_url,
              custom_autocomplete, allow_private_network)
           VALUES
             ('rivian_account', TRUE, 'remote', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE),
             ('open_meteo', TRUE, 'remote', 'approximate', 'https://api.open-meteo.com/v1/forecast', 'https://archive-api.open-meteo.com/v1/archive', NULL, NULL, NULL, 'Weather data by Open-Meteo', 'https://open-meteo.com/', FALSE, FALSE),
             ('nominatim', TRUE, 'remote', NULL, NULL, NULL, 'https://nominatim.openstreetmap.org', NULL, NULL, 'OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright', FALSE, FALSE),
             ('basemap', TRUE, 'remote', NULL, NULL, NULL, NULL, 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', 'OpenStreetMap contributors and CARTO', 'https://carto.com/attributions', FALSE, FALSE),
             ('iconify', TRUE, 'remote', NULL, NULL, NULL, 'https://api.iconify.design', NULL, NULL, 'Iconify', 'https://iconify.design/', FALSE, FALSE),
             ('s3_backup', FALSE, 'disabled', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE)
           ON CONFLICT (id) DO NOTHING"#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

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
    /// Deprecated compatibility flag. New policy is represented by the CIDR
    /// allowlist and policy state below.
    pub allow_private_network: bool,
    pub private_network_allowlist: Vec<String>,
    pub private_network_policy_state: String,
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
    pub last_test_at: Option<DateTime<Utc>>,
    pub last_test_ok: Option<bool>,
    pub last_test_error: Option<String>,
}

pub async fn load(pool: &PgPool, id: &str) -> Result<ConnectionSettingsRow, AppError> {
    sqlx::query_as::<_, ConnectionSettingsRow>(
        r#"SELECT id, enabled, mode, weather_precision, forecast_url, archive_url,
                  base_url, light_url_template, dark_url_template, attribution,
                  attribution_url, request_identifier, custom_autocomplete,
                  allow_private_network, private_network_allowlist::text[] AS private_network_allowlist,
                  private_network_policy_state, api_key_encrypted, bearer_token_encrypted,
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
        private_network_allowlist: Vec<String>,
        private_network_policy_state: String,
        api_key_encrypted: Option<Vec<u8>>,
        bearer_token_encrypted: Option<Vec<u8>>,
        updated_at: DateTime<Utc>,
        last_attempt_at: Option<DateTime<Utc>>,
        last_success_at: Option<DateTime<Utc>>,
        last_error: Option<String>,
        usage_date: NaiveDate,
        request_count: i32,
        last_test_at: Option<DateTime<Utc>>,
        last_test_ok: Option<bool>,
        last_test_error: Option<String>,
    }

    let rows = sqlx::query_as::<_, JoinedRow>(
        r#"SELECT s.id, s.enabled, s.mode, s.weather_precision, s.forecast_url,
                  s.archive_url, s.base_url, s.light_url_template, s.dark_url_template,
                  s.attribution, s.attribution_url, s.request_identifier,
                  s.custom_autocomplete, s.allow_private_network,
                  s.private_network_allowlist::text[] AS private_network_allowlist,
                  s.private_network_policy_state, s.api_key_encrypted,
                  s.bearer_token_encrypted, s.updated_at,
                  a.last_attempt_at, a.last_success_at, a.last_error,
                  a.last_test_at, a.last_test_ok, a.last_test_error,
                  COALESCE(a.usage_date, CURRENT_DATE) AS usage_date,
                  COALESCE(a.request_count, 0) AS request_count
           FROM riviamigo.external_connection_settings s
           LEFT JOIN riviamigo.external_connection_activity a ON a.connection_id = s.id
           ORDER BY CASE s.id
             WHEN 'rivian_account' THEN 1 WHEN 'open_meteo' THEN 2
             WHEN 'nominatim' THEN 3 WHEN 'basemap' THEN 4
             WHEN 'iconify' THEN 5 ELSE 6 END"#,
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
                    private_network_allowlist: row.private_network_allowlist,
                    private_network_policy_state: row.private_network_policy_state,
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
                    last_test_at: row.last_test_at,
                    last_test_ok: row.last_test_ok,
                    last_test_error: row.last_test_error,
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
        r#"INSERT INTO riviamigo.external_connection_activity
             (connection_id, last_attempt_at, last_success_at, last_error, usage_date, request_count)
           VALUES ($1, now(), now(), NULL, CURRENT_DATE, 0)
           ON CONFLICT (connection_id) DO UPDATE SET last_success_at = now(), last_error = NULL"#,
    )
    .bind(id)
    .execute(pool)
    .await;
}

pub async fn record_failure(pool: &PgPool, id: &str, message: &str) {
    let sanitized = sanitize_error(message);
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.external_connection_activity
             (connection_id, last_attempt_at, last_error, usage_date, request_count)
           VALUES ($1, now(), $2, CURRENT_DATE, 0)
           ON CONFLICT (connection_id) DO UPDATE SET last_error = EXCLUDED.last_error"#,
    )
    .bind(id)
    .bind(sanitized)
    .execute(pool)
    .await;
}

pub async fn record_test(pool: &PgPool, id: &str, ok: bool, message: Option<&str>) {
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.external_connection_activity
             (connection_id, last_attempt_at, usage_date, request_count, last_test_at, last_test_ok, last_test_error)
           VALUES ($1, now(), CURRENT_DATE, 0, now(), $2, $3)
           ON CONFLICT (connection_id) DO UPDATE SET
             last_test_at = now(), last_test_ok = EXCLUDED.last_test_ok, last_test_error = EXCLUDED.last_test_error"#,
    )
    .bind(id)
    .bind(ok)
    .bind(message.map(sanitize_error))
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
    use super::{rivian_renewal_state, sanitize_error, RivianRenewalState};
    use chrono::{Duration, TimeZone, Utc};

    #[test]
    fn strips_query_strings_and_bounds_error_text() {
        let result = sanitize_error(&format!(
            "request https://example.test/path?lat=1&lng=2 {}",
            "x".repeat(300)
        ));
        assert!(!result.contains("lat="));
        assert!(result.len() <= 240);
    }

    #[test]
    fn derives_advisory_renewal_boundaries_and_auth_override() {
        let issued = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        assert!(matches!(
            rivian_renewal_state(issued, issued + Duration::days(172), false),
            RivianRenewalState::Healthy
        ));
        assert!(matches!(
            rivian_renewal_state(issued, issued + Duration::days(173), false),
            RivianRenewalState::RenewalSoon
        ));
        assert!(matches!(
            rivian_renewal_state(issued, issued + Duration::days(180), false),
            RivianRenewalState::RenewalDue
        ));
        assert!(matches!(
            rivian_renewal_state(issued, issued + Duration::days(1), true),
            RivianRenewalState::ReauthRequired
        ));
    }
}
