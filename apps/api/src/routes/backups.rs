use axum::{
    extract::State,
    routing::{get, put},
    Json, Router,
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    errors::AppError,
    ingestion::session_store::encrypt_json,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/backups", get(get_backup_overview))
        .route("/admin/backups/settings", put(update_backup_settings))
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum BackupFrequency {
    Daily,
    Weekly,
    Monthly,
}

impl BackupFrequency {
    fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
        }
    }
}

impl TryFrom<&str> for BackupFrequency {
    type Error = AppError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "daily" => Ok(Self::Daily),
            "weekly" => Ok(Self::Weekly),
            "monthly" => Ok(Self::Monthly),
            _ => Err(AppError::Validation(
                "frequency must be daily, weekly, or monthly".into(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum BackupTargetType {
    S3,
}

impl BackupTargetType {
    fn as_str(self) -> &'static str {
        match self {
            Self::S3 => "s3",
        }
    }
}

impl TryFrom<&str> for BackupTargetType {
    type Error = AppError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "s3" => Ok(Self::S3),
            _ => Err(AppError::Validation(
                "target_type must be s3".into(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum BackupRunStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Canceled,
}

impl TryFrom<&str> for BackupRunStatus {
    type Error = AppError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "pending" => Ok(Self::Pending),
            "running" => Ok(Self::Running),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            "canceled" => Ok(Self::Canceled),
            _ => Err(AppError::Validation(
                "backup run status is invalid".into(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum BackupRunTrigger {
    Manual,
    Scheduled,
    Restore,
}

impl TryFrom<&str> for BackupRunTrigger {
    type Error = AppError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "manual" => Ok(Self::Manual),
            "scheduled" => Ok(Self::Scheduled),
            "restore" => Ok(Self::Restore),
            _ => Err(AppError::Validation(
                "backup run trigger is invalid".into(),
            )),
        }
    }
}

#[derive(Debug, Serialize)]
struct BackupOverviewResponse {
    settings: BackupSettingsResponse,
    recent_runs: Vec<BackupRunResponse>,
    latest_successful_run: Option<BackupRunResponse>,
    next_run_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
struct BackupSettingsResponse {
    enabled: bool,
    frequency: BackupFrequency,
    run_at: String,
    timezone: String,
    day_of_week: Option<i16>,
    day_of_month: Option<i16>,
    retention_count: i32,
    target_type: BackupTargetType,
    endpoint: String,
    region: Option<String>,
    bucket: String,
    prefix: String,
    access_key: Option<String>,
    has_secret_key: bool,
    updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
struct BackupRunResponse {
    id: Uuid,
    trigger: BackupRunTrigger,
    status: BackupRunStatus,
    artifact_key: Option<String>,
    started_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    error_message: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct UpdateBackupSettingsBody {
    enabled: bool,
    frequency: BackupFrequency,
    run_at: String,
    timezone: String,
    day_of_week: Option<i16>,
    day_of_month: Option<i16>,
    retention_count: i32,
    target_type: BackupTargetType,
    endpoint: String,
    region: Option<String>,
    bucket: String,
    prefix: String,
    access_key: Option<String>,
    secret_key: Option<String>,
    clear_secret_key: Option<bool>,
}

#[derive(Debug, FromRow)]
struct BackupSettingsRow {
    enabled: bool,
    frequency: String,
    run_at: NaiveTime,
    timezone: String,
    day_of_week: Option<i16>,
    day_of_month: Option<i16>,
    retention_count: i32,
    target_type: String,
    endpoint: String,
    region: Option<String>,
    bucket: String,
    prefix: String,
    access_key: Option<String>,
    has_secret_key: bool,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct BackupRunRow {
    id: Uuid,
    trigger: String,
    status: String,
    artifact_key: Option<String>,
    started_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    error_message: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

async fn get_backup_overview(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<BackupOverviewResponse>, AppError> {
    require_admin(&state, auth.user_id).await?;

    let settings = load_settings(&state).await?;
    let recent_runs = load_recent_runs(&state).await?;
    let latest_successful_run = load_latest_successful_run(&state).await?;
    let next_run_at = compute_next_run(&settings)?;

    Ok(Json(BackupOverviewResponse {
        settings,
        recent_runs,
        latest_successful_run,
        next_run_at,
    }))
}

async fn update_backup_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdateBackupSettingsBody>,
) -> Result<Json<BackupSettingsResponse>, AppError> {
    require_admin(&state, auth.user_id).await?;

    let run_at = parse_run_time(&body.run_at)?;
    let timezone = parse_timezone(&body.timezone)?;
    validate_schedule(&body.frequency, body.day_of_week, body.day_of_month)?;
    validate_target(&body.target_type, body.enabled, &body.bucket)?;

    let normalized_day_of_week = match body.frequency {
        BackupFrequency::Weekly => body.day_of_week,
        _ => None,
    };
    let normalized_day_of_month = match body.frequency {
        BackupFrequency::Monthly => body.day_of_month,
        _ => None,
    };

    let normalized_endpoint = body.endpoint.trim().to_string();
    let normalized_region = body.region.as_deref().map(str::trim).filter(|value| !value.is_empty()).map(str::to_string);
    let normalized_bucket = body.bucket.trim().to_string();
    let normalized_prefix = normalize_prefix(&body.prefix);
    let normalized_access_key = body.access_key.as_deref().map(str::trim).filter(|value| !value.is_empty()).map(str::to_string);
    let clear_secret_key = body.clear_secret_key.unwrap_or(false);
    let encrypted_secret = encrypt_secret(state.age_key.as_str(), body.secret_key.as_deref())?;

    sqlx::query(
        r#"
        INSERT INTO riviamigo.backup_settings (
            id, enabled, frequency, run_at, timezone, day_of_week, day_of_month,
            retention_count, target_type, endpoint, region, bucket, prefix,
            access_key, secret_key_encrypted, updated_at, updated_by
        )
        VALUES (
            TRUE, $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12,
            $13, $14, now(), $15
        )
        ON CONFLICT (id) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            frequency = EXCLUDED.frequency,
            run_at = EXCLUDED.run_at,
            timezone = EXCLUDED.timezone,
            day_of_week = EXCLUDED.day_of_week,
            day_of_month = EXCLUDED.day_of_month,
            retention_count = EXCLUDED.retention_count,
            target_type = EXCLUDED.target_type,
            endpoint = EXCLUDED.endpoint,
            region = EXCLUDED.region,
            bucket = EXCLUDED.bucket,
            prefix = EXCLUDED.prefix,
            access_key = EXCLUDED.access_key,
            secret_key_encrypted = CASE
                WHEN $16 THEN NULL
                WHEN $14 IS NOT NULL THEN $14
                ELSE riviamigo.backup_settings.secret_key_encrypted
            END,
            updated_at = now(),
            updated_by = EXCLUDED.updated_by
        "#,
    )
    .bind(body.enabled)
    .bind(body.frequency.as_str())
    .bind(run_at)
    .bind(timezone.name())
    .bind(normalized_day_of_week)
    .bind(normalized_day_of_month)
    .bind(body.retention_count)
    .bind(body.target_type.as_str())
    .bind(normalized_endpoint)
    .bind(normalized_region)
    .bind(normalized_bucket)
    .bind(normalized_prefix)
    .bind(normalized_access_key)
    .bind(encrypted_secret)
    .bind(auth.user_id)
    .bind(clear_secret_key)
    .execute(&state.pool)
    .await?;

    Ok(Json(load_settings(&state).await?))
}

async fn load_settings(state: &AppState) -> Result<BackupSettingsResponse, AppError> {
    let row = sqlx::query_as::<_, BackupSettingsRow>(
        r#"
        SELECT
            enabled,
            frequency,
            run_at,
            timezone,
            day_of_week,
            day_of_month,
            retention_count,
            target_type,
            endpoint,
            region,
            bucket,
            prefix,
            access_key,
            secret_key_encrypted IS NOT NULL AS has_secret_key,
            updated_at
        FROM riviamigo.backup_settings
        WHERE id = TRUE
        "#,
    )
    .fetch_optional(&state.pool)
    .await?;

    match row {
        Some(row) => map_settings_row(row),
        None => Ok(default_settings()),
    }
}

async fn load_recent_runs(state: &AppState) -> Result<Vec<BackupRunResponse>, AppError> {
    let rows = sqlx::query_as::<_, BackupRunRow>(
        r#"
        SELECT id, trigger, status, artifact_key, started_at, completed_at, error_message, created_at, updated_at
        FROM riviamigo.backup_runs
        ORDER BY created_at DESC
        LIMIT 10
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    rows.into_iter().map(map_run_row).collect()
}

async fn load_latest_successful_run(
    state: &AppState,
) -> Result<Option<BackupRunResponse>, AppError> {
    let row = sqlx::query_as::<_, BackupRunRow>(
        r#"
        SELECT id, trigger, status, artifact_key, started_at, completed_at, error_message, created_at, updated_at
        FROM riviamigo.backup_runs
        WHERE status = 'succeeded'
        ORDER BY completed_at DESC NULLS LAST, created_at DESC
        LIMIT 1
        "#,
    )
    .fetch_optional(&state.pool)
    .await?;

    row.map(map_run_row).transpose()
}

fn map_settings_row(row: BackupSettingsRow) -> Result<BackupSettingsResponse, AppError> {
    Ok(BackupSettingsResponse {
        enabled: row.enabled,
        frequency: BackupFrequency::try_from(row.frequency.as_str())?,
        run_at: row.run_at.format("%H:%M").to_string(),
        timezone: row.timezone,
        day_of_week: row.day_of_week,
        day_of_month: row.day_of_month,
        retention_count: row.retention_count,
        target_type: BackupTargetType::try_from(row.target_type.as_str())?,
        endpoint: row.endpoint,
        region: row.region,
        bucket: row.bucket,
        prefix: row.prefix,
        access_key: row.access_key,
        has_secret_key: row.has_secret_key,
        updated_at: Some(row.updated_at),
    })
}

fn map_run_row(row: BackupRunRow) -> Result<BackupRunResponse, AppError> {
    Ok(BackupRunResponse {
        id: row.id,
        trigger: BackupRunTrigger::try_from(row.trigger.as_str())?,
        status: BackupRunStatus::try_from(row.status.as_str())?,
        artifact_key: row.artifact_key,
        started_at: row.started_at,
        completed_at: row.completed_at,
        error_message: row.error_message,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn default_settings() -> BackupSettingsResponse {
    BackupSettingsResponse {
        enabled: false,
        frequency: BackupFrequency::Weekly,
        run_at: "03:00".into(),
        timezone: "UTC".into(),
        day_of_week: Some(0),
        day_of_month: Some(1),
        retention_count: 8,
        target_type: BackupTargetType::S3,
        endpoint: String::new(),
        region: None,
        bucket: String::new(),
        prefix: "riviamigo".into(),
        access_key: None,
        has_secret_key: false,
        updated_at: None,
    }
}

fn parse_run_time(value: &str) -> Result<NaiveTime, AppError> {
    NaiveTime::parse_from_str(value.trim(), "%H:%M")
        .map_err(|_| AppError::Validation("run_at must use HH:MM 24-hour time".into()))
}

fn parse_timezone(value: &str) -> Result<Tz, AppError> {
    value
        .trim()
        .parse::<Tz>()
        .map_err(|_| AppError::Validation("timezone must be a valid IANA timezone".into()))
}

fn validate_schedule(
    frequency: &BackupFrequency,
    day_of_week: Option<i16>,
    day_of_month: Option<i16>,
) -> Result<(), AppError> {
    match frequency {
        BackupFrequency::Daily => Ok(()),
        BackupFrequency::Weekly => match day_of_week {
            Some(value) if (0..=6).contains(&value) => Ok(()),
            _ => Err(AppError::Validation(
                "weekly backups require day_of_week between 0 and 6".into(),
            )),
        },
        BackupFrequency::Monthly => match day_of_month {
            Some(value) if (1..=31).contains(&value) => Ok(()),
            _ => Err(AppError::Validation(
                "monthly backups require day_of_month between 1 and 31".into(),
            )),
        },
    }
}

fn validate_target(
    target_type: BackupTargetType,
    enabled: bool,
    bucket: &str,
) -> Result<(), AppError> {
    if target_type != BackupTargetType::S3 {
        return Err(AppError::Validation("target_type must be s3".into()));
    }
    if enabled && bucket.trim().is_empty() {
        return Err(AppError::Validation(
            "bucket is required when automatic backups are enabled".into(),
        ));
    }
    Ok(())
}

fn normalize_prefix(value: &str) -> String {
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        "riviamigo".into()
    } else {
        trimmed.into()
    }
}

fn encrypt_secret(age_key: &str, secret_key: Option<&str>) -> Result<Option<Vec<u8>>, AppError> {
    let Some(secret_key) = secret_key.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    let identity = age_key
        .parse::<age::x25519::Identity>()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid age key for backup secret storage")))?;
    let ciphertext = encrypt_json(&secret_key.to_string(), &identity)?;
    Ok(Some(ciphertext))
}

fn compute_next_run(settings: &BackupSettingsResponse) -> Result<Option<DateTime<Utc>>, AppError> {
    if !settings.enabled {
        return Ok(None);
    }

    let timezone = parse_timezone(&settings.timezone)?;
    let run_at = parse_run_time(&settings.run_at)?;
    let now_local = Utc::now().with_timezone(&timezone);

    let next_local = match settings.frequency {
        BackupFrequency::Daily => next_daily_run(now_local, run_at),
        BackupFrequency::Weekly => next_weekly_run(now_local, run_at, settings.day_of_week.unwrap_or(0)),
        BackupFrequency::Monthly => next_monthly_run(now_local, run_at, settings.day_of_month.unwrap_or(1)),
    };

    Ok(Some(next_local.with_timezone(&Utc)))
}

fn next_daily_run(now_local: chrono::DateTime<Tz>, run_at: NaiveTime) -> chrono::DateTime<Tz> {
    let candidate = combine_local(now_local.timezone(), now_local.date_naive(), run_at);
    if candidate <= now_local {
        combine_local(now_local.timezone(), now_local.date_naive() + Duration::days(1), run_at)
    } else {
        candidate
    }
}

fn next_weekly_run(
    now_local: chrono::DateTime<Tz>,
    run_at: NaiveTime,
    day_of_week: i16,
) -> chrono::DateTime<Tz> {
    let current = now_local.weekday().num_days_from_sunday() as i16;
    let mut days_until = (day_of_week - current + 7) % 7;
    let mut candidate_date = now_local.date_naive() + Duration::days(i64::from(days_until));
    let mut candidate = combine_local(now_local.timezone(), candidate_date, run_at);

    if candidate <= now_local {
        days_until = 7;
        candidate_date += Duration::days(i64::from(days_until));
        candidate = combine_local(now_local.timezone(), candidate_date, run_at);
    }

    candidate
}

fn next_monthly_run(
    now_local: chrono::DateTime<Tz>,
    run_at: NaiveTime,
    day_of_month: i16,
) -> chrono::DateTime<Tz> {
    let current_date = now_local.date_naive();
    let current_month_day = clamp_day_of_month(current_date.year(), current_date.month(), day_of_month);
    let mut candidate_date = NaiveDate::from_ymd_opt(current_date.year(), current_date.month(), current_month_day)
        .unwrap_or(current_date);
    let mut candidate = combine_local(now_local.timezone(), candidate_date, run_at);

    if candidate <= now_local {
        let (year, month) = if current_date.month() == 12 {
            (current_date.year() + 1, 1)
        } else {
            (current_date.year(), current_date.month() + 1)
        };
        let next_day = clamp_day_of_month(year, month, day_of_month);
        candidate_date = NaiveDate::from_ymd_opt(year, month, next_day).unwrap_or(current_date);
        candidate = combine_local(now_local.timezone(), candidate_date, run_at);
    }

    candidate
}

fn clamp_day_of_month(year: i32, month: u32, day_of_month: i16) -> u32 {
    let max_day = days_in_month(year, month);
    day_of_month.max(1) as u32.min(max_day)
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_of_next_month = NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(year, month, 1).expect("valid month"));
    let last_of_current_month = first_of_next_month - Duration::days(1);
    last_of_current_month.day()
}

fn combine_local(timezone: Tz, date: NaiveDate, time: NaiveTime) -> chrono::DateTime<Tz> {
    let naive = NaiveDateTime::new(date, time);
    match timezone.from_local_datetime(&naive) {
        chrono::LocalResult::Single(value) => value,
        chrono::LocalResult::Ambiguous(first, second) => first.min(second),
        chrono::LocalResult::None => timezone.from_utc_datetime(&naive),
    }
}

async fn require_admin(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    let role: Option<String> = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?;

    match role.as_deref() {
        Some("admin") => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}