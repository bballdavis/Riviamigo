use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderValue, Response, StatusCode},
    routing::{get, post, put},
    Json, Router,
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use tokio::fs;
use uuid::Uuid;

use crate::{
    errors::AppError,
    ingestion::session_store::encrypt_json,
    middleware::auth::{AppState, AuthUser},
    services::backups as backup_service,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/backups", get(get_backup_overview))
        .route("/admin/backups/settings", put(update_backup_settings))
        .route("/admin/backups/run", post(run_backup_now))
        .route(
            "/admin/backups/artifacts/{artifact_id}/download",
            get(download_backup_artifact),
        )
        .route(
            "/admin/backups/restore-requests",
            post(create_restore_request),
        )
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
            _ => Err(AppError::Validation("target_type must be s3".into())),
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
            _ => Err(AppError::Validation("backup run status is invalid".into())),
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
            _ => Err(AppError::Validation("backup run trigger is invalid".into())),
        }
    }
}

#[derive(Debug, Serialize)]
struct BackupOverviewResponse {
    settings: BackupSettingsResponse,
    recent_runs: Vec<BackupRunResponse>,
    recent_runs_total: i64,
    recent_runs_page: i64,
    recent_runs_per_page: i64,
    artifacts: Vec<BackupArtifactResponse>,
    restore_requests: Vec<BackupRestoreRequestResponse>,
    latest_successful_run: Option<BackupRunResponse>,
    next_run_at: Option<DateTime<Utc>>,
    runtime_readiness: BackupRuntimeReadinessResponse,
}

#[derive(Debug, Serialize)]
struct BackupRuntimeReadinessResponse {
    pg_dump_available: bool,
    run_now_allowed: bool,
    reason: Option<String>,
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

#[derive(Debug, Serialize)]
struct BackupArtifactResponse {
    id: Uuid,
    run_id: Uuid,
    storage_type: String,
    file_name: String,
    storage_path: String,
    size_bytes: i64,
    checksum_sha256: String,
    manifest: Value,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct BackupRestoreRequestResponse {
    id: Uuid,
    artifact_id: Uuid,
    requested_by: Option<Uuid>,
    status: String,
    confirmation_phrase: String,
    notes: Option<String>,
    error_message: Option<String>,
    requested_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct BackupRunExecutionResponse {
    run: BackupRunResponse,
    artifact: BackupArtifactResponse,
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

#[derive(Debug, Deserialize)]
struct CreateRestoreRequestBody {
    artifact_id: Uuid,
    confirmation_phrase: String,
    notes: Option<String>,
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

#[derive(Debug, FromRow)]
struct BackupArtifactRow {
    id: Uuid,
    run_id: Uuid,
    storage_type: String,
    file_name: String,
    storage_path: String,
    size_bytes: i64,
    checksum_sha256: String,
    manifest: Value,
    created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct BackupRestoreRequestRow {
    id: Uuid,
    artifact_id: Uuid,
    requested_by: Option<Uuid>,
    status: String,
    confirmation_phrase: String,
    notes: Option<String>,
    error_message: Option<String>,
    requested_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

async fn get_backup_overview(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Query(query): axum::extract::Query<BackupOverviewQuery>,
) -> Result<Json<BackupOverviewResponse>, AppError> {
    require_admin(&state, auth.user_id).await?;

    let settings = load_settings(&state).await?;
    let recent_runs_page = query.page.unwrap_or(1).max(1);
    let recent_runs_per_page = query.per_page.unwrap_or(10).clamp(1, 100);
    let recent_runs_total = count_recent_runs(&state).await?;
    let recent_runs = load_recent_runs(&state, recent_runs_page, recent_runs_per_page).await?;
    let artifacts = load_artifacts(&state).await?;
    let restore_requests = load_restore_requests(&state).await?;
    let latest_successful_run = load_latest_successful_run(&state).await?;
    let next_run_at = compute_next_run(&settings)?;
    let readiness = backup_service::runtime_readiness(&state.config).await;

    Ok(Json(BackupOverviewResponse {
        settings,
        recent_runs,
        recent_runs_total,
        recent_runs_page: recent_runs_page as i64,
        recent_runs_per_page: recent_runs_per_page as i64,
        artifacts,
        restore_requests,
        latest_successful_run,
        next_run_at,
        runtime_readiness: BackupRuntimeReadinessResponse {
            pg_dump_available: readiness.pg_dump_available,
            run_now_allowed: readiness.run_now_allowed,
            reason: readiness.reason,
        },
    }))
}

async fn download_backup_artifact(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(artifact_id): axum::extract::Path<Uuid>,
) -> Result<Response<Body>, AppError> {
    require_admin(&state, auth.user_id).await?;
    let artifact = load_artifact_by_id(&state, artifact_id).await?;
    let bytes = fs::read(&artifact.storage_path)
        .await
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound,
            _ => AppError::Internal(anyhow::anyhow!("failed to read backup artifact: {error}")),
        })?;

    let safe_name = artifact.file_name.replace('"', "_");
    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    let content_disposition = HeaderValue::from_str(&format!(
        "attachment; filename=\"{safe_name}\""
    ))
    .map_err(|error| AppError::Internal(anyhow::anyhow!("invalid download filename: {error}")))?;
    response
        .headers_mut()
        .insert(header::CONTENT_DISPOSITION, content_disposition);
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
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
    validate_target(body.target_type, body.enabled, &body.endpoint, &body.bucket)?;

    let normalized_day_of_week = match body.frequency {
        BackupFrequency::Weekly => body.day_of_week,
        _ => None,
    };
    let normalized_day_of_month = match body.frequency {
        BackupFrequency::Monthly => body.day_of_month,
        _ => None,
    };

    let normalized_endpoint = body.endpoint.trim().to_string();
    let normalized_region = body
        .region
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let normalized_bucket = body.bucket.trim().to_string();
    let normalized_prefix = normalize_prefix(&body.prefix);
    let normalized_access_key = body
        .access_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
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

async fn run_backup_now(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<(StatusCode, Json<BackupRunExecutionResponse>), AppError> {
    require_admin(&state, auth.user_id).await?;

    let result = backup_service::run_backup_now(
        &state.pool,
        &state.config,
        Some(auth.user_id),
        backup_service::BackupRunTrigger::Manual,
    )
    .await?;

    let run = load_run_by_id(&state, result.run_id).await?;
    let artifact = load_artifact_by_id(&state, result.artifact_id).await?;

    Ok((
        StatusCode::CREATED,
        Json(BackupRunExecutionResponse { run, artifact }),
    ))
}

async fn create_restore_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateRestoreRequestBody>,
) -> Result<(StatusCode, Json<BackupRestoreRequestResponse>), AppError> {
    require_admin(&state, auth.user_id).await?;

    let request_id = backup_service::create_restore_request(
        &state.pool,
        body.artifact_id,
        auth.user_id,
        &body.confirmation_phrase,
        body.notes,
    )
    .await?;

    let request = load_restore_request_by_id(&state, request_id).await?;
    Ok((StatusCode::CREATED, Json(request)))
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

async fn count_recent_runs(state: &AppState) -> Result<i64, AppError> {
    let total = sqlx::query_scalar("SELECT COUNT(*) FROM riviamigo.backup_runs")
        .fetch_one(&state.pool)
        .await?;
    Ok(total)
}

async fn load_recent_runs(
    state: &AppState,
    page: u32,
    per_page: u32,
) -> Result<Vec<BackupRunResponse>, AppError> {
    let limit = i64::from(per_page);
    let offset = i64::from(page.saturating_sub(1)) * i64::from(per_page);
    let rows = sqlx::query_as::<_, BackupRunRow>(
        r#"
        SELECT id, trigger, status, artifact_key, started_at, completed_at, error_message, created_at, updated_at
        FROM riviamigo.backup_runs
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
        "#,
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    rows.into_iter().map(map_run_row).collect()
}

async fn load_run_by_id(state: &AppState, run_id: Uuid) -> Result<BackupRunResponse, AppError> {
    let row = sqlx::query_as::<_, BackupRunRow>(
        r#"
        SELECT id, trigger, status, artifact_key, started_at, completed_at, error_message, created_at, updated_at
        FROM riviamigo.backup_runs
        WHERE id = $1
        "#,
    )
    .bind(run_id)
    .fetch_optional(&state.pool)
    .await?;

    match row {
        Some(row) => map_run_row(row),
        None => Err(AppError::NotFound),
    }
}

async fn load_artifacts(state: &AppState) -> Result<Vec<BackupArtifactResponse>, AppError> {
    let rows = sqlx::query_as::<_, BackupArtifactRow>(
        r#"
        SELECT id, run_id, storage_type, file_name, storage_path, size_bytes, checksum_sha256, manifest, created_at
        FROM riviamigo.backup_artifacts
        ORDER BY created_at DESC
        LIMIT 10
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(rows.into_iter().map(map_artifact_row).collect())
}

async fn load_artifact_by_id(
    state: &AppState,
    artifact_id: Uuid,
) -> Result<BackupArtifactResponse, AppError> {
    let row = sqlx::query_as::<_, BackupArtifactRow>(
        r#"
        SELECT id, run_id, storage_type, file_name, storage_path, size_bytes, checksum_sha256, manifest, created_at
        FROM riviamigo.backup_artifacts
        WHERE id = $1
        "#,
    )
    .bind(artifact_id)
    .fetch_optional(&state.pool)
    .await?;

    match row {
        Some(row) => Ok(map_artifact_row(row)),
        None => Err(AppError::NotFound),
    }
}

async fn load_restore_requests(
    state: &AppState,
) -> Result<Vec<BackupRestoreRequestResponse>, AppError> {
    let rows = sqlx::query_as::<_, BackupRestoreRequestRow>(
        r#"
        SELECT id, artifact_id, requested_by, status, confirmation_phrase, notes, error_message, requested_at, updated_at
        FROM riviamigo.backup_restore_requests
        ORDER BY requested_at DESC
        LIMIT 10
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(rows.into_iter().map(map_restore_request_row).collect())
}

async fn load_restore_request_by_id(
    state: &AppState,
    request_id: Uuid,
) -> Result<BackupRestoreRequestResponse, AppError> {
    let row = sqlx::query_as::<_, BackupRestoreRequestRow>(
        r#"
        SELECT id, artifact_id, requested_by, status, confirmation_phrase, notes, error_message, requested_at, updated_at
        FROM riviamigo.backup_restore_requests
        WHERE id = $1
        "#,
    )
    .bind(request_id)
    .fetch_optional(&state.pool)
    .await?;

    match row {
        Some(row) => Ok(map_restore_request_row(row)),
        None => Err(AppError::NotFound),
    }
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

fn map_artifact_row(row: BackupArtifactRow) -> BackupArtifactResponse {
    BackupArtifactResponse {
        id: row.id,
        run_id: row.run_id,
        storage_type: row.storage_type,
        file_name: row.file_name,
        storage_path: row.storage_path,
        size_bytes: row.size_bytes,
        checksum_sha256: row.checksum_sha256,
        manifest: row.manifest,
        created_at: row.created_at,
    }
}

fn map_restore_request_row(row: BackupRestoreRequestRow) -> BackupRestoreRequestResponse {
    BackupRestoreRequestResponse {
        id: row.id,
        artifact_id: row.artifact_id,
        requested_by: row.requested_by,
        status: row.status,
        confirmation_phrase: row.confirmation_phrase,
        notes: row.notes,
        error_message: row.error_message,
        requested_at: row.requested_at,
        updated_at: row.updated_at,
    }
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
    endpoint: &str,
    bucket: &str,
) -> Result<(), AppError> {
    if target_type != BackupTargetType::S3 {
        return Err(AppError::Validation("target_type must be s3".into()));
    }
    // Bucket is only required when an S3 endpoint is configured; local-only runs
    // (empty endpoint) do not need one.
    if enabled && !endpoint.trim().is_empty() && bucket.trim().is_empty() {
        return Err(AppError::Validation(
            "bucket is required when an S3 endpoint is configured".into(),
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

    let identity = age_key.parse::<age::x25519::Identity>().map_err(|_| {
        AppError::Internal(anyhow::anyhow!("invalid age key for backup secret storage"))
    })?;
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
        BackupFrequency::Weekly => {
            next_weekly_run(now_local, run_at, settings.day_of_week.unwrap_or(0))
        }
        BackupFrequency::Monthly => {
            next_monthly_run(now_local, run_at, settings.day_of_month.unwrap_or(1))
        }
    };

    Ok(Some(next_local.with_timezone(&Utc)))
}

fn next_daily_run(now_local: chrono::DateTime<Tz>, run_at: NaiveTime) -> chrono::DateTime<Tz> {
    let candidate = combine_local(now_local.timezone(), now_local.date_naive(), run_at);
    if candidate <= now_local {
        combine_local(
            now_local.timezone(),
            now_local.date_naive() + Duration::days(1),
            run_at,
        )
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
    let current_month_day =
        clamp_day_of_month(current_date.year(), current_date.month(), day_of_month);
    let mut candidate_date =
        NaiveDate::from_ymd_opt(current_date.year(), current_date.month(), current_month_day)
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
    (day_of_month.max(1) as u32).min(max_day)
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
    let role = sqlx::query_scalar!("SELECT role FROM riviamigo.users WHERE id = $1", user_id)
        .fetch_optional(&state.pool)
        .await?;

    match role.as_deref() {
        Some("admin") | Some("super_user") => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}
#[derive(Debug, Deserialize)]
struct BackupOverviewQuery {
    page: Option<u32>,
    per_page: Option<u32>,
}
